/**
 * Row mappers. The database speaks snake_case integers; the engines speak
 * camelCase branded types. Everything crosses the boundary here and nowhere else.
 */

import type {
  ComplianceNotification,
  KycRecord,
  Kilogrammes,
  OpenQuestion,
  Pence,
  PriceAnchor,
  Product,
  ProvenanceTag,
  StorageAgreement,
  StorageMovement,
  SuspiciousTransaction,
} from '@ukn/core';
import { assumed, kg, pence, tagged, unknown as unknownTag } from '@ukn/core';
import { Db, jsonOut, toBool, type Row } from './db.js';

export const asPence = (v: unknown): Pence => pence(Number(v ?? 0));
export const asKg = (v: unknown): Kilogrammes => kg(Number(v ?? 0));
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

export function mapProduct(r: Row): Product {
  const low = r['target_gm_low_bps'];
  const high = r['target_gm_high_bps'];
  const tag = String(r['target_gm_tag'] ?? 'U') as ProvenanceTag;
  const band =
    low === null || low === undefined || high === null || high === undefined || tag === 'U'
      ? unknownTag<[number, number]>(str(r['target_gm_blocked_by']) ?? undefined)
      : tagged<[number, number]>([Number(low), Number(high)], tag, {
          source: str(r['target_gm_source']) ?? undefined,
        });

  return {
    id: String(r['id']),
    name: String(r['name']),
    formula: str(r['formula']),
    productClass: String(r['product_class']) as Product['productClass'],
    nitrogenPct: r['nitrogen_pct'] === null ? null : Number(r['nitrogen_pct']),
    analysis: str(r['analysis']),
    grade: String(r['grade']) as Product['grade'],
    unClass: str(r['un_class']),
    unNumber: str(r['un_number']),
    packForms: jsonOut<Product['packForms']>(r['pack_forms'], []),
    supplier: str(r['supplier']),
    ukStock: toBool(r['uk_stock']),
    targetGmBps: band,
    notes: String(r['notes'] ?? ''),
  };
}

export const loadProducts = (db: Db): Product[] =>
  db.all('SELECT * FROM products WHERE active = 1 ORDER BY product_class, name').map(mapProduct);

export function mapAnchor(r: Row): PriceAnchor {
  return {
    productId: String(r['product_id']),
    pricePerTonne: asPence(r['price_per_tonne']),
    source: String(r['source']),
    asOf: String(r['as_of']),
    basis: String(r['basis']),
  };
}

/** The most recent anchor per product. Older ones stay for the trend chart. */
export function loadLatestAnchors(db: Db): Map<string, PriceAnchor> {
  const rows = db.all(`
    SELECT a.* FROM price_anchors a
    JOIN (SELECT product_id, MAX(as_of) AS m FROM price_anchors GROUP BY product_id) latest
      ON latest.product_id = a.product_id AND latest.m = a.as_of
  `);
  return new Map(rows.map((r) => [String(r['product_id']), mapAnchor(r)]));
}

export function mapKyc(r: Row): KycRecord {
  return {
    id: String(r['id']),
    accountId: String(r['account_id']),
    photoIdReference: str(r['photo_id_reference']),
    photoIdType: str(r['photo_id_type']) as KycRecord['photoIdType'],
    businessName: str(r['business_name']),
    businessAddress: str(r['business_address']),
    vatNumber: str(r['vat_number']),
    natureOfTrade: str(r['nature_of_trade']),
    buyerType: String(r['buyer_type'] ?? 'unknown') as KycRecord['buyerType'],
    verifiedBy: str(r['verified_by']),
    verifiedAt: str(r['verified_at']),
    refused: toBool(r['refused']),
    refusalReason: str(r['refusal_reason']),
  };
}

export const loadKyc = (db: Db, accountId: string): KycRecord | null => {
  const row = db.get('SELECT * FROM kyc_records WHERE account_id = ?', accountId);
  return row ? mapKyc(row) : null;
};

export function mapNotification(r: Row): ComplianceNotification {
  return {
    thresholdId: String(r['threshold_id']),
    status: String(r['status']) as ComplianceNotification['status'],
    filedAt: str(r['filed_at']),
    reference: str(r['reference']),
    note: String(r['note'] ?? ''),
  };
}

export const loadNotifications = (db: Db): ComplianceNotification[] =>
  db.all('SELECT * FROM compliance_notifications').map(mapNotification);

export function mapStorageAgreement(r: Row): StorageAgreement {
  return {
    id: String(r['id']),
    accountId: String(r['account_id']),
    productId: str(r['product_id']),
    feeBasis: String(r['fee_basis']) as StorageAgreement['feeBasis'],
    ratePence: r['rate_pence'] === null || r['rate_pence'] === undefined ? null : asPence(r['rate_pence']),
    palletPositions: r['pallet_positions'] === null ? null : Number(r['pallet_positions']),
    startedAt: String(r['started_at']),
    endedAt: str(r['ended_at']),
    dutyAccepted: toBool(r['duty_accepted']),
    notes: String(r['notes'] ?? ''),
  };
}

export function mapMovement(r: Row): StorageMovement {
  return {
    id: String(r['id']),
    agreementId: String(r['agreement_id']),
    accountId: String(r['account_id']),
    productId: String(r['product_id']),
    direction: String(r['direction']) as StorageMovement['direction'],
    quantityKg: asKg(r['quantity_kg']),
    occurredAt: String(r['occurred_at']),
    reference: str(r['reference']),
  };
}

export function mapSuspicious(r: Row): SuspiciousTransaction {
  return {
    id: String(r['id']),
    accountId: str(r['account_id']),
    detectedAt: String(r['detected_at']),
    summary: String(r['summary']),
    indicators: jsonOut<string[]>(r['indicators'], []),
    status: String(r['status']) as SuspiciousTransaction['status'],
    reportedAt: str(r['reported_at']),
    reference: str(r['reference']),
  };
}

export function mapQuestion(r: Row): OpenQuestion {
  return {
    id: String(r['id']),
    tier: Number(r['tier']) as OpenQuestion['tier'],
    business: String(r['business']) as OpenQuestion['business'],
    question: String(r['question']),
    whyItMatters: String(r['why_it_matters']),
    howToAnswer: String(r['how_to_answer']),
    consequenceIfUnanswered: String(r['consequence_if_unanswered']),
    owner: String(r['owner']),
    blocks: jsonOut<string[]>(r['blocks'], []),
    status: String(r['status']) as OpenQuestion['status'],
    answer: str(r['answer']),
    answeredAt: str(r['answered_at']),
  };
}

export interface DealLineRow {
  id: string;
  dealId: string;
  productId: string;
  quantityKg: Kilogrammes;
  costPerTonne: Pence;
  sellPerTonne: Pence;
  costTag: ProvenanceTag;
  deliveryCost: Pence;
  discount: Pence;
  packForm: string | null;
  position: number;
}

export function mapDealLine(r: Row): DealLineRow {
  return {
    id: String(r['id']),
    dealId: String(r['deal_id']),
    productId: String(r['product_id']),
    quantityKg: asKg(r['quantity_kg']),
    costPerTonne: asPence(r['cost_per_tonne']),
    sellPerTonne: asPence(r['sell_per_tonne']),
    costTag: String(r['cost_tag'] ?? 'E') as ProvenanceTag,
    deliveryCost: asPence(r['delivery_cost']),
    discount: asPence(r['discount']),
    packForm: str(r['pack_form']),
    position: Number(r['position'] ?? 0),
  };
}

export const loadDealLines = (db: Db, dealId: string): DealLineRow[] =>
  db.all('SELECT * FROM deal_lines WHERE deal_id = ? ORDER BY position', dealId).map(mapDealLine);

/** Reference sell prices for the mix-shift comparison, newest quote wins. */
export function referenceSellPrices(db: Db): Record<string, Pence | undefined> {
  const rows = db.all(`
    SELECT product_id, sell_per_tonne FROM deal_lines
    ORDER BY rowid DESC
  `);
  const out: Record<string, Pence | undefined> = {};
  for (const r of rows) {
    const pid = String(r['product_id']);
    if (out[pid] === undefined) out[pid] = asPence(r['sell_per_tonne']);
  }
  const anchors = loadLatestAnchors(db);
  for (const [pid, anchor] of anchors) if (out[pid] === undefined) out[pid] = anchor.pricePerTonne;
  return out;
}

export const bandFromTag = assumed;
