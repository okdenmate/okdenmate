/**
 * Services: the operations that touch more than one table and have to stay
 * consistent. Route handlers stay thin; the rules live here.
 */

import type {
  CommissionEntry,
  DealMargin,
  LineInput,
  MarginGuard,
  Pence,
  Product,
  SaleGate,
} from '@ukn/core';
import {
  applyBps,
  checkAgainstAnchor,
  computeCommission,
  computeDealMargin,
  evaluateMarginGuards,
  evaluateSaleGate,
  hasBlockingGuard,
  pence,
  screenEnquiry,
  suggestMixShift,
  type MixShiftSuggestion,
} from '@ukn/core';
import { HttpError, type AuthUser } from './auth.js';
import { audit, Db, id, jsonIn, now, today, toInt, type Row } from './db.js';
import {
  asKg,
  asPence,
  loadDealLines,
  loadKyc,
  loadLatestAnchors,
  loadProducts,
  referenceSellPrices,
} from './repo.js';

/* ------------------------------------------------------------------ */
/* Deal pricing                                                        */
/* ------------------------------------------------------------------ */

export interface DealPricing {
  margin: DealMargin;
  guards: MarginGuard[];
  gate: SaleGate;
  anchors: Array<{ productId: string; check: ReturnType<typeof checkAgainstAnchor> }>;
  mixShift: MixShiftSuggestion[];
  sendable: boolean;
  blockers: string[];
}

/**
 * Everything that has to be true before a quote can go out, computed in one
 * place so the pipeline board, the deal screen and the quote endpoint cannot
 * disagree with each other.
 */
export function priceDeal(db: Db, dealId: string): DealPricing {
  const deal = db.get<Row>('SELECT * FROM deals WHERE id = ?', dealId);
  if (!deal) throw new HttpError(404, 'Deal not found.');

  const products = loadProducts(db);
  const byId = new Map(products.map((p) => [p.id, p]));
  const lines = loadDealLines(db, dealId);

  const lineInputs: LineInput[] = lines.map((l) => {
    const product = byId.get(l.productId);
    return {
      productId: l.productId,
      productClass: product?.productClass ?? 'ancillary',
      quantityKg: l.quantityKg,
      costPerTonne: l.costPerTonne,
      sellPerTonne: l.sellPerTonne,
      deliveryCost: l.deliveryCost,
      discount: l.discount,
    };
  });

  const margin = computeDealMargin(lineInputs);
  const guards = evaluateMarginGuards(margin, products);

  const accountId = String(deal['account_id']);
  const kyc = loadKyc(db, accountId);
  const gate = evaluateSaleGate(products, lines.map((l) => l.productId), kyc);

  const latestAnchors = loadLatestAnchors(db);
  const anchors = lines.map((l) => ({
    productId: l.productId,
    check: checkAgainstAnchor(l.sellPerTonne, latestAnchors.get(l.productId)),
  }));

  const account = db.get<Row>('SELECT * FROM accounts WHERE id = ?', accountId);
  const commissionBps = String(account?.['origin'] ?? 'new') === 'new' ? 2500 : 750;
  const mixShift = suggestMixShift(
    {
      productIds: lines.map((l) => l.productId),
      quantityKg: asKg(lines.reduce((s, l) => s + l.quantityKg, 0)),
      sector: account?.['sector'] ? String(account['sector']) : null,
      commissionBps,
    },
    products,
    referenceSellPrices(db),
  );

  const blockers: string[] = [];
  if (lines.length === 0) blockers.push('The deal has no lines.');
  if (gate.decision === 'blocked') blockers.push(...gate.reasons);
  for (const g of guards) if (g.severity === 'block') blockers.push(g.message);

  return {
    margin,
    guards,
    gate,
    anchors,
    mixShift,
    sendable: blockers.length === 0,
    blockers,
  };
}

/* ------------------------------------------------------------------ */
/* Quotes                                                              */
/* ------------------------------------------------------------------ */

export function createQuote(db: Db, user: AuthUser, dealId: string, validUntil: string | null) {
  const pricing = priceDeal(db, dealId);

  if (pricing.gate.decision === 'blocked') {
    throw new HttpError(422, 'This quote cannot be issued until buyer verification is complete.', {
      reasons: pricing.gate.reasons,
      requiredActions: pricing.gate.requiredActions,
      regulatedProducts: pricing.gate.regulatedProducts,
    });
  }
  if (hasBlockingGuard(pricing.guards)) {
    throw new HttpError(422, 'This quote breaches a margin floor.', {
      reasons: pricing.guards.filter((g) => g.severity === 'block').map((g) => g.message),
    });
  }

  return db.tx(() => {
    const prior = db.get<{ n: number }>('SELECT COALESCE(MAX(version),0) AS n FROM quotes WHERE deal_id = ?', dealId);
    const version = (prior?.n ?? 0) + 1;
    const deal = db.get<Row>('SELECT * FROM deals WHERE id = ?', dealId)!;
    const reference = `${String(deal['reference'])}-Q${version}`;
    const quoteId = id();

    db.run(
      `INSERT INTO quotes (id, deal_id, version, reference, snapshot, revenue, cost, gross_margin, gm_bps,
                           gate_decision, gate_reasons, valid_until, created_by, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      quoteId,
      dealId,
      version,
      reference,
      jsonIn({ margin: pricing.margin, anchors: pricing.anchors, guards: pricing.guards }),
      pricing.margin.revenue,
      pricing.margin.cost,
      pricing.margin.grossMargin,
      pricing.margin.gmBps,
      pricing.gate.decision,
      jsonIn(pricing.gate.reasons),
      validUntil,
      user.id,
      now(),
    );

    if (String(deal['stage']) === 'enquiry' || String(deal['stage']) === 'qualified') {
      db.run('UPDATE deals SET stage = ?, updated_at = ? WHERE id = ?', 'quoted', now(), dealId);
    }
    recordEvent(db, {
      event: 'quote_sent',
      sessionId: `crm:${dealId}`,
      productId: null,
      payload: { quoteId, reference, version },
    });
    audit(db, user.id, 'quote', quoteId, 'created', { dealId, version, reference });
    return { id: quoteId, version, reference, pricing };
  });
}

/* ------------------------------------------------------------------ */
/* Winning a deal                                                      */
/* ------------------------------------------------------------------ */

/**
 * Marking a deal won creates the order and the commission accrual together.
 * Commission is accrued, not payable: nothing is payable until Tom is paid,
 * which is the cash-cycle lag the compensation structure carries.
 */
export function winDeal(db: Db, user: AuthUser, dealId: string, orderedAt: string) {
  const pricing = priceDeal(db, dealId);
  if (pricing.gate.decision === 'blocked') {
    throw new HttpError(422, 'This order cannot be booked until buyer verification is complete.', {
      reasons: pricing.gate.reasons,
    });
  }

  return db.tx(() => {
    const deal = db.get<Row>('SELECT * FROM deals WHERE id = ?', dealId);
    if (!deal) throw new HttpError(404, 'Deal not found.');
    if (String(deal['stage']) === 'won') throw new HttpError(409, 'This deal is already won.');

    const accountId = String(deal['account_id']);
    const account = db.get<Row>('SELECT * FROM accounts WHERE id = ?', accountId)!;
    const prior = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM orders WHERE account_id = ?', accountId);
    const sequence = (prior?.n ?? 0) + 1;

    const orderCount = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM orders');
    const reference = `${String(deal['business'])}-O-${String((orderCount?.n ?? 0) + 1).padStart(4, '0')}`;
    const orderId = id();

    db.run(
      `INSERT INTO orders (id, reference, deal_id, account_id, business, revenue, cost, gross_margin, gm_bps,
                           ordered_at, payment_status, order_sequence, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,'unpaid',?,?)`,
      orderId,
      reference,
      dealId,
      accountId,
      String(deal['business']),
      pricing.margin.revenue,
      pricing.margin.cost,
      pricing.margin.grossMargin,
      pricing.margin.gmBps,
      orderedAt,
      sequence,
      now(),
    );

    db.run(
      'UPDATE deals SET stage = ?, closed_at = ?, order_sequence = ?, updated_at = ? WHERE id = ?',
      'won',
      orderedAt,
      sequence,
      now(),
      dealId,
    );
    db.run('UPDATE accounts SET status = ?, updated_at = ? WHERE id = ? AND status != ?', 'active', now(), accountId, 'refused');

    const business = String(deal['business']) as 'UKN' | 'RW';
    const entry = computeCommission({
      sourceId: orderId,
      sourceType: 'order',
      business,
      origin: String(account['origin']) as 'new' | 'inherited',
      basis: business === 'UKN' ? 'gross_margin' : 'order_value',
      amount: business === 'UKN' ? pricing.margin.grossMargin : pricing.margin.revenue,
      orderSequence: sequence,
      occurredAt: orderedAt,
      customerTermsDays: Number(account['payment_terms_days'] ?? 30),
    });
    insertCommission(db, entry, user.id, accountId);

    recordEvent(db, {
      event: 'order_won',
      sessionId: `crm:${dealId}`,
      productId: null,
      payload: { orderId, reference, grossMargin: pricing.margin.grossMargin },
    });
    audit(db, user.id, 'order', orderId, 'created', { dealId, reference });

    return { orderId, reference, commission: entry };
  });
}

export function insertCommission(
  db: Db,
  entry: CommissionEntry,
  userId: string,
  accountId: string | null,
): void {
  db.run(
    `INSERT OR IGNORE INTO commission_entries
       (id, source_id, source_type, user_id, account_id, business, rate_id, rate_bps, basis,
        basis_amount, amount, status, occurred_at, expected_payable_at, note, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id(),
    entry.sourceId,
    entry.sourceType,
    userId,
    accountId,
    entry.business,
    entry.rateId,
    entry.rateBps,
    entry.basis,
    entry.basisAmount,
    entry.amount,
    entry.status,
    entry.occurredAt,
    entry.expectedPayableAt,
    entry.note,
    now(),
  );
}

/**
 * When Tom is paid, the matching commission becomes payable. This is the only
 * transition that makes a commission line real.
 */
export function markOrderPaid(db: Db, user: AuthUser, orderId: string, paidAt: string): void {
  db.tx(() => {
    const order = db.get<Row>('SELECT * FROM orders WHERE id = ?', orderId);
    if (!order) throw new HttpError(404, 'Order not found.');
    db.run('UPDATE orders SET payment_status = ?, paid_at = ? WHERE id = ?', 'paid', paidAt, orderId);
    db.run(
      "UPDATE commission_entries SET status = 'payable' WHERE source_id = ? AND source_type = 'order' AND status = 'accrued'",
      orderId,
    );
    audit(db, user.id, 'order', orderId, 'paid', { paidAt });
  });
}

/* ------------------------------------------------------------------ */
/* Enquiry intake                                                      */
/* ------------------------------------------------------------------ */

export interface EnquiryInput {
  companyName?: string | null;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  sector?: string | null;
  natureOfTrade?: string | null;
  productIds?: string[];
  quantityKg?: number | null;
  fulfilment?: 'delivery' | 'collection';
  deliveryPostcode?: string | null;
  timing?: string | null;
  buyerType?: string | null;
  message?: string | null;
  source?: string | null;
  medium?: string | null;
  campaign?: string | null;
  sessionId?: string | null;
  offeredCashPayment?: boolean;
  refusedToProvideDetails?: boolean;
}

/**
 * The public intake path. This is what the brief calls the missing endpoint:
 * the live site's Enquire buttons point at a malformed URL and its footer
 * contact link 404s, so there is no countable enquiry today. Every enquiry
 * that lands here is screened for precursor risk at the moment it arrives,
 * and routed for mix shift before anyone has had a chance to forget.
 */
export function intakeEnquiry(db: Db, input: EnquiryInput) {
  const products = loadProducts(db);
  const productIds = (input.productIds ?? []).filter((p) => products.some((x) => x.id === p));
  const quantityKg = asKg(input.quantityKg ?? 0);

  const signals = screenEnquiry(
    {
      buyerType: (input.buyerType ?? 'unknown') as never,
      natureOfTrade: input.natureOfTrade ?? null,
      quantityKg,
      productIds,
      wantsCollection: input.fulfilment === 'collection',
      offeredCashPayment: input.offeredCashPayment ?? false,
      refusedToProvideDetails: input.refusedToProvideDetails ?? false,
      deliveryPostcode: input.deliveryPostcode ?? null,
    },
    products,
  );

  const mixShift = suggestMixShift(
    {
      productIds,
      quantityKg,
      sector: input.sector ?? null,
      commissionBps: 2500,
    },
    products,
    referenceSellPrices(db),
  );

  return db.tx(() => {
    const enquiryId = id();
    db.run(
      `INSERT INTO enquiries (id, company_name, contact_name, email, phone, sector, nature_of_trade,
        product_ids, quantity_kg, fulfilment, delivery_postcode, timing, buyer_type, message,
        source, medium, campaign, session_id, status, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'new',?)`,
      enquiryId,
      input.companyName ?? null,
      input.contactName ?? null,
      input.email ?? null,
      input.phone ?? null,
      input.sector ?? null,
      input.natureOfTrade ?? null,
      jsonIn(productIds),
      quantityKg,
      input.fulfilment ?? 'delivery',
      input.deliveryPostcode ?? null,
      input.timing ?? null,
      input.buyerType ?? 'unknown',
      input.message ?? null,
      input.source ?? null,
      input.medium ?? null,
      input.campaign ?? null,
      input.sessionId ?? null,
      now(),
    );

    if (signals.length > 0) {
      db.run(
        `INSERT INTO suspicious_transactions (id, enquiry_id, detected_at, summary, indicators, status, created_at)
         VALUES (?,?,?,?,?, 'open', ?)`,
        id(),
        enquiryId,
        now(),
        `Automatic screening raised ${signals.length} indicator${signals.length === 1 ? '' : 's'} on an enquiry for a regulated line.`,
        jsonIn(signals.map((s) => s.message)),
        now(),
      );
    }

    recordEvent(db, {
      event: 'enquiry_submitted',
      sessionId: input.sessionId ?? `intake:${enquiryId}`,
      productId: productIds[0] ?? null,
      source: input.source ?? null,
      medium: input.medium ?? null,
      campaign: input.campaign ?? null,
      payload: { enquiryId, quantityKg, productIds },
    });

    audit(db, null, 'enquiry', enquiryId, 'intake', { source: input.source, signals: signals.length });
    return { enquiryId, signals, mixShift };
  });
}

/** Turn a triaged enquiry into an account and a deal in one step. */
export function convertEnquiry(
  db: Db,
  user: AuthUser,
  enquiryId: string,
  opts: { accountId?: string | null; title?: string | null },
) {
  return db.tx(() => {
    const enquiry = db.get<Row>('SELECT * FROM enquiries WHERE id = ?', enquiryId);
    if (!enquiry) throw new HttpError(404, 'Enquiry not found.');
    if (String(enquiry['status']) === 'converted') throw new HttpError(409, 'Already converted.');

    let accountId = opts.accountId ?? null;
    if (!accountId) {
      accountId = id();
      db.run(
        `INSERT INTO accounts (id, name, business, sector, origin, owner_user_id, phone, postcode, status, notes, created_at, updated_at)
         VALUES (?,?,'UKN',?,'new',?,?,?, 'prospect', ?, ?, ?)`,
        accountId,
        String(enquiry['company_name'] ?? enquiry['contact_name'] ?? 'Unnamed enquiry'),
        enquiry['sector'] ?? null,
        user.id,
        enquiry['phone'] ?? null,
        enquiry['delivery_postcode'] ?? null,
        `Created from enquiry ${enquiryId}.`,
        now(),
        now(),
      );
      if (enquiry['contact_name'] || enquiry['email']) {
        db.run(
          'INSERT INTO contacts (id, account_id, name, email, phone, is_primary, created_at) VALUES (?,?,?,?,?,1,?)',
          id(),
          accountId,
          String(enquiry['contact_name'] ?? 'Primary contact'),
          enquiry['email'] ?? null,
          enquiry['phone'] ?? null,
          now(),
        );
      }
      // Seed the verification record with whatever the enquiry already told us,
      // so the compliance gap is visible from the first minute rather than later.
      db.run(
        `INSERT INTO kyc_records (id, account_id, business_name, nature_of_trade, buyer_type, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?)`,
        id(),
        accountId,
        enquiry['company_name'] ?? null,
        enquiry['nature_of_trade'] ?? null,
        String(enquiry['buyer_type'] ?? 'unknown'),
        now(),
        now(),
      );
    }

    const dealCount = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM deals');
    const reference = `UKN-D-${String((dealCount?.n ?? 0) + 1).padStart(4, '0')}`;
    const dealId = id();
    db.run(
      `INSERT INTO deals (id, reference, account_id, enquiry_id, business, title, stage, owner_user_id, created_at, updated_at)
       VALUES (?,?,?,?, 'UKN', ?, 'enquiry', ?, ?, ?)`,
      dealId,
      reference,
      accountId,
      enquiryId,
      opts.title ?? `Enquiry from ${String(enquiry['company_name'] ?? 'new contact')}`,
      user.id,
      now(),
      now(),
    );

    db.run(
      "UPDATE enquiries SET status = 'converted', deal_id = ?, triaged_at = ? WHERE id = ?",
      dealId,
      now(),
      enquiryId,
    );
    audit(db, user.id, 'enquiry', enquiryId, 'converted', { dealId, accountId });
    return { dealId, accountId, reference };
  });
}

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

export interface EventInput {
  event: string;
  sessionId: string;
  occurredAt?: string;
  source?: string | null;
  medium?: string | null;
  campaign?: string | null;
  productId?: string | null;
  business?: string;
  payload?: Record<string, unknown>;
}

export function recordEvent(db: Db, input: EventInput): void {
  db.run(
    `INSERT INTO funnel_events (id, event, session_id, occurred_at, source, medium, campaign, product_id, business, payload, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    id(),
    input.event,
    input.sessionId,
    input.occurredAt ?? now(),
    input.source ?? null,
    input.medium ?? null,
    input.campaign ?? null,
    input.productId ?? null,
    input.business ?? 'UKN',
    jsonIn(input.payload ?? {}),
    now(),
  );
}

/* ------------------------------------------------------------------ */
/* Storage billing                                                     */
/* ------------------------------------------------------------------ */

/**
 * Raise a month of storage charges and the commission that follows. Runs
 * idempotently, so calling it twice for the same period changes nothing.
 */
export function runStorageBilling(db: Db, user: AuthUser, periodStart: string, periodEnd: string) {
  const agreements = db.all<Row>(
    'SELECT * FROM storage_agreements WHERE started_at <= ? AND (ended_at IS NULL OR ended_at >= ?)',
    periodEnd,
    periodStart,
  );

  const results: Array<{ agreementId: string; fee: Pence | null; unresolved: boolean; note: string }> = [];

  db.tx(() => {
    for (const a of agreements) {
      const agreementId = String(a['id']);
      const existing = db.get('SELECT id FROM storage_charges WHERE agreement_id = ? AND period_start = ?', agreementId, periodStart);
      if (existing) continue;

      const heldRow = db.get<{ held: number }>(
        `SELECT COALESCE(SUM(CASE WHEN direction='in' THEN quantity_kg ELSE -quantity_kg END),0) AS held
           FROM storage_movements WHERE agreement_id = ? AND occurred_at <= ?`,
        agreementId,
        periodEnd,
      );
      const heldKg = asKg(heldRow?.held ?? 0);

      const basis = String(a['fee_basis']);
      const quantity =
        basis === 'per_pallet_month'
          ? Number(a['pallet_positions'] ?? 0)
          : basis === 'per_tonne_month'
            ? heldKg / 1000
            : 1;

      const rate = a['rate_pence'];
      const unresolved = rate === null || rate === undefined;
      const fee = unresolved ? null : pence(Number(rate) * quantity);
      const note = unresolved
        ? 'Storage rate is not recorded (Q3). The fee cannot be raised or the commission accrued.'
        : '';

      db.run(
        `INSERT INTO storage_charges (id, agreement_id, account_id, period_start, period_end, basis, quantity, fee, unresolved, note, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        id(),
        agreementId,
        String(a['account_id']),
        periodStart,
        periodEnd,
        basis,
        quantity,
        fee,
        toInt(unresolved),
        note,
        now(),
      );

      if (fee !== null && fee > 0) {
        const account = db.get<Row>('SELECT * FROM accounts WHERE id = ?', String(a['account_id']));
        const entry = computeCommission({
          sourceId: `${agreementId}:${periodStart}`,
          sourceType: 'storage_period',
          business: 'UKN',
          origin: 'new',
          basis: 'storage_fee',
          amount: fee,
          orderSequence: 1,
          occurredAt: periodEnd,
          customerTermsDays: Number(account?.['payment_terms_days'] ?? 30),
        });
        insertCommission(db, entry, user.id, String(a['account_id']));
      }

      results.push({ agreementId, fee, unresolved, note });
    }
  });

  return { periodStart, periodEnd, charged: results.length, results };
}

export const currentPeriod = (): { start: string; end: string } => {
  const d = new Date(today());
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
};

export const commissionOn = (amount: Pence, bps: number): Pence => applyBps(amount, bps);
export type { Product };
