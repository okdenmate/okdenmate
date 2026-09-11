/**
 * Demo data. NOT seed data.
 *
 * The seed loads only figures the brief marks Verified, which is correct and
 * also means a fresh install has two orders and no pipeline. That is honest but
 * makes the system hard to evaluate before real data exists.
 *
 * This script fills the gap with openly fictional trading: invented companies,
 * invented tonnages, invented costs. Every account it creates is named so that
 * it cannot be mistaken for a real customer, and every record it writes is
 * tagged Assumed. Run it against a scratch database, never the live one.
 *
 *   npm run demo -w @ukn/server            (writes to data/demo.db)
 */

import { fromPounds, fromTonnes } from '@ukn/core';
import { Db, id, jsonIn, now, toInt, type Row } from './db.js';
import { seed } from './seed.js';
import { createQuote, intakeEnquiry, runStorageBilling, winDeal } from './services.js';
import type { AuthUser } from './auth.js';

const DEMO_PREFIX = '[demo]';

interface DemoAccount {
  name: string;
  /** What they make or do. Required at the point of sale for a regulated line. */
  natureOfTrade: string;
  sector: string;
  /** The nitrate this account actually buys. */
  preferredProductId: string;
  /**
   * How they take it.
   *   immediate — wants it off the floor this week, which only UK stock can do
   *   storage   — buys it and leaves it on our racking, so we carry the duty
   *               and the only recurring fee in the business
   *   scheduled — a contract called off across a season
   */
  fulfilment: 'immediate' | 'storage' | 'scheduled';
  /** What a normal order looks like, in tonnes. */
  typicalTonnes: number;
  origin: 'new' | 'inherited';
  importer: boolean;
  verified: boolean;
  /** Pallet positions let, where they keep stock on our floor. */
  storagePositions?: number;
  /** Monthly rate per position, in pounds. Left out where it was never agreed. */
  storageRatePounds?: number;
  notes: string;
  orders: Array<{
    productId: string;
    tonnes: number;
    costPerTonne: number;
    sellPerTonne: number;
    orderedAt: string;
    paid: boolean;
  }>;
}

const ACCOUNTS: DemoAccount[] = [
  {
    name: `${DEMO_PREFIX} Wash Valley Growers`,
    natureOfTrade: 'Protected salad and soft fruit under glass',
    sector: 'horticulture',
    preferredProductId: 'can',
    fulfilment: 'immediate',
    typicalTonnes: 8,
    origin: 'new',
    importer: false,
    verified: true,
    notes:
      'Buys calcium nitrate for the calcium as much as the nitrogen. Orders against the growing ' +
      'programme and wants it the same week, so this only works while there is UK stock on the floor.',
    orders: [
      { productId: 'can', tonnes: 8, costPerTonne: 395, sellPerTonne: 720, orderedAt: '2026-06-02', paid: true },
      { productId: 'can', tonnes: 6, costPerTonne: 399, sellPerTonne: 725, orderedAt: '2026-08-19', paid: true },
    ],
  },
  {
    name: `${DEMO_PREFIX} Marshside Nurseries`,
    natureOfTrade: 'Ornamental nursery stock and bedding',
    sector: 'horticulture',
    preferredProductId: 'mkp',
    fulfilment: 'scheduled',
    typicalTonnes: 2.5,
    origin: 'new',
    importer: false,
    verified: true,
    notes:
      'Fertigation. Specifies MKP by analysis rather than by price, and takes small drops on a ' +
      'fortnightly schedule. Low tonnage, high margin, almost no price argument.',
    orders: [
      { productId: 'mkp', tonnes: 2.5, costPerTonne: 1180, sellPerTonne: 1690, orderedAt: '2026-07-11', paid: true },
      { productId: 'mkp', tonnes: 2, costPerTonne: 1190, sellPerTonne: 1710, orderedAt: '2026-08-29', paid: false },
    ],
  },
  {
    name: `${DEMO_PREFIX} Holbeach Arable Supplies`,
    natureOfTrade: 'Agricultural merchant supplying arable growers',
    sector: 'agriculture',
    preferredProductId: 'an-nitram-345',
    fulfilment: 'storage',
    typicalTonnes: 28,
    origin: 'inherited',
    importer: false,
    verified: true,
    storagePositions: 24,
    storageRatePounds: 11.5,
    notes:
      'The classic arable pattern: buys ammonium nitrate ahead of the season at a price they like, ' +
      'then leaves it on our racking and calls it off. Thin margin on the tonne and a recurring ' +
      'storage fee on top, which is the only part of this account that pays every month.',
    orders: [
      { productId: 'an-nitram-345', tonnes: 28, costPerTonne: 441, sellPerTonne: 461, orderedAt: '2026-04-08', paid: true },
      { productId: 'an-nitram-345', tonnes: 28, costPerTonne: 444, sellPerTonne: 462, orderedAt: '2026-06-19', paid: true },
      { productId: 'an-nitram-345', tonnes: 50, costPerTonne: 438, sellPerTonne: 456, orderedAt: '2026-08-27', paid: false },
    ],
  },
  {
    name: `${DEMO_PREFIX} Terrington Estates`,
    natureOfTrade: 'Mixed arable farm, 1,400 acres',
    sector: 'agriculture',
    preferredProductId: 'an-nitram-345',
    fulfilment: 'immediate',
    typicalTonnes: 24,
    origin: 'new',
    importer: false,
    verified: false,
    notes:
      'Buys on the spot price and checks it against the AHDB figure before answering the phone. ' +
      'No verification on file, so nothing can be supplied yet. The mix-shift route for this ' +
      'sector is foliar potassium nitrate: a different job, not a cheaper tonne.',
    orders: [],
  },
  {
    name: `${DEMO_PREFIX} Anglia Cure & Cull`,
    natureOfTrade: 'Bacon and charcuterie curing',
    sector: 'food_production',
    preferredProductId: 'nano3',
    fulfilment: 'storage',
    typicalTonnes: 4,
    origin: 'new',
    importer: false,
    verified: true,
    storagePositions: 8,
    storageRatePounds: 12.5,
    notes:
      'Food-grade sodium nitrate, which prices 30 to 50 per cent above technical. Holds buffer ' +
      'stock with us rather than in a food facility, and pays for the fact that we carry the duty. ' +
      'Grade of current inventory is unconfirmed (Q5), so do not promise food grade until it is.',
    orders: [
      { productId: 'nano3', tonnes: 4, costPerTonne: 610, sellPerTonne: 1180, orderedAt: '2026-05-21', paid: true },
      { productId: 'nano3', tonnes: 3.5, costPerTonne: 615, sellPerTonne: 1190, orderedAt: '2026-08-06', paid: true },
    ],
  },
  {
    name: `${DEMO_PREFIX} Fen Glassworks Ltd`,
    natureOfTrade: 'Container glass manufacture',
    sector: 'glass',
    preferredProductId: 'nano3',
    fulfilment: 'scheduled',
    typicalTonnes: 15.6,
    origin: 'new',
    importer: false,
    verified: true,
    storagePositions: 14,
    storageRatePounds: 11.5,
    notes:
      'Sodium nitrate as a refining agent. Steady offtake against a furnace campaign, so the ' +
      'schedule matters more to them than the price per tonne.',
    orders: [
      { productId: 'nano3', tonnes: 15.6, costPerTonne: 440, sellPerTonne: 860, orderedAt: '2026-05-14', paid: true },
      { productId: 'nano3', tonnes: 12, costPerTonne: 452, sellPerTonne: 865, orderedAt: '2026-07-30', paid: true },
    ],
  },
  {
    name: `${DEMO_PREFIX} Ouse Water Services`,
    natureOfTrade: 'Municipal wastewater treatment',
    sector: 'water_treatment',
    preferredProductId: 'nano3',
    fulfilment: 'scheduled',
    typicalTonnes: 22,
    origin: 'new',
    importer: true,
    verified: true,
    notes:
      'Sodium nitrate for odour and sulphide control, on a contract rather than spot. Flagged as a ' +
      'possible direct importer: if they can buy at source the switching cost is near zero, so treat ' +
      'this margin as at risk rather than as a base.',
    orders: [
      { productId: 'nano3', tonnes: 22, costPerTonne: 448, sellPerTonne: 795, orderedAt: '2026-07-04', paid: true },
    ],
  },
  {
    name: `${DEMO_PREFIX} Marsh & Sons Pyrotechnics`,
    natureOfTrade: 'Display firework manufacture',
    sector: 'pyrotechnics',
    preferredProductId: 'kno3-13-0-46',
    fulfilment: 'immediate',
    typicalTonnes: 4,
    origin: 'new',
    importer: false,
    verified: false,
    notes:
      'Potassium nitrate as an oxidiser. Small tonnages, high margin, and a reportable substance, so ' +
      'they expect a supplier who documents properly. No verification on file, so the quote is blocked.',
    orders: [],
  },
  {
    name: `${DEMO_PREFIX} Wisbech Ceramics Studio`,
    natureOfTrade: 'Studio glaze and frit production',
    sector: 'ceramics',
    preferredProductId: 'kno3-13-0-46',
    fulfilment: 'immediate',
    typicalTonnes: 1.2,
    origin: 'new',
    importer: false,
    verified: true,
    notes:
      'Potassium nitrate in glazes and frits. Tiny, regular and almost entirely price-insensitive. ' +
      'Worth having precisely because nobody else wants to pick and pack 1.2 tonnes.',
    orders: [
      { productId: 'kno3-13-0-46', tonnes: 1.2, costPerTonne: 655, sellPerTonne: 985, orderedAt: '2026-06-27', paid: true },
    ],
  },
  {
    name: `${DEMO_PREFIX} Deeping Feed Blends`,
    natureOfTrade: 'Compound animal feed manufacture',
    sector: 'animal_nutrition',
    preferredProductId: 'nano3',
    fulfilment: 'storage',
    typicalTonnes: 20,
    origin: 'inherited',
    importer: false,
    verified: false,
    storagePositions: 6,
    notes:
      'Specification-driven buyer with repeat volumes, holding stock on our floor. The storage rate ' +
      'was never agreed, so the monthly charge cannot be raised and the storage commission does not ' +
      'accrue. That is Q3, and this account is what it costs.',
    orders: [],
  },
];

/** Deals left open, so the pipeline board and the gate have something in them. */
const OPEN_DEALS: Array<{
  account: string;
  title: string;
  stage: 'enquiry' | 'qualified' | 'quoted' | 'negotiation';
  productId: string;
  tonnes: number;
  costPerTonne: number;
  sellPerTonne: number;
}> = [
  {
    account: `${DEMO_PREFIX} Marsh & Sons Pyrotechnics`,
    title: 'Potassium nitrate, 4t, display grade',
    stage: 'qualified',
    productId: 'kno3-13-0-46',
    tonnes: 4,
    costPerTonne: 640,
    sellPerTonne: 920,
  },
  {
    account: `${DEMO_PREFIX} Holbeach Arable Supplies`,
    title: 'Ammonium nitrate, 28t, spring call-off',
    stage: 'quoted',
    productId: 'an-nitram-345',
    tonnes: 28,
    costPerTonne: 443,
    sellPerTonne: 461,
  },
  {
    account: `${DEMO_PREFIX} Fen Glassworks Ltd`,
    title: 'Sodium nitrate, 18t, Q4 contract',
    stage: 'negotiation',
    productId: 'nano3',
    tonnes: 18,
    costPerTonne: 455,
    sellPerTonne: 870,
  },
  {
    account: `${DEMO_PREFIX} Wash Valley Growers`,
    title: 'Calcium nitrate, 10t',
    stage: 'enquiry',
    productId: 'can',
    tonnes: 10,
    costPerTonne: 398,
    sellPerTonne: 715,
  },
];

const ENQUIRIES = [
  {
    companyName: `${DEMO_PREFIX} Lincs Ceramics Studio`,
    contactName: 'R. Fenwick',
    email: 'buyer@example.invalid',
    sector: 'ceramics',
    natureOfTrade: 'Studio glaze and frit production',
    productIds: ['an-nitram-345'],
    quantityKg: 3_000,
    fulfilment: 'delivery' as const,
    deliveryPostcode: 'LN4 1AA',
    timing: 'Within a month',
    buyerType: 'business' as const,
    message: 'Looking for a regular small-tonnage supply. What can you do on price?',
    source: 'google',
    sessionId: 'demo-sess-101',
  },
  {
    companyName: `${DEMO_PREFIX} Anglia Feed Blends`,
    contactName: 'P. Adeyemi',
    email: 'purchasing@example.invalid',
    sector: 'animal_nutrition',
    natureOfTrade: 'Compound feed manufacture',
    productIds: ['nano3'],
    quantityKg: 20_000,
    fulfilment: 'delivery' as const,
    deliveryPostcode: 'IP24 2AA',
    timing: 'This quarter',
    buyerType: 'business' as const,
    message: 'Need to confirm the grade before we can specify.',
    source: 'referral',
    sessionId: 'demo-sess-102',
  },
  {
    // Deliberately trips the screening rules, so the compliance queue is populated.
    contactName: 'Walk-in caller',
    productIds: ['an-nitram-345'],
    quantityKg: 18_000,
    fulfilment: 'collection' as const,
    buyerType: 'member_of_public' as const,
    message: 'Can I pay cash on collection?',
    source: 'phone',
    sessionId: 'demo-sess-103',
    offeredCashPayment: true,
    refusedToProvideDetails: true,
  },
];

/** A handful of page-level events, so the funnel is not a flat zero. */
function seedFunnelEvents(db: Db): void {
  const stages: Array<[string, number]> = [
    ['page_view', 240],
    ['calc_engaged', 96],
    ['spec_changed', 71],
    ['enquiry_opened', 34],
    ['enquiry_step_2', 21],
    ['spec_emailed', 11],
    ['enquiry_abandoned', 13],
  ];
  const sources = ['google', 'direct', 'referral', 'linkedin'];
  const base = Date.now() - 30 * 86_400_000;

  for (const [event, sessions] of stages) {
    for (let i = 0; i < sessions; i += 1) {
      db.run(
        `INSERT INTO funnel_events (id, event, session_id, occurred_at, source, medium, campaign, product_id, business, payload, created_at)
         VALUES (?,?,?,?,?,?,NULL,NULL,'UKN','{}',?)`,
        id(),
        event,
        `demo-visitor-${i}`,
        new Date(base + Math.floor(Math.random() * 30 * 86_400_000)).toISOString(),
        sources[i % sources.length]!,
        'organic',
        now(),
      );
    }
  }
}

export function loadDemo(db: Db): void {
  seed(db);

  const already = db.get<Row>('SELECT id FROM accounts WHERE name LIKE ?', `${DEMO_PREFIX}%`);
  if (already) {
    console.log('Demo data is already loaded. Delete the database file to start again.');
    return;
  }

  const userRow = db.get<Row>('SELECT * FROM users WHERE role = ? LIMIT 1', 'ops_director');
  if (!userRow) throw new Error('Seed the database before loading the demo.');
  const user: AuthUser = {
    id: String(userRow['id']),
    email: String(userRow['email']),
    name: String(userRow['name']),
    role: 'ops_director',
  };

  const accountIds = new Map<string, string>();

  db.tx(() => {
    for (const a of ACCOUNTS) {
      const accountId = id();
      accountIds.set(a.name, accountId);
      db.run(
        `INSERT INTO accounts (id, name, business, sector, origin, owner_user_id, payment_terms_days,
           possible_direct_importer, status, notes, fulfilment_preference, preferred_product_id,
           typical_order_kg, nature_of_trade, created_at, updated_at)
         VALUES (?,?, 'UKN', ?,?,?, 30, ?, 'active', ?,?,?,?,?,?,?)`,
        accountId,
        a.name,
        a.sector,
        a.origin,
        user.id,
        toInt(a.importer),
        `${a.notes}\n\nFictional account created by the demo loader. Not a real customer.`,
        a.fulfilment,
        a.preferredProductId,
        fromTonnes(a.typicalTonnes),
        a.natureOfTrade,
        now(),
        now(),
      );
      db.run(
        `INSERT INTO kyc_records (id, account_id, photo_id_reference, photo_id_type, business_name,
           business_address, vat_number, nature_of_trade, buyer_type, verified_by, verified_at, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        id(),
        accountId,
        a.verified ? `DEMO-ID-${Math.floor(Math.random() * 9000 + 1000)}` : null,
        a.verified ? 'driving_licence' : null,
        a.name,
        a.verified ? 'Norfolk' : null,
        a.verified ? `GB${Math.floor(Math.random() * 900_000_000 + 100_000_000)}` : null,
        a.natureOfTrade,
        a.verified ? 'business' : 'unknown',
        a.verified ? user.name : null,
        a.verified ? '2026-03-01T09:00:00.000Z' : null,
        now(),
        now(),
      );
    }
  });

  // Historic orders go through winDeal, so commission accrues exactly as it
  // would in real use rather than being written straight into the ledger.
  let dealSeq = 0;
  for (const a of ACCOUNTS) {
    const accountId = accountIds.get(a.name)!;
    for (const o of a.orders) {
      dealSeq += 1;
      const dealId = id();
      const reference = `UKN-D-D${String(dealSeq).padStart(3, '0')}`;
      db.tx(() => {
        db.run(
          `INSERT INTO deals (id, reference, account_id, business, title, stage, owner_user_id, notes, created_at, updated_at)
           VALUES (?,?,?, 'UKN', ?, 'negotiation', ?, ?, ?, ?)`,
          dealId,
          reference,
          accountId,
          `${o.tonnes}t order`,
          user.id,
          'Demo data.',
          now(),
          now(),
        );
        db.run(
          `INSERT INTO deal_lines (id, deal_id, product_id, quantity_kg, cost_per_tonne, sell_per_tonne, cost_tag, position)
           VALUES (?,?,?,?,?,?, 'A', 0)`,
          id(),
          dealId,
          o.productId,
          fromTonnes(o.tonnes),
          fromPounds(o.costPerTonne),
          fromPounds(o.sellPerTonne),
        );
      });
      const { orderId } = winDeal(db, user, dealId, o.orderedAt);
      if (o.paid) {
        db.run("UPDATE orders SET payment_status = 'paid', paid_at = ? WHERE id = ?", o.orderedAt, orderId);
        db.run(
          "UPDATE commission_entries SET status = 'payable' WHERE source_id = ? AND source_type = 'order'",
          orderId,
        );
      }
    }
  }

  for (const d of OPEN_DEALS) {
    const accountId = accountIds.get(d.account)!;
    dealSeq += 1;
    const dealId = id();
    db.tx(() => {
      db.run(
        `INSERT INTO deals (id, reference, account_id, business, title, stage, owner_user_id, expected_close_at, notes, created_at, updated_at)
         VALUES (?,?,?, 'UKN', ?, ?, ?, ?, 'Demo data.', ?, ?)`,
        dealId,
        `UKN-D-D${String(dealSeq).padStart(3, '0')}`,
        accountId,
        d.title,
        d.stage,
        user.id,
        '2026-10-15',
        now(),
        now(),
      );
      db.run(
        `INSERT INTO deal_lines (id, deal_id, product_id, quantity_kg, cost_per_tonne, sell_per_tonne, cost_tag, position)
         VALUES (?,?,?,?,?,?, 'A', 0)`,
        id(),
        dealId,
        d.productId,
        fromTonnes(d.tonnes),
        fromPounds(d.costPerTonne),
        fromPounds(d.sellPerTonne),
      );
    });
    if (d.stage === 'quoted' || d.stage === 'negotiation') {
      try {
        createQuote(db, user, dealId, '2026-10-31');
      } catch {
        // A blocked quote is a legitimate demo state, not a failure.
      }
    }
  }

  for (const e of ENQUIRIES) intakeEnquiry(db, e);

  /*
   * Storage agreements follow from the accounts themselves. An account that
   * said it leaves stock on our racking gets one; an account that wants it off
   * the floor does not. One of them has no agreed rate, which is deliberate:
   * that is what Q3 costs, and it shows up as a month that cannot be billed
   * rather than as a month that was free.
   */
  const storageAccounts = ACCOUNTS.filter((a) => a.storagePositions && a.storagePositions > 0);
  const agreementIds = new Map<string, string>();

  db.tx(() => {
    for (const a of storageAccounts) {
      const accountId = accountIds.get(a.name)!;
      const agreementId = id();
      agreementIds.set(a.name, agreementId);
      db.run(
        `INSERT INTO storage_agreements (id, account_id, product_id, fee_basis, rate_pence, pallet_positions,
           started_at, duty_accepted, notes, created_at)
         VALUES (?,?,?, 'per_pallet_month', ?,?, '2026-05-01', ?, ?, ?)`,
        agreementId,
        accountId,
        a.preferredProductId,
        a.storageRatePounds === undefined ? null : fromPounds(a.storageRatePounds),
        a.storagePositions!,
        toInt(a.storageRatePounds !== undefined),
        a.storageRatePounds === undefined
          ? 'Rate never agreed, so the monthly charge cannot be raised (Q3). Demo data.'
          : 'Demo data.',
        now(),
      );

      // Goods in for what they are holding, then a partial call-off, so the
      // ledger proves a peak rather than only showing today's balance.
      const heldTonnes = a.typicalTonnes;
      db.run(
        `INSERT INTO storage_movements (id, agreement_id, account_id, product_id, direction, quantity_kg, occurred_at, reference, created_at)
         VALUES (?,?,?,?, 'in', ?, '2026-05-02', 'demo', ?)`,
        id(), agreementId, accountId, a.preferredProductId, fromTonnes(heldTonnes), now(),
      );
      db.run(
        `INSERT INTO storage_movements (id, agreement_id, account_id, product_id, direction, quantity_kg, occurred_at, reference, created_at)
         VALUES (?,?,?,?, 'out', ?, '2026-07-15', 'demo call-off', ?)`,
        id(), agreementId, accountId, a.preferredProductId, fromTonnes(heldTonnes * 0.3), now(),
      );
    }
  });

  for (const [start, end] of [
    ['2026-06-01', '2026-06-30'],
    ['2026-07-01', '2026-07-31'],
    ['2026-08-01', '2026-08-31'],
  ] as Array<[string, string]>) {
    runStorageBilling(db, user, start, end);
  }

  seedFunnelEvents(db);

  db.run(
    `INSERT INTO activities (id, user_id, type, subject, body, due_at, created_at)
     VALUES (?,?, 'task', ?, ?, ?, ?)`,
    id(),
    user.id,
    'Sign off verification for Marsh & Sons before quoting',
    'The deal is qualified and the quote is blocked until the record is complete. Demo data.',
    '2026-09-15',
    now(),
  );

  console.log('Demo data loaded. Every account is prefixed [demo] and none of it is real.');
}

const isMain = process.argv[1]?.endsWith('demo.ts') || process.argv[1]?.endsWith('demo.js');
if (isMain) {
  const path = process.env['UKN_DB'] ?? new URL('../../../data/demo.db', import.meta.url).pathname;
  const db = new Db(path);
  loadDemo(db);
  db.close();
  console.log(`Written to ${path}. Start the server with UKN_DB=${path}.`);
}

export { jsonIn };
