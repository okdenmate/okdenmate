/**
 * Compliance engine.
 *
 * Two separate regimes, routinely confused, kept apart here:
 *
 *   1. Point of sale - Poisons Act 1972, in force 1 Oct 2023. Applies to every
 *      sale of an explosives precursor regardless of tonnage. Buyer verification,
 *      18-month record retention, 24-hour suspicious transaction reporting,
 *      and no supply to members of the public.
 *
 *   2. Storage - NAMOS / NIHHS notification thresholds on peak tonnage held.
 *      25t of ammonium nitrate at or above 28%N, and 150t of AN mixtures at or
 *      above 15.75%N. Nothing to do with how much you sell.
 *
 * The brief records the site's notification status as UNKNOWN (Q13) and no
 * warning signage visible in photographs. The engine therefore treats an
 * unconfirmed notification as a live exposure, not as a silent pass.
 */

import type { Kilogrammes } from './money.js';
import { fromTonnes, toTonnes } from './money.js';
import type { Product } from './products.js';
import { isExplosivesPrecursor, isReportableSubstance } from './products.js';

/* ------------------------------------------------------------------------ */
/* 1. Point of sale: Poisons Act 1972                                        */
/* ------------------------------------------------------------------------ */

export const KYC_RETENTION_MONTHS = 18;
export const SUSPICIOUS_REPORT_DEADLINE_HOURS = 24;

export type BuyerType = 'business' | 'professional_user' | 'member_of_public' | 'unknown';

export interface KycRecord {
  id: string;
  accountId: string;
  /** Reference to the stored photo ID, not the document itself. */
  photoIdReference: string | null;
  photoIdType: 'passport' | 'driving_licence' | 'national_id' | null;
  businessName: string | null;
  businessAddress: string | null;
  vatNumber: string | null;
  natureOfTrade: string | null;
  buyerType: BuyerType;
  verifiedBy: string | null;
  verifiedAt: string | null;
  /** Set when the account is known to be barred from regulated supply. */
  refused: boolean;
  refusalReason: string | null;
}

export interface KycAssessment {
  complete: boolean;
  /** True when the record may lawfully support a regulated sale today. */
  valid: boolean;
  missingFields: string[];
  retentionExpiresAt: string | null;
  retentionExpired: boolean;
  daysUntilRetentionExpiry: number | null;
  reasons: string[];
}

const REQUIRED_KYC_FIELDS: Array<[keyof KycRecord, string]> = [
  ['photoIdReference', 'Photographic ID'],
  ['businessName', 'Business name'],
  ['businessAddress', 'Business address'],
  ['vatNumber', 'VAT number'],
  ['natureOfTrade', 'Nature of trade'],
];

export function assessKyc(record: KycRecord | null, today: Date = new Date()): KycAssessment {
  if (!record) {
    return {
      complete: false,
      valid: false,
      missingFields: REQUIRED_KYC_FIELDS.map(([, label]) => label),
      retentionExpiresAt: null,
      retentionExpired: false,
      daysUntilRetentionExpiry: null,
      reasons: ['No buyer verification record exists for this account.'],
    };
  }

  const missingFields = REQUIRED_KYC_FIELDS.filter(([key]) => {
    const v = record[key];
    return v === null || v === undefined || String(v).trim() === '';
  }).map(([, label]) => label);

  const reasons: string[] = [];
  if (missingFields.length > 0) reasons.push(`Verification incomplete: ${missingFields.join(', ')}.`);
  if (record.refused) {
    reasons.push(
      `Supply refused for this account${record.refusalReason ? `: ${record.refusalReason}` : '.'}`,
    );
  }
  if (record.buyerType === 'member_of_public') {
    reasons.push(
      'Buyer is a member of the public. Regulated nitrate lines may only be supplied to ' +
        'businesses and professional users.',
    );
  }
  if (record.buyerType === 'unknown') {
    reasons.push('Buyer type is not recorded, so the supply restriction cannot be applied.');
  }
  if (!record.verifiedAt || !record.verifiedBy) {
    reasons.push('Verification has not been signed off by a named person.');
  }

  let retentionExpiresAt: string | null = null;
  let retentionExpired = false;
  let daysUntilRetentionExpiry: number | null = null;

  if (record.verifiedAt) {
    const expiry = new Date(record.verifiedAt);
    expiry.setUTCMonth(expiry.getUTCMonth() + KYC_RETENTION_MONTHS);
    retentionExpiresAt = expiry.toISOString().slice(0, 10);
    daysUntilRetentionExpiry = Math.floor((expiry.getTime() - today.getTime()) / 86_400_000);
    retentionExpired = daysUntilRetentionExpiry < 0;
    if (retentionExpired) {
      reasons.push(
        `Verification is ${Math.abs(daysUntilRetentionExpiry)} days past the ${KYC_RETENTION_MONTHS}-month ` +
          'retention window and must be refreshed before further regulated supply.',
      );
    }
  }

  const complete = missingFields.length === 0 && !!record.verifiedAt && !!record.verifiedBy;
  const valid =
    complete &&
    !record.refused &&
    !retentionExpired &&
    (record.buyerType === 'business' || record.buyerType === 'professional_user');

  return {
    complete,
    valid,
    missingFields,
    retentionExpiresAt,
    retentionExpired,
    daysUntilRetentionExpiry,
    reasons,
  };
}

export type SaleGateDecision = 'clear' | 'warn' | 'blocked';

export interface SaleGate {
  decision: SaleGateDecision;
  regulatedProducts: string[];
  reportableProducts: string[];
  reasons: string[];
  requiredActions: string[];
}

/**
 * The gate a quote must pass before it can be sent. This is the mechanism that
 * makes compliance a property of the system rather than a memory exercise.
 */
export function evaluateSaleGate(
  products: Product[],
  lineProductIds: string[],
  kyc: KycRecord | null,
  today: Date = new Date(),
): SaleGate {
  const lineProducts = lineProductIds
    .map((id) => products.find((p) => p.id === id))
    .filter((p): p is Product => !!p);

  const regulated = lineProducts.filter(isExplosivesPrecursor);
  const reportable = lineProducts.filter(isReportableSubstance);

  if (regulated.length === 0) {
    return {
      decision: 'clear',
      regulatedProducts: [],
      reportableProducts: reportable.map((p) => p.name),
      reasons: ['No explosives-precursor lines on this quote.'],
      requiredActions: [],
    };
  }

  const assessment = assessKyc(kyc, today);
  if (assessment.valid) {
    const actions: string[] = [];
    if (assessment.daysUntilRetentionExpiry !== null && assessment.daysUntilRetentionExpiry < 60) {
      actions.push(
        `Refresh buyer verification within ${assessment.daysUntilRetentionExpiry} days to keep the record inside retention.`,
      );
    }
    return {
      decision: actions.length ? 'warn' : 'clear',
      regulatedProducts: regulated.map((p) => p.name),
      reportableProducts: reportable.map((p) => p.name),
      reasons: ['Buyer verification is complete and within the retention window.'],
      requiredActions: actions,
    };
  }

  return {
    decision: 'blocked',
    regulatedProducts: regulated.map((p) => p.name),
    reportableProducts: reportable.map((p) => p.name),
    reasons: assessment.reasons,
    requiredActions: [
      ...assessment.missingFields.map((f) => `Capture ${f.toLowerCase()}.`),
      'Sign off the verification against a named member of staff.',
    ],
  };
}

/* ------------------------------------------------------------------------ */
/* Suspicious transactions                                                   */
/* ------------------------------------------------------------------------ */

export type SuspiciousStatus = 'open' | 'reported' | 'dismissed';

export interface SuspiciousTransaction {
  id: string;
  accountId: string | null;
  detectedAt: string;
  summary: string;
  indicators: string[];
  status: SuspiciousStatus;
  reportedAt: string | null;
  reference: string | null;
}

export interface SuspiciousSla {
  deadlineAt: string;
  hoursRemaining: number;
  breached: boolean;
  urgent: boolean;
}

export function suspiciousSla(
  txn: SuspiciousTransaction,
  now: Date = new Date(),
): SuspiciousSla {
  const detected = new Date(txn.detectedAt);
  const deadline = new Date(detected.getTime() + SUSPICIOUS_REPORT_DEADLINE_HOURS * 3_600_000);
  const settled = txn.status !== 'open';
  const reference = settled && txn.reportedAt ? new Date(txn.reportedAt) : now;
  const hoursRemaining = (deadline.getTime() - reference.getTime()) / 3_600_000;
  return {
    deadlineAt: deadline.toISOString(),
    hoursRemaining: Math.round(hoursRemaining * 10) / 10,
    breached: hoursRemaining < 0 && txn.status !== 'dismissed',
    urgent: !settled && hoursRemaining >= 0 && hoursRemaining < 6,
  };
}

/**
 * Patterns that should raise a flag at the point of enquiry. Deliberately
 * conservative: these prompt a human to look, they do not accuse anyone.
 */
export interface SuspicionSignal {
  code: string;
  message: string;
}

export interface EnquiryRiskInput {
  buyerType: BuyerType;
  natureOfTrade: string | null;
  quantityKg: Kilogrammes;
  productIds: string[];
  wantsCollection: boolean;
  offeredCashPayment: boolean;
  refusedToProvideDetails: boolean;
  deliveryPostcode: string | null;
}

export function screenEnquiry(
  input: EnquiryRiskInput,
  products: Product[],
): SuspicionSignal[] {
  const signals: SuspicionSignal[] = [];
  const lines = input.productIds
    .map((id) => products.find((p) => p.id === id))
    .filter((p): p is Product => !!p);
  const touchesRegulated = lines.some(isExplosivesPrecursor);
  if (!touchesRegulated) return signals;

  if (input.buyerType === 'member_of_public') {
    signals.push({
      code: 'public_buyer',
      message: 'Enquiry is from a member of the public for a supply-restricted product.',
    });
  }
  if (input.refusedToProvideDetails) {
    signals.push({
      code: 'details_refused',
      message: 'Buyer declined to provide business details for a regulated line.',
    });
  }
  if (input.offeredCashPayment && toTonnes(input.quantityKg) >= 1) {
    signals.push({
      code: 'cash_payment',
      message: 'Cash offered for a bulk regulated line.',
    });
  }
  if (!input.natureOfTrade || input.natureOfTrade.trim().length < 3) {
    signals.push({
      code: 'no_trade_stated',
      message: 'No nature of trade given, which is a required field for this sale.',
    });
  }
  if (input.wantsCollection && toTonnes(input.quantityKg) >= 10) {
    signals.push({
      code: 'bulk_collection',
      message: 'Collection requested for 10t or more. Confirm the vehicle and the end use.',
    });
  }
  if (!input.deliveryPostcode && !input.wantsCollection) {
    signals.push({
      code: 'no_destination',
      message: 'No delivery destination given for a regulated line.',
    });
  }
  return signals;
}

/* ------------------------------------------------------------------------ */
/* 2. Storage: NAMOS / NIHHS thresholds                                      */
/* ------------------------------------------------------------------------ */

export interface StorageThreshold {
  id: string;
  limitKg: Kilogrammes;
  applies: string;
  notify: string;
  basis: string;
}

export const STORAGE_THRESHOLDS: StorageThreshold[] = [
  {
    id: 'dsear-25t',
    limitKg: fromTonnes(25),
    applies: 'Ammonium nitrate at or above 28%N',
    notify: 'HSE, local Fire & Rescue Service, and a warning sign at the site entrance',
    basis: 'Dangerous substances notification threshold',
  },
  {
    id: 'namos-150t',
    limitKg: fromTonnes(150),
    applies: 'Ammonium nitrate mixtures at or above 15.75%N',
    notify: 'Fire & Rescue Service, and HSE via NAMOS',
    basis: 'NAMOS',
  },
  {
    id: 'nihhs-150t',
    limitKg: fromTonnes(150),
    applies: 'Ammonium nitrate and mixtures',
    notify: 'HSE',
    basis: 'NIHHS 1982 (as amended)',
  },
];

export const MAX_STACK_KG = fromTonnes(300);
export const MIN_STACK_GAP_METRES = 1;

export type NotificationStatus = 'filed' | 'not_required' | 'unknown' | 'overdue';

export interface ComplianceNotification {
  thresholdId: string;
  status: NotificationStatus;
  filedAt: string | null;
  reference: string | null;
  note: string;
}

export interface ThresholdBreach {
  thresholdId: string;
  severity: 'critical' | 'warning' | 'info';
  heldKg: Kilogrammes;
  limitKg: Kilogrammes;
  utilisationBps: number;
  notificationStatus: NotificationStatus;
  message: string;
  action: string;
}

/**
 * Evaluate current and peak holdings against every threshold.
 *
 * Peak matters as much as current: the duty attaches to the tonnage held, so a
 * single 30t week two months ago triggers a notification obligation that a
 * snapshot of today's near-empty shed will not show. The brief records peak
 * tonnage ever held as UNKNOWN, which is why it is a required input here.
 */
export function evaluateStorageThresholds(
  currentAnKg: Kilogrammes,
  peakAnKg: Kilogrammes | null,
  notifications: ComplianceNotification[],
): ThresholdBreach[] {
  const breaches: ThresholdBreach[] = [];

  for (const threshold of STORAGE_THRESHOLDS) {
    const notification = notifications.find((n) => n.thresholdId === threshold.id);
    const status: NotificationStatus = notification?.status ?? 'unknown';
    const assessedKg = Math.max(currentAnKg, peakAnKg ?? 0) as Kilogrammes;
    const utilisationBps = Math.round((assessedKg / threshold.limitKg) * 10_000);

    if (peakAnKg === null && currentAnKg < threshold.limitKg) {
      breaches.push({
        thresholdId: threshold.id,
        severity: 'warning',
        heldKg: currentAnKg,
        limitKg: threshold.limitKg,
        utilisationBps,
        notificationStatus: 'unknown',
        message:
          `Peak tonnage ever held is not recorded, so it cannot be shown that the ` +
          `${toTonnes(threshold.limitKg)}t threshold was never crossed.`,
        action: `Reconstruct peak holdings from goods-in records, then confirm ${threshold.notify}.`,
      });
      continue;
    }

    if (assessedKg >= threshold.limitKg) {
      const filed = status === 'filed';
      breaches.push({
        thresholdId: threshold.id,
        severity: filed ? 'info' : 'critical',
        heldKg: assessedKg,
        limitKg: threshold.limitKg,
        utilisationBps,
        notificationStatus: filed ? 'filed' : 'overdue',
        message: filed
          ? `Above the ${toTonnes(threshold.limitKg)}t threshold, notification on file.`
          : `Holdings reached ${toTonnes(assessedKg).toFixed(1)}t against a ${toTonnes(threshold.limitKg)}t threshold with no notification recorded.`,
        action: filed
          ? 'Keep the notification current as holdings change.'
          : `Notify ${threshold.notify}.`,
      });
    } else if (utilisationBps >= 8000) {
      breaches.push({
        thresholdId: threshold.id,
        severity: 'warning',
        heldKg: assessedKg,
        limitKg: threshold.limitKg,
        utilisationBps,
        notificationStatus: status,
        message: `At ${(utilisationBps / 100).toFixed(0)}% of the ${toTonnes(threshold.limitKg)}t threshold. One more load crosses it.`,
        action: `Prepare the notification to ${threshold.notify} before accepting the next intake.`,
      });
    }
  }
  return breaches;
}

export interface StackCheck {
  ok: boolean;
  message: string;
}

export function checkStack(stackKg: Kilogrammes): StackCheck {
  if (stackKg > MAX_STACK_KG) {
    return {
      ok: false,
      message: `Stack of ${toTonnes(stackKg).toFixed(1)}t exceeds the 300t single-stack maximum. Split it, with at least ${MIN_STACK_GAP_METRES}m between stacks.`,
    };
  }
  return { ok: true, message: `Within the 300t single-stack maximum.` };
}

/**
 * The storage pitch is "outsource your regulatory duty to us". That only sells
 * if the duty is demonstrably discharged. This scores whether it currently is.
 */
export interface StoragePitchReadiness {
  score: number;
  sellable: boolean;
  blockers: string[];
}

export function assessStoragePitch(
  notifications: ComplianceNotification[],
  peakKnown: boolean,
  signageInPlace: boolean,
  proceduresDocumented: boolean,
): StoragePitchReadiness {
  const blockers: string[] = [];
  let score = 100;

  const filed = notifications.filter((n) => n.status === 'filed').length;
  const required = STORAGE_THRESHOLDS.length;
  if (filed < required) {
    score -= 35;
    blockers.push(
      `${required - filed} of ${required} notification positions are unconfirmed (Q13).`,
    );
  }
  if (!peakKnown) {
    score -= 25;
    blockers.push('Peak tonnage ever held is unknown, so the notification duty cannot be established.');
  }
  if (!signageInPlace) {
    score -= 20;
    blockers.push('No warning signage recorded at the site entrance.');
  }
  if (!proceduresDocumented) {
    score -= 20;
    blockers.push('Storage procedures are not documented, so the duty cannot be shown as discharged.');
  }

  return {
    score: Math.max(0, score),
    sellable: blockers.length === 0,
    blockers,
  };
}
