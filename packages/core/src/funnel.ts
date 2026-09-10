/**
 * Funnel model.
 *
 * Brief Layer 10. The problem this solves is stated plainly: enquiry volume and
 * conversion are unmeasurable (Q11). UKN's own Enquire buttons point at a URL
 * containing a space, and its footer contact route 404s. Reeve Wood had the same
 * defect in a subtler form - a mailto: link as the call to action, which produces
 * no record of who started an enquiry and abandoned.
 *
 * "Unmeasurable and broken are the same failure mode."
 *
 * The stage list below is the one designed in Layer 10.2, extended past the point
 * where the web page stops and the CRM takes over. Stages 6 and 7 were marked
 * "offline - manual until there is a CRM". This is that CRM.
 */

export const FUNNEL_STAGES = [
  'arrival',
  'engagement',
  'spec_built',
  'intent',
  'qualification',
  'lead',
  'quote',
  'order',
] as const;

export type FunnelStage = (typeof FUNNEL_STAGES)[number];

export interface StageDefinition {
  stage: FunnelStage;
  index: number;
  event: string;
  label: string;
  tells: string;
  /** Healthy conversion from the previous stage, in bps. Null where unknown. */
  benchmarkBps: number | null;
  benchmarkNote: string;
}

export const STAGE_DEFINITIONS: StageDefinition[] = [
  {
    stage: 'arrival',
    index: 0,
    event: 'page_view',
    label: 'Arrival',
    tells: 'Traffic. The denominator for everything below it.',
    benchmarkBps: null,
    benchmarkNote: 'No baseline exists yet for either site.',
  },
  {
    stage: 'engagement',
    index: 1,
    event: 'calc_engaged',
    label: 'Engagement',
    tells: 'Share of visitors who touch the tool.',
    benchmarkBps: 3500,
    benchmarkNote: 'Below roughly 35%, the page or the traffic is wrong, not the offer.',
  },
  {
    stage: 'spec_built',
    index: 2,
    event: 'spec_changed',
    label: 'Spec built',
    tells: 'Which products, grades and tonnages get configured. Demand data without a survey.',
    benchmarkBps: null,
    benchmarkNote: 'Watched for what it reveals, not as a conversion gate.',
  },
  {
    stage: 'intent',
    index: 3,
    event: 'enquiry_opened',
    label: 'Intent',
    tells: 'The real top of the sales funnel.',
    benchmarkBps: null,
    benchmarkNote: '',
  },
  {
    stage: 'qualification',
    index: 4,
    event: 'enquiry_step_2',
    label: 'Qualification',
    tells: 'Carries destination and timing. Splits hot from browsing.',
    benchmarkBps: null,
    benchmarkNote: '',
  },
  {
    stage: 'lead',
    index: 5,
    event: 'enquiry_submitted',
    label: 'Lead',
    tells: 'A countable lead. The number Q11 has been missing.',
    benchmarkBps: null,
    benchmarkNote: '',
  },
  {
    stage: 'quote',
    index: 6,
    event: 'quote_sent',
    label: 'Quote',
    tells: 'Quotes issued. Was manual before this system existed.',
    benchmarkBps: null,
    benchmarkNote: '',
  },
  {
    stage: 'order',
    index: 7,
    event: 'order_won',
    label: 'Order',
    tells: 'Quote-to-order ratio, the number every forecast needs.',
    benchmarkBps: null,
    benchmarkNote: '',
  },
];

export const SOFT_LEAD_EVENT = 'spec_emailed';
export const DROP_EVENTS = ['enquiry_abandoned', 'enquiry_failed'] as const;

export interface FunnelEvent {
  id: string;
  event: string;
  sessionId: string;
  occurredAt: string;
  source: string | null;
  medium: string | null;
  campaign: string | null;
  productId: string | null;
  payload: Record<string, unknown>;
}

export interface StageCount {
  stage: FunnelStage;
  label: string;
  count: number;
  /** Conversion from the immediately preceding stage. */
  stepConversionBps: number | null;
  /** Conversion from arrival. */
  absoluteConversionBps: number | null;
  benchmarkBps: number | null;
  health: 'good' | 'watch' | 'poor' | 'unknown';
  note: string;
  /** Sessions that reached this stage without passing through the one before it. */
  enteredOutsideFunnel: number;
}

export interface FunnelReport {
  stages: StageCount[];
  softLeads: number;
  abandons: number;
  failures: number;
  /** Leads divided by arrivals. The one number that says whether the site works. */
  overallConversionBps: number | null;
  /** Quotes that became orders. */
  quoteToOrderBps: number | null;
  diagnosis: string[];
}

export function buildFunnelReport(events: FunnelEvent[]): FunnelReport {
  const uniqueSessions = (eventName: string): number =>
    new Set(events.filter((e) => e.event === eventName).map((e) => e.sessionId)).size;

  const counts = STAGE_DEFINITIONS.map((def) => ({ def, count: uniqueSessions(def.event) }));

  const arrivals = counts[0]?.count ?? 0;
  const stages: StageCount[] = counts.map(({ def, count }, i) => {
    const prev = i > 0 ? counts[i - 1]!.count : null;
    const stepConversionBps = prev && prev > 0 ? Math.round((count / prev) * 10_000) : null;
    const absoluteConversionBps = arrivals > 0 ? Math.round((count / arrivals) * 10_000) : null;

    let health: StageCount['health'] = 'unknown';
    let note = def.benchmarkNote;
    if (def.benchmarkBps !== null && absoluteConversionBps !== null) {
      if (absoluteConversionBps >= def.benchmarkBps) health = 'good';
      else if (absoluteConversionBps >= def.benchmarkBps * 0.7) health = 'watch';
      else health = 'poor';
    } else if (count > 0) {
      health = 'good';
    }
    if (count === 0 && arrivals > 0 && i > 0) {
      health = 'poor';
      note = 'No sessions reached this stage. Check the event is firing before reading anything into it.';
    }

    // A stage cannot really convert above 100%. When it appears to, sessions are
    // entering the funnel partway down - an order taken over the phone, or a deal
    // marked won without a quote ever being issued through the system. Saying so
    // is more useful than printing 400% and leaving the reader to work it out.
    const inflated = prev !== null && prev > 0 && count > prev;
    if (inflated) {
      health = 'watch';
      note =
        `${count - prev} of these did not pass through the previous stage, so they entered the ` +
        'funnel partway down rather than through the website. Read this stage as a count, not a rate.';
    }

    return {
      stage: def.stage,
      label: def.label,
      count,
      // Null rather than a figure above 100%, which would be meaningless.
      stepConversionBps: inflated ? null : stepConversionBps,
      absoluteConversionBps: inflated ? null : absoluteConversionBps,
      benchmarkBps: def.benchmarkBps,
      health,
      note,
      enteredOutsideFunnel: inflated ? count - (prev ?? 0) : 0,
    };
  });

  const leads = stages.find((s) => s.stage === 'lead')?.count ?? 0;
  const quotes = stages.find((s) => s.stage === 'quote')?.count ?? 0;
  const orders = stages.find((s) => s.stage === 'order')?.count ?? 0;

  const diagnosis: string[] = [];
  if (arrivals === 0) {
    diagnosis.push(
      'No arrivals recorded. Either analytics is not installed (Q18) or nothing is being sent ' +
        'to the intake endpoint. Until that is fixed, every figure below is zero for the wrong reason.',
    );
  }
  const engagement = stages.find((s) => s.stage === 'engagement');
  if (engagement && engagement.absoluteConversionBps !== null && engagement.absoluteConversionBps < 3500) {
    diagnosis.push(
      `Only ${(engagement.absoluteConversionBps / 100).toFixed(0)}% of visitors touch the tool. ` +
        'Below 35% the fault is upstream, in the page or the traffic, not in the form.',
    );
  }
  const intent = stages.find((s) => s.stage === 'intent')?.count ?? 0;
  if (intent > 0 && leads / intent < 0.4) {
    diagnosis.push(
      `${intent} enquiries opened and ${leads} completed. The form is leaking between opening and submitting.`,
    );
  }
  if (quotes > 0 && orders === 0) {
    diagnosis.push(`${quotes} quotes issued with no orders recorded yet. Check the follow-up is happening.`);
  }
  if (orders > quotes) {
    diagnosis.push(
      `${orders} orders against ${quotes} quotes. Orders are being booked without a quote going out ` +
        'through this system, so the quote-to-order ratio cannot be computed yet.',
    );
  }

  return {
    stages,
    softLeads: uniqueSessions(SOFT_LEAD_EVENT),
    abandons: uniqueSessions('enquiry_abandoned'),
    failures: uniqueSessions('enquiry_failed'),
    overallConversionBps: arrivals > 0 ? Math.round((leads / arrivals) * 10_000) : null,
    quoteToOrderBps: quotes > 0 && orders <= quotes ? Math.round((orders / quotes) * 10_000) : null,
    diagnosis,
  };
}

/* ------------------------------------------------------------------------ */
/* Deal pipeline                                                             */
/* ------------------------------------------------------------------------ */

export type DealStage =
  | 'enquiry'
  | 'qualified'
  | 'quoted'
  | 'negotiation'
  | 'won'
  | 'lost';

export const DEAL_STAGES: DealStage[] = [
  'enquiry',
  'qualified',
  'quoted',
  'negotiation',
  'won',
  'lost',
];

export const DEAL_STAGE_LABEL: Record<DealStage, string> = {
  enquiry: 'Enquiry',
  qualified: 'Qualified',
  quoted: 'Quoted',
  negotiation: 'Negotiation',
  won: 'Won',
  lost: 'Lost',
};

/**
 * Default close probabilities.
 *
 * These are [A]ssumed. With no historical quote-to-order ratio (Q11), there is
 * nothing to fit them to. They are deliberately conservative, and the pipeline
 * view labels any forecast built on them as an assumption rather than a number.
 */
export const DEFAULT_STAGE_PROBABILITY_BPS: Record<DealStage, number> = {
  enquiry: 1000,
  qualified: 2500,
  quoted: 4000,
  negotiation: 6500,
  won: 10_000,
  lost: 0,
};

export const isOpenStage = (s: DealStage): boolean => s !== 'won' && s !== 'lost';
