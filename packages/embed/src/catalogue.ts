/**
 * What the widget knows about the products, kept separate from how it looks.
 *
 * Pack data is only here where the brief actually records it. Where a figure is
 * a working assumption it is marked, and the widget prints the qualifier rather
 * than a confident number, for the same reason the CRM does.
 */

export interface PackSpec {
  id: 'bag_25kg' | 'fibc_600kg';
  label: string;
  unitKg: number;
  /** Units per pallet, where it is known. */
  perPallet: number | null;
  perPalletIsAssumed: boolean;
}

export const PACKS: Record<PackSpec['id'], PackSpec> = {
  bag_25kg: {
    id: 'bag_25kg',
    label: '25 kg bags',
    unitKg: 25,
    perPallet: 40,
    perPalletIsAssumed: false,
  },
  fibc_600kg: {
    id: 'fibc_600kg',
    label: '600 kg bulk bags',
    unitKg: 600,
    // One bulk bag to a pallet position, stacked no more than three high.
    perPallet: 1,
    perPalletIsAssumed: false,
  },
};

export interface WidgetProduct {
  id: string;
  name: string;
  short: string;
  packs: Array<PackSpec['id']>;
  /** UK stock at King's Lynn goes out immediately; shipped material is 8-10 weeks. */
  ukStock: boolean;
  /** Requires buyer verification before it can be supplied. */
  regulated: boolean;
}

export const PRODUCTS: WidgetProduct[] = [
  { id: 'nano3', name: 'Sodium nitrate', short: 'NaNO₃', packs: ['bag_25kg'], ukStock: true, regulated: false },
  { id: 'kno3-13-0-46', name: 'Potassium nitrate 13-0-46', short: 'KNO₃', packs: ['bag_25kg'], ukStock: true, regulated: true },
  { id: 'can', name: 'Calcium nitrate', short: 'Ca(NO₃)₂', packs: ['bag_25kg', 'fibc_600kg'], ukStock: false, regulated: false },
  { id: 'mkp', name: 'Monopotassium phosphate', short: 'MKP', packs: ['bag_25kg'], ukStock: false, regulated: false },
  { id: 'an-nitram-345', name: 'Ammonium nitrate 34.5%N', short: 'Nitram', packs: ['fibc_600kg', 'bag_25kg'], ukStock: true, regulated: true },
  { id: 'cacl2', name: 'Calcium chloride', short: 'CaCl₂', packs: ['bag_25kg', 'fibc_600kg'], ukStock: false, regulated: false },
  { id: 'mgso4', name: 'Magnesium sulphate', short: 'MgSO₄', packs: ['bag_25kg'], ukStock: false, regulated: false },
  { id: 'kcl', name: 'Potassium chloride', short: 'MOP', packs: ['fibc_600kg'], ukStock: false, regulated: false },
];

/**
 * Sectors, asked before product.
 *
 * The order of the questions is the mix shift. Asking what the material is for
 * before asking which product routes the enquiry on the job to be done rather
 * than on the commodity the caller happened to name, which is the whole of
 * Opportunity A expressed as a form.
 */
export interface SectorOption {
  id: string;
  label: string;
  /** The specialty line this sector usually turns out to want. */
  leads: string;
}

export const SECTORS: SectorOption[] = [
  { id: 'horticulture', label: 'Horticulture and growing', leads: 'can' },
  { id: 'hydroponics', label: 'Hydroponics and fertigation', leads: 'mkp' },
  { id: 'agriculture', label: 'Arable and agriculture', leads: 'kno3-13-0-46' },
  { id: 'food_production', label: 'Food production', leads: 'nano3' },
  { id: 'animal_nutrition', label: 'Animal nutrition', leads: 'nano3' },
  { id: 'water_treatment', label: 'Water treatment', leads: 'nano3' },
  { id: 'sewage', label: 'Wastewater and odour control', leads: 'nano3' },
  { id: 'pyrotechnics', label: 'Pyrotechnics', leads: 'kno3-13-0-46' },
  { id: 'glass', label: 'Glass', leads: 'nano3' },
  { id: 'ceramics', label: 'Ceramics and glazes', leads: 'kno3-13-0-46' },
];

export interface PackBreakdown {
  units: number;
  unitLabel: string;
  pallets: number | null;
  palletsAreApproximate: boolean;
  leadTime: string;
  regulated: boolean;
}

/**
 * Tonnage to packaging. This is the part of the form that gives something back
 * before it asks for anything, so it runs entirely in the browser and posts
 * nothing.
 */
export function breakDown(product: WidgetProduct, packId: PackSpec['id'], tonnes: number): PackBreakdown {
  const pack = PACKS[packId];
  const kilos = Math.max(0, tonnes) * 1000;
  const units = Math.ceil(kilos / pack.unitKg);
  return {
    units,
    unitLabel: pack.label,
    pallets: pack.perPallet ? Math.ceil(units / pack.perPallet) : null,
    palletsAreApproximate: pack.perPalletIsAssumed,
    leadTime: product.ukStock
      ? 'In stock at King’s Lynn, so it ships as soon as the order is confirmed.'
      : 'Shipped to order. Allow eight to ten weeks to any UK port.',
    regulated: product.regulated,
  };
}
