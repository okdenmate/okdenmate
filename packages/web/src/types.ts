/** Shapes the API returns. Kept narrow: only what the views actually read. */

export interface User { id: string; email: string; name: string; role: string }

export interface TaggedBand {
  value: [number, number] | null;
  tag: string;
  source?: string;
  blockedBy?: string;
}

export interface Product {
  id: string;
  name: string;
  formula: string | null;
  productClass: 'commodity' | 'specialty' | 'ancillary';
  nitrogenPct: number | null;
  analysis: string | null;
  grade: string;
  unClass: string | null;
  unNumber: string | null;
  supplier: string | null;
  ukStock: boolean;
  targetGmBps: TaggedBand;
  notes: string;
}

export interface TaggedMoney { value: number | null; tag: string; blockedBy?: string; source?: string }

export interface MixShiftSuggestion {
  fromProductId: string;
  toProductId: string;
  rationale: string;
  currentGm: TaggedMoney;
  suggestedGm: TaggedMoney;
  gmUplift: TaggedMoney;
  commissionUplift: TaggedMoney;
  upliftMultipleBps: { value: number | null; tag: string };
  caveat: string;
}

export interface MarginGuard { code: string; severity: 'block' | 'warn' | 'info'; message: string }

export interface SaleGate {
  decision: 'clear' | 'warn' | 'blocked';
  regulatedProducts: string[];
  reportableProducts: string[];
  reasons: string[];
  requiredActions: string[];
}

export interface AnchorCheck {
  anchored: boolean;
  anchorPerTonne: number | null;
  variancePerTonne: number | null;
  varianceBps: number | null;
  anchorAgeDays: number | null;
  verdict: string;
  message: string;
}

export interface DealPricing {
  margin: {
    lines: Array<{
      productId: string;
      productClass: string;
      quantityKg: number;
      revenue: number;
      cost: number;
      grossMargin: number;
      gmBps: number;
      gmPerTonne: number;
    }>;
    revenue: number;
    cost: number;
    grossMargin: number;
    gmBps: number;
    commodityRevenue: number;
    specialtyRevenue: number;
    specialtyGmShareBps: number;
  };
  guards: MarginGuard[];
  gate: SaleGate;
  anchors: Array<{ productId: string; check: AnchorCheck }>;
  mixShift: MixShiftSuggestion[];
  sendable: boolean;
  blockers: string[];
}

export interface KycAssessment {
  complete: boolean;
  valid: boolean;
  missingFields: string[];
  retentionExpiresAt: string | null;
  retentionExpired: boolean;
  daysUntilRetentionExpiry: number | null;
  reasons: string[];
}

export interface ThresholdBreach {
  thresholdId: string;
  severity: 'critical' | 'warning' | 'info';
  heldKg: number;
  limitKg: number;
  utilisationBps: number;
  notificationStatus: string;
  message: string;
  action: string;
}

export interface ComplianceOverview {
  currentAnKg: number;
  peakAnKg: number | null;
  peakSource: string;
  peakAt: string | null;
  breaches: ThresholdBreach[];
  notifications: Array<{ thresholdId: string; status: string; filedAt: string | null; reference: string | null; note: string }>;
  readiness: { score: number; sellable: boolean; blockers: string[] };
  suspicious: Array<{
    id: string;
    summary: string;
    indicators: string[];
    status: string;
    detectedAt: string;
    sla: { deadlineAt: string; hoursRemaining: number; breached: boolean; urgent: boolean };
  }>;
  accountsMissingKyc: number;
  accountsTotal: number;
  site: {
    signageInPlace: boolean;
    proceduresDocumented: boolean;
    totalPalletPositions: number | null;
    note: string;
  };
}

export interface FunnelReport {
  stages: Array<{
    stage: string;
    label: string;
    count: number;
    stepConversionBps: number | null;
    absoluteConversionBps: number | null;
    benchmarkBps: number | null;
    health: string;
    note: string;
    enteredOutsideFunnel: number;
  }>;
  softLeads: number;
  abandons: number;
  failures: number;
  overallConversionBps: number | null;
  quoteToOrderBps: number | null;
  diagnosis: string[];
}

export interface Dashboard {
  pipeline: {
    openDealCount: number;
    openRevenue: number;
    openGrossMargin: number;
    weightedRevenue: number;
    weightedGrossMargin: number;
    weightedCommission: number;
    byStage: Array<{ stage: string; count: number; revenue: number; grossMargin: number; weightedGrossMargin: number }>;
    caveat: string;
  };
  commission: {
    accrued: number;
    payable: number;
    paid: number;
    total: number;
    recurring: number;
    count: number;
    byBusiness: Record<string, number>;
  };
  earnings: {
    baseAnnual: number;
    commissionYearToDate: number;
    projectedCommissionAnnual: number;
    projectedTotalAnnual: number;
    monthlyRunRate: number;
    pctOfTargetBps: number;
  };
  mix: {
    specialtyGmShareBps: number;
    specialtyRevenueShareBps: number;
    blendedGmBps: number;
    targetSpecialtyGmShareBps: number;
    onTrack: boolean;
    headline: string;
  };
  concentration: {
    accountCount: number;
    activeAccountCount: number;
    totalRevenue: number;
    totalGrossMargin: number;
    hhi: number;
    topAccountShareBps: number;
    topAccountName: string | null;
    top3ShareBps: number;
    accountsToHalfMargin: number;
    severity: string;
    headline: string;
    findings: string[];
  };
  funnel: FunnelReport;
  compliance: ComplianceOverview;
  questions: Array<{ questionId: string; tier: number; question: string; blocks: string[]; weight: number }>;
  scenarios: Array<{
    scenario: { id: string; label: string; ordersPerMonthAtMaturity: number };
    monthlyCommissionAtMaturity: number;
    yearOneCommission: number;
    months: Array<{ month: number; orders: number; grossMargin: number; commission: number }>;
  }>;
  callList: Array<{
    accountId: string;
    accountName: string;
    commodityRevenue12m: number;
    specialtyRevenue12m: number;
    sector: string | null;
    opportunityScore: number;
    suggestedProductId: string;
    reason: string;
  }>;
  openTasks: Array<Record<string, unknown>>;
  newEnquiryCount: number;
}

export type Row = Record<string, any>;
