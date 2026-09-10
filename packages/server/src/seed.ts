/**
 * Seed.
 *
 * Rule, taken from the brief's own discipline: nothing here is invented. Only
 * figures the brief marks Verified are loaded as data. Where a number is marked
 * Unknown it stays null and becomes a task, because a plausible placeholder in a
 * database is indistinguishable from a fact three months later.
 *
 * That is why this seed produces two orders rather than five: those are the two
 * whose value and product are both recorded. The rest become work.
 */

import { randomBytes } from 'node:crypto';
import { SEED_PRODUCTS, SEED_QUESTIONS, STORAGE_THRESHOLDS, fromPounds, fromTonnes } from '@ukn/core';
import { Db, id, jsonIn, now, toInt } from './db.js';
import { DEFAULT_DB_PATH } from './index.js';
import { createUser, type Role } from './auth.js';

const AHDB_AN_PER_TONNE = fromPounds(461);

interface SeedUser {
  email: string;
  name: string;
  role: Role;
}

const USERS: SeedUser[] = [
  { email: 'joshuanwobodo727@gmail.com', name: 'Joshua Nwobodo', role: 'ops_director' },
  { email: 'tom@reevewood.com', name: 'Tom', role: 'owner' },
  { email: 'sam@reevewood.com', name: 'Sam', role: 'production' },
];

export function seed(db: Db): { credentials: Array<{ email: string; password: string }> } {
  const credentials: Array<{ email: string; password: string }> = [];

  db.tx(() => {
    /* Users ------------------------------------------------------- */
    for (const u of USERS) {
      const existing = db.get('SELECT id FROM users WHERE email = ?', u.email);
      if (existing) continue;
      const password = process.env['UKN_SEED_PASSWORD'] ?? randomBytes(9).toString('base64url');
      createUser(db, { ...u, password });
      credentials.push({ email: u.email, password });
    }
    const opsUser = db.get<{ id: string }>('SELECT id FROM users WHERE role = ? LIMIT 1', 'ops_director')!;

    /* Products ---------------------------------------------------- */
    for (const p of SEED_PRODUCTS) {
      db.run(
        `INSERT INTO products (id, name, formula, product_class, nitrogen_pct, analysis, grade, un_class, un_number,
           pack_forms, supplier, uk_stock, target_gm_low_bps, target_gm_high_bps, target_gm_tag, target_gm_source,
           target_gm_blocked_by, notes, active)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)
         ON CONFLICT(id) DO NOTHING`,
        p.id,
        p.name,
        p.formula,
        p.productClass,
        p.nitrogenPct,
        p.analysis,
        p.grade,
        p.unClass,
        p.unNumber,
        jsonIn(p.packForms),
        p.supplier,
        toInt(p.ukStock),
        p.targetGmBps.value?.[0] ?? null,
        p.targetGmBps.value?.[1] ?? null,
        p.targetGmBps.tag,
        p.targetGmBps.source ?? null,
        p.targetGmBps.blockedBy ?? null,
        p.notes,
      );
    }

    /* Price anchors ----------------------------------------------- */
    // AHDB publishes a delivered GB price weekly. This is the only externally
    // checkable price in the catalogue, which is exactly why AN margin is thin.
    const anchorExists = db.get('SELECT id FROM price_anchors WHERE product_id = ? AND as_of = ?', 'an-nitram-345', '2026-08-28');
    if (!anchorExists) {
      db.run(
        'INSERT INTO price_anchors (id, product_id, price_per_tonne, source, as_of, basis, created_at) VALUES (?,?,?,?,?,?,?)',
        id(),
        'an-nitram-345',
        AHDB_AN_PER_TONNE,
        'AHDB GB weekly fertiliser prices (UK-produced)',
        '2026-08-28',
        'Delivered to farm, full load, 28-day terms, ex-VAT. Imported material quoted at GBP 462/t on the same date.',
        now(),
      );
    }

    /* Open questions ---------------------------------------------- */
    for (const q of SEED_QUESTIONS) {
      db.run(
        `INSERT INTO open_questions (id, tier, business, question, why_it_matters, how_to_answer,
           consequence_if_unanswered, owner, blocks, status, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`,
        q.id,
        q.tier,
        q.business,
        q.question,
        q.whyItMatters,
        q.howToAnswer,
        q.consequenceIfUnanswered,
        q.owner,
        jsonIn(q.blocks),
        q.status,
        now(),
      );
    }

    /* Compliance -------------------------------------------------- */
    // Every notification starts Unknown, not Filed. The brief records the site's
    // status as unconfirmed with no warning signage visible in photographs, and
    // an unconfirmed notification is an exposure, not a pass.
    for (const t of STORAGE_THRESHOLDS) {
      db.run(
        `INSERT INTO compliance_notifications (id, threshold_id, status, note, updated_at)
         VALUES (?,?, 'unknown', ?, ?) ON CONFLICT(threshold_id) DO NOTHING`,
        id(),
        t.id,
        `Status unconfirmed (Q13). Requires notification to ${t.notify}.`,
        now(),
      );
    }
    db.run(
      `INSERT INTO site_compliance (id, peak_an_kg, signage_in_place, procedures_documented, total_pallet_positions, note, updated_at)
       VALUES (1, NULL, 0, 0, NULL, ?, ?) ON CONFLICT(id) DO NOTHING`,
      'Peak tonnage ever held is unknown (Q13). Pallet positions have never been counted (Q15). ' +
        'No warning signage visible on the photographed elevations, 2026-09-08.',
      now(),
    );

    /* Accounts and the two orders whose figures are actually known -- */
    const seededAccounts = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM accounts');
    if ((seededAccounts?.n ?? 0) === 0) {
      const proficioId = id();
      db.run(
        `INSERT INTO accounts (id, name, business, sector, origin, owner_user_id, payment_terms_days,
           possible_direct_importer, status, notes, created_at, updated_at)
         VALUES (?, 'Proficio Ltd', 'UKN', 'agriculture', 'inherited', ?, 30, 1, 'active', ?, ?, ?)`,
        proficioId,
        opsUser.id,
        'Largest visible account on the 2026-09-01 sheet, appearing on four lines. Flagged as a ' +
          'possible direct importer: if they can buy the same goods at source, the switching cost ' +
          'is near zero and this margin is at risk rather than assured (Q4).',
        now(),
        now(),
      );

      const wallaceId = id();
      db.run(
        `INSERT INTO accounts (id, name, business, sector, origin, owner_user_id, payment_terms_days,
           possible_direct_importer, status, notes, created_at, updated_at)
         VALUES (?, 'Brian Wallace', 'UKN', 'agriculture', 'inherited', ?, 30, 0, 'active', ?, ?, ?)`,
        wallaceId,
        opsUser.id,
        'Single small lot on the 2026-09-01 sheet.',
        now(),
        now(),
      );

      for (const accountId of [proficioId, wallaceId]) {
        db.run(
          `INSERT INTO kyc_records (id, account_id, business_name, buyer_type, created_at, updated_at)
           VALUES (?,?,(SELECT name FROM accounts WHERE id = ?), 'unknown', ?, ?)`,
          id(),
          accountId,
          accountId,
          now(),
          now(),
        );
      }

      // Both historical orders are ammonium nitrate, which is an explosives
      // precursor. Neither account has a verification record, so both are
      // seeded blocked. That is the correct starting position, not a bug.
      seedHistoricOrder(db, opsUser.id, {
        accountId: proficioId,
        title: 'Ammonium nitrate, 600kg FIBC',
        revenue: fromPounds(13_207.8),
        orderedAt: '2026-08-18',
        sequence: 1,
        note: 'Value verified from the 2026-09-01 order sheet. Bag count and price per bag are unknown (Q16), so tonnage and cost are estimated from the AHDB delivered price.',
      });

      seedHistoricOrder(db, opsUser.id, {
        accountId: wallaceId,
        title: 'Ammonium nitrate, 600kg FIBC',
        revenue: fromPounds(606),
        orderedAt: '2026-08-22',
        sequence: 1,
        note: 'Value verified from the 2026-09-01 order sheet. Tonnage and cost estimated from the AHDB delivered price.',
      });

      /* Tasks, drawn from the brief's own immediate action list ----- */
      const tasks: Array<[string, string, string | null]> = [
        [
          'Enter the remaining Proficio order lines from the 2026-09-01 sheet',
          'The sheet shows Proficio on four lines. Only the GBP 13,207.80 line has both a value and a product recorded, so it is the only one loaded. Enter the rest before reading anything into the concentration figures.',
          '2026-09-13',
        ],
        [
          'Photograph the sodium nitrate bag label',
          'Answers Q5. Food grade prices 30-50% above technical and changes which sector the material should be sold into.',
          '2026-09-13',
        ],
        [
          'Ask Tom for the bag count and price per bag on the GBP 13,207.80 order',
          'Answers Q16 and converts the ammonium nitrate margin from an inference off public prices to a measured figure.',
          '2026-09-13',
        ],
        [
          'Ask Tom whether the NAMOS and NIHHS notifications have been filed, and the peak tonnage ever held',
          'Answers Q13. Until this is known the storage pitch cannot be made and the site may already be in breach.',
          '2026-09-13',
        ],
        [
          'Count the pallet positions in the store',
          'Answers Q15 and puts a ceiling on what the shed could earn.',
          '2026-09-13',
        ],
        [
          'Ask Tom for three to five recent specialty orders with price and cost',
          'Answers Q2, the single blocking assumption behind every margin figure in this system.',
          '2026-09-16',
        ],
        [
          'Point the live site enquiry buttons at this system',
          'The homepage Enquire links contain a space and the footer contact route 404s, so no enquiry is countable today. Repoint both at POST /api/public/enquiry.',
          '2026-09-20',
        ],
        [
          'Check whether analytics is installed on either site',
          'Answers Q18. Arrival and engagement events fire into nothing without it, so the top of the funnel stays dark.',
          '2026-09-13',
        ],
        [
          'Put the commission term for repeat orders in writing',
          'Answers Q12. If the 25% new-account rate is first-order-only, every projection in this system halves.',
          '2026-09-18',
        ],
        [
          'Contact the top three accounts with a specialty offer',
          'The Mix Shift trial. Proves the model before asking for any funnel budget. The call list is on the mix shift screen.',
          '2026-09-23',
        ],
      ];
      for (const [subject, body, dueAt] of tasks) {
        db.run(
          'INSERT INTO activities (id, user_id, type, subject, body, due_at, created_at) VALUES (?,?, \'task\', ?,?,?,?)',
          id(),
          opsUser.id,
          subject,
          body,
          dueAt,
          now(),
        );
      }
    }
  });

  return { credentials };
}

interface HistoricOrder {
  accountId: string;
  title: string;
  revenue: number;
  orderedAt: string;
  sequence: number;
  note: string;
}

/**
 * Reconstruct a historic order from a known order value.
 *
 * The sheet records what the customer paid. It does not record tonnage or cost,
 * so both are derived from the published AHDB price and the verified 2-6%
 * merchant band, and the line is tagged Estimated. When Q16 is answered these
 * two lines should be corrected, not appended to.
 */
function seedHistoricOrder(db: Db, userId: string, o: HistoricOrder): void {
  const AN_GM_MIDPOINT_BPS = 400; // midpoint of the verified 2-6% merchant band
  const quantityKg = Math.round((o.revenue / AHDB_AN_PER_TONNE) * 1000);
  const costPerTonne = Math.round(AHDB_AN_PER_TONNE * (1 - AN_GM_MIDPOINT_BPS / 10_000));
  const cost = Math.round((costPerTonne * quantityKg) / 1000);
  const grossMargin = o.revenue - cost;

  const dealCount = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM deals');
  const dealRef = `UKN-D-${String((dealCount?.n ?? 0) + 1).padStart(4, '0')}`;
  const dealId = id();

  db.run(
    `INSERT INTO deals (id, reference, account_id, business, title, stage, owner_user_id, order_sequence, notes, created_at, updated_at, closed_at)
     VALUES (?,?,?, 'UKN', ?, 'won', ?, ?, ?, ?, ?, ?)`,
    dealId,
    dealRef,
    o.accountId,
    o.title,
    userId,
    o.sequence,
    o.note,
    now(),
    now(),
    o.orderedAt,
  );

  db.run(
    `INSERT INTO deal_lines (id, deal_id, product_id, quantity_kg, cost_per_tonne, sell_per_tonne, cost_tag, pack_form, position)
     VALUES (?,?, 'an-nitram-345', ?,?,?, 'E', 'fibc_600kg', 0)`,
    id(),
    dealId,
    quantityKg,
    costPerTonne,
    AHDB_AN_PER_TONNE,
  );

  const orderCount = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM orders');
  const orderRef = `UKN-O-${String((orderCount?.n ?? 0) + 1).padStart(4, '0')}`;
  const orderId = id();

  db.run(
    `INSERT INTO orders (id, reference, deal_id, account_id, business, revenue, cost, gross_margin, gm_bps,
       ordered_at, payment_status, order_sequence, created_at)
     VALUES (?,?,?,?, 'UKN', ?,?,?,?,?, 'paid', ?, ?)`,
    orderId,
    orderRef,
    dealId,
    o.accountId,
    o.revenue,
    cost,
    grossMargin,
    Math.round((grossMargin / o.revenue) * 10_000),
    o.orderedAt,
    o.sequence,
    now(),
  );
}

const isMain = process.argv[1]?.endsWith('seed.ts') || process.argv[1]?.endsWith('seed.js');
if (isMain) {
  const db = new Db(process.env['UKN_DB'] ?? DEFAULT_DB_PATH);
  const { credentials } = seed(db);
  db.close();
  if (credentials.length > 0) {
    console.log('\nSeeded users. These passwords are shown once.\n');
    for (const c of credentials) console.log(`  ${c.email.padEnd(32)} ${c.password}`);
    console.log('\nChange them after the first sign-in.\n');
  } else {
    console.log('Seed complete. Users already existed, so no new passwords were generated.');
  }
}
