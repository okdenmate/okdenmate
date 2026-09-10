/**
 * Commission engine.
 *
 * Rates are fixed and accepted (brief Layer 2, decided 2026-09-01). They are
 * encoded here rather than configured in the UI, because a rate that can be
 * edited in an admin screen is a rate that gets disputed later.
 *
 *   RW new customer      10% of order value
 *   RW repeat            3%  of order value
 *   UKN new account      25% of gross margin
 *   UKN repeat           7.5% of gross margin
 *   UKN storage          25% of the storage fee, per month while stock is held
 *
 * Every line is paid only when Tom is paid, which means commission lags the
 * order by the customer's payment terms. The ledger models that lag explicitly
 * rather than pretending an order is cash.
 */

import type { Pence } from './money.js';
import { applyBps, pence } from './money.js';

export type Business = 'RW' | 'UKN';
export type CommissionBasis = 'order_value' | 'gross_margin' | 'storage_fee';
export type AccountOrigin = 'new' | 'inherited';

export interface CommissionRate {
  id: string;
  business: Business;
  line: string;
  basis: CommissionBasis;
  bps: number;
  description: string;
}

export const COMMISSION_RATES: CommissionRate[] = [
  {
    id: 'rw-new',
    business: 'RW',
    line: 'New customer order',
    basis: 'order_value',
    bps: 1000,
    description: 'First order from an account the user opened.',
  },
  {
    id: 'rw-repeat',
    business: 'RW',
    line: "Repeat order (Tom's customer)",
    basis: 'order_value',
    bps: 300,
    description: 'Any order from an account that pre-dates the user.',
  },
  {
    id: 'ukn-new',
    business: 'UKN',
    line: 'New account',
    basis: 'gross_margin',
    bps: 2500,
    description: 'Gross margin, not revenue. Aligns the incentive with profitability.',
  },
  {
    id: 'ukn-repeat',
    business: 'UKN',
    line: "Repeat order (Tom's customer)",
    basis: 'gross_margin',
    bps: 750,
    description: 'Repeat order from an inherited account.',
  },
  {
    id: 'ukn-storage',
    business: 'UKN',
    line: 'Storage fee',
    basis: 'storage_fee',
    bps: 2500,
    description: 'Per month, for as long as the customer holds stock. The only recurring line.',
  },
];

export const rateFor = (
  business: Business,
  origin: AccountOrigin,
  basis: CommissionBasis,
): CommissionRate => {
  if (basis === 'storage_fee') return COMMISSION_RATES.find((r) => r.id === 'ukn-storage')!;
  const id = `${business.toLowerCase()}-${origin === 'new' ? 'new' : 'repeat'}`;
  const rate = COMMISSION_RATES.find((r) => r.id === id);
  if (!rate) throw new Error(`No commission rate for ${business}/${origin}/${basis}`);
  return rate;
};

/**
 * Q12, unresolved: it is not written down whether the 25% new-account rate
 * applies to that account's later orders, or only its first. If it is
 * first-order-only, every projection in the business halves. The engine takes
 * the interpretation as an explicit input so the ambiguity is visible in the
 * numbers instead of buried in them.
 */
export type RepeatTerm = 'first_order_only' | 'life_of_account';

export interface RepeatTermPolicy {
  term: RepeatTerm;
  /** Months the new-account rate survives, when the term is life_of_account. */
  monthsIfLifetime: number | null;
  note: string;
}

export const DEFAULT_REPEAT_TERM: RepeatTermPolicy = {
  term: 'first_order_only',
  monthsIfLifetime: null,
  note:
    'Q12 is unanswered. The conservative reading is used by default so forecasts are not ' +
    'inflated by an entitlement that was never agreed in writing.',
};

export type CommissionStatus = 'accrued' | 'payable' | 'paid' | 'void';

export interface CommissionInput {
  sourceId: string;
  sourceType: 'order' | 'storage_period';
  business: Business;
  origin: AccountOrigin;
  basis: CommissionBasis;
  /** Order value, gross margin, or the month's storage fee, matching `basis`. */
  amount: Pence;
  /** Sequence of this order within the account. 1 is the first. */
  orderSequence: number;
  occurredAt: string;
  /** Payment terms in days; commission becomes payable when Tom is paid. */
  customerTermsDays: number;
}

export interface CommissionEntry {
  sourceId: string;
  sourceType: CommissionInput['sourceType'];
  business: Business;
  rateId: string;
  rateBps: number;
  basis: CommissionBasis;
  basisAmount: Pence;
  amount: Pence;
  status: CommissionStatus;
  occurredAt: string;
  /** Earliest date this can be paid, given the customer's terms. */
  expectedPayableAt: string;
  note: string;
}

const addDays = (iso: string, days: number): string => {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

export function computeCommission(
  input: CommissionInput,
  policy: RepeatTermPolicy = DEFAULT_REPEAT_TERM,
): CommissionEntry {
  let effectiveOrigin = input.origin;
  let note = '';

  if (input.origin === 'new' && input.orderSequence > 1 && input.basis !== 'storage_fee') {
    if (policy.term === 'first_order_only') {
      effectiveOrigin = 'inherited';
      note =
        'Paid at the repeat rate. Q12 is unresolved: if the new-account rate is agreed to ' +
        'run for the life of the account, this line is understated.';
    } else {
      note = 'Paid at the new-account rate on a repeat order, per the life-of-account reading of Q12.';
    }
  }

  const rate = rateFor(input.business, effectiveOrigin, input.basis);
  const amount = applyBps(input.amount, rate.bps);

  return {
    sourceId: input.sourceId,
    sourceType: input.sourceType,
    business: input.business,
    rateId: rate.id,
    rateBps: rate.bps,
    basis: input.basis,
    basisAmount: input.amount,
    amount,
    status: 'accrued',
    occurredAt: input.occurredAt,
    expectedPayableAt: addDays(input.occurredAt, input.customerTermsDays),
    note,
  };
}

export interface CommissionSummary {
  accrued: Pence;
  payable: Pence;
  paid: Pence;
  total: Pence;
  byBusiness: Record<Business, Pence>;
  recurring: Pence;
  count: number;
}

export function summariseCommission(entries: CommissionEntry[]): CommissionSummary {
  const zero = pence(0);
  const sum = (xs: CommissionEntry[]) => pence(xs.reduce((a, e) => a + e.amount, 0));
  const live = entries.filter((e) => e.status !== 'void');
  return {
    accrued: sum(live.filter((e) => e.status === 'accrued')),
    payable: sum(live.filter((e) => e.status === 'payable')),
    paid: sum(live.filter((e) => e.status === 'paid')),
    total: sum(live),
    byBusiness: {
      RW: sum(live.filter((e) => e.business === 'RW')),
      UKN: sum(live.filter((e) => e.business === 'UKN')),
    },
    recurring: sum(live.filter((e) => e.sourceType === 'storage_period')),
    count: live.length,
  };
}

/**
 * Annualised earnings view. The brief is blunt that year-1 lands at
 * GBP 50-70k and does not reach GBP 10k/month until year 2 at the earliest.
 * This computes against actuals rather than repeating that estimate.
 */
export const ANNUAL_BASE_SALARY = pence(4_500_000); // GBP 45,000, fixed and accepted

export interface EarningsView {
  baseAnnual: Pence;
  commissionYearToDate: Pence;
  /** Straight-line run rate from actual commission earned so far this year. */
  projectedCommissionAnnual: Pence;
  projectedTotalAnnual: Pence;
  monthlyRunRate: Pence;
  /** GBP 10k/month is the user's stated target. */
  pctOfTargetBps: number;
}

export const MONTHLY_TARGET = pence(1_000_000); // GBP 10,000/month

export function projectEarnings(
  commissionYtd: Pence,
  monthsElapsed: number,
  baseAnnual: Pence = ANNUAL_BASE_SALARY,
): EarningsView {
  const months = Math.max(1, monthsElapsed);
  const perMonth = pence(commissionYtd / months);
  const projectedCommissionAnnual = pence(perMonth * 12);
  const total = pence(baseAnnual + projectedCommissionAnnual);
  const monthlyRunRate = pence(total / 12);
  return {
    baseAnnual,
    commissionYearToDate: commissionYtd,
    projectedCommissionAnnual,
    projectedTotalAnnual: total,
    monthlyRunRate,
    pctOfTargetBps: Math.round((monthlyRunRate / MONTHLY_TARGET) * 10_000),
  };
}
