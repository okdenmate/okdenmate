/**
 * Customer concentration.
 *
 * Brief Q4 is described as the highest-value open question in the business:
 * "if 2 customers, pitch is dangerous; if 30, pitch is unworked book". The
 * visible order sheet shows Proficio Ltd on four lines and one other name.
 *
 * There is a second, sharper risk noted in Layer 1: if Proficio is itself an
 * importer, the switching cost for them is near zero and the largest account
 * is also the least defensible. Concentration measured on revenue alone would
 * miss that, so this module measures dependency on gross margin too - which is
 * what actually pays the wages.
 */

import type { Pence } from './money.js';
import { pence, ratioBps } from './money.js';

export interface AccountRevenue {
  accountId: string;
  accountName: string;
  revenue: Pence;
  grossMargin: Pence;
  orderCount: number;
  firstOrderAt: string | null;
  lastOrderAt: string | null;
  /** Flagged where the customer may source the same goods directly. */
  possibleDirectImporter: boolean;
}

export interface ConcentrationRisk {
  accountCount: number;
  activeAccountCount: number;
  totalRevenue: Pence;
  totalGrossMargin: Pence;
  /** Herfindahl-Hirschman index on gross margin, 0-10000. */
  hhi: number;
  topAccountShareBps: number;
  topAccountName: string | null;
  top3ShareBps: number;
  /** Accounts needed to reach half of all gross margin. */
  accountsToHalfMargin: number;
  severity: 'critical' | 'high' | 'moderate' | 'low' | 'unknown';
  headline: string;
  findings: string[];
}

/**
 * HHI bands follow competition-authority convention: above 2500 is concentrated.
 * For a customer book rather than a market, above 2500 means the business is
 * effectively a supplier to one or two firms.
 */
const HHI_CRITICAL = 5000;
const HHI_HIGH = 2500;
const HHI_MODERATE = 1500;

export function assessConcentration(
  accounts: AccountRevenue[],
  activeWindowDays = 365,
  today: Date = new Date(),
): ConcentrationRisk {
  const totalRevenue = pence(accounts.reduce((a, x) => a + x.revenue, 0));
  const totalGm = pence(accounts.reduce((a, x) => a + x.grossMargin, 0));

  if (accounts.length === 0 || totalGm <= 0) {
    return {
      accountCount: accounts.length,
      activeAccountCount: 0,
      totalRevenue,
      totalGrossMargin: totalGm,
      hhi: 0,
      topAccountShareBps: 0,
      topAccountName: null,
      top3ShareBps: 0,
      accountsToHalfMargin: 0,
      severity: 'unknown',
      headline:
        'Not enough trading history recorded to measure concentration. This is Q4, and it is ' +
        'the highest-value question open in the business.',
      findings: [
        'Load the last twelve months of orders before drawing any conclusion about the book.',
      ],
    };
  }

  const active = accounts.filter((a) => {
    if (!a.lastOrderAt) return false;
    const days = (today.getTime() - new Date(a.lastOrderAt).getTime()) / 86_400_000;
    return days <= activeWindowDays;
  });

  const shares = accounts
    .map((a) => ({ account: a, shareBps: ratioBps(a.grossMargin, totalGm) }))
    .sort((x, y) => y.shareBps - x.shareBps);

  const hhi = Math.round(
    shares.reduce((sum, s) => sum + Math.pow(s.shareBps / 100, 2), 0),
  );

  const top = shares[0];
  const top3ShareBps = shares.slice(0, 3).reduce((a, s) => a + s.shareBps, 0);

  let cumulative = 0;
  let accountsToHalfMargin = 0;
  for (const s of shares) {
    cumulative += s.shareBps;
    accountsToHalfMargin += 1;
    if (cumulative >= 5000) break;
  }

  let severity: ConcentrationRisk['severity'];
  if (hhi >= HHI_CRITICAL) severity = 'critical';
  else if (hhi >= HHI_HIGH) severity = 'high';
  else if (hhi >= HHI_MODERATE) severity = 'moderate';
  else severity = 'low';

  const findings: string[] = [];
  if (top && top.shareBps >= 5000) {
    findings.push(
      `${top.account.accountName} accounts for ${(top.shareBps / 100).toFixed(0)}% of gross margin. ` +
        'Losing that one account halves the business.',
    );
  }
  if (accountsToHalfMargin <= 2) {
    findings.push(
      `${accountsToHalfMargin} account${accountsToHalfMargin === 1 ? '' : 's'} produce half of all gross margin.`,
    );
  }
  if (accounts.length <= 5) {
    findings.push(
      `Only ${accounts.length} accounts have traded. Growth here is customer acquisition, not account management.`,
    );
  }
  const importerRisk = shares.filter(
    (s) => s.account.possibleDirectImporter && s.shareBps >= 1500,
  );
  for (const s of importerRisk) {
    findings.push(
      `${s.account.accountName} carries ${(s.shareBps / 100).toFixed(0)}% of gross margin and may be able ` +
        'to import the same goods directly. Switching cost is low, so treat this margin as at risk ' +
        'rather than as a base.',
    );
  }
  if (active.length < accounts.length) {
    findings.push(
      `${accounts.length - active.length} of ${accounts.length} accounts have not ordered in ${activeWindowDays} days.`,
    );
  }

  const headline =
    severity === 'critical' || severity === 'high'
      ? `The book is concentrated. ${top?.account.accountName ?? 'One account'} carries ${((top?.shareBps ?? 0) / 100).toFixed(0)}% of gross margin.`
      : severity === 'moderate'
        ? 'The book is moderately concentrated. Watch the top three.'
        : 'Gross margin is spread across enough accounts to absorb losing one.';

  return {
    accountCount: accounts.length,
    activeAccountCount: active.length,
    totalRevenue,
    totalGrossMargin: totalGm,
    hhi,
    topAccountShareBps: top?.shareBps ?? 0,
    topAccountName: top?.account.accountName ?? null,
    top3ShareBps,
    accountsToHalfMargin,
    severity,
    headline,
    findings,
  };
}

/**
 * Revenue at risk if the named accounts stopped buying. Used to put a number on
 * the sentence "Proficio is the largest visible line".
 */
export function marginAtRisk(accounts: AccountRevenue[], accountIds: string[]): Pence {
  return pence(
    accounts.filter((a) => accountIds.includes(a.accountId)).reduce((s, a) => s + a.grossMargin, 0),
  );
}
