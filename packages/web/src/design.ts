/**
 * Design profiles.
 *
 * The brief adopts one visual system across both businesses and is candid that
 * this is a production-cost decision, not a brand one. It then leaves the
 * consequence open: the shared palette is Reeve Wood's own, and running it over
 * a nitrate distributor presents a single identity for two unrelated companies.
 *
 * Both profiles are kept complete so the question can be settled by looking
 * rather than by arguing. The choice is per browser, because it is a decision
 * being made rather than a setting that has been made.
 */

export type ProfileId = 'ukn' | 'group';

export interface Profile {
  id: ProfileId;
  name: string;
  description: string;
}

export const PROFILES: Profile[] = [
  {
    id: 'ukn',
    name: 'UK Nitrates',
    description:
      'Cold ground, chemical accent, hazard yellow reserved for Class 5.1. Built for this business.',
  },
  {
    id: 'group',
    name: 'Group',
    description:
      'The shared timber palette from the brief. Reeve Wood’s own colours, extended across both companies.',
  },
];

const STORAGE_KEY = 'ukn_profile';
const DEFAULT: ProfileId = 'ukn';

export function currentProfile(): ProfileId {
  const stamped = document.documentElement.getAttribute('data-profile');
  if (stamped === 'ukn' || stamped === 'group') return stamped;
  return DEFAULT;
}

export function applyProfile(id: ProfileId): void {
  document.documentElement.setAttribute('data-profile', id);
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Private browsing, or storage disabled. The profile still applies for
    // this session; it just will not be remembered.
  }
}

/** Restore the stored choice before first paint. */
export function restoreProfile(): ProfileId {
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    stored = null;
  }
  const id: ProfileId = stored === 'ukn' || stored === 'group' ? stored : DEFAULT;
  document.documentElement.setAttribute('data-profile', id);
  return id;
}
