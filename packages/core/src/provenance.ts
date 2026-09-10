/**
 * Provenance tagging.
 *
 * The RW/UKN brief (v6) is built on a discipline: every figure carries a tag
 * saying how much weight it can bear. This module makes that discipline
 * enforceable in code rather than editorial.
 *
 * Legend (brief, "REFERENCE: Tagging Legend"):
 *   V  Verified   - evidence in hand
 *   R  Reported   - stated by a person, not independently verified
 *   E  Estimated  - calculated from available data
 *   A  Assumed    - necessary assumption, vulnerable to being wrong
 *   U  Unknown    - must be obtained, currently missing
 *   X  Corrected  - an earlier draft asserted this; retracted with evidence
 */

export const PROVENANCE_TAGS = ['V', 'R', 'E', 'A', 'U', 'X'] as const;
export type ProvenanceTag = (typeof PROVENANCE_TAGS)[number];

export const PROVENANCE_LABEL: Record<ProvenanceTag, string> = {
  V: 'Verified',
  R: 'Reported',
  E: 'Estimated',
  A: 'Assumed',
  U: 'Unknown',
  X: 'Corrected',
};

/** How much decision weight a tag can bear. Higher is stronger. */
export const PROVENANCE_WEIGHT: Record<ProvenanceTag, number> = {
  V: 100,
  R: 60,
  E: 45,
  A: 25,
  X: 0,
  U: 0,
};

export interface Tagged<T> {
  /** Absent when the tag is U or X. Never fabricate a value to fill this. */
  value: T | null;
  tag: ProvenanceTag;
  /** Where the figure came from. Required for V and R. */
  source?: string;
  /** Open question this figure is blocked on, e.g. "Q2". */
  blockedBy?: string;
  asOf?: string;
}

export function tagged<T>(
  value: T | null,
  tag: ProvenanceTag,
  extra: Omit<Tagged<T>, 'value' | 'tag'> = {},
): Tagged<T> {
  if ((tag === 'U' || tag === 'X') && value !== null) {
    throw new Error(`A ${PROVENANCE_LABEL[tag]} field cannot carry a value`);
  }
  return { value, tag, ...extra };
}

export const unknown = <T>(blockedBy?: string): Tagged<T> =>
  tagged<T>(null, 'U', blockedBy ? { blockedBy } : {});

export const verified = <T>(value: T, source: string, asOf?: string): Tagged<T> =>
  tagged(value, 'V', asOf ? { source, asOf } : { source });

export const reported = <T>(value: T, source: string): Tagged<T> => tagged(value, 'R', { source });
export const estimated = <T>(value: T, source?: string): Tagged<T> =>
  tagged(value, 'E', source ? { source } : {});
export const assumed = <T>(value: T, source?: string): Tagged<T> =>
  tagged(value, 'A', source ? { source } : {});

export const isKnown = <T>(t: Tagged<T>): t is Tagged<T> & { value: T } => t.value !== null;

/**
 * The weakest tag across a set of inputs. A derived figure can never be more
 * certain than the least certain thing it was derived from - which is exactly
 * the mistake the brief keeps correcting.
 */
export function weakest(...tags: ProvenanceTag[]): ProvenanceTag {
  if (tags.length === 0) return 'U';
  let out: ProvenanceTag = tags[0]!;
  for (const t of tags) if (PROVENANCE_WEIGHT[t] < PROVENANCE_WEIGHT[out]) out = t;
  return out;
}

/**
 * Derive a figure from tagged inputs. Returns Unknown if any input is Unknown,
 * so a missing number propagates as a gap rather than silently becoming zero.
 */
export function derive<T>(inputs: Tagged<number>[], fn: (values: number[]) => T): Tagged<T> {
  const values: number[] = [];
  for (const input of inputs) {
    if (!isKnown(input)) return unknown<T>(input.blockedBy);
    values.push(input.value);
  }
  const tag = weakest(...inputs.map((i) => i.tag));
  const derivedTag: ProvenanceTag = tag === 'V' ? 'E' : tag;
  return tagged(fn(values), derivedTag, { source: 'derived' });
}

/** True when a figure is too weak to publish, quote from, or pay commission on. */
export function tooWeakToPublish(t: Tagged<unknown>, floor: ProvenanceTag = 'E'): boolean {
  return PROVENANCE_WEIGHT[t.tag] < PROVENANCE_WEIGHT[floor];
}
