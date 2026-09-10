/**
 * Formatting. Every money figure in the API is integer pence and every tonnage
 * integer kilogrammes, so nothing here divides before it formats.
 */

const GBP = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 2 });
const GBP0 = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 });

export const gbp = (p: number | null | undefined, whole = false): string =>
  p === null || p === undefined ? '—' : (whole ? GBP0 : GBP).format(p / 100);

export const pct = (bps: number | null | undefined, dp = 1): string =>
  bps === null || bps === undefined ? '—' : `${(bps / 100).toFixed(dp)}%`;

export const tonnes = (kilos: number | null | undefined, dp = 2): string =>
  kilos === null || kilos === undefined ? '—' : `${(kilos / 1000).toFixed(dp)} t`;

export const count = (n: number | null | undefined): string =>
  n === null || n === undefined ? '—' : new Intl.NumberFormat('en-GB').format(n);

export const shortDate = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

export const relativeDays = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const days = Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  return days > 0 ? `in ${days} days` : `${Math.abs(days)} days ago`;
};

export const titleCase = (s: string): string =>
  s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

/**
 * The provenance legend, spelled out. A tag with no explanation is decoration;
 * the point of the tag is that the reader knows how much weight the number bears.
 */
export const TAG_MEANING: Record<string, string> = {
  V: 'Verified. Evidence in hand.',
  R: 'Reported. Stated by someone, not independently checked.',
  E: 'Estimated. Calculated from what is available.',
  A: 'Assumed. A necessary assumption that could be wrong.',
  U: 'Unknown. This has to be obtained.',
  X: 'Corrected. An earlier version asserted this and it was wrong.',
};
