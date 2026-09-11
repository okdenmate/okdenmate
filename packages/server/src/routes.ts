/**
 * HTTP routes. Handlers validate, delegate to a service, and serialise.
 * Business rules live in services.ts and in @ukn/core, never here.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  COMMISSION_RATES,
  DEAL_STAGES,
  MARGIN_FLOOR_BPS,
  SECTORS,
  STAGE_DEFINITIONS,
  STORAGE_THRESHOLDS,
  SEED_PRODUCTS,
  assessConcentration,
  assessKyc,
  buildFunnelReport,
  evaluateSaleGate,
  prioritiseQuestions,
  projectAllScenarios,
  summariseCommission,
  sectorRoute,
  UNFULFILLABLE_SERVICES,
} from '@ukn/core';
import {
  HttpError,
  SESSION_COOKIE,
  createSession,
  destroySession,
  requireCompliance,
  requireUser,
  requireWrite,
  setSessionCookie,
  verifyPassword,
} from './auth.js';
import { audit, Db, id, jsonIn, jsonOut, now, toInt, type Row } from './db.js';
import {
  accountRevenues,
  commissionEntries,
  complianceOverview,
  dashboard,
  funnelEvents,
  mixSnapshot,
  mixShiftCallList,
  storageOverview,
} from './analytics.js';
import { loadKyc, loadProducts, mapQuestion, mapProduct, asKg, asPence } from './repo.js';
import {
  convertEnquiry,
  createQuote,
  currentPeriod,
  intakeEnquiry,
  markOrderPaid,
  priceDeal,
  recordEvent,
  runStorageBilling,
  winDeal,
} from './services.js';

const ok = <T>(data: T) => ({ ok: true as const, data });

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a YYYY-MM-DD date');
const money = z.number().int().nonnegative();

export function registerRoutes(app: FastifyInstance, db: Db): void {
  /* -------------------------------------------------------------- */
  /* Auth                                                            */
  /* -------------------------------------------------------------- */

  app.post('/api/auth/login', async (req, reply) => {
    const body = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
    const row = db.get<Row>('SELECT * FROM users WHERE email = ? AND active = 1', body.email.toLowerCase());
    if (!row || !verifyPassword(body.password, String(row['password_hash']), String(row['password_salt']))) {
      throw new HttpError(401, 'Those details do not match an account.');
    }
    const session = createSession(db, String(row['id']));
    setSessionCookie(reply, session.token, session.expiresAt);
    return ok({
      user: { id: row['id'], email: row['email'], name: row['name'], role: row['role'] },
      token: session.token,
    });
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) destroySession(db, token);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return ok({ signedOut: true });
  });

  app.get('/api/auth/me', async (req) => ok({ user: requireUser(req) }));

  /* -------------------------------------------------------------- */
  /* Reference data                                                  */
  /* -------------------------------------------------------------- */

  app.get('/api/reference', async (req) => {
    requireUser(req);
    return ok({
      products: loadProducts(db),
      sectors: SECTORS.map((s) => ({ id: s, route: sectorRoute(s) })),
      commissionRates: COMMISSION_RATES,
      dealStages: DEAL_STAGES,
      funnelStages: STAGE_DEFINITIONS,
      storageThresholds: STORAGE_THRESHOLDS,
      marginFloors: MARGIN_FLOOR_BPS,
      unfulfillableServices: UNFULFILLABLE_SERVICES,
    });
  });

  app.get('/api/dashboard', async (req) => {
    const user = requireUser(req);
    return ok(dashboard(db, user.id));
  });

  /* -------------------------------------------------------------- */
  /* Accounts                                                        */
  /* -------------------------------------------------------------- */

  app.get('/api/accounts', async (req) => {
    requireUser(req);
    const q = z
      .object({ search: z.string().optional(), status: z.string().optional() })
      .parse(req.query ?? {});
    const rows = db.all<Row>(
      `SELECT a.*,
              (SELECT COUNT(*) FROM orders o WHERE o.account_id = a.id) AS order_count,
              (SELECT COALESCE(SUM(o.gross_margin),0) FROM orders o WHERE o.account_id = a.id) AS gross_margin,
              (SELECT MAX(o.ordered_at) FROM orders o WHERE o.account_id = a.id) AS last_order_at,
              (SELECT k.verified_at FROM kyc_records k WHERE k.account_id = a.id) AS kyc_verified_at,
              (SELECT p.name FROM products p WHERE p.id = a.preferred_product_id) AS preferred_product_name,
              (SELECT p.product_class FROM products p WHERE p.id = a.preferred_product_id) AS preferred_product_class,
              (SELECT COUNT(*) FROM storage_agreements s WHERE s.account_id = a.id AND s.ended_at IS NULL) AS storage_agreements
         FROM accounts a
        WHERE (? IS NULL OR a.name LIKE '%' || ? || '%')
          AND (? IS NULL OR a.status = ?)
        ORDER BY gross_margin DESC, a.name`,
      q.search ?? null,
      q.search ?? null,
      q.status ?? null,
      q.status ?? null,
    );
    return ok({ accounts: rows });
  });

  app.post('/api/accounts', async (req) => {
    const user = requireWrite(req);
    const body = z
      .object({
        name: z.string().min(1),
        sector: z.string().nullable().optional(),
        origin: z.enum(['new', 'inherited']).default('new'),
        business: z.enum(['UKN', 'RW']).default('UKN'),
        phone: z.string().nullable().optional(),
        website: z.string().nullable().optional(),
        address: z.string().nullable().optional(),
        postcode: z.string().nullable().optional(),
        companiesHouseNumber: z.string().nullable().optional(),
        paymentTermsDays: z.number().int().min(0).max(180).default(30),
        possibleDirectImporter: z.boolean().default(false),
        fulfilmentPreference: z.enum(['immediate', 'storage', 'scheduled', 'unknown']).default('unknown'),
        preferredProductId: z.string().nullable().optional(),
        typicalOrderKg: z.number().int().positive().nullable().optional(),
        natureOfTrade: z.string().nullable().optional(),
        notes: z.string().default(''),
      })
      .parse(req.body);

    const accountId = id();
    db.tx(() => {
      db.run(
        `INSERT INTO accounts (id, name, business, sector, origin, owner_user_id, companies_house_number,
          website, phone, address, postcode, payment_terms_days, possible_direct_importer, status, notes,
          fulfilment_preference, preferred_product_id, typical_order_kg, nature_of_trade, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, 'prospect', ?,?,?,?,?,?,?)`,
        accountId,
        body.name,
        body.business,
        body.sector ?? null,
        body.origin,
        user.id,
        body.companiesHouseNumber ?? null,
        body.website ?? null,
        body.phone ?? null,
        body.address ?? null,
        body.postcode ?? null,
        body.paymentTermsDays,
        toInt(body.possibleDirectImporter),
        body.notes,
        body.fulfilmentPreference,
        body.preferredProductId ?? null,
        body.typicalOrderKg ?? null,
        body.natureOfTrade ?? null,
        now(),
        now(),
      );
      // Whatever the account already told us about its trade goes straight into
      // the verification record, so the compliance gap is visible immediately
      // rather than being rediscovered at the point of quoting.
      db.run(
        'INSERT INTO kyc_records (id, account_id, business_name, nature_of_trade, buyer_type, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
        id(),
        accountId,
        body.name,
        body.natureOfTrade ?? null,
        'unknown',
        now(),
        now(),
      );
      audit(db, user.id, 'account', accountId, 'created', { name: body.name });
    });
    return ok({ id: accountId });
  });

  app.get('/api/accounts/:id', async (req) => {
    requireUser(req);
    const { id: accountId } = z.object({ id: z.string() }).parse(req.params);
    const account = db.get<Row>('SELECT * FROM accounts WHERE id = ?', accountId);
    if (!account) throw new HttpError(404, 'Account not found.');

    const kyc = loadKyc(db, accountId);
    const products = loadProducts(db);
    const revenues = accountRevenues(db);
    const mine = revenues.find((r) => r.accountId === accountId);
    const totalGm = revenues.reduce((s, r) => s + r.grossMargin, 0);

    return ok({
      account,
      contacts: db.all('SELECT * FROM contacts WHERE account_id = ? ORDER BY is_primary DESC, name', accountId),
      deals: db.all('SELECT * FROM deals WHERE account_id = ? ORDER BY updated_at DESC', accountId),
      orders: db.all('SELECT * FROM orders WHERE account_id = ? ORDER BY ordered_at DESC', accountId),
      activities: db.all('SELECT * FROM activities WHERE account_id = ? ORDER BY created_at DESC LIMIT 50', accountId),
      storageAgreements: db.all('SELECT * FROM storage_agreements WHERE account_id = ?', accountId),
      kyc,
      kycAssessment: assessKyc(kyc),
      regulatedProducts: products.filter((p) => p.productClass !== 'ancillary').map((p) => p.id),
      shareOfGrossMarginBps: mine && totalGm > 0 ? Math.round((mine.grossMargin / totalGm) * 10_000) : 0,
      revenue: mine ?? null,
    });
  });

  app.patch('/api/accounts/:id', async (req) => {
    const user = requireWrite(req);
    const { id: accountId } = z.object({ id: z.string() }).parse(req.params);
    const body = z
      .object({
        name: z.string().min(1).optional(),
        sector: z.string().nullable().optional(),
        origin: z.enum(['new', 'inherited']).optional(),
        status: z.enum(['prospect', 'active', 'dormant', 'refused']).optional(),
        phone: z.string().nullable().optional(),
        website: z.string().nullable().optional(),
        address: z.string().nullable().optional(),
        postcode: z.string().nullable().optional(),
        paymentTermsDays: z.number().int().min(0).max(180).optional(),
        possibleDirectImporter: z.boolean().optional(),
        fulfilmentPreference: z.enum(['immediate', 'storage', 'scheduled', 'unknown']).optional(),
        preferredProductId: z.string().nullable().optional(),
        typicalOrderKg: z.number().int().positive().nullable().optional(),
        natureOfTrade: z.string().nullable().optional(),
        notes: z.string().optional(),
      })
      .parse(req.body);

    const columns: Record<string, unknown> = {
      name: body.name,
      sector: body.sector,
      origin: body.origin,
      status: body.status,
      phone: body.phone,
      website: body.website,
      address: body.address,
      postcode: body.postcode,
      payment_terms_days: body.paymentTermsDays,
      possible_direct_importer: body.possibleDirectImporter === undefined ? undefined : toInt(body.possibleDirectImporter),
      fulfilment_preference: body.fulfilmentPreference,
      preferred_product_id: body.preferredProductId,
      typical_order_kg: body.typicalOrderKg,
      nature_of_trade: body.natureOfTrade,
      notes: body.notes,
    };
    const sets = Object.entries(columns).filter(([, v]) => v !== undefined);
    if (sets.length > 0) {
      db.run(
        `UPDATE accounts SET ${sets.map(([k]) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
        ...sets.map(([, v]) => v),
        now(),
        accountId,
      );
      audit(db, user.id, 'account', accountId, 'updated', body);
    }
    return ok({ updated: sets.length });
  });

  app.post('/api/accounts/:id/contacts', async (req) => {
    const user = requireWrite(req);
    const { id: accountId } = z.object({ id: z.string() }).parse(req.params);
    const body = z
      .object({
        name: z.string().min(1),
        role: z.string().nullable().optional(),
        email: z.string().email().nullable().optional(),
        phone: z.string().nullable().optional(),
        isPrimary: z.boolean().default(false),
        notes: z.string().default(''),
      })
      .parse(req.body);
    const contactId = id();
    db.run(
      'INSERT INTO contacts (id, account_id, name, role, email, phone, is_primary, notes, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      contactId,
      accountId,
      body.name,
      body.role ?? null,
      body.email ?? null,
      body.phone ?? null,
      toInt(body.isPrimary),
      body.notes,
      now(),
    );
    audit(db, user.id, 'contact', contactId, 'created', { accountId });
    return ok({ id: contactId });
  });

  /* -------------------------------------------------------------- */
  /* Buyer verification (Poisons Act 1972)                           */
  /* -------------------------------------------------------------- */

  app.put('/api/accounts/:id/kyc', async (req) => {
    const user = requireCompliance(req);
    const { id: accountId } = z.object({ id: z.string() }).parse(req.params);
    const body = z
      .object({
        photoIdReference: z.string().nullable().optional(),
        photoIdType: z.enum(['passport', 'driving_licence', 'national_id']).nullable().optional(),
        businessName: z.string().nullable().optional(),
        businessAddress: z.string().nullable().optional(),
        vatNumber: z.string().nullable().optional(),
        natureOfTrade: z.string().nullable().optional(),
        buyerType: z.enum(['business', 'professional_user', 'member_of_public', 'unknown']).optional(),
        /** Signing off records who verified it and when. Both are required by the regime. */
        signOff: z.boolean().default(false),
        refused: z.boolean().optional(),
        refusalReason: z.string().nullable().optional(),
      })
      .parse(req.body);

    const existing = db.get<Row>('SELECT id FROM kyc_records WHERE account_id = ?', accountId);
    if (!existing) {
      db.run(
        'INSERT INTO kyc_records (id, account_id, buyer_type, created_at, updated_at) VALUES (?,?,?,?,?)',
        id(),
        accountId,
        'unknown',
        now(),
        now(),
      );
    }

    const columns: Record<string, unknown> = {
      photo_id_reference: body.photoIdReference,
      photo_id_type: body.photoIdType,
      business_name: body.businessName,
      business_address: body.businessAddress,
      vat_number: body.vatNumber,
      nature_of_trade: body.natureOfTrade,
      buyer_type: body.buyerType,
      refused: body.refused === undefined ? undefined : toInt(body.refused),
      refusal_reason: body.refusalReason,
    };
    if (body.signOff) {
      columns['verified_by'] = user.name;
      columns['verified_at'] = now();
    }
    const sets = Object.entries(columns).filter(([, v]) => v !== undefined);
    if (sets.length > 0) {
      db.run(
        `UPDATE kyc_records SET ${sets.map(([k]) => `${k} = ?`).join(', ')}, updated_at = ? WHERE account_id = ?`,
        ...sets.map(([, v]) => v),
        now(),
        accountId,
      );
    }
    if (body.refused) db.run("UPDATE accounts SET status = 'refused', updated_at = ? WHERE id = ?", now(), accountId);

    audit(db, user.id, 'kyc', accountId, body.signOff ? 'signed_off' : 'updated', {
      fields: sets.map(([k]) => k),
    });

    const kyc = loadKyc(db, accountId);
    return ok({ kyc, assessment: assessKyc(kyc) });
  });

  /* -------------------------------------------------------------- */
  /* Deals                                                           */
  /* -------------------------------------------------------------- */

  app.get('/api/deals', async (req) => {
    requireUser(req);
    const rows = db.all<Row>(`
      SELECT d.*, a.name AS account_name, a.sector, a.origin,
             (SELECT COUNT(*) FROM deal_lines dl WHERE dl.deal_id = d.id) AS line_count,
             COALESCE((SELECT SUM(dl.sell_per_tonne * dl.quantity_kg / 1000.0) - SUM(dl.discount)
                         FROM deal_lines dl WHERE dl.deal_id = d.id), 0) AS revenue,
             COALESCE((SELECT SUM((dl.sell_per_tonne - dl.cost_per_tonne) * dl.quantity_kg / 1000.0)
                            - SUM(dl.delivery_cost) - SUM(dl.discount)
                         FROM deal_lines dl WHERE dl.deal_id = d.id), 0) AS gross_margin,
             EXISTS(SELECT 1 FROM deal_lines dl JOIN products p ON p.id = dl.product_id
                     WHERE dl.deal_id = d.id AND p.product_class = 'specialty') AS has_specialty
        FROM deals d JOIN accounts a ON a.id = d.account_id
       ORDER BY d.updated_at DESC
    `);
    return ok({ deals: rows });
  });

  app.post('/api/deals', async (req) => {
    const user = requireWrite(req);
    const body = z
      .object({
        accountId: z.string(),
        title: z.string().min(1),
        business: z.enum(['UKN', 'RW']).default('UKN'),
        expectedCloseAt: isoDate.nullable().optional(),
        notes: z.string().default(''),
      })
      .parse(req.body);

    const count = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM deals');
    const reference = `${body.business}-D-${String((count?.n ?? 0) + 1).padStart(4, '0')}`;
    const dealId = id();
    db.run(
      `INSERT INTO deals (id, reference, account_id, business, title, stage, owner_user_id, expected_close_at, notes, created_at, updated_at)
       VALUES (?,?,?,?,?, 'enquiry', ?,?,?,?,?)`,
      dealId,
      reference,
      body.accountId,
      body.business,
      body.title,
      user.id,
      body.expectedCloseAt ?? null,
      body.notes,
      now(),
      now(),
    );
    audit(db, user.id, 'deal', dealId, 'created', { reference });
    return ok({ id: dealId, reference });
  });

  app.get('/api/deals/:id', async (req) => {
    requireUser(req);
    const { id: dealId } = z.object({ id: z.string() }).parse(req.params);
    const deal = db.get<Row>(
      'SELECT d.*, a.name AS account_name, a.sector, a.origin FROM deals d JOIN accounts a ON a.id = d.account_id WHERE d.id = ?',
      dealId,
    );
    if (!deal) throw new HttpError(404, 'Deal not found.');
    return ok({
      deal,
      lines: db.all('SELECT dl.*, p.name AS product_name, p.product_class FROM deal_lines dl JOIN products p ON p.id = dl.product_id WHERE dl.deal_id = ? ORDER BY dl.position', dealId),
      quotes: db.all('SELECT * FROM quotes WHERE deal_id = ? ORDER BY version DESC', dealId),
      activities: db.all('SELECT * FROM activities WHERE deal_id = ? ORDER BY created_at DESC', dealId),
      pricing: priceDeal(db, dealId),
    });
  });

  app.patch('/api/deals/:id', async (req) => {
    const user = requireWrite(req);
    const { id: dealId } = z.object({ id: z.string() }).parse(req.params);
    const body = z
      .object({
        title: z.string().min(1).optional(),
        stage: z.enum(['enquiry', 'qualified', 'quoted', 'negotiation', 'lost']).optional(),
        expectedCloseAt: isoDate.nullable().optional(),
        probabilityBpsOverride: z.number().int().min(0).max(10_000).nullable().optional(),
        lostReason: z.string().nullable().optional(),
        notes: z.string().optional(),
      })
      .parse(req.body);

    const columns: Record<string, unknown> = {
      title: body.title,
      stage: body.stage,
      expected_close_at: body.expectedCloseAt,
      probability_bps_override: body.probabilityBpsOverride,
      lost_reason: body.lostReason,
      notes: body.notes,
    };
    if (body.stage === 'lost') columns['closed_at'] = now();
    const sets = Object.entries(columns).filter(([, v]) => v !== undefined);
    if (sets.length > 0) {
      db.run(
        `UPDATE deals SET ${sets.map(([k]) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
        ...sets.map(([, v]) => v),
        now(),
        dealId,
      );
      audit(db, user.id, 'deal', dealId, 'updated', body);
    }
    return ok({ updated: sets.length });
  });

  app.post('/api/deals/:id/lines', async (req) => {
    const user = requireWrite(req);
    const { id: dealId } = z.object({ id: z.string() }).parse(req.params);
    const body = z
      .object({
        productId: z.string(),
        quantityKg: z.number().int().positive(),
        costPerTonne: money,
        sellPerTonne: money,
        costTag: z.enum(['V', 'R', 'E', 'A']).default('E'),
        deliveryCost: money.default(0),
        discount: money.default(0),
        packForm: z.string().nullable().optional(),
      })
      .parse(req.body);

    const position = db.get<{ n: number }>('SELECT COALESCE(MAX(position), -1) + 1 AS n FROM deal_lines WHERE deal_id = ?', dealId);
    const lineId = id();
    db.run(
      `INSERT INTO deal_lines (id, deal_id, product_id, quantity_kg, cost_per_tonne, sell_per_tonne, cost_tag, delivery_cost, discount, pack_form, position)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      lineId,
      dealId,
      body.productId,
      body.quantityKg,
      body.costPerTonne,
      body.sellPerTonne,
      body.costTag,
      body.deliveryCost,
      body.discount,
      body.packForm ?? null,
      position?.n ?? 0,
    );
    db.run('UPDATE deals SET updated_at = ? WHERE id = ?', now(), dealId);
    audit(db, user.id, 'deal_line', lineId, 'created', { dealId, productId: body.productId });
    return ok({ id: lineId, pricing: priceDeal(db, dealId) });
  });

  app.delete('/api/deals/:dealId/lines/:lineId', async (req) => {
    const user = requireWrite(req);
    const params = z.object({ dealId: z.string(), lineId: z.string() }).parse(req.params);
    db.run('DELETE FROM deal_lines WHERE id = ? AND deal_id = ?', params.lineId, params.dealId);
    db.run('UPDATE deals SET updated_at = ? WHERE id = ?', now(), params.dealId);
    audit(db, user.id, 'deal_line', params.lineId, 'deleted', { dealId: params.dealId });
    return ok({ pricing: priceDeal(db, params.dealId) });
  });

  app.post('/api/deals/:id/quote', async (req) => {
    const user = requireWrite(req);
    const { id: dealId } = z.object({ id: z.string() }).parse(req.params);
    const body = z.object({ validUntil: isoDate.nullable().default(null) }).parse(req.body ?? {});
    return ok(createQuote(db, user, dealId, body.validUntil));
  });

  app.post('/api/deals/:id/win', async (req) => {
    const user = requireWrite(req);
    const { id: dealId } = z.object({ id: z.string() }).parse(req.params);
    const body = z.object({ orderedAt: isoDate.default(new Date().toISOString().slice(0, 10)) }).parse(req.body ?? {});
    return ok(winDeal(db, user, dealId, body.orderedAt));
  });

  /* -------------------------------------------------------------- */
  /* Orders and commission                                           */
  /* -------------------------------------------------------------- */

  app.get('/api/orders', async (req) => {
    requireUser(req);
    return ok({
      orders: db.all(`
        SELECT o.*, a.name AS account_name, d.reference AS deal_reference
          FROM orders o JOIN accounts a ON a.id = o.account_id JOIN deals d ON d.id = o.deal_id
         ORDER BY o.ordered_at DESC`),
    });
  });

  app.post('/api/orders/:id/paid', async (req) => {
    const user = requireWrite(req);
    const { id: orderId } = z.object({ id: z.string() }).parse(req.params);
    const body = z.object({ paidAt: isoDate.default(new Date().toISOString().slice(0, 10)) }).parse(req.body ?? {});
    markOrderPaid(db, user, orderId, body.paidAt);
    return ok({ paid: true });
  });

  app.get('/api/commission', async (req) => {
    const user = requireUser(req);
    const rows = db.all<Row>(
      `SELECT c.*, a.name AS account_name FROM commission_entries c
         LEFT JOIN accounts a ON a.id = c.account_id
        WHERE c.user_id = ? ORDER BY c.occurred_at DESC`,
      user.id,
    );
    return ok({ entries: rows, summary: summariseCommission(commissionEntries(db, user.id)), rates: COMMISSION_RATES });
  });

  app.post('/api/commission/:id/paid', async (req) => {
    const user = requireWrite(req);
    const { id: entryId } = z.object({ id: z.string() }).parse(req.params);
    db.run("UPDATE commission_entries SET status = 'paid', paid_at = ? WHERE id = ?", now(), entryId);
    audit(db, user.id, 'commission', entryId, 'paid', {});
    return ok({ paid: true });
  });

  /* -------------------------------------------------------------- */
  /* Enquiries                                                       */
  /* -------------------------------------------------------------- */

  app.get('/api/enquiries', async (req) => {
    requireUser(req);
    const rows = db.all<Row>('SELECT * FROM enquiries ORDER BY created_at DESC LIMIT 200');
    const products = loadProducts(db);
    return ok({
      enquiries: rows.map((r) => {
        const productIds = jsonOut<string[]>(r['product_ids'], []);
        const chosen = products.filter((p) => productIds.includes(p.id));
        return {
          ...r,
          productIds,
          productNames: chosen.map((p) => p.name),
          isCommodityOnly: chosen.length > 0 && chosen.every((p) => p.productClass === 'commodity'),
          suggestedRoute: sectorRoute(r['sector'] ? String(r['sector']) : null),
        };
      }),
    });
  });

  app.post('/api/enquiries/:id/convert', async (req) => {
    const user = requireWrite(req);
    const { id: enquiryId } = z.object({ id: z.string() }).parse(req.params);
    const body = z
      .object({ accountId: z.string().nullable().default(null), title: z.string().nullable().default(null) })
      .parse(req.body ?? {});
    return ok(convertEnquiry(db, user, enquiryId, body));
  });

  app.post('/api/enquiries/:id/disqualify', async (req) => {
    const user = requireWrite(req);
    const { id: enquiryId } = z.object({ id: z.string() }).parse(req.params);
    const body = z.object({ reason: z.string().min(1) }).parse(req.body);
    db.run(
      "UPDATE enquiries SET status = 'disqualified', disqualified_reason = ?, triaged_at = ? WHERE id = ?",
      body.reason,
      now(),
      enquiryId,
    );
    audit(db, user.id, 'enquiry', enquiryId, 'disqualified', body);
    return ok({ disqualified: true });
  });

  /* -------------------------------------------------------------- */
  /* Public intake - this is the endpoint the live site is missing    */
  /* -------------------------------------------------------------- */

  app.post('/api/public/enquiry', async (req) => {
    const body = z
      .object({
        companyName: z.string().max(200).nullable().optional(),
        contactName: z.string().max(200).nullable().optional(),
        email: z.string().email().nullable().optional(),
        phone: z.string().max(50).nullable().optional(),
        sector: z.string().max(60).nullable().optional(),
        natureOfTrade: z.string().max(300).nullable().optional(),
        productIds: z.array(z.string()).max(20).default([]),
        quantityKg: z.number().int().nonnegative().nullable().optional(),
        fulfilment: z.enum(['delivery', 'collection']).default('delivery'),
        deliveryPostcode: z.string().max(20).nullable().optional(),
        timing: z.string().max(100).nullable().optional(),
        buyerType: z.enum(['business', 'professional_user', 'member_of_public', 'unknown']).default('unknown'),
        message: z.string().max(4000).nullable().optional(),
        source: z.string().max(100).nullable().optional(),
        medium: z.string().max(100).nullable().optional(),
        campaign: z.string().max(100).nullable().optional(),
        sessionId: z.string().max(100).nullable().optional(),
      })
      .parse(req.body);

    const result = intakeEnquiry(db, body);
    // The response says nothing about the screening result. A buyer must never
    // learn from a form whether they tripped a flag.
    return ok({
      received: true,
      reference: result.enquiryId.slice(0, 8).toUpperCase(),
      message: 'Enquiry received. We will confirm stock and a delivered price by return.',
    });
  });

  app.post('/api/public/events', async (req) => {
    const body = z
      .object({
        event: z.string().max(60),
        sessionId: z.string().max(100),
        occurredAt: z.string().max(40).optional(),
        source: z.string().max(100).nullable().optional(),
        medium: z.string().max(100).nullable().optional(),
        campaign: z.string().max(100).nullable().optional(),
        productId: z.string().max(60).nullable().optional(),
        business: z.enum(['UKN', 'RW']).default('UKN'),
        payload: z.record(z.unknown()).default({}),
      })
      .parse(req.body);
    recordEvent(db, body);
    return ok({ recorded: true });
  });

  /* -------------------------------------------------------------- */
  /* Analytics                                                       */
  /* -------------------------------------------------------------- */

  app.get('/api/analytics/funnel', async (req) => {
    requireUser(req);
    const q = z.object({ since: z.string().optional() }).parse(req.query ?? {});
    return ok({ report: buildFunnelReport(funnelEvents(db, q.since)), stages: STAGE_DEFINITIONS });
  });

  app.get('/api/analytics/mix', async (req) => {
    requireUser(req);
    const since = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
    return ok({ mix: mixSnapshot(db, since), callList: mixShiftCallList(db) });
  });

  app.get('/api/analytics/concentration', async (req) => {
    requireUser(req);
    const revenues = accountRevenues(db);
    return ok({ risk: assessConcentration(revenues), accounts: revenues });
  });

  app.get('/api/analytics/scenarios', async (req) => {
    requireUser(req);
    return ok({ scenarios: projectAllScenarios() });
  });

  /* -------------------------------------------------------------- */
  /* Compliance and storage                                          */
  /* -------------------------------------------------------------- */

  app.get('/api/compliance', async (req) => {
    requireUser(req);
    return ok(complianceOverview(db));
  });

  app.put('/api/compliance/notifications/:thresholdId', async (req) => {
    const user = requireCompliance(req);
    const { thresholdId } = z.object({ thresholdId: z.string() }).parse(req.params);
    const body = z
      .object({
        status: z.enum(['filed', 'not_required', 'unknown', 'overdue']),
        filedAt: isoDate.nullable().default(null),
        reference: z.string().nullable().default(null),
        note: z.string().default(''),
      })
      .parse(req.body);
    db.run(
      `INSERT INTO compliance_notifications (id, threshold_id, status, filed_at, reference, note, updated_at)
       VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(threshold_id) DO UPDATE SET status = excluded.status, filed_at = excluded.filed_at,
         reference = excluded.reference, note = excluded.note, updated_at = excluded.updated_at`,
      id(),
      thresholdId,
      body.status,
      body.filedAt,
      body.reference,
      body.note,
      now(),
    );
    audit(db, user.id, 'compliance_notification', thresholdId, 'updated', body);
    return ok(complianceOverview(db));
  });

  app.put('/api/compliance/site', async (req) => {
    const user = requireCompliance(req);
    const body = z
      .object({
        peakAnKg: z.number().int().nonnegative().nullable().optional(),
        signageInPlace: z.boolean().optional(),
        proceduresDocumented: z.boolean().optional(),
        totalPalletPositions: z.number().int().nonnegative().nullable().optional(),
        note: z.string().optional(),
      })
      .parse(req.body);

    db.run(
      `INSERT INTO site_compliance (id, peak_an_kg, peak_recorded_at, signage_in_place, procedures_documented, total_pallet_positions, note, updated_at)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         peak_an_kg = COALESCE(excluded.peak_an_kg, site_compliance.peak_an_kg),
         peak_recorded_at = CASE WHEN excluded.peak_an_kg IS NOT NULL THEN excluded.peak_recorded_at ELSE site_compliance.peak_recorded_at END,
         signage_in_place = excluded.signage_in_place,
         procedures_documented = excluded.procedures_documented,
         total_pallet_positions = COALESCE(excluded.total_pallet_positions, site_compliance.total_pallet_positions),
         note = excluded.note,
         updated_at = excluded.updated_at`,
      body.peakAnKg ?? null,
      body.peakAnKg !== undefined && body.peakAnKg !== null ? now() : null,
      toInt(body.signageInPlace ?? false),
      toInt(body.proceduresDocumented ?? false),
      body.totalPalletPositions ?? null,
      body.note ?? '',
      now(),
    );
    audit(db, user.id, 'site_compliance', 'site', 'updated', body);
    return ok(complianceOverview(db));
  });

  app.post('/api/compliance/suspicious', async (req) => {
    const user = requireWrite(req);
    const body = z
      .object({
        accountId: z.string().nullable().default(null),
        enquiryId: z.string().nullable().default(null),
        summary: z.string().min(1),
        indicators: z.array(z.string()).default([]),
      })
      .parse(req.body);
    const txnId = id();
    db.run(
      `INSERT INTO suspicious_transactions (id, account_id, enquiry_id, detected_at, summary, indicators, status, raised_by, created_at)
       VALUES (?,?,?,?,?,?, 'open', ?, ?)`,
      txnId,
      body.accountId,
      body.enquiryId,
      now(),
      body.summary,
      jsonIn(body.indicators),
      user.id,
      now(),
    );
    audit(db, user.id, 'suspicious_transaction', txnId, 'raised', body);
    return ok({ id: txnId });
  });

  app.patch('/api/compliance/suspicious/:id', async (req) => {
    const user = requireCompliance(req);
    const { id: txnId } = z.object({ id: z.string() }).parse(req.params);
    const body = z
      .object({
        status: z.enum(['open', 'reported', 'dismissed']),
        reference: z.string().nullable().default(null),
      })
      .parse(req.body);
    db.run(
      'UPDATE suspicious_transactions SET status = ?, reported_at = ?, reference = ? WHERE id = ?',
      body.status,
      body.status === 'reported' ? now() : null,
      body.reference,
      txnId,
    );
    audit(db, user.id, 'suspicious_transaction', txnId, body.status, body);
    return ok({ updated: true });
  });

  app.get('/api/storage', async (req) => {
    requireUser(req);
    return ok(storageOverview(db));
  });

  app.post('/api/storage/agreements', async (req) => {
    const user = requireWrite(req);
    const body = z
      .object({
        accountId: z.string(),
        productId: z.string().nullable().default(null),
        feeBasis: z.enum(['per_pallet_month', 'per_tonne_month', 'flat_month']),
        ratePence: money.nullable().default(null),
        palletPositions: z.number().int().positive().nullable().default(null),
        startedAt: isoDate,
        dutyAccepted: z.boolean().default(false),
        notes: z.string().default(''),
      })
      .parse(req.body);
    const agreementId = id();
    db.run(
      `INSERT INTO storage_agreements (id, account_id, product_id, fee_basis, rate_pence, pallet_positions, started_at, duty_accepted, notes, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      agreementId,
      body.accountId,
      body.productId,
      body.feeBasis,
      body.ratePence,
      body.palletPositions,
      body.startedAt,
      toInt(body.dutyAccepted),
      body.notes,
      now(),
    );
    audit(db, user.id, 'storage_agreement', agreementId, 'created', body);
    return ok({ id: agreementId });
  });

  app.post('/api/storage/movements', async (req) => {
    const user = requireWrite(req);
    const body = z
      .object({
        agreementId: z.string(),
        accountId: z.string(),
        productId: z.string(),
        direction: z.enum(['in', 'out']),
        quantityKg: z.number().int().positive(),
        occurredAt: isoDate,
        reference: z.string().nullable().default(null),
      })
      .parse(req.body);
    const movementId = id();
    db.run(
      `INSERT INTO storage_movements (id, agreement_id, account_id, product_id, direction, quantity_kg, occurred_at, reference, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      movementId,
      body.agreementId,
      body.accountId,
      body.productId,
      body.direction,
      body.quantityKg,
      body.occurredAt,
      body.reference,
      now(),
    );
    audit(db, user.id, 'storage_movement', movementId, 'created', body);
    // Goods in can cross a notification threshold, so the overview comes back
    // with the movement rather than waiting for someone to open another screen.
    return ok({ id: movementId, compliance: complianceOverview(db) });
  });

  app.post('/api/storage/billing-run', async (req) => {
    const user = requireWrite(req);
    const period = currentPeriod();
    const body = z
      .object({ periodStart: isoDate.default(period.start), periodEnd: isoDate.default(period.end) })
      .parse(req.body ?? {});
    return ok(runStorageBilling(db, user, body.periodStart, body.periodEnd));
  });

  /* -------------------------------------------------------------- */
  /* Activities                                                      */
  /* -------------------------------------------------------------- */

  app.post('/api/activities', async (req) => {
    const user = requireWrite(req);
    const body = z
      .object({
        accountId: z.string().nullable().default(null),
        dealId: z.string().nullable().default(null),
        contactId: z.string().nullable().default(null),
        type: z.enum(['call', 'email', 'meeting', 'note', 'task', 'site_visit']),
        subject: z.string().min(1),
        body: z.string().default(''),
        dueAt: z.string().nullable().default(null),
      })
      .parse(req.body);
    const activityId = id();
    db.run(
      `INSERT INTO activities (id, account_id, deal_id, contact_id, user_id, type, subject, body, due_at, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      activityId,
      body.accountId,
      body.dealId,
      body.contactId,
      user.id,
      body.type,
      body.subject,
      body.body,
      body.dueAt,
      now(),
    );
    return ok({ id: activityId });
  });

  app.post('/api/activities/:id/complete', async (req) => {
    requireWrite(req);
    const { id: activityId } = z.object({ id: z.string() }).parse(req.params);
    db.run('UPDATE activities SET completed_at = ? WHERE id = ?', now(), activityId);
    return ok({ completed: true });
  });

  app.get('/api/activities', async (req) => {
    requireUser(req);
    const q = z.object({ open: z.string().optional() }).parse(req.query ?? {});
    const rows =
      q.open === 'true'
        ? db.all('SELECT * FROM activities WHERE completed_at IS NULL ORDER BY due_at IS NULL, due_at LIMIT 100')
        : db.all('SELECT * FROM activities ORDER BY created_at DESC LIMIT 100');
    return ok({ activities: rows });
  });

  /* -------------------------------------------------------------- */
  /* Open questions                                                  */
  /* -------------------------------------------------------------- */

  app.get('/api/questions', async (req) => {
    requireUser(req);
    const questions = db.all<Row>('SELECT * FROM open_questions ORDER BY tier, id').map(mapQuestion);
    return ok({ questions, prioritised: prioritiseQuestions(questions) });
  });

  app.patch('/api/questions/:id', async (req) => {
    const user = requireWrite(req);
    const { id: questionId } = z.object({ id: z.string() }).parse(req.params);
    const body = z
      .object({
        status: z.enum(['open', 'chasing', 'answered', 'dropped']).optional(),
        answer: z.string().nullable().optional(),
      })
      .parse(req.body);
    db.run(
      'UPDATE open_questions SET status = COALESCE(?, status), answer = COALESCE(?, answer), answered_at = ?, updated_at = ? WHERE id = ?',
      body.status ?? null,
      body.answer ?? null,
      body.status === 'answered' ? now() : null,
      now(),
      questionId,
    );
    audit(db, user.id, 'open_question', questionId, 'updated', body);
    return ok({ updated: true });
  });

  /* -------------------------------------------------------------- */
  /* Price anchors                                                   */
  /* -------------------------------------------------------------- */

  app.get('/api/anchors', async (req) => {
    requireUser(req);
    return ok({
      anchors: db.all('SELECT a.*, p.name AS product_name FROM price_anchors a JOIN products p ON p.id = a.product_id ORDER BY a.as_of DESC LIMIT 200'),
    });
  });

  app.post('/api/anchors', async (req) => {
    const user = requireWrite(req);
    const body = z
      .object({
        productId: z.string(),
        pricePerTonne: money,
        source: z.string().min(1),
        asOf: isoDate,
        basis: z.string().default('Delivered, full load, ex-VAT'),
      })
      .parse(req.body);
    const anchorId = id();
    db.run(
      'INSERT INTO price_anchors (id, product_id, price_per_tonne, source, as_of, basis, created_at) VALUES (?,?,?,?,?,?,?)',
      anchorId,
      body.productId,
      body.pricePerTonne,
      body.source,
      body.asOf,
      body.basis,
      now(),
    );
    audit(db, user.id, 'price_anchor', anchorId, 'created', body);
    return ok({ id: anchorId });
  });

  app.get('/api/audit', async (req) => {
    requireUser(req);
    return ok({ entries: db.all('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 200') });
  });
}

export { SEED_PRODUCTS, mapProduct, evaluateSaleGate, asKg, asPence };
