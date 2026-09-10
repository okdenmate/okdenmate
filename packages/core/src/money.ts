/**
 * Money is stored and computed in integer pence. Never floats.
 *
 * Commission here is a real person's pay (25% of gross margin, brief Layer 2),
 * and storage fees accrue monthly for years. Float drift in either is a dispute
 * waiting to happen.
 */

export type Pence = number & { readonly __brand: 'Pence' };

export const pence = (n: number): Pence => {
  if (!Number.isFinite(n)) throw new Error('Money must be finite');
  return Math.round(n) as Pence;
};

export const fromPounds = (pounds: number): Pence => pence(pounds * 100);
export const toPounds = (p: Pence): number => p / 100;

export const addP = (...xs: Pence[]): Pence => pence(xs.reduce((a, b) => a + b, 0));
export const subP = (a: Pence, b: Pence): Pence => pence(a - b);
export const mulP = (a: Pence, factor: number): Pence => pence(a * factor);
export const negP = (a: Pence): Pence => pence(-a);

/** Apply a basis-point rate (10000 bps = 100%). Half-up rounding to the penny. */
export const applyBps = (amount: Pence, bps: number): Pence => pence((amount * bps) / 10_000);

/** Ratio as basis points, so percentages stay integers end to end. */
export const ratioBps = (part: Pence, whole: Pence): number =>
  whole === 0 ? 0 : Math.round((part / whole) * 10_000);

export const bpsToPct = (bps: number): number => bps / 100;
export const pctToBps = (pct: number): number => Math.round(pct * 100);

const GBP = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const GBP_WHOLE = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export const formatGBP = (p: Pence, whole = false): string =>
  (whole ? GBP_WHOLE : GBP).format(toPounds(p));

export const formatPct = (bps: number, dp = 1): string => `${(bps / 100).toFixed(dp)}%`;

/** Tonnage in integer kilogrammes, for the same reason money is in pence. */
export type Kilogrammes = number & { readonly __brand: 'Kilogrammes' };
export const kg = (n: number): Kilogrammes => Math.round(n) as Kilogrammes;
export const fromTonnes = (t: number): Kilogrammes => kg(t * 1000);
export const toTonnes = (k: Kilogrammes): number => k / 1000;
export const addKg = (...xs: Kilogrammes[]): Kilogrammes => kg(xs.reduce((a, b) => a + b, 0));
export const formatTonnes = (k: Kilogrammes, dp = 2): string => `${toTonnes(k).toFixed(dp)} t`;
