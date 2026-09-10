/**
 * Storage ledger.
 *
 * Storage is the only recurring revenue line in either business, and the user
 * earns 25% of the fee every month the customer holds stock. It is also the
 * only line where the product being sold is a regulatory duty rather than a
 * material: the customer is outsourcing the obligation to hold nitrates
 * compliantly. The brief is direct about what that means - "a moat if
 * compliance is solid; a liability if not".
 *
 * Utilisation is roughly 5% (verified by photograph). The constraint is not
 * space, it is sales activity.
 */

import type { Kilogrammes, Pence } from './money.js';
import { addKg, kg, pence, ratioBps, toTonnes } from './money.js';

export type FeeBasis = 'per_pallet_month' | 'per_tonne_month' | 'flat_month';

export interface StorageAgreement {
  id: string;
  accountId: string;
  productId: string | null;
  feeBasis: FeeBasis;
  /** Rate in pence, per the basis. UNKNOWN in the brief (Q3) until Tom confirms. */
  ratePence: Pence | null;
  palletPositions: number | null;
  startedAt: string;
  endedAt: string | null;
  /** Whether UKN has accepted the customer's notification duty in writing. */
  dutyAccepted: boolean;
  notes: string;
}

export type MovementDirection = 'in' | 'out';

export interface StorageMovement {
  id: string;
  agreementId: string;
  accountId: string;
  productId: string;
  direction: MovementDirection;
  quantityKg: Kilogrammes;
  occurredAt: string;
  reference: string | null;
}

export interface HoldingSnapshot {
  accountId: string;
  productId: string;
  heldKg: Kilogrammes;
}

/** Running balance per account and product, from the movement ledger. */
export function computeHoldings(movements: StorageMovement[]): HoldingSnapshot[] {
  const map = new Map<string, HoldingSnapshot>();
  for (const m of movements) {
    const key = `${m.accountId}::${m.productId}`;
    const existing = map.get(key) ?? { accountId: m.accountId, productId: m.productId, heldKg: kg(0) };
    const delta = m.direction === 'in' ? m.quantityKg : (-m.quantityKg as Kilogrammes);
    existing.heldKg = addKg(existing.heldKg, delta);
    map.set(key, existing);
  }
  return [...map.values()].filter((h) => h.heldKg !== 0);
}

/** Peak tonnage held across the whole site, which is what the duty attaches to. */
export function peakSiteHolding(
  movements: StorageMovement[],
  productFilter?: (productId: string) => boolean,
): { peakKg: Kilogrammes; peakAt: string | null } {
  const relevant = movements
    .filter((m) => !productFilter || productFilter(m.productId))
    .slice()
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));

  let running = 0;
  let peak = 0;
  let peakAt: string | null = null;
  for (const m of relevant) {
    running += m.direction === 'in' ? m.quantityKg : -m.quantityKg;
    if (running > peak) {
      peak = running;
      peakAt = m.occurredAt;
    }
  }
  return { peakKg: kg(peak), peakAt };
}

export interface StoragePeriodCharge {
  agreementId: string;
  accountId: string;
  periodStart: string;
  periodEnd: string;
  basis: FeeBasis;
  quantity: number;
  fee: Pence | null;
  /** Null fee means the rate is not recorded, not that the month was free. */
  unresolved: boolean;
  note: string;
}

/**
 * Monthly charge for one agreement. Returns an unresolved charge rather than
 * zero when the rate is unknown, so a blank fee schedule shows up as a gap in
 * the ledger instead of quietly suppressing revenue.
 */
export function chargeForPeriod(
  agreement: StorageAgreement,
  heldKg: Kilogrammes,
  periodStart: string,
  periodEnd: string,
): StoragePeriodCharge {
  const quantity =
    agreement.feeBasis === 'per_pallet_month'
      ? (agreement.palletPositions ?? 0)
      : agreement.feeBasis === 'per_tonne_month'
        ? toTonnes(heldKg)
        : 1;

  if (agreement.ratePence === null) {
    return {
      agreementId: agreement.id,
      accountId: agreement.accountId,
      periodStart,
      periodEnd,
      basis: agreement.feeBasis,
      quantity,
      fee: null,
      unresolved: true,
      note: 'Storage rate is not recorded (Q3). The fee cannot be raised or the commission accrued.',
    };
  }

  return {
    agreementId: agreement.id,
    accountId: agreement.accountId,
    periodStart,
    periodEnd,
    basis: agreement.feeBasis,
    quantity,
    fee: pence(agreement.ratePence * quantity),
    unresolved: false,
    note: '',
  };
}

/* ------------------------------------------------------------------------ */
/* Capacity                                                                  */
/* ------------------------------------------------------------------------ */

export interface CapacityModel {
  /** Total pallet positions in the racking. UNKNOWN in the brief (Q15). */
  totalPalletPositions: number | null;
  occupiedPalletPositions: number;
  utilisationBps: number | null;
  /** Monthly revenue if every position were let at the current rate. */
  revenueAtFullOccupancy: Pence | null;
  /** What is currently earned. */
  currentMonthlyRevenue: Pence;
  headroom: string;
}

export function modelCapacity(
  totalPositions: number | null,
  agreements: StorageAgreement[],
  ratePerPositionMonth: Pence | null,
): CapacityModel {
  const live = agreements.filter((a) => !a.endedAt);
  const occupied = live.reduce((s, a) => s + (a.palletPositions ?? 0), 0);
  const currentMonthlyRevenue = pence(
    live.reduce(
      (s, a) => s + (a.ratePence !== null ? a.ratePence * (a.palletPositions ?? 1) : 0),
      0,
    ),
  );

  if (totalPositions === null) {
    return {
      totalPalletPositions: null,
      occupiedPalletPositions: occupied,
      utilisationBps: null,
      revenueAtFullOccupancy: null,
      currentMonthlyRevenue,
      headroom:
        'Pallet positions have never been counted (Q15). Utilisation was estimated at about 5% ' +
        'from photographs, so the constraint is sales activity rather than space.',
    };
  }

  const utilisationBps = ratioBps(pence(occupied), pence(totalPositions));
  return {
    totalPalletPositions: totalPositions,
    occupiedPalletPositions: occupied,
    utilisationBps,
    revenueAtFullOccupancy:
      ratePerPositionMonth !== null ? pence(ratePerPositionMonth * totalPositions) : null,
    currentMonthlyRevenue,
    headroom: `${totalPositions - occupied} of ${totalPositions} positions are empty.`,
  };
}
