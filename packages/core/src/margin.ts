/**
 * Margin engine.
 *
 * Every line in this CRM is priced against gross margin, not revenue, because
 * the user's commission is paid on gross margin (brief Layer 2) and because
 * the difference between a 4% AN load and a 25% specialty load is the entire
 * business case.
 */

import type { Pence } from './money.js';
import { addP, applyBps, pence, ratioBps, subP } from './money.js';
import type { Kilogrammes } from './money.js';
import { toTonnes } from './money.js';
import type { Product } from './products.js';

export interface LineInput {
  productId: string;
  productClass: Product['productClass'];
  /** Quantity in kg. Priced per tonne, held per kg, to avoid rounding drift. */
  quantityKg: Kilogrammes;
  /** Laid-down cost per tonne: goods + freight + handling. */
  costPerTonne: Pence;
  /** Sell price per tonne, ex-VAT. */
  sellPerTonne: Pence;
  /** Line-level extras that reduce margin but not headline price. */
  deliveryCost?: Pence;
  discount?: Pence;
}

export interface LineMargin {
  productId: string;
  productClass: Product['productClass'];
  quantityKg: Kilogrammes;
  revenue: Pence;
  cost: Pence;
  grossMargin: Pence;
  gmBps: number;
  /** Margin per tonne, the number that decides whether a load is worth loading. */
  gmPerTonne: Pence;
}

export interface DealMargin {
  lines: LineMargin[];
  revenue: Pence;
  cost: Pence;
  grossMargin: Pence;
  gmBps: number;
  commodityRevenue: Pence;
  specialtyRevenue: Pence;
  commodityGrossMargin: Pence;
  specialtyGrossMargin: Pence;
  /** Share of gross margin coming from specialty, in bps. The mix-shift KPI. */
  specialtyGmShareBps: number;
}

export function computeLineMargin(line: LineInput): LineMargin {
  const tonnes = toTonnes(line.quantityKg);
  const gross = pence(line.sellPerTonne * tonnes);
  const revenue = subP(gross, line.discount ?? pence(0));
  const cost = addP(pence(line.costPerTonne * tonnes), line.deliveryCost ?? pence(0));
  const grossMargin = subP(revenue, cost);
  return {
    productId: line.productId,
    productClass: line.productClass,
    quantityKg: line.quantityKg,
    revenue,
    cost,
    grossMargin,
    gmBps: ratioBps(grossMargin, revenue),
    gmPerTonne: tonnes > 0 ? pence(grossMargin / tonnes) : pence(0),
  };
}

export function computeDealMargin(lines: LineInput[]): DealMargin {
  const computed = lines.map(computeLineMargin);
  const revenue = addP(...computed.map((l) => l.revenue), pence(0));
  const cost = addP(...computed.map((l) => l.cost), pence(0));
  const grossMargin = subP(revenue, cost);

  const sumBy = (pred: (l: LineMargin) => boolean, key: 'revenue' | 'grossMargin'): Pence =>
    addP(...computed.filter(pred).map((l) => l[key]), pence(0));

  const isSpecialty = (l: LineMargin) => l.productClass === 'specialty';
  const isCommodity = (l: LineMargin) => l.productClass === 'commodity';

  const specialtyGrossMargin = sumBy(isSpecialty, 'grossMargin');

  return {
    lines: computed,
    revenue,
    cost,
    grossMargin,
    gmBps: ratioBps(grossMargin, revenue),
    commodityRevenue: sumBy(isCommodity, 'revenue'),
    specialtyRevenue: sumBy(isSpecialty, 'revenue'),
    commodityGrossMargin: sumBy(isCommodity, 'grossMargin'),
    specialtyGrossMargin,
    specialtyGmShareBps: ratioBps(specialtyGrossMargin, grossMargin),
  };
}

/* ------------------------------------------------------------------------ */
/* Price anchors                                                             */
/* ------------------------------------------------------------------------ */

/**
 * AHDB publishes a delivered GB price for ammonium nitrate every week. A buyer
 * can check any AN quote against it in thirty seconds, so quoting AN without
 * knowing the anchor is quoting blind.
 */
export interface PriceAnchor {
  productId: string;
  /** Reference price per tonne, delivered, ex-VAT. */
  pricePerTonne: Pence;
  source: string;
  asOf: string;
  basis: string;
}

export interface AnchorCheck {
  anchored: boolean;
  anchorPerTonne: Pence | null;
  /** Quote minus anchor, per tonne. Positive means quoted above the public price. */
  variancePerTonne: Pence | null;
  varianceBps: number | null;
  /** Days since the anchor was published. Stale anchors mislead. */
  anchorAgeDays: number | null;
  verdict: 'no_anchor' | 'below_anchor' | 'at_anchor' | 'above_anchor' | 'far_above_anchor';
  message: string;
}

const AT_ANCHOR_TOLERANCE_BPS = 200; // +/-2% reads as "at market"
const FAR_ABOVE_BPS = 1000; // +10% invites a price check the rep will lose

export function checkAgainstAnchor(
  sellPerTonne: Pence,
  anchor: PriceAnchor | undefined,
  today: Date = new Date(),
): AnchorCheck {
  if (!anchor) {
    return {
      anchored: false,
      anchorPerTonne: null,
      variancePerTonne: null,
      varianceBps: null,
      anchorAgeDays: null,
      verdict: 'no_anchor',
      message: 'No published reference price. Margin cannot be sanity-checked against market.',
    };
  }
  const variance = subP(sellPerTonne, anchor.pricePerTonne);
  const varianceBps = ratioBps(variance, anchor.pricePerTonne);
  const ageDays = Math.max(
    0,
    Math.floor((today.getTime() - new Date(anchor.asOf).getTime()) / 86_400_000),
  );

  let verdict: AnchorCheck['verdict'];
  let message: string;
  if (varianceBps > FAR_ABOVE_BPS) {
    verdict = 'far_above_anchor';
    message = `Quoted ${(varianceBps / 100).toFixed(1)}% above the published AHDB price. The buyer can see that figure. Expect a challenge.`;
  } else if (varianceBps > AT_ANCHOR_TOLERANCE_BPS) {
    verdict = 'above_anchor';
    message = `Quoted ${(varianceBps / 100).toFixed(1)}% above the published price. Defensible only on service or lead time.`;
  } else if (varianceBps < -AT_ANCHOR_TOLERANCE_BPS) {
    verdict = 'below_anchor';
    message = `Quoted ${(Math.abs(varianceBps) / 100).toFixed(1)}% below the published price. Check the laid-down cost before sending.`;
  } else {
    verdict = 'at_anchor';
    message = 'At the published market price.';
  }
  if (ageDays > 14) message += ` Anchor is ${ageDays} days old.`;

  return {
    anchored: true,
    anchorPerTonne: anchor.pricePerTonne,
    variancePerTonne: variance,
    varianceBps,
    anchorAgeDays: ageDays,
    verdict,
    message,
  };
}

/* ------------------------------------------------------------------------ */
/* Guardrails                                                                */
/* ------------------------------------------------------------------------ */

export type GuardSeverity = 'block' | 'warn' | 'info';

export interface MarginGuard {
  code: string;
  severity: GuardSeverity;
  message: string;
}

/**
 * Floor margins below which a line is not worth the handling, the compliance
 * duty or the working capital. Commodity AN genuinely runs at 2-6%, so its
 * floor is low; a specialty line at 8% means something has gone wrong in
 * pricing, not that specialty is thin.
 */
export const MARGIN_FLOOR_BPS: Record<Product['productClass'], number> = {
  commodity: 150,
  specialty: 1200,
  ancillary: 500,
};

export function evaluateMarginGuards(deal: DealMargin, products: Product[]): MarginGuard[] {
  const guards: MarginGuard[] = [];
  const nameOf = (id: string) => products.find((p) => p.id === id)?.name ?? id;

  for (const line of deal.lines) {
    const floor = MARGIN_FLOOR_BPS[line.productClass];
    if (line.revenue <= 0) continue;
    if (line.gmBps < 0) {
      guards.push({
        code: 'negative_margin',
        severity: 'block',
        message: `${nameOf(line.productId)} sells below laid-down cost. This line loses money.`,
      });
    } else if (line.gmBps < floor) {
      guards.push({
        code: 'below_floor',
        severity: line.productClass === 'specialty' ? 'block' : 'warn',
        message: `${nameOf(line.productId)} at ${(line.gmBps / 100).toFixed(1)}% is below the ${(floor / 100).toFixed(0)}% floor for ${line.productClass} lines.`,
      });
    }
    const product = products.find((p) => p.id === line.productId);
    const band = product?.targetGmBps;
    if (band?.value && line.gmBps > band.value[1] + 1000) {
      guards.push({
        code: 'above_band',
        severity: 'info',
        message: `${nameOf(line.productId)} is priced above the expected band. Confirm the cost figure is complete.`,
      });
    }
  }

  if (deal.revenue > 0 && deal.commodityRevenue === deal.revenue && deal.lines.length > 0) {
    guards.push({
      code: 'all_commodity',
      severity: 'warn',
      message:
        'Every line on this deal is commodity. Commodity gross margin runs 2-6%, so the ' +
        'acquisition effort here earns roughly a tenth of the same effort on specialty.',
    });
  }
  return guards;
}

export const hasBlockingGuard = (guards: MarginGuard[]): boolean =>
  guards.some((g) => g.severity === 'block');

/** Convenience for the UI: apply a target band to a cost to get a sell price. */
export const sellFromCost = (costPerTonne: Pence, targetGmBps: number): Pence =>
  targetGmBps >= 10_000
    ? costPerTonne
    : pence(costPerTonne / (1 - targetGmBps / 10_000));

export const marginAtSell = (costPerTonne: Pence, sellPerTonne: Pence): number =>
  ratioBps(subP(sellPerTonne, costPerTonne), sellPerTonne);

export const uplift = (base: Pence, bps: number): Pence => addP(base, applyBps(base, bps));
