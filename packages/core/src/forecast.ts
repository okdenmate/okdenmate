/**
 * Forecast and scenario model.
 *
 * The brief gives three funnel scenarios for UKN at maturity (Layer 4,
 * Opportunity B) and is careful to present them as a band rather than a plan.
 * This reproduces that band from live pipeline data where it exists, and falls
 * back to the stated scenarios where it does not - always saying which.
 */

import type { Pence } from './money.js';
import { applyBps, pence } from './money.js';
import type { DealStage } from './funnel.js';
import { DEFAULT_STAGE_PROBABILITY_BPS, isOpenStage } from './funnel.js';

export interface PipelineDeal {
  id: string;
  accountId: string;
  stage: DealStage;
  revenue: Pence;
  grossMargin: Pence;
  expectedCloseAt: string | null;
  /** Overrides the stage default where a rep has a real read on the deal. */
  probabilityBpsOverride: number | null;
  isNewAccount: boolean;
}

export interface PipelineForecast {
  openDealCount: number;
  openRevenue: Pence;
  openGrossMargin: Pence;
  weightedRevenue: Pence;
  weightedGrossMargin: Pence;
  /** Commission the user would earn if the weighted pipeline landed. */
  weightedCommission: Pence;
  byStage: Array<{
    stage: DealStage;
    count: number;
    revenue: Pence;
    grossMargin: Pence;
    weightedGrossMargin: Pence;
  }>;
  caveat: string;
}

const NEW_ACCOUNT_BPS = 2500;
const REPEAT_BPS = 750;

export function forecastPipeline(
  deals: PipelineDeal[],
  probabilities: Record<DealStage, number> = DEFAULT_STAGE_PROBABILITY_BPS,
): PipelineForecast {
  const open = deals.filter((d) => isOpenStage(d.stage));
  const probFor = (d: PipelineDeal) => d.probabilityBpsOverride ?? probabilities[d.stage];

  const weightedGrossMargin = pence(
    open.reduce((s, d) => s + applyBps(d.grossMargin, probFor(d)), 0),
  );
  const weightedCommission = pence(
    open.reduce(
      (s, d) =>
        s +
        applyBps(applyBps(d.grossMargin, probFor(d)), d.isNewAccount ? NEW_ACCOUNT_BPS : REPEAT_BPS),
      0,
    ),
  );

  const stages: DealStage[] = ['enquiry', 'qualified', 'quoted', 'negotiation'];
  const byStage = stages.map((stage) => {
    const inStage = open.filter((d) => d.stage === stage);
    return {
      stage,
      count: inStage.length,
      revenue: pence(inStage.reduce((s, d) => s + d.revenue, 0)),
      grossMargin: pence(inStage.reduce((s, d) => s + d.grossMargin, 0)),
      weightedGrossMargin: pence(inStage.reduce((s, d) => s + applyBps(d.grossMargin, probFor(d)), 0)),
    };
  });

  return {
    openDealCount: open.length,
    openRevenue: pence(open.reduce((s, d) => s + d.revenue, 0)),
    openGrossMargin: pence(open.reduce((s, d) => s + d.grossMargin, 0)),
    weightedRevenue: pence(open.reduce((s, d) => s + applyBps(d.revenue, probFor(d)), 0)),
    weightedGrossMargin,
    weightedCommission,
    byStage,
    caveat:
      'Stage probabilities are assumed. There is no historical quote-to-order ratio to fit them ' +
      'to yet (Q11), so treat the weighting as a ranking device rather than a forecast until ' +
      'this system has recorded a full quarter.',
  };
}

/* ------------------------------------------------------------------------ */
/* Scenario bands                                                            */
/* ------------------------------------------------------------------------ */

export interface Scenario {
  id: 'low' | 'mid' | 'high';
  label: string;
  ordersPerMonthAtMaturity: number;
  /** Average gross margin per specialty order. */
  gmPerOrder: Pence;
  commissionBps: number;
  rampMonths: number;
}

/**
 * Reproduced from the brief's Opportunity B, which states the year-one impact
 * as: low 3 orders/mo, GBP 656/mo, GBP 4,300 year one; mid 6 orders/mo,
 * GBP 1,680/mo, GBP 11,100; high 10 orders/mo, GBP 3,375/mo, GBP 22,300.
 *
 * Two things are back-solved from those figures rather than invented. The
 * per-order gross margin follows from the monthly commission at maturity and
 * the 25% rate: GBP 656 a month across three orders is GBP 875 of margin per
 * order. The ramp then follows from the gap between the mature run rate and the
 * stated year-one total: GBP 4,300 against GBP 656 a month is 6.6 months of
 * mature trading inside twelve, which a linear ramp reaches only if it runs the
 * whole year. That is why every scenario ramps over twelve months and none of
 * them is at full rate before December.
 */
export const SCENARIOS: Scenario[] = [
  {
    id: 'low',
    label: 'Low',
    ordersPerMonthAtMaturity: 3,
    gmPerOrder: pence(87_500),
    commissionBps: 2500,
    rampMonths: 12,
  },
  {
    id: 'mid',
    label: 'Mid',
    ordersPerMonthAtMaturity: 6,
    gmPerOrder: pence(112_000),
    commissionBps: 2500,
    rampMonths: 12,
  },
  {
    id: 'high',
    label: 'High',
    ordersPerMonthAtMaturity: 10,
    gmPerOrder: pence(135_000),
    commissionBps: 2500,
    rampMonths: 12,
  },
];

export interface ScenarioProjection {
  scenario: Scenario;
  monthlyCommissionAtMaturity: Pence;
  yearOneCommission: Pence;
  monthlyGrossMarginAtMaturity: Pence;
  months: Array<{ month: number; orders: number; grossMargin: Pence; commission: Pence }>;
}

/** Linear ramp to maturity, then flat. Deliberately simple and easy to argue with. */
export function projectScenario(scenario: Scenario, horizonMonths = 12): ScenarioProjection {
  const months = Array.from({ length: horizonMonths }, (_, i) => {
    const month = i + 1;
    const rampFactor = Math.min(1, month / scenario.rampMonths);
    const orders = scenario.ordersPerMonthAtMaturity * rampFactor;
    const grossMargin = pence(orders * scenario.gmPerOrder);
    return {
      month,
      orders: Math.round(orders * 10) / 10,
      grossMargin,
      commission: applyBps(grossMargin, scenario.commissionBps),
    };
  });

  const gmAtMaturity = pence(scenario.ordersPerMonthAtMaturity * scenario.gmPerOrder);

  return {
    scenario,
    monthlyGrossMarginAtMaturity: gmAtMaturity,
    monthlyCommissionAtMaturity: applyBps(gmAtMaturity, scenario.commissionBps),
    yearOneCommission: pence(months.reduce((s, m) => s + m.commission, 0)),
    months,
  };
}

export const projectAllScenarios = (horizonMonths = 12): ScenarioProjection[] =>
  SCENARIOS.map((s) => projectScenario(s, horizonMonths));
