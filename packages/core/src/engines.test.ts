import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { derive, estimated, isKnown, tagged, unknown, verified, weakest } from './provenance.js';
import { applyBps, fromPounds, fromTonnes, pence, ratioBps, toPounds } from './money.js';
import { SEED_PRODUCTS, isExplosivesPrecursor, isReportableSubstance } from './products.js';
import {
  checkAgainstAnchor,
  computeDealMargin,
  evaluateMarginGuards,
  hasBlockingGuard,
  marginAtSell,
  sellFromCost,
} from './margin.js';
import { computeCommission, projectEarnings, summariseCommission } from './commission.js';
import {
  assessKyc,
  assessStoragePitch,
  checkStack,
  evaluateSaleGate,
  evaluateStorageThresholds,
  screenEnquiry,
  suspiciousSla,
  type KycRecord,
} from './compliance.js';
import { measureMixShift, rankMixShiftCandidates, suggestMixShift } from './mixshift.js';
import { buildFunnelReport, type FunnelEvent } from './funnel.js';
import { assessConcentration } from './concentration.js';
import { computeHoldings, chargeForPeriod, peakSiteHolding, type StorageAgreement } from './storage.js';
import { forecastPipeline, projectScenario, SCENARIOS } from './forecast.js';
import { prioritiseQuestions, SEED_QUESTIONS } from './questions.js';

describe('provenance', () => {
  it('refuses to attach a value to an unknown', () => {
    assert.throws(() => tagged(5, 'U'));
  });

  it('propagates the weakest tag through a derivation', () => {
    assert.equal(weakest('V', 'A', 'R'), 'A');
    const out = derive([verified(10, 'invoice'), estimated(2)], ([a, b]) => a! * b!);
    assert.equal(out.tag, 'E');
    assert.equal(out.value, 20);
  });

  it('returns unknown when any input is unknown, rather than zero', () => {
    const out = derive([verified(10, 'invoice'), unknown<number>('Q2')], ([a, b]) => a! * b!);
    assert.equal(isKnown(out), false);
    assert.equal(out.blockedBy, 'Q2');
  });
});

describe('money', () => {
  it('rounds to whole pence and survives a round trip', () => {
    assert.equal(fromPounds(461), 46_100);
    assert.equal(toPounds(fromPounds(12.345)), 12.35);
  });

  it('applies basis points without float drift', () => {
    // 25% of GBP 5,000 gross margin is the headline UKN commission line.
    assert.equal(applyBps(fromPounds(5000), 2500), fromPounds(1250));
    assert.equal(ratioBps(pence(2500), pence(10_000)), 2500);
  });
});

describe('products', () => {
  it('treats ammonium nitrate at 34.5%N as an explosives precursor', () => {
    const an = SEED_PRODUCTS.find((p) => p.id === 'an-nitram-345')!;
    assert.equal(isExplosivesPrecursor(an), true);
  });

  it('treats potassium nitrate as regulated and sodium nitrate as reportable only', () => {
    const kno3 = SEED_PRODUCTS.find((p) => p.id === 'kno3-13-0-46')!;
    const nano3 = SEED_PRODUCTS.find((p) => p.id === 'nano3')!;
    assert.equal(isExplosivesPrecursor(kno3), true);
    assert.equal(isExplosivesPrecursor(nano3), false);
    assert.equal(isReportableSubstance(nano3), true);
  });

  it('keeps the specialty margin band tagged as assumed', () => {
    const nano3 = SEED_PRODUCTS.find((p) => p.id === 'nano3')!;
    assert.equal(nano3.targetGmBps.tag, 'A');
  });
});

describe('margin', () => {
  const anLine = {
    productId: 'an-nitram-345',
    productClass: 'commodity' as const,
    quantityKg: fromTonnes(28),
    costPerTonne: fromPounds(440),
    sellPerTonne: fromPounds(461),
  };

  it('computes gross margin per tonne on a commodity load', () => {
    const deal = computeDealMargin([anLine]);
    assert.equal(deal.revenue, fromPounds(12_908));
    assert.equal(deal.grossMargin, fromPounds(588));
    // 21/461 is 4.55%, inside the 2-6% band the brief anchors AN to.
    assert.ok(deal.gmBps > 400 && deal.gmBps < 500);
    assert.equal(deal.lines[0]!.gmPerTonne, fromPounds(21));
  });

  it('separates specialty margin share from revenue share', () => {
    const deal = computeDealMargin([
      { ...anLine, quantityKg: fromTonnes(56) },
      {
        productId: 'nano3',
        productClass: 'specialty',
        quantityKg: fromTonnes(15.6),
        costPerTonne: fromPounds(435),
        sellPerTonne: fromPounds(850),
      },
    ]);
    // Specialty is the minority of revenue and the overwhelming majority of margin,
    // which is the whole argument for measuring the mix on gross margin.
    assert.ok(deal.specialtyRevenue < deal.commodityRevenue);
    assert.ok(deal.specialtyGmShareBps > 8000);
  });

  it('blocks a specialty line priced below its floor', () => {
    const deal = computeDealMargin([
      {
        productId: 'nano3',
        productClass: 'specialty',
        quantityKg: fromTonnes(10),
        costPerTonne: fromPounds(500),
        sellPerTonne: fromPounds(520),
      },
    ]);
    const guards = evaluateMarginGuards(deal, SEED_PRODUCTS);
    assert.equal(hasBlockingGuard(guards), true);
  });

  it('flags an all-commodity deal', () => {
    const guards = evaluateMarginGuards(computeDealMargin([anLine]), SEED_PRODUCTS);
    assert.ok(guards.some((g) => g.code === 'all_commodity'));
  });

  it('compares a quote against the published AHDB price', () => {
    const anchor = {
      productId: 'an-nitram-345',
      pricePerTonne: fromPounds(461),
      source: 'AHDB GB',
      asOf: '2026-08-28',
      basis: 'Delivered to farm, full load, 28-day terms, ex-VAT',
    };
    const at = checkAgainstAnchor(fromPounds(465), anchor, new Date('2026-09-01'));
    assert.equal(at.verdict, 'at_anchor');

    const far = checkAgainstAnchor(fromPounds(550), anchor, new Date('2026-09-01'));
    assert.equal(far.verdict, 'far_above_anchor');

    const none = checkAgainstAnchor(fromPounds(800), undefined);
    assert.equal(none.verdict, 'no_anchor');
  });

  it('round-trips a target margin through sell price', () => {
    const sell = sellFromCost(fromPounds(400), 2500);
    assert.equal(marginAtSell(fromPounds(400), sell), 2500);
  });
});

describe('commission', () => {
  const base = {
    sourceId: 'ord-1',
    sourceType: 'order' as const,
    business: 'UKN' as const,
    origin: 'new' as const,
    basis: 'gross_margin' as const,
    amount: fromPounds(6000),
    orderSequence: 1,
    occurredAt: '2026-09-01',
    customerTermsDays: 30,
  };

  it('pays 25% of gross margin on a new UK Nitrates account', () => {
    const entry = computeCommission(base);
    assert.equal(entry.amount, fromPounds(1500));
    assert.equal(entry.rateId, 'ukn-new');
    assert.equal(entry.expectedPayableAt, '2026-10-01');
  });

  it('drops to the repeat rate on later orders under the conservative reading of Q12', () => {
    const entry = computeCommission({ ...base, orderSequence: 2 });
    assert.equal(entry.rateId, 'ukn-repeat');
    assert.equal(entry.amount, fromPounds(450));
    assert.match(entry.note, /Q12/);
  });

  it('keeps the new rate on repeats under the life-of-account reading', () => {
    const entry = computeCommission(
      { ...base, orderSequence: 4 },
      { term: 'life_of_account', monthsIfLifetime: null, note: '' },
    );
    assert.equal(entry.rateId, 'ukn-new');
    assert.equal(entry.amount, fromPounds(1500));
  });

  it('pays Reeve Wood on order value rather than margin', () => {
    const entry = computeCommission({
      ...base,
      business: 'RW',
      basis: 'order_value',
      amount: fromPounds(7428),
    });
    assert.equal(entry.rateBps, 1000);
    assert.equal(entry.amount, fromPounds(742.8));
  });

  it('summarises a ledger by status and business', () => {
    const entries = [
      { ...computeCommission(base), status: 'paid' as const },
      { ...computeCommission({ ...base, sourceId: 'ord-2' }), status: 'accrued' as const },
    ];
    const summary = summariseCommission(entries);
    assert.equal(summary.paid, fromPounds(1500));
    assert.equal(summary.accrued, fromPounds(1500));
    assert.equal(summary.byBusiness.UKN, fromPounds(3000));
  });

  it('projects annual earnings from actual commission', () => {
    const view = projectEarnings(fromPounds(3000), 6);
    assert.equal(view.projectedCommissionAnnual, fromPounds(6000));
    assert.equal(view.projectedTotalAnnual, fromPounds(51_000));
    // Well short of the GBP 10k/month target, which is what the brief predicts.
    assert.ok(view.pctOfTargetBps < 5000);
  });
});

describe('compliance: point of sale', () => {
  const goodKyc: KycRecord = {
    id: 'kyc-1',
    accountId: 'acc-1',
    photoIdReference: 'DL-88213',
    photoIdType: 'driving_licence',
    businessName: 'Proficio Ltd',
    businessAddress: 'Norfolk',
    vatNumber: 'GB123456789',
    natureOfTrade: 'Agricultural merchant',
    buyerType: 'business',
    verifiedBy: 'J. Nwobodo',
    verifiedAt: '2026-06-01',
    refused: false,
    refusalReason: null,
  };

  it('clears a regulated sale when verification is complete', () => {
    const gate = evaluateSaleGate(
      SEED_PRODUCTS,
      ['an-nitram-345'],
      goodKyc,
      new Date('2026-09-10'),
    );
    assert.equal(gate.decision, 'clear');
  });

  it('blocks a regulated sale with no verification record at all', () => {
    const gate = evaluateSaleGate(SEED_PRODUCTS, ['an-nitram-345'], null);
    assert.equal(gate.decision, 'blocked');
    assert.ok(gate.requiredActions.length > 0);
  });

  it('blocks when the VAT number is missing', () => {
    const gate = evaluateSaleGate(SEED_PRODUCTS, ['kno3-13-0-46'], {
      ...goodKyc,
      vatNumber: null,
    });
    assert.equal(gate.decision, 'blocked');
    assert.ok(gate.reasons.some((r) => r.includes('VAT number')));
  });

  it('blocks supply to a member of the public', () => {
    const gate = evaluateSaleGate(SEED_PRODUCTS, ['an-nitram-345'], {
      ...goodKyc,
      buyerType: 'member_of_public',
    });
    assert.equal(gate.decision, 'blocked');
  });

  it('expires verification 18 months after sign-off', () => {
    const assessment = assessKyc(goodKyc, new Date('2028-06-01'));
    assert.equal(assessment.retentionExpired, true);
    assert.equal(assessment.valid, false);
    assert.equal(assessment.retentionExpiresAt, '2027-12-01');
  });

  it('leaves an unregulated line alone', () => {
    const gate = evaluateSaleGate(SEED_PRODUCTS, ['mgso4'], null);
    assert.equal(gate.decision, 'clear');
  });

  it('runs the 24-hour reporting clock', () => {
    const sla = suspiciousSla(
      {
        id: 's1',
        accountId: null,
        detectedAt: '2026-09-09T09:00:00Z',
        summary: 'Cash offered for 20t',
        indicators: [],
        status: 'open',
        reportedAt: null,
        reference: null,
      },
      new Date('2026-09-10T12:00:00Z'),
    );
    assert.equal(sla.breached, true);
  });

  it('raises signals on a cash, no-details bulk enquiry', () => {
    const signals = screenEnquiry(
      {
        buyerType: 'member_of_public',
        natureOfTrade: null,
        quantityKg: fromTonnes(24),
        productIds: ['an-nitram-345'],
        wantsCollection: true,
        offeredCashPayment: true,
        refusedToProvideDetails: true,
        deliveryPostcode: null,
      },
      SEED_PRODUCTS,
    );
    const codes = signals.map((s) => s.code);
    assert.ok(codes.includes('public_buyer'));
    assert.ok(codes.includes('cash_payment'));
    assert.ok(codes.includes('details_refused'));
    assert.ok(codes.includes('bulk_collection'));
  });

  it('raises nothing on an unregulated enquiry', () => {
    const signals = screenEnquiry(
      {
        buyerType: 'unknown',
        natureOfTrade: null,
        quantityKg: fromTonnes(24),
        productIds: ['mgso4'],
        wantsCollection: true,
        offeredCashPayment: true,
        refusedToProvideDetails: true,
        deliveryPostcode: null,
      },
      SEED_PRODUCTS,
    );
    assert.equal(signals.length, 0);
  });
});

describe('compliance: storage thresholds', () => {
  it('treats an unrecorded peak as an exposure rather than a pass', () => {
    const breaches = evaluateStorageThresholds(fromTonnes(4), null, []);
    assert.ok(breaches.length >= 1);
    assert.ok(breaches.every((b) => b.notificationStatus === 'unknown'));
  });

  it('raises a critical breach at 25t with no notification on file', () => {
    const breaches = evaluateStorageThresholds(fromTonnes(30), fromTonnes(30), []);
    const dsear = breaches.find((b) => b.thresholdId === 'dsear-25t');
    assert.equal(dsear?.severity, 'critical');
    assert.match(dsear!.action, /Fire & Rescue/);
  });

  it('goes quiet once the notification is filed', () => {
    const breaches = evaluateStorageThresholds(fromTonnes(30), fromTonnes(30), [
      { thresholdId: 'dsear-25t', status: 'filed', filedAt: '2026-01-01', reference: 'HSE-1', note: '' },
    ]);
    assert.equal(breaches.find((b) => b.thresholdId === 'dsear-25t')?.severity, 'info');
  });

  it('warns one load before the threshold', () => {
    const breaches = evaluateStorageThresholds(fromTonnes(21), fromTonnes(21), []);
    const dsear = breaches.find((b) => b.thresholdId === 'dsear-25t');
    assert.equal(dsear?.severity, 'warning');
  });

  it('enforces the 300t single-stack maximum', () => {
    assert.equal(checkStack(fromTonnes(310)).ok, false);
    assert.equal(checkStack(fromTonnes(250)).ok, true);
  });

  it('will not call the storage pitch sellable while notifications are unconfirmed', () => {
    const readiness = assessStoragePitch([], false, false, false);
    assert.equal(readiness.sellable, false);
    assert.equal(readiness.score, 0);
  });
});

describe('mix shift', () => {
  it('suggests a specialty route for a commodity enquiry', () => {
    const suggestions = suggestMixShift(
      {
        productIds: ['an-nitram-345'],
        quantityKg: fromTonnes(28),
        sector: 'pyrotechnics',
        commissionBps: 2500,
      },
      SEED_PRODUCTS,
      { 'an-nitram-345': fromPounds(461), 'kno3-13-0-46': fromPounds(900) },
    );
    assert.equal(suggestions.length, 1);
    assert.equal(suggestions[0]!.toProductId, 'kno3-13-0-46');
    assert.ok(isKnown(suggestions[0]!.gmUplift));
    assert.match(suggestions[0]!.caveat, /Q2/);
  });

  it('says nothing when the enquiry is already specialty', () => {
    const suggestions = suggestMixShift(
      { productIds: ['nano3'], quantityKg: fromTonnes(15), sector: 'glass', commissionBps: 2500 },
      SEED_PRODUCTS,
    );
    assert.equal(suggestions.length, 0);
  });

  it('reports the uplift as unknown when no reference price exists', () => {
    const suggestions = suggestMixShift(
      { productIds: ['an-nitram-345'], quantityKg: fromTonnes(28), sector: null, commissionBps: 2500 },
      SEED_PRODUCTS,
    );
    assert.equal(isKnown(suggestions[0]!.gmUplift), false);
  });

  it('measures the mix on gross margin, not revenue', () => {
    const progress = measureMixShift({
      periodStart: '2026-01-01',
      periodEnd: '2026-09-01',
      commodityRevenue: fromPounds(100_000),
      specialtyRevenue: fromPounds(30_000),
      commodityGm: fromPounds(4_000),
      specialtyGm: fromPounds(7_500),
      commodityOrders: 12,
      specialtyOrders: 3,
    });
    assert.ok(progress.specialtyRevenueShareBps < progress.specialtyGmShareBps);
    assert.equal(progress.onTrack, false);
  });

  it('ranks the untouched, high-volume, recently active account first', () => {
    const ranked = rankMixShiftCandidates(
      [
        {
          accountId: 'a',
          accountName: 'Proficio Ltd',
          commodityRevenue12m: fromPounds(40_000),
          specialtyRevenue12m: fromPounds(0),
          sector: 'agriculture',
          lastOrderAt: '2026-08-20',
        },
        {
          accountId: 'b',
          accountName: 'Brian Wallace',
          commodityRevenue12m: fromPounds(600),
          specialtyRevenue12m: fromPounds(0),
          sector: null,
          lastOrderAt: '2026-01-02',
        },
      ],
      new Date('2026-09-10'),
    );
    assert.equal(ranked[0]!.accountId, 'a');
    assert.ok(ranked[0]!.opportunityScore > ranked[1]!.opportunityScore);
  });
});

describe('funnel', () => {
  const ev = (event: string, sessionId: string): FunnelEvent => ({
    id: `${event}-${sessionId}`,
    event,
    sessionId,
    occurredAt: '2026-09-09T10:00:00Z',
    source: null,
    medium: null,
    campaign: null,
    productId: null,
    payload: {},
  });

  it('counts unique sessions per stage and computes conversion', () => {
    const events = [
      ev('page_view', 's1'),
      ev('page_view', 's2'),
      ev('page_view', 's2'),
      ev('calc_engaged', 's1'),
      ev('enquiry_opened', 's1'),
      ev('enquiry_submitted', 's1'),
    ];
    const report = buildFunnelReport(events);
    assert.equal(report.stages[0]!.count, 2);
    assert.equal(report.overallConversionBps, 5000);
  });

  it('says why the funnel is empty rather than reporting a clean zero', () => {
    const report = buildFunnelReport([]);
    assert.ok(report.diagnosis.some((d) => d.includes('Q18')));
  });

  it('refuses to print a conversion above 100% and says why instead', () => {
    const events = [
      ev('page_view', 's1'),
      ev('quote_sent', 'q1'),
      ev('order_won', 'q1'),
      ev('order_won', 'phone-1'),
      ev('order_won', 'phone-2'),
    ];
    const report = buildFunnelReport(events);
    const order = report.stages.find((s) => s.stage === 'order')!;
    assert.equal(order.count, 3);
    assert.equal(order.stepConversionBps, null);
    assert.equal(order.enteredOutsideFunnel, 2);
    assert.equal(report.quoteToOrderBps, null);
    assert.ok(report.diagnosis.some((d) => d.includes('without a quote going out')));
  });

  it('will not report an arrival-to-lead rate above 100%', () => {
    const events = [
      ev('page_view', 's1'),
      ev('enquiry_submitted', 's1'),
      ev('enquiry_submitted', 'phone-1'),
      ev('enquiry_submitted', 'phone-2'),
    ];
    const report = buildFunnelReport(events);
    assert.equal(report.overallConversionBps, null);
    assert.ok(report.diagnosis.some((d) => d.includes('fires no page view')));
  });

  it('flags a leak between opening and submitting', () => {
    const events = [
      ...['s1', 's2', 's3', 's4'].map((s) => ev('page_view', s)),
      ...['s1', 's2', 's3', 's4'].map((s) => ev('calc_engaged', s)),
      ...['s1', 's2', 's3', 's4'].map((s) => ev('enquiry_opened', s)),
      ev('enquiry_submitted', 's1'),
    ];
    const report = buildFunnelReport(events);
    assert.ok(report.diagnosis.some((d) => d.includes('leaking')));
  });
});

describe('concentration', () => {
  it('calls a single-account book critical', () => {
    const risk = assessConcentration(
      [
        {
          accountId: 'a',
          accountName: 'Proficio Ltd',
          revenue: fromPounds(20_000),
          grossMargin: fromPounds(900),
          orderCount: 4,
          firstOrderAt: '2026-01-01',
          lastOrderAt: '2026-09-01',
          possibleDirectImporter: true,
        },
        {
          accountId: 'b',
          accountName: 'Brian Wallace',
          revenue: fromPounds(606),
          grossMargin: fromPounds(24),
          orderCount: 1,
          firstOrderAt: '2026-08-01',
          lastOrderAt: '2026-08-01',
          possibleDirectImporter: false,
        },
      ],
      365,
      new Date('2026-09-10'),
    );
    assert.equal(risk.severity, 'critical');
    assert.equal(risk.accountsToHalfMargin, 1);
    assert.ok(risk.findings.some((f) => f.includes('directly')));
  });

  it('reports unknown rather than safe when there is no history', () => {
    const risk = assessConcentration([]);
    assert.equal(risk.severity, 'unknown');
    assert.match(risk.headline, /Q4/);
  });
});

describe('storage', () => {
  const movements = [
    { id: '1', agreementId: 'ag1', accountId: 'a', productId: 'an-nitram-345', direction: 'in' as const, quantityKg: fromTonnes(28), occurredAt: '2026-03-01', reference: null },
    { id: '2', agreementId: 'ag1', accountId: 'a', productId: 'an-nitram-345', direction: 'out' as const, quantityKg: fromTonnes(20), occurredAt: '2026-04-01', reference: null },
    { id: '3', agreementId: 'ag1', accountId: 'a', productId: 'an-nitram-345', direction: 'in' as const, quantityKg: fromTonnes(5), occurredAt: '2026-05-01', reference: null },
  ];

  it('computes the current holding from the ledger', () => {
    const holdings = computeHoldings(movements);
    assert.equal(holdings[0]!.heldKg, fromTonnes(13));
  });

  it('finds the peak, which is what the notification duty attaches to', () => {
    const { peakKg, peakAt } = peakSiteHolding(movements);
    assert.equal(peakKg, fromTonnes(28));
    assert.equal(peakAt, '2026-03-01');
  });

  it('leaves the fee unresolved when the rate is unknown, rather than charging zero', () => {
    const agreement: StorageAgreement = {
      id: 'ag1',
      accountId: 'a',
      productId: null,
      feeBasis: 'per_pallet_month',
      ratePence: null,
      palletPositions: 13,
      startedAt: '2026-03-01',
      endedAt: null,
      dutyAccepted: false,
      notes: '',
    };
    const charge = chargeForPeriod(agreement, fromTonnes(13), '2026-09-01', '2026-09-30');
    assert.equal(charge.fee, null);
    assert.equal(charge.unresolved, true);
    assert.match(charge.note, /Q3/);
  });
});

describe('forecast', () => {
  it('weights open deals and derives the commission that follows', () => {
    const forecast = forecastPipeline([
      { id: 'd1', accountId: 'a', stage: 'quoted', revenue: fromPounds(12_000), grossMargin: fromPounds(3_000), expectedCloseAt: null, probabilityBpsOverride: null, isNewAccount: true },
      { id: 'd2', accountId: 'b', stage: 'won', revenue: fromPounds(5_000), grossMargin: fromPounds(1_000), expectedCloseAt: null, probabilityBpsOverride: null, isNewAccount: false },
    ]);
    assert.equal(forecast.openDealCount, 1);
    assert.equal(forecast.weightedGrossMargin, fromPounds(1_200));
    assert.equal(forecast.weightedCommission, fromPounds(300));
  });

  it('ramps a scenario to maturity and totals year one', () => {
    const mid = projectScenario(SCENARIOS.find((s) => s.id === 'mid')!);
    assert.equal(mid.months.length, 12);
    assert.equal(mid.months[11]!.orders, 6);
    assert.equal(mid.monthlyCommissionAtMaturity, fromPounds(1680));
    // The brief puts year one for the mid case at about GBP 11,100. Reproducing
    // that from the ramp rather than restating it is the point of this test:
    // if the ramp is ever changed, this catches the scenarios drifting away
    // from the numbers the growth case was argued on.
    assert.ok(toPounds(mid.yearOneCommission) > 10_500);
    assert.ok(toPounds(mid.yearOneCommission) < 11_500);
  });

  it('reproduces the low and high year-one bands from the brief', () => {
    const low = projectScenario(SCENARIOS.find((s) => s.id === 'low')!);
    const high = projectScenario(SCENARIOS.find((s) => s.id === 'high')!);
    assert.equal(low.monthlyCommissionAtMaturity, fromPounds(656.25));
    assert.equal(high.monthlyCommissionAtMaturity, fromPounds(3375));
    assert.ok(toPounds(low.yearOneCommission) > 4_000 && toPounds(low.yearOneCommission) < 4_600);
    assert.ok(toPounds(high.yearOneCommission) > 21_000 && toPounds(high.yearOneCommission) < 23_000);
  });
});

describe('questions', () => {
  it('puts tier-1 questions that block the most engines at the top', () => {
    const ranked = prioritiseQuestions(SEED_QUESTIONS);
    assert.equal(ranked[0]!.tier, 1);
    assert.ok(ranked.every((r, i) => i === 0 || r.weight <= ranked[i - 1]!.weight));
  });
});
