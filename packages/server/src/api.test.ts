/**
 * Integration tests over the real HTTP surface and a real database.
 *
 * These exist for one reason above all others: the compliance gate must be
 * impossible to walk past. A unit test proving the engine says "blocked" is
 * worth little if a route forgets to ask it.
 */

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { buildServer } from './index.js';
import { seed } from './seed.js';
import type { Db } from './db.js';

let app: FastifyInstance;
let db: Db;
let cookie = '';

const json = (res: { payload: string }) => JSON.parse(res.payload);

async function call(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, body?: unknown) {
  return app.inject({
    method,
    url,
    payload: body === undefined ? undefined : (body as object),
    headers: cookie ? { cookie } : {},
  });
}

before(async () => {
  process.env['NODE_ENV'] = 'test';
  process.env['UKN_SEED_PASSWORD'] = 'test-password-1';
  process.env['UKN_PUBLIC_ORIGINS'] = 'https://uknitrates.com,https://www.uknitrates.com';
  const built = await buildServer(':memory:');
  app = built.app;
  db = built.db;
  seed(db);
  await app.ready();

  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'joshuanwobodo727@gmail.com', password: 'test-password-1' },
  });
  assert.equal(login.statusCode, 200);
  cookie = String(login.headers['set-cookie']).split(';')[0]!;
});

after(async () => {
  await app.close();
});

describe('auth', () => {
  it('refuses an unauthenticated read', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/accounts' });
    assert.equal(res.statusCode, 401);
  });

  it('rejects a wrong password', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'tom@reevewood.com', password: 'not-the-password' },
    });
    assert.equal(res.statusCode, 401);
  });
});

describe('seeded state', () => {
  it('loads only the two orders whose figures are actually recorded', async () => {
    const res = await call('GET', '/api/orders');
    assert.equal(json(res).data.orders.length, 2);
  });

  it('starts every notification position as unconfirmed rather than filed', async () => {
    const res = await call('GET', '/api/compliance');
    const data = json(res).data;
    assert.ok(data.notifications.every((n: { status: string }) => n.status === 'unknown'));
    assert.equal(data.readiness.sellable, false);
  });

  it('reports the seeded book as critically concentrated', async () => {
    const res = await call('GET', '/api/analytics/concentration');
    assert.equal(json(res).data.risk.severity, 'critical');
  });
});

describe('public intake', () => {
  it('accepts an enquiry and tells the sender nothing about screening', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/public/enquiry',
      payload: {
        companyName: 'Fenland Pyrotechnics Ltd',
        contactName: 'A. Buyer',
        email: 'buyer@example.com',
        sector: 'pyrotechnics',
        natureOfTrade: 'Display fireworks manufacture',
        productIds: ['kno3-13-0-46'],
        quantityKg: 2000,
        buyerType: 'business',
        source: 'google',
        sessionId: 'sess-1',
      },
    });
    assert.equal(res.statusCode, 200);
    const body = json(res).data;
    assert.equal(body.received, true);
    assert.equal(JSON.stringify(body).includes('indicator'), false);
  });

  it('raises a suspicious transaction on a cash, no-details bulk enquiry', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/public/enquiry',
      payload: {
        contactName: 'Walk-in',
        productIds: ['an-nitram-345'],
        quantityKg: 24_000,
        fulfilment: 'collection',
        buyerType: 'member_of_public',
        sessionId: 'sess-2',
      },
    });
    const res = await call('GET', '/api/compliance');
    const open = json(res).data.suspicious.filter((s: { status: string }) => s.status === 'open');
    assert.ok(open.length >= 1);
    assert.ok(open[0].indicators.length >= 2);
  });

  it('records a funnel event without a session', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/public/events',
      payload: { event: 'page_view', sessionId: 'sess-3', source: 'google' },
    });
    assert.equal(res.statusCode, 200);
  });

  it('counts the submitted enquiries in the funnel report', async () => {
    const res = await call('GET', '/api/analytics/funnel');
    const lead = json(res).data.report.stages.find((s: { stage: string }) => s.stage === 'lead');
    assert.ok(lead.count >= 2);
  });
});

describe('the compliance gate cannot be walked past', () => {
  let accountId = '';
  let dealId = '';

  it('converts an enquiry into an account and a deal', async () => {
    const list = await call('GET', '/api/enquiries');
    const enquiry = json(list).data.enquiries.find((e: { company_name: string | null }) =>
      e.company_name === 'Fenland Pyrotechnics Ltd',
    );
    assert.ok(enquiry);
    const res = await call('POST', `/api/enquiries/${enquiry.id}/convert`, {});
    assert.equal(res.statusCode, 200);
    ({ accountId, dealId } = json(res).data);
    assert.ok(accountId && dealId);
  });

  it('carries the enquiry’s trade details into a verification record automatically', async () => {
    const res = await call('GET', `/api/accounts/${accountId}`);
    const data = json(res).data;
    assert.equal(data.kyc.natureOfTrade, 'Display fireworks manufacture');
    assert.equal(data.kycAssessment.valid, false);
    assert.ok(data.kycAssessment.missingFields.includes('VAT number'));
  });

  it('prices a line and reports the deal as unsendable', async () => {
    const res = await call('POST', `/api/deals/${dealId}/lines`, {
      productId: 'kno3-13-0-46',
      quantityKg: 2000,
      costPerTonne: 65_000,
      sellPerTonne: 90_000,
    });
    assert.equal(res.statusCode, 200);
    const pricing = json(res).data.pricing;
    assert.equal(pricing.margin.grossMargin, 50_000);
    assert.equal(pricing.gate.decision, 'blocked');
    assert.equal(pricing.sendable, false);
  });

  it('refuses to issue the quote', async () => {
    const res = await call('POST', `/api/deals/${dealId}/quote`, {});
    assert.equal(res.statusCode, 422);
    assert.match(json(res).error, /buyer verification/i);
  });

  it('refuses to book the order too, not just the quote', async () => {
    const res = await call('POST', `/api/deals/${dealId}/win`, { orderedAt: '2026-09-10' });
    assert.equal(res.statusCode, 422);
  });

  it('still refuses when verification is filled in but never signed off', async () => {
    const res = await call('PUT', `/api/accounts/${accountId}/kyc`, {
      photoIdReference: 'PASS-991',
      photoIdType: 'passport',
      businessName: 'Fenland Pyrotechnics Ltd',
      businessAddress: 'Whaplode, Lincolnshire',
      vatNumber: 'GB999888777',
      natureOfTrade: 'Display fireworks manufacture',
      buyerType: 'business',
      signOff: false,
    });
    assert.equal(res.statusCode, 200);
    assert.equal(json(res).data.assessment.valid, false);
    const quote = await call('POST', `/api/deals/${dealId}/quote`, {});
    assert.equal(quote.statusCode, 422);
  });

  it('issues the quote once a named person signs the verification off', async () => {
    const kyc = await call('PUT', `/api/accounts/${accountId}/kyc`, { signOff: true });
    assert.equal(json(kyc).data.assessment.valid, true);
    assert.equal(json(kyc).data.kyc.verifiedBy, 'Joshua Nwobodo');

    const res = await call('POST', `/api/deals/${dealId}/quote`, { validUntil: '2026-10-10' });
    assert.equal(res.statusCode, 200);
    assert.equal(json(res).data.version, 1);
  });

  it('books the order and accrues commission on gross margin', async () => {
    const res = await call('POST', `/api/deals/${dealId}/win`, { orderedAt: '2026-09-10' });
    assert.equal(res.statusCode, 200);
    const commission = json(res).data.commission;
    // New account, so 25% of GBP 500 gross margin.
    assert.equal(commission.rateId, 'ukn-new');
    assert.equal(commission.amount, 12_500);
    assert.equal(commission.status, 'accrued');
  });

  it('holds the commission at accrued until the order is paid', async () => {
    const before = await call('GET', '/api/commission');
    assert.equal(json(before).data.summary.payable, 0);
    assert.equal(json(before).data.summary.accrued, 12_500);

    const orders = await call('GET', '/api/orders');
    const order = json(orders).data.orders.find((o: { deal_id: string }) => o.deal_id === dealId);
    await call('POST', `/api/orders/${order.id}/paid`, { paidAt: '2026-10-08' });

    const after = await call('GET', '/api/commission');
    assert.equal(json(after).data.summary.payable, 12_500);
    assert.equal(json(after).data.summary.accrued, 0);
  });

  it('moves the mix, because that order was specialty', async () => {
    const res = await call('GET', '/api/analytics/mix');
    assert.ok(json(res).data.mix.specialtyGmShareBps > 0);
  });
});

describe('margin floors', () => {
  it('refuses a quote on a specialty line priced near cost', async () => {
    const account = await call('POST', '/api/accounts', {
      name: 'Thin Margin Test Ltd',
      sector: 'glass',
      origin: 'new',
    });
    const accountId = json(account).data.id;
    await call('PUT', `/api/accounts/${accountId}/kyc`, {
      photoIdReference: 'DL-1',
      photoIdType: 'driving_licence',
      businessName: 'Thin Margin Test Ltd',
      businessAddress: 'Norfolk',
      vatNumber: 'GB111',
      natureOfTrade: 'Glass manufacture',
      buyerType: 'business',
      signOff: true,
    });
    const deal = await call('POST', '/api/deals', { accountId, title: 'Sodium nitrate, thin' });
    const dealId = json(deal).data.id;
    await call('POST', `/api/deals/${dealId}/lines`, {
      productId: 'nano3',
      quantityKg: 10_000,
      costPerTonne: 50_000,
      sellPerTonne: 52_000,
    });
    const res = await call('POST', `/api/deals/${dealId}/quote`, {});
    assert.equal(res.statusCode, 422);
    assert.match(json(res).error, /margin floor/i);
  });
});

describe('mix shift routing', () => {
  it('suggests potassium nitrate for a ceramics buyer on ammonium nitrate', async () => {
    const account = await call('POST', '/api/accounts', {
      name: 'Fen Ceramics Ltd',
      sector: 'ceramics',
      origin: 'new',
    });
    const accountId = json(account).data.id;
    const deal = await call('POST', '/api/deals', { accountId, title: 'AN enquiry' });
    const dealId = json(deal).data.id;
    const res = await call('POST', `/api/deals/${dealId}/lines`, {
      productId: 'an-nitram-345',
      quantityKg: 28_000,
      costPerTonne: 44_000,
      sellPerTonne: 46_100,
    });
    const pricing = json(res).data.pricing;
    assert.equal(pricing.mixShift.length, 1);
    assert.equal(pricing.mixShift[0].toProductId, 'kno3-13-0-46');
    assert.ok(pricing.guards.some((g: { code: string }) => g.code === 'all_commodity'));
  });

  it('checks an ammonium nitrate quote against the published AHDB price', async () => {
    const deals = await call('GET', '/api/deals');
    const deal = json(deals).data.deals.find((d: { title: string }) => d.title === 'AN enquiry');
    const res = await call('GET', `/api/deals/${deal.id}`);
    const anchors = json(res).data.pricing.anchors;
    assert.equal(anchors[0].check.anchored, true);
    assert.equal(anchors[0].check.verdict, 'at_anchor');
  });
});

describe('storage', () => {
  let accountId = '';
  let agreementId = '';

  it('creates an agreement with no rate, because the fee schedule is unknown', async () => {
    const account = await call('POST', '/api/accounts', { name: 'Storage Customer Ltd', sector: 'agriculture' });
    accountId = json(account).data.id;
    const res = await call('POST', '/api/storage/agreements', {
      accountId,
      feeBasis: 'per_pallet_month',
      ratePence: null,
      palletPositions: 13,
      startedAt: '2026-09-01',
    });
    assert.equal(res.statusCode, 200);
    agreementId = json(res).data.id;
  });

  it('raises the month as unresolved rather than charging zero', async () => {
    const res = await call('POST', '/api/storage/billing-run', {
      periodStart: '2026-09-01',
      periodEnd: '2026-09-30',
    });
    const result = json(res).data.results.find((r: { agreementId: string }) => r.agreementId === agreementId);
    assert.equal(result.fee, null);
    assert.equal(result.unresolved, true);
    assert.match(result.note, /Q3/);
  });

  it('does not double-charge when the billing run is repeated', async () => {
    const res = await call('POST', '/api/storage/billing-run', {
      periodStart: '2026-09-01',
      periodEnd: '2026-09-30',
    });
    assert.equal(json(res).data.charged, 0);
  });

  it('escalates to a critical breach when goods in cross 25 tonnes', async () => {
    const res = await call('POST', '/api/storage/movements', {
      agreementId,
      accountId,
      productId: 'an-nitram-345',
      direction: 'in',
      quantityKg: 30_000,
      occurredAt: '2026-09-05',
    });
    assert.equal(res.statusCode, 200);
    const breach = json(res).data.compliance.breaches.find((b: { thresholdId: string }) => b.thresholdId === 'dsear-25t');
    assert.equal(breach.severity, 'critical');
    assert.match(breach.action, /Fire & Rescue/);
  });

  it('goes quiet once the notification is recorded as filed', async () => {
    const res = await call('PUT', '/api/compliance/notifications/dsear-25t', {
      status: 'filed',
      filedAt: '2026-09-06',
      reference: 'HSE-TEST-1',
      note: 'Filed during test.',
    });
    const breach = json(res).data.breaches.find((b: { thresholdId: string }) => b.thresholdId === 'dsear-25t');
    assert.equal(breach.severity, 'info');
  });

  it('accrues storage commission once a rate exists', async () => {
    const account = await call('POST', '/api/accounts', { name: 'Rated Storage Ltd' });
    const ratedAccountId = json(account).data.id;
    await call('POST', '/api/storage/agreements', {
      accountId: ratedAccountId,
      feeBasis: 'per_pallet_month',
      ratePence: 1_200,
      palletPositions: 10,
      startedAt: '2026-08-01',
    });
    await call('POST', '/api/storage/billing-run', { periodStart: '2026-08-01', periodEnd: '2026-08-31' });
    const res = await call('GET', '/api/commission');
    const storage = json(res).data.entries.find((e: { source_type: string }) => e.source_type === 'storage_period');
    assert.ok(storage);
    // 10 positions at GBP 12 is GBP 120, and 25% of that is GBP 30.
    assert.equal(storage.basis_amount, 12_000);
    assert.equal(storage.amount, 3_000);
  });
});

describe('how an account takes the material', () => {
  let accountId = '';

  it('records the nitrate, the fulfilment and the trade on creation', async () => {
    const res = await call('POST', '/api/accounts', {
      name: 'Fen Growers Co-op',
      sector: 'horticulture',
      natureOfTrade: 'Protected salad under glass',
      preferredProductId: 'can',
      fulfilmentPreference: 'storage',
      typicalOrderKg: 8000,
    });
    assert.equal(res.statusCode, 200);
    accountId = json(res).data.id;

    const list = await call('GET', '/api/accounts?search=Fen Growers');
    const row = json(list).data.accounts[0];
    assert.equal(row.fulfilment_preference, 'storage');
    assert.equal(row.preferred_product_name, 'Calcium nitrate');
    assert.equal(row.preferred_product_class, 'specialty');
    assert.equal(row.typical_order_kg, 8000);
  });

  it('carries the stated trade into the verification record, so the gap is visible at once', async () => {
    const res = await call('GET', `/api/accounts/${accountId}`);
    const data = json(res).data;
    assert.equal(data.kyc.natureOfTrade, 'Protected salad under glass');
    // Stating a trade is not verification. The account is still blocked.
    assert.equal(data.kycAssessment.valid, false);
  });

  it('changes how an account takes it', async () => {
    await call('PATCH', `/api/accounts/${accountId}`, { fulfilmentPreference: 'immediate' });
    const list = await call('GET', '/api/accounts?search=Fen Growers');
    assert.equal(json(list).data.accounts[0].fulfilment_preference, 'immediate');
  });

  it('refuses a fulfilment value that is not one of the four', async () => {
    const res = await call('PATCH', `/api/accounts/${accountId}`, { fulfilmentPreference: 'whenever' });
    assert.equal(res.statusCode, 400);
  });

  it('defaults to not established rather than guessing', async () => {
    const res = await call('POST', '/api/accounts', { name: 'Unknown Shape Ltd' });
    const list = await call('GET', '/api/accounts?search=Unknown Shape');
    assert.equal(res.statusCode, 200);
    assert.equal(json(list).data.accounts[0].fulfilment_preference, 'unknown');
  });
});

describe('cross-origin access', () => {
  it('allows an approved origin to post an enquiry', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/public/enquiry',
      headers: { origin: 'https://uknitrates.com' },
      payload: { contactName: 'CORS test', productIds: ['mgso4'], buyerType: 'business' },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['access-control-allow-origin'], 'https://uknitrates.com');
  });

  it('refuses an origin that is not on the list', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/public/enquiry',
      headers: { origin: 'https://not-our-site.example' },
      payload: { contactName: 'CORS test', productIds: ['mgso4'], buyerType: 'business' },
    });
    assert.equal(res.headers['access-control-allow-origin'], undefined);
  });

  it('never opens the authenticated API to the browser, even from an approved origin', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/accounts',
      headers: { origin: 'https://uknitrates.com', cookie },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['access-control-allow-origin'], undefined);
  });

  it('answers the preflight for the event endpoint', async () => {
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/api/public/events',
      headers: {
        origin: 'https://uknitrates.com',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });
    assert.ok(res.statusCode === 204 || res.statusCode === 200);
    assert.equal(res.headers['access-control-allow-origin'], 'https://uknitrates.com');
  });
});

describe('permissions', () => {
  it('will not let a production account sign off buyer verification', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'sam@reevewood.com', password: 'test-password-1' },
    });
    const samCookie = String(login.headers['set-cookie']).split(';')[0]!;
    const accounts = await call('GET', '/api/accounts');
    const target = json(accounts).data.accounts[0];
    const res = await app.inject({
      method: 'PUT',
      url: `/api/accounts/${target.id}/kyc`,
      payload: { signOff: true },
      headers: { cookie: samCookie },
    });
    assert.equal(res.statusCode, 403);
  });
});

describe('open questions', () => {
  it('answers a question and drops it out of the chase list', async () => {
    const before = await call('GET', '/api/questions');
    const openBefore = json(before).data.prioritised.length;
    await call('PATCH', '/api/questions/Q15', { status: 'answered', answer: '312 pallet positions.' });
    const after = await call('GET', '/api/questions');
    assert.equal(json(after).data.prioritised.length, openBefore - 1);
  });
});

describe('audit', () => {
  it('records who did what', async () => {
    const res = await call('GET', '/api/audit');
    const entries = json(res).data.entries;
    assert.ok(entries.some((e: { entity: string; action: string }) => e.entity === 'kyc' && e.action === 'signed_off'));
    assert.ok(entries.some((e: { entity: string }) => e.entity === 'order'));
  });
});
