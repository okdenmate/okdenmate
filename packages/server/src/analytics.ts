/**
 * Read models for the dashboard. Each one answers a question the brief asks
 * and cannot currently answer.
 */

import type { AccountRevenue, FunnelEvent } from '@ukn/core';
import {
  assessConcentration,
  assessStoragePitch,
  buildFunnelReport,
  computeHoldings,
  evaluateStorageThresholds,
  forecastPipeline,
  kg,
  measureMixShift,
  modelCapacity,
  pence,
  peakSiteHolding,
  prioritiseQuestions,
  projectAllScenarios,
  projectEarnings,
  rankMixShiftCandidates,
  summariseCommission,
  suspiciousSla,
  type CommissionEntry,
  type PipelineDeal,
} from '@ukn/core';
import { Db, jsonOut, toBool, type Row } from './db.js';
import { asKg, asPence, mapMovement, mapNotification, mapQuestion, mapStorageAgreement, mapSuspicious } from './repo.js';

const AN_PRODUCT_IDS = new Set(['an-nitram-345']);

export function accountRevenues(db: Db): AccountRevenue[] {
  const rows = db.all<Row>(`
    SELECT a.id, a.name, a.possible_direct_importer,
           COALESCE(SUM(o.revenue),0)      AS revenue,
           COALESCE(SUM(o.gross_margin),0) AS gross_margin,
           COUNT(o.id)                     AS order_count,
           MIN(o.ordered_at)               AS first_order_at,
           MAX(o.ordered_at)               AS last_order_at
      FROM accounts a
      LEFT JOIN orders o ON o.account_id = a.id
     GROUP BY a.id
     HAVING COUNT(o.id) > 0
  `);
  return rows.map((r) => ({
    accountId: String(r['id']),
    accountName: String(r['name']),
    revenue: asPence(r['revenue']),
    grossMargin: asPence(r['gross_margin']),
    orderCount: Number(r['order_count']),
    firstOrderAt: r['first_order_at'] ? String(r['first_order_at']) : null,
    lastOrderAt: r['last_order_at'] ? String(r['last_order_at']) : null,
    possibleDirectImporter: toBool(r['possible_direct_importer']),
  }));
}

export function pipelineDeals(db: Db): PipelineDeal[] {
  const rows = db.all<Row>(`
    SELECT d.id, d.account_id, d.stage, d.expected_close_at, d.probability_bps_override,
           a.origin,
           COALESCE(SUM(CAST(dl.sell_per_tonne AS REAL) * dl.quantity_kg / 1000.0) - SUM(dl.discount), 0) AS revenue,
           COALESCE(SUM(CAST(dl.sell_per_tonne AS REAL) * dl.quantity_kg / 1000.0)
                  - SUM(CAST(dl.cost_per_tonne AS REAL) * dl.quantity_kg / 1000.0)
                  - SUM(dl.delivery_cost) - SUM(dl.discount), 0) AS gross_margin
      FROM deals d
      JOIN accounts a ON a.id = d.account_id
      LEFT JOIN deal_lines dl ON dl.deal_id = d.id
     GROUP BY d.id
  `);
  return rows.map((r) => ({
    id: String(r['id']),
    accountId: String(r['account_id']),
    stage: String(r['stage']) as PipelineDeal['stage'],
    revenue: pence(Number(r['revenue'])),
    grossMargin: pence(Number(r['gross_margin'])),
    expectedCloseAt: r['expected_close_at'] ? String(r['expected_close_at']) : null,
    probabilityBpsOverride:
      r['probability_bps_override'] === null ? null : Number(r['probability_bps_override']),
    isNewAccount: String(r['origin']) === 'new',
  }));
}

export function commissionEntries(db: Db, userId?: string): CommissionEntry[] {
  const rows = userId
    ? db.all<Row>('SELECT * FROM commission_entries WHERE user_id = ?', userId)
    : db.all<Row>('SELECT * FROM commission_entries');
  return rows.map((r) => ({
    sourceId: String(r['source_id']),
    sourceType: String(r['source_type']) as CommissionEntry['sourceType'],
    business: String(r['business']) as CommissionEntry['business'],
    rateId: String(r['rate_id']),
    rateBps: Number(r['rate_bps']),
    basis: String(r['basis']) as CommissionEntry['basis'],
    basisAmount: asPence(r['basis_amount']),
    amount: asPence(r['amount']),
    status: String(r['status']) as CommissionEntry['status'],
    occurredAt: String(r['occurred_at']),
    expectedPayableAt: String(r['expected_payable_at']),
    note: String(r['note'] ?? ''),
  }));
}

export function funnelEvents(db: Db, sinceIso?: string): FunnelEvent[] {
  const rows = sinceIso
    ? db.all<Row>('SELECT * FROM funnel_events WHERE occurred_at >= ?', sinceIso)
    : db.all<Row>('SELECT * FROM funnel_events');
  return rows.map((r) => ({
    id: String(r['id']),
    event: String(r['event']),
    sessionId: String(r['session_id']),
    occurredAt: String(r['occurred_at']),
    source: r['source'] ? String(r['source']) : null,
    medium: r['medium'] ? String(r['medium']) : null,
    campaign: r['campaign'] ? String(r['campaign']) : null,
    productId: r['product_id'] ? String(r['product_id']) : null,
    payload: jsonOut<Record<string, unknown>>(r['payload'], {}),
  }));
}

export function mixSnapshot(db: Db, sinceIso: string) {
  const row = db.get<Row>(
    `SELECT
       COALESCE(SUM(CASE WHEN p.product_class='commodity' THEN dl.sell_per_tonne * dl.quantity_kg / 1000.0 ELSE 0 END),0) AS c_rev,
       COALESCE(SUM(CASE WHEN p.product_class='specialty' THEN dl.sell_per_tonne * dl.quantity_kg / 1000.0 ELSE 0 END),0) AS s_rev,
       COALESCE(SUM(CASE WHEN p.product_class='commodity' THEN (dl.sell_per_tonne - dl.cost_per_tonne) * dl.quantity_kg / 1000.0 ELSE 0 END),0) AS c_gm,
       COALESCE(SUM(CASE WHEN p.product_class='specialty' THEN (dl.sell_per_tonne - dl.cost_per_tonne) * dl.quantity_kg / 1000.0 ELSE 0 END),0) AS s_gm,
       COUNT(DISTINCT CASE WHEN p.product_class='commodity' THEN o.id END) AS c_orders,
       COUNT(DISTINCT CASE WHEN p.product_class='specialty' THEN o.id END) AS s_orders
     FROM orders o
     JOIN deal_lines dl ON dl.deal_id = o.deal_id
     JOIN products p ON p.id = dl.product_id
     WHERE o.ordered_at >= ?`,
    sinceIso,
  );
  return measureMixShift({
    periodStart: sinceIso,
    periodEnd: new Date().toISOString().slice(0, 10),
    commodityRevenue: pence(Number(row?.['c_rev'] ?? 0)),
    specialtyRevenue: pence(Number(row?.['s_rev'] ?? 0)),
    commodityGm: pence(Number(row?.['c_gm'] ?? 0)),
    specialtyGm: pence(Number(row?.['s_gm'] ?? 0)),
    commodityOrders: Number(row?.['c_orders'] ?? 0),
    specialtyOrders: Number(row?.['s_orders'] ?? 0),
  });
}

export function mixShiftCallList(db: Db) {
  const since = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
  const rows = db.all<Row>(
    `SELECT a.id, a.name, a.sector,
            COALESCE(SUM(CASE WHEN p.product_class='commodity' THEN dl.sell_per_tonne * dl.quantity_kg / 1000.0 ELSE 0 END),0) AS c_rev,
            COALESCE(SUM(CASE WHEN p.product_class='specialty' THEN dl.sell_per_tonne * dl.quantity_kg / 1000.0 ELSE 0 END),0) AS s_rev,
            MAX(o.ordered_at) AS last_order_at
       FROM accounts a
       JOIN orders o ON o.account_id = a.id AND o.ordered_at >= ?
       JOIN deal_lines dl ON dl.deal_id = o.deal_id
       JOIN products p ON p.id = dl.product_id
      GROUP BY a.id`,
    since,
  );
  return rankMixShiftCandidates(
    rows.map((r) => ({
      accountId: String(r['id']),
      accountName: String(r['name']),
      commodityRevenue12m: pence(Number(r['c_rev'])),
      specialtyRevenue12m: pence(Number(r['s_rev'])),
      sector: r['sector'] ? String(r['sector']) : null,
      lastOrderAt: r['last_order_at'] ? String(r['last_order_at']) : null,
    })),
  ).slice(0, 10);
}

export function complianceOverview(db: Db) {
  const movements = db.all<Row>('SELECT * FROM storage_movements').map(mapMovement);
  const notifications = db.all<Row>('SELECT * FROM compliance_notifications').map(mapNotification);
  const site = db.get<Row>('SELECT * FROM site_compliance WHERE id = 1');

  const anMovements = movements.filter((m) => AN_PRODUCT_IDS.has(m.productId));
  const holdings = computeHoldings(anMovements);
  const currentAnKg = kg(holdings.reduce((s, h) => s + h.heldKg, 0));

  const ledgerPeak = peakSiteHolding(movements, (pid) => AN_PRODUCT_IDS.has(pid));
  const declaredPeak = site?.['peak_an_kg'] === null || site?.['peak_an_kg'] === undefined
    ? null
    : asKg(site['peak_an_kg']);
  // The larger of what was declared and what the ledger proves. A declared peak
  // lower than the ledger's would be a record-keeping failure, not a lower duty.
  const peakAnKg =
    declaredPeak === null && ledgerPeak.peakKg === 0
      ? null
      : kg(Math.max(declaredPeak ?? 0, ledgerPeak.peakKg));

  const breaches = evaluateStorageThresholds(currentAnKg, peakAnKg, notifications);

  const suspicious = db
    .all<Row>("SELECT * FROM suspicious_transactions ORDER BY detected_at DESC")
    .map(mapSuspicious)
    .map((t) => ({ ...t, sla: suspiciousSla(t) }));

  const kycRows = db.all<Row>(`
    SELECT a.id, a.name,
           k.id AS kyc_id, k.photo_id_reference, k.business_name, k.business_address,
           k.vat_number, k.nature_of_trade, k.buyer_type, k.verified_at, k.verified_by, k.refused
      FROM accounts a LEFT JOIN kyc_records k ON k.account_id = a.id
     WHERE a.status IN ('active','prospect')
  `);

  const readiness = assessStoragePitch(
    notifications,
    peakAnKg !== null,
    toBool(site?.['signage_in_place']),
    toBool(site?.['procedures_documented']),
  );

  return {
    currentAnKg,
    peakAnKg,
    peakSource: declaredPeak !== null ? 'declared' : ledgerPeak.peakKg > 0 ? 'ledger' : 'unknown',
    peakAt: ledgerPeak.peakAt,
    breaches,
    notifications,
    readiness,
    suspicious,
    accountsMissingKyc: kycRows.filter((r) => !r['kyc_id'] || !r['verified_at']).length,
    accountsTotal: kycRows.length,
    site: {
      signageInPlace: toBool(site?.['signage_in_place']),
      proceduresDocumented: toBool(site?.['procedures_documented']),
      totalPalletPositions:
        site?.['total_pallet_positions'] === null || site?.['total_pallet_positions'] === undefined
          ? null
          : Number(site['total_pallet_positions']),
      note: String(site?.['note'] ?? ''),
    },
  };
}

export function storageOverview(db: Db) {
  const agreements = db.all<Row>('SELECT * FROM storage_agreements').map(mapStorageAgreement);
  const movements = db.all<Row>('SELECT * FROM storage_movements ORDER BY occurred_at DESC').map(mapMovement);
  const site = db.get<Row>('SELECT * FROM site_compliance WHERE id = 1');
  const totalPositions =
    site?.['total_pallet_positions'] === null || site?.['total_pallet_positions'] === undefined
      ? null
      : Number(site['total_pallet_positions']);

  const rated = agreements.filter((a) => a.ratePence !== null && a.palletPositions);
  const avgRate =
    rated.length > 0 ? pence(rated.reduce((s, a) => s + (a.ratePence ?? 0), 0) / rated.length) : null;

  const charges = db.all<Row>('SELECT * FROM storage_charges ORDER BY period_start DESC LIMIT 24');

  return {
    agreements,
    holdings: computeHoldings(movements),
    movements: movements.slice(0, 50),
    capacity: modelCapacity(totalPositions, agreements, avgRate),
    unresolvedCharges: charges.filter((c) => toBool(c['unresolved'])).length,
    charges,
  };
}

export function dashboard(db: Db, userId: string) {
  const twelveMonthsAgo = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
  const revenues = accountRevenues(db);
  const commissions = commissionEntries(db, userId);
  const summary = summariseCommission(commissions);

  const yearStart = `${new Date().getUTCFullYear()}-01-01`;
  const ytd = commissions.filter((c) => c.occurredAt >= yearStart && c.status !== 'void');
  const monthsElapsed = new Date().getUTCMonth() + 1;
  const earnings = projectEarnings(
    pence(ytd.reduce((s, c) => s + c.amount, 0)),
    monthsElapsed,
  );

  const openTasks = db.all<Row>(
    'SELECT * FROM activities WHERE completed_at IS NULL AND due_at IS NOT NULL ORDER BY due_at LIMIT 10',
  );

  const newEnquiries = db.get<{ n: number }>("SELECT COUNT(*) AS n FROM enquiries WHERE status = 'new'");

  return {
    pipeline: forecastPipeline(pipelineDeals(db)),
    commission: summary,
    earnings,
    mix: mixSnapshot(db, twelveMonthsAgo),
    concentration: assessConcentration(revenues),
    funnel: buildFunnelReport(funnelEvents(db)),
    compliance: complianceOverview(db),
    questions: prioritiseQuestions(db.all<Row>('SELECT * FROM open_questions').map(mapQuestion)).slice(0, 6),
    scenarios: projectAllScenarios(),
    callList: mixShiftCallList(db),
    openTasks,
    newEnquiryCount: newEnquiries?.n ?? 0,
  };
}
