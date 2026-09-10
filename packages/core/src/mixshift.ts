/**
 * Mix Shift engine.
 *
 * Brief Layer 4, Opportunity A: steer existing enquiries from commodity
 * ammonium nitrate to specialty grades. Specialty gross margin runs 20-30%
 * against 2-6% on AN, so the same acquisition effort earns four to fifteen
 * times as much. It costs nothing and needs no budget, which is why the brief
 * sequences it ahead of any paid funnel.
 *
 * Layer 10.5 is explicit that this must be "enforced by the form rather than
 * left to memory". This module is that enforcement: it computes the specific
 * alternative, the specific margin delta, and the specific commission delta
 * for the person doing the steering.
 */

import type { Pence } from './money.js';
import { applyBps, pence, ratioBps, subP, toTonnes } from './money.js';
import type { Kilogrammes } from './money.js';
import type { Product } from './products.js';
import type { Tagged } from './provenance.js';
import { assumed, isKnown, unknown } from './provenance.js';

export interface MixShiftContext {
  /** Products on the enquiry or deal as it stands. */
  productIds: string[];
  quantityKg: Kilogrammes;
  /** Sector the buyer operates in, which decides what specialty line fits. */
  sector: string | null;
  /** 25% for a new account, 7.5% for an inherited one. */
  commissionBps: number;
}

export interface MixShiftSuggestion {
  fromProductId: string;
  toProductId: string;
  rationale: string;
  /** Margin the current mix earns, if it can be computed. */
  currentGm: Tagged<Pence>;
  /** Margin the suggested mix would earn. */
  suggestedGm: Tagged<Pence>;
  gmUplift: Tagged<Pence>;
  commissionUplift: Tagged<Pence>;
  /** Multiple, in basis points. 800 = 8x. */
  upliftMultipleBps: Tagged<number>;
  confidence: 'high' | 'medium' | 'low';
  caveat: string;
}

/**
 * Which specialty line to steer toward, by the buyer's sector. Sectors come
 * from the live site's own list, so this reflects markets the business already
 * claims to serve rather than an invented segmentation.
 */
const SECTOR_ROUTES: Record<string, { productId: string; rationale: string }> = {
  horticulture: {
    productId: 'can',
    rationale:
      'Horticulture buys calcium nitrate for the calcium as much as the nitrogen. It is a ' +
      'technical sell on crop outcome, not a price-per-tonne sell.',
  },
  hydroponics: {
    productId: 'mkp',
    rationale: 'Fertigation and hydroponic growers specify MKP by analysis, not by price.',
  },
  food_production: {
    productId: 'nano3',
    rationale:
      'Food-grade sodium nitrate carries a 30-50% price premium over technical grade, but only ' +
      'if the grade of current stock is confirmed (Q5).',
  },
  animal_nutrition: {
    productId: 'nano3',
    rationale: 'Specification-driven buyer, low price sensitivity, repeat volumes.',
  },
  water_treatment: {
    productId: 'nano3',
    rationale: 'Process chemical, bought on continuity of supply rather than spot price.',
  },
  sewage: {
    productId: 'nano3',
    rationale: 'Sodium nitrate is used for odour and sulphide control. Contract volumes, not spot.',
  },
  pyrotechnics: {
    productId: 'kno3-13-0-46',
    rationale:
      'Potassium nitrate is the standard oxidiser. Small tonnages, high margin, and a ' +
      'reportable substance so the buyer expects a documented supplier.',
  },
  glass: {
    productId: 'nano3',
    rationale: 'Sodium nitrate is a refining agent in glassmaking. Technical grade, steady offtake.',
  },
  ceramics: {
    productId: 'kno3-13-0-46',
    rationale: 'Potassium nitrate is used in glazes and frits. Small, regular, price-insensitive.',
  },
  agriculture: {
    productId: 'kno3-13-0-46',
    rationale:
      'Arable buyers on AN are the hardest to shift, since AHDB publishes the price they pay. ' +
      'Foliar potassium nitrate is the realistic wedge: a different job, not a cheaper tonne.',
  },
};

const DEFAULT_ROUTE = {
  productId: 'kno3-13-0-46',
  rationale:
    'No sector recorded, so the default specialty route applies. Ask what the material is ' +
    'used for before quoting; the answer decides the grade and the price.',
};

/** Midpoint of a target band, in bps. */
const bandMid = (band: Tagged<[number, number]>): Tagged<number> =>
  isKnown(band)
    ? assumed(Math.round((band.value[0] + band.value[1]) / 2), band.source ?? 'target band')
    : unknown<number>(band.blockedBy);

/**
 * Build the suggestion for a commodity-heavy enquiry.
 *
 * Returns an empty list when there is nothing to shift, so the UI shows a
 * prompt only where one is genuinely warranted.
 */
export function suggestMixShift(
  ctx: MixShiftContext,
  products: Product[],
  /** Reference sell price per tonne, by product, where one is known. */
  sellPerTonne: Record<string, Pence | undefined> = {},
): MixShiftSuggestion[] {
  const byId = new Map(products.map((p) => [p.id, p]));
  const lines = ctx.productIds.map((id) => byId.get(id)).filter((p): p is Product => !!p);
  const commodityLines = lines.filter((p) => p.productClass === 'commodity');
  if (commodityLines.length === 0) return [];

  const route = (ctx.sector && SECTOR_ROUTES[ctx.sector]) || DEFAULT_ROUTE;
  const target = byId.get(route.productId);
  if (!target) return [];

  const tonnes = toTonnes(ctx.quantityKg);

  return commodityLines.map((from) => {
    const fromMid = bandMid(from.targetGmBps);
    const toMid = bandMid(target.targetGmBps);

    const fromSell = sellPerTonne[from.id];
    const toSell = sellPerTonne[target.id];

    const currentGm: Tagged<Pence> =
      isKnown(fromMid) && fromSell !== undefined
        ? assumed(pence(applyBps(fromSell, fromMid.value) * tonnes), 'target band midpoint')
        : unknown<Pence>(fromMid.blockedBy ?? 'reference sell price');

    // A specialty substitution is rarely tonne-for-tonne. Specialty buyers take
    // smaller, more frequent loads, so the comparison is deliberately made on a
    // conservative fraction of the commodity tonnage rather than all of it.
    const specialtyTonnes = Math.max(1, tonnes * SPECIALTY_TONNAGE_RATIO);

    const suggestedGm: Tagged<Pence> =
      isKnown(toMid) && toSell !== undefined
        ? assumed(pence(applyBps(toSell, toMid.value) * specialtyTonnes), 'target band midpoint')
        : unknown<Pence>(toMid.blockedBy ?? 'reference sell price');

    const gmUplift: Tagged<Pence> =
      isKnown(currentGm) && isKnown(suggestedGm)
        ? assumed(subP(suggestedGm.value, currentGm.value), 'derived from target bands')
        : unknown<Pence>(currentGm.blockedBy ?? suggestedGm.blockedBy ?? 'Q2');

    const commissionUplift: Tagged<Pence> = isKnown(gmUplift)
      ? assumed(applyBps(gmUplift.value, ctx.commissionBps), 'commission on the margin delta')
      : unknown<Pence>(gmUplift.blockedBy);

    const upliftMultipleBps: Tagged<number> =
      isKnown(currentGm) && isKnown(suggestedGm) && currentGm.value > 0
        ? assumed(ratioBps(suggestedGm.value, currentGm.value), 'derived')
        : unknown<number>('Q2');

    return {
      fromProductId: from.id,
      toProductId: target.id,
      rationale: route.rationale,
      currentGm,
      suggestedGm,
      gmUplift,
      commissionUplift,
      upliftMultipleBps,
      confidence: isKnown(gmUplift) ? 'low' : 'low',
      caveat:
        'The specialty margin band is assumed at 20-30% and is unverified (Q2). Every figure ' +
        'in this comparison moves with it. Treat the direction as sound and the magnitude as a ' +
        'working estimate until three to five real specialty orders are priced out.',
    };
  });
}

/** Specialty substitutions run at smaller tonnages than the AN load they replace. */
export const SPECIALTY_TONNAGE_RATIO = 0.15;

/* ------------------------------------------------------------------------ */
/* Portfolio view                                                            */
/* ------------------------------------------------------------------------ */

export interface MixSnapshot {
  periodStart: string;
  periodEnd: string;
  commodityRevenue: Pence;
  specialtyRevenue: Pence;
  commodityGm: Pence;
  specialtyGm: Pence;
  commodityOrders: number;
  specialtyOrders: number;
}

export interface MixShiftProgress {
  specialtyGmShareBps: number;
  specialtyRevenueShareBps: number;
  /** Gross margin earned per pound of revenue, across the whole book. */
  blendedGmBps: number;
  /** Where the blended margin would sit if the target share were reached. */
  targetSpecialtyGmShareBps: number;
  onTrack: boolean;
  headline: string;
}

/**
 * The target is expressed as a share of gross margin rather than of revenue,
 * because tonnes of AN will always dominate revenue and never dominate profit.
 * Measuring the shift on revenue would make real progress look like failure.
 */
export const TARGET_SPECIALTY_GM_SHARE_BPS = 7000; // 70% of gross margin

export function measureMixShift(snapshot: MixSnapshot): MixShiftProgress {
  const revenue = pence(snapshot.commodityRevenue + snapshot.specialtyRevenue);
  const gm = pence(snapshot.commodityGm + snapshot.specialtyGm);
  const specialtyGmShareBps = ratioBps(snapshot.specialtyGm, gm);
  const specialtyRevenueShareBps = ratioBps(snapshot.specialtyRevenue, revenue);
  const blendedGmBps = ratioBps(gm, revenue);
  const onTrack = specialtyGmShareBps >= TARGET_SPECIALTY_GM_SHARE_BPS;

  const headline = onTrack
    ? `Specialty carries ${(specialtyGmShareBps / 100).toFixed(0)}% of gross margin. The mix has shifted.`
    : `Specialty carries ${(specialtyGmShareBps / 100).toFixed(0)}% of gross margin against a ${(TARGET_SPECIALTY_GM_SHARE_BPS / 100).toFixed(0)}% target. ` +
      `Commodity is still doing most of the work for a fraction of the return.`;

  return {
    specialtyGmShareBps,
    specialtyRevenueShareBps,
    blendedGmBps,
    targetSpecialtyGmShareBps: TARGET_SPECIALTY_GM_SHARE_BPS,
    onTrack,
    headline,
  };
}

/**
 * Rank accounts by how much they would be worth if their mix moved. This is the
 * call list for the Mix Shift trial the brief schedules for week 4-6: "contact
 * top 3 existing UKN customers with a specialty offer".
 */
export interface AccountMixCandidate {
  accountId: string;
  accountName: string;
  commodityRevenue12m: Pence;
  specialtyRevenue12m: Pence;
  sector: string | null;
  lastOrderAt: string | null;
}

export interface RankedCandidate extends AccountMixCandidate {
  /** 0-100. Volume that could move, weighted by how untouched the account is. */
  opportunityScore: number;
  suggestedProductId: string;
  reason: string;
}

export function rankMixShiftCandidates(
  candidates: AccountMixCandidate[],
  today: Date = new Date(),
): RankedCandidate[] {
  const maxCommodity = Math.max(1, ...candidates.map((c) => c.commodityRevenue12m));

  return candidates
    .map((c) => {
      const volumeScore = (c.commodityRevenue12m / maxCommodity) * 60;
      const total = c.commodityRevenue12m + c.specialtyRevenue12m;
      const untouchedScore = total > 0 ? (1 - c.specialtyRevenue12m / total) * 25 : 0;
      const days = c.lastOrderAt
        ? Math.floor((today.getTime() - new Date(c.lastOrderAt).getTime()) / 86_400_000)
        : 999;
      const recencyScore = days <= 90 ? 15 : days <= 180 ? 8 : 0;
      const route = (c.sector && SECTOR_ROUTES[c.sector]) || DEFAULT_ROUTE;

      const reasons: string[] = [];
      if (c.commodityRevenue12m > 0 && c.specialtyRevenue12m === 0) {
        reasons.push('Buys commodity only, so nothing has been tried yet.');
      }
      if (days <= 90) reasons.push('Ordered within the last quarter, so the relationship is live.');
      if (!c.sector) reasons.push('Sector not recorded. Find out what they make before quoting.');

      return {
        ...c,
        opportunityScore: Math.round(volumeScore + untouchedScore + recencyScore),
        suggestedProductId: route.productId,
        reason: reasons.join(' ') || 'Existing account with room to move.',
      };
    })
    .sort((a, b) => b.opportunityScore - a.opportunityScore);
}

export const SECTORS = Object.keys(SECTOR_ROUTES);
export const sectorRoute = (sector: string | null) =>
  (sector && SECTOR_ROUTES[sector]) || DEFAULT_ROUTE;
