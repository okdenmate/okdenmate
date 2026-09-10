/**
 * Product catalogue and the split the whole business turns on.
 *
 * Brief, Layer 3, "X7 Critical Split":
 *   AN        - price-transparent (AHDB weekly), thin margin, volume/logistics play
 *   Specialty - opaque pricing, technical sell, grade-driven, real margin
 *
 * "All growth and user income depends on deliberately steering enquiries to
 * specialty. This should be enforced by the enquiry form, not left to memory."
 *
 * This file is where that enforcement starts: classification is a property of
 * the product, not a judgement made per deal.
 */

import type { Tagged } from './provenance.js';
import { assumed, estimated, unknown, verified } from './provenance.js';

export type ProductClass = 'commodity' | 'specialty' | 'ancillary';
export type Grade = 'food' | 'technical' | 'fertiliser' | 'unspecified';
export type PackForm = 'fibc_600kg' | 'bag_25kg' | 'loose_pallet' | 'bulk';

export interface Product {
  id: string;
  name: string;
  formula: string | null;
  productClass: ProductClass;
  /** Nitrogen content by mass, percent. Drives the regulatory gates. */
  nitrogenPct: number | null;
  analysis: string | null;
  grade: Grade;
  unClass: string | null;
  unNumber: string | null;
  packForms: PackForm[];
  supplier: string | null;
  /** UK-manufactured stock at King's Lynn ships immediately; imports are 8-10wk. */
  ukStock: boolean;
  /** Gross margin band in basis points, with its provenance attached. */
  targetGmBps: Tagged<[number, number]>;
  notes: string;
}

/**
 * Explosives-precursor gate. Poisons Act 1972, in force 1 Oct 2023.
 * Applies at the point of every sale of ammonium nitrate at or above 16% N.
 */
export const REGULATED_AN_NITROGEN_PCT = 16;

export function isExplosivesPrecursor(p: Product): boolean {
  if (p.id.startsWith('an-')) return (p.nitrogenPct ?? 0) >= REGULATED_AN_NITROGEN_PCT;
  // Potassium nitrate is a reportable substance under the same regime.
  return p.formula === 'KNO3';
}

/** Reportable for suspicious transactions even where not supply-restricted. */
export function isReportableSubstance(p: Product): boolean {
  return isExplosivesPrecursor(p) || p.formula === 'NaNO3';
}

/**
 * Seed catalogue. Every margin band carries a tag.
 *
 * The specialty band is [A]ssumed at 20-30%, and the brief flags it as the
 * single blocking assumption for every funnel number in the business (Q2).
 * It is tagged that way here so that anything computed from it inherits the
 * weakness instead of laundering it into a fact.
 */
export const SEED_PRODUCTS: Product[] = [
  {
    id: 'an-nitram-345',
    name: 'Nitram ammonium nitrate 34.5%N',
    formula: 'NH4NO3',
    productClass: 'commodity',
    nitrogenPct: 34.5,
    analysis: '34.5-0-0 (17.3 nitric + 17.2 ammoniacal)',
    grade: 'fertiliser',
    unClass: '5.1 Oxidising',
    unNumber: 'UN 2067',
    packForms: ['fibc_600kg', 'bag_25kg'],
    supplier: 'CF Fertilisers UK Ltd',
    ukStock: true,
    targetGmBps: verified([200, 600], 'AHDB GB weekly + Proficio invoice fragment', '2026-08-28'),
    notes:
      'UK-manufactured, prilled, CAS 6484-52-2. Max 3 bags high. AHDB publishes a delivered ' +
      'price weekly, so the buyer can price-check every quote. Merchant margin is 2-6%.',
  },
  {
    id: 'kno3-13-0-46',
    name: 'Potassium nitrate 13-0-46',
    formula: 'KNO3',
    productClass: 'specialty',
    nitrogenPct: 13,
    analysis: '13-0-46',
    grade: 'unspecified',
    unClass: '5.1 Oxidising',
    unNumber: 'UN 1486',
    packForms: ['bag_25kg'],
    supplier: null,
    ukStock: true,
    targetGmBps: assumed([2000, 3000], 'Brief Layer 2, blocked by Q2'),
    notes: '25kg bag, 40 per pallet. Market price opaque; grade materially changes the margin.',
  },
  {
    id: 'nano3',
    name: 'Sodium nitrate',
    formula: 'NaNO3',
    productClass: 'specialty',
    nitrogenPct: 16.5,
    analysis: '16-0-0',
    grade: 'unspecified',
    unClass: '5.1 Oxidising',
    unNumber: 'UN 1498',
    packForms: ['bag_25kg', 'loose_pallet'],
    supplier: 'Chile / Jordan / Europe',
    ukStock: true,
    targetGmBps: assumed([2000, 3000], 'Brief Layer 2, blocked by Q2'),
    notes:
      'Grade of current inventory is UNKNOWN (Q5). Food grade prices 30-50% above technical, ' +
      'which changes both the margin and the target segment. FOB China index ran $302-622/t ' +
      'across 2025-26, so treat any single-point margin figure as a snapshot.',
  },
  {
    id: 'can',
    name: 'Calcium nitrate',
    formula: 'Ca(NO3)2',
    productClass: 'specialty',
    nitrogenPct: 15.5,
    analysis: '15.5-0-0 + 26.5 CaO',
    grade: 'unspecified',
    unClass: '5.1 Oxidising',
    unNumber: 'UN 1454',
    packForms: ['bag_25kg', 'fibc_600kg'],
    supplier: null,
    ukStock: false,
    targetGmBps: assumed([2000, 3000], 'Brief Layer 2, blocked by Q2'),
    notes: 'Site-listed. Horticulture and hydroponics demand.',
  },
  {
    id: 'cacl2',
    name: 'Calcium chloride',
    formula: 'CaCl2',
    productClass: 'ancillary',
    nitrogenPct: null,
    analysis: null,
    grade: 'unspecified',
    unClass: null,
    unNumber: null,
    packForms: ['bag_25kg', 'fibc_600kg'],
    supplier: null,
    ukStock: false,
    targetGmBps: unknown('Q2'),
    notes: 'Site-listed. Not a nitrate; no precursor duty.',
  },
  {
    id: 'mgso4',
    name: 'Magnesium sulphate',
    formula: 'MgSO4',
    productClass: 'ancillary',
    nitrogenPct: null,
    analysis: null,
    grade: 'unspecified',
    unClass: null,
    unNumber: null,
    packForms: ['bag_25kg'],
    supplier: null,
    ukStock: false,
    targetGmBps: unknown('Q2'),
    notes: 'Site-listed.',
  },
  {
    id: 'mkp',
    name: 'Monopotassium phosphate (MKP)',
    formula: 'KH2PO4',
    productClass: 'specialty',
    nitrogenPct: 0,
    analysis: '0-52-34',
    grade: 'technical',
    unClass: null,
    unNumber: null,
    packForms: ['bag_25kg'],
    supplier: null,
    ukStock: false,
    targetGmBps: assumed([2000, 3000], 'Brief Layer 2, blocked by Q2'),
    notes: 'Site-listed. Fertigation and hydroponics.',
  },
  {
    id: 'kcl',
    name: 'Potassium chloride (MOP)',
    formula: 'KCl',
    productClass: 'commodity',
    nitrogenPct: 0,
    analysis: '0-0-60',
    grade: 'fertiliser',
    unClass: null,
    unNumber: null,
    packForms: ['fibc_600kg', 'bulk'],
    supplier: null,
    ukStock: false,
    targetGmBps: estimated([300, 800], 'Commodity fertiliser comparator'),
    notes: 'Site-listed. Commodity behaviour: transparent pricing, thin margin.',
  },
];

/**
 * Services advertised on the live site that the business cannot currently
 * deliver. Brief Layer 1: "site sells a service the business can't fulfil" [X].
 * Held here so the CRM refuses to let a rep quote them by accident.
 */
export const UNFULFILLABLE_SERVICES = [
  {
    id: 'bespoke-blending',
    name: 'Bespoke blending',
    advertised: true,
    deliverable: false,
    note: 'Advertised on uknitrates.com. No blending capability exists (confirmed 2026-09-08).',
  },
  {
    id: 'white-label',
    name: 'White-label packing',
    advertised: true,
    deliverable: false,
    note: 'Advertised on uknitrates.com. Not currently offered.',
  },
] as const;

export const productById = (products: Product[], id: string): Product | undefined =>
  products.find((p) => p.id === id);
