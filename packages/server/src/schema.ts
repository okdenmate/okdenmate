/**
 * Schema.
 *
 * Everything is versioned through numbered migrations so the database can move
 * forward without a rebuild. Money is INTEGER pence, tonnage INTEGER kilogrammes,
 * timestamps ISO-8601 text. SQLite has no decimal type worth trusting, so nothing
 * financial is ever a REAL.
 */

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial',
    sql: `
CREATE TABLE users (
  id           TEXT PRIMARY KEY,
  email        TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  role         TEXT NOT NULL CHECK (role IN ('owner','ops_director','sales','production','readonly')),
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  active       INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE sessions (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE products (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  formula       TEXT,
  product_class TEXT NOT NULL CHECK (product_class IN ('commodity','specialty','ancillary')),
  nitrogen_pct  REAL,
  analysis      TEXT,
  grade         TEXT NOT NULL,
  un_class      TEXT,
  un_number     TEXT,
  pack_forms    TEXT NOT NULL,
  supplier      TEXT,
  uk_stock      INTEGER NOT NULL DEFAULT 0,
  target_gm_low_bps  INTEGER,
  target_gm_high_bps INTEGER,
  target_gm_tag      TEXT NOT NULL DEFAULT 'U',
  target_gm_source   TEXT,
  target_gm_blocked_by TEXT,
  notes         TEXT NOT NULL DEFAULT '',
  active        INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE price_anchors (
  id             TEXT PRIMARY KEY,
  product_id     TEXT NOT NULL REFERENCES products(id),
  price_per_tonne INTEGER NOT NULL,
  source         TEXT NOT NULL,
  as_of          TEXT NOT NULL,
  basis          TEXT NOT NULL,
  created_at     TEXT NOT NULL
);
CREATE INDEX idx_anchor_product_date ON price_anchors(product_id, as_of DESC);

CREATE TABLE accounts (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  business      TEXT NOT NULL CHECK (business IN ('UKN','RW')) DEFAULT 'UKN',
  sector        TEXT,
  origin        TEXT NOT NULL CHECK (origin IN ('new','inherited')) DEFAULT 'new',
  owner_user_id TEXT REFERENCES users(id),
  companies_house_number TEXT,
  website       TEXT,
  phone         TEXT,
  address       TEXT,
  postcode      TEXT,
  payment_terms_days INTEGER NOT NULL DEFAULT 30,
  possible_direct_importer INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL CHECK (status IN ('prospect','active','dormant','refused')) DEFAULT 'prospect',
  notes         TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX idx_accounts_status ON accounts(status);
CREATE INDEX idx_accounts_sector ON accounts(sector);

CREATE TABLE contacts (
  id         TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  role       TEXT,
  email      TEXT,
  phone      TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0,
  notes      TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_contacts_account ON contacts(account_id);

CREATE TABLE kyc_records (
  id                TEXT PRIMARY KEY,
  account_id        TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  photo_id_reference TEXT,
  photo_id_type     TEXT,
  business_name     TEXT,
  business_address  TEXT,
  vat_number        TEXT,
  nature_of_trade   TEXT,
  buyer_type        TEXT NOT NULL DEFAULT 'unknown',
  verified_by       TEXT,
  verified_at       TEXT,
  refused           INTEGER NOT NULL DEFAULT 0,
  refusal_reason    TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_kyc_account ON kyc_records(account_id);

CREATE TABLE enquiries (
  id             TEXT PRIMARY KEY,
  account_id     TEXT REFERENCES accounts(id),
  company_name   TEXT,
  contact_name   TEXT,
  email          TEXT,
  phone          TEXT,
  sector         TEXT,
  nature_of_trade TEXT,
  product_ids    TEXT NOT NULL DEFAULT '[]',
  quantity_kg    INTEGER,
  fulfilment     TEXT CHECK (fulfilment IN ('delivery','collection')) DEFAULT 'delivery',
  delivery_postcode TEXT,
  timing         TEXT,
  buyer_type     TEXT NOT NULL DEFAULT 'unknown',
  message        TEXT,
  source         TEXT,
  medium         TEXT,
  campaign       TEXT,
  session_id     TEXT,
  status         TEXT NOT NULL CHECK (status IN ('new','triaged','converted','disqualified')) DEFAULT 'new',
  disqualified_reason TEXT,
  deal_id        TEXT,
  created_at     TEXT NOT NULL,
  triaged_at     TEXT
);
CREATE INDEX idx_enquiries_status ON enquiries(status, created_at DESC);

CREATE TABLE deals (
  id             TEXT PRIMARY KEY,
  reference      TEXT NOT NULL UNIQUE,
  account_id     TEXT NOT NULL REFERENCES accounts(id),
  enquiry_id     TEXT REFERENCES enquiries(id),
  business       TEXT NOT NULL CHECK (business IN ('UKN','RW')) DEFAULT 'UKN',
  title          TEXT NOT NULL,
  stage          TEXT NOT NULL CHECK (stage IN ('enquiry','qualified','quoted','negotiation','won','lost')) DEFAULT 'enquiry',
  owner_user_id  TEXT REFERENCES users(id),
  expected_close_at TEXT,
  probability_bps_override INTEGER,
  lost_reason    TEXT,
  order_sequence INTEGER NOT NULL DEFAULT 1,
  notes          TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  closed_at      TEXT
);
CREATE INDEX idx_deals_stage ON deals(stage, updated_at DESC);
CREATE INDEX idx_deals_account ON deals(account_id);

CREATE TABLE deal_lines (
  id             TEXT PRIMARY KEY,
  deal_id        TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  product_id     TEXT NOT NULL REFERENCES products(id),
  quantity_kg    INTEGER NOT NULL,
  cost_per_tonne INTEGER NOT NULL,
  sell_per_tonne INTEGER NOT NULL,
  cost_tag       TEXT NOT NULL DEFAULT 'E',
  delivery_cost  INTEGER NOT NULL DEFAULT 0,
  discount       INTEGER NOT NULL DEFAULT 0,
  pack_form      TEXT,
  position       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_deal_lines_deal ON deal_lines(deal_id);

CREATE TABLE quotes (
  id           TEXT PRIMARY KEY,
  deal_id      TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  version      INTEGER NOT NULL,
  reference    TEXT NOT NULL,
  snapshot     TEXT NOT NULL,
  revenue      INTEGER NOT NULL,
  cost         INTEGER NOT NULL,
  gross_margin INTEGER NOT NULL,
  gm_bps       INTEGER NOT NULL,
  gate_decision TEXT NOT NULL,
  gate_reasons TEXT NOT NULL DEFAULT '[]',
  valid_until  TEXT,
  sent_at      TEXT,
  created_by   TEXT REFERENCES users(id),
  created_at   TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_quote_deal_version ON quotes(deal_id, version);

CREATE TABLE orders (
  id            TEXT PRIMARY KEY,
  reference     TEXT NOT NULL UNIQUE,
  deal_id       TEXT NOT NULL REFERENCES deals(id),
  account_id    TEXT NOT NULL REFERENCES accounts(id),
  business      TEXT NOT NULL DEFAULT 'UKN',
  revenue       INTEGER NOT NULL,
  cost          INTEGER NOT NULL,
  gross_margin  INTEGER NOT NULL,
  gm_bps        INTEGER NOT NULL,
  ordered_at    TEXT NOT NULL,
  invoiced_at   TEXT,
  paid_at       TEXT,
  payment_status TEXT NOT NULL CHECK (payment_status IN ('unpaid','part_paid','paid')) DEFAULT 'unpaid',
  order_sequence INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_orders_account ON orders(account_id, ordered_at DESC);

CREATE TABLE commission_entries (
  id            TEXT PRIMARY KEY,
  source_id     TEXT NOT NULL,
  source_type   TEXT NOT NULL CHECK (source_type IN ('order','storage_period')),
  user_id       TEXT NOT NULL REFERENCES users(id),
  account_id    TEXT REFERENCES accounts(id),
  business      TEXT NOT NULL,
  rate_id       TEXT NOT NULL,
  rate_bps      INTEGER NOT NULL,
  basis         TEXT NOT NULL,
  basis_amount  INTEGER NOT NULL,
  amount        INTEGER NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('accrued','payable','paid','void')) DEFAULT 'accrued',
  occurred_at   TEXT NOT NULL,
  expected_payable_at TEXT NOT NULL,
  paid_at       TEXT,
  note          TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_commission_source ON commission_entries(source_id, source_type, user_id);
CREATE INDEX idx_commission_status ON commission_entries(status);

CREATE TABLE storage_agreements (
  id              TEXT PRIMARY KEY,
  account_id      TEXT NOT NULL REFERENCES accounts(id),
  product_id      TEXT REFERENCES products(id),
  fee_basis       TEXT NOT NULL CHECK (fee_basis IN ('per_pallet_month','per_tonne_month','flat_month')),
  rate_pence      INTEGER,
  pallet_positions INTEGER,
  started_at      TEXT NOT NULL,
  ended_at        TEXT,
  duty_accepted   INTEGER NOT NULL DEFAULT 0,
  notes           TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL
);

CREATE TABLE storage_movements (
  id           TEXT PRIMARY KEY,
  agreement_id TEXT NOT NULL REFERENCES storage_agreements(id) ON DELETE CASCADE,
  account_id   TEXT NOT NULL REFERENCES accounts(id),
  product_id   TEXT NOT NULL REFERENCES products(id),
  direction    TEXT NOT NULL CHECK (direction IN ('in','out')),
  quantity_kg  INTEGER NOT NULL,
  occurred_at  TEXT NOT NULL,
  reference    TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_movements_date ON storage_movements(occurred_at);

CREATE TABLE storage_charges (
  id           TEXT PRIMARY KEY,
  agreement_id TEXT NOT NULL REFERENCES storage_agreements(id) ON DELETE CASCADE,
  account_id   TEXT NOT NULL REFERENCES accounts(id),
  period_start TEXT NOT NULL,
  period_end   TEXT NOT NULL,
  basis        TEXT NOT NULL,
  quantity     REAL NOT NULL,
  fee          INTEGER,
  unresolved   INTEGER NOT NULL DEFAULT 0,
  note         TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_charge_period ON storage_charges(agreement_id, period_start);

CREATE TABLE compliance_notifications (
  id           TEXT PRIMARY KEY,
  threshold_id TEXT NOT NULL UNIQUE,
  status       TEXT NOT NULL CHECK (status IN ('filed','not_required','unknown','overdue')) DEFAULT 'unknown',
  filed_at     TEXT,
  reference    TEXT,
  note         TEXT NOT NULL DEFAULT '',
  updated_at   TEXT NOT NULL
);

CREATE TABLE site_compliance (
  id                    INTEGER PRIMARY KEY CHECK (id = 1),
  peak_an_kg            INTEGER,
  peak_recorded_at      TEXT,
  signage_in_place      INTEGER NOT NULL DEFAULT 0,
  procedures_documented INTEGER NOT NULL DEFAULT 0,
  total_pallet_positions INTEGER,
  updated_at            TEXT NOT NULL,
  note                  TEXT NOT NULL DEFAULT ''
);

CREATE TABLE suspicious_transactions (
  id          TEXT PRIMARY KEY,
  account_id  TEXT REFERENCES accounts(id),
  enquiry_id  TEXT REFERENCES enquiries(id),
  detected_at TEXT NOT NULL,
  summary     TEXT NOT NULL,
  indicators  TEXT NOT NULL DEFAULT '[]',
  status      TEXT NOT NULL CHECK (status IN ('open','reported','dismissed')) DEFAULT 'open',
  reported_at TEXT,
  reference   TEXT,
  raised_by   TEXT REFERENCES users(id),
  created_at  TEXT NOT NULL
);

CREATE TABLE activities (
  id          TEXT PRIMARY KEY,
  account_id  TEXT REFERENCES accounts(id) ON DELETE CASCADE,
  deal_id     TEXT REFERENCES deals(id) ON DELETE CASCADE,
  contact_id  TEXT REFERENCES contacts(id),
  user_id     TEXT REFERENCES users(id),
  type        TEXT NOT NULL CHECK (type IN ('call','email','meeting','note','task','site_visit')),
  subject     TEXT NOT NULL,
  body        TEXT NOT NULL DEFAULT '',
  due_at      TEXT,
  completed_at TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_activities_account ON activities(account_id, created_at DESC);
CREATE INDEX idx_activities_open_tasks ON activities(due_at) WHERE completed_at IS NULL;

CREATE TABLE funnel_events (
  id          TEXT PRIMARY KEY,
  event       TEXT NOT NULL,
  session_id  TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  source      TEXT,
  medium      TEXT,
  campaign    TEXT,
  product_id  TEXT,
  business    TEXT NOT NULL DEFAULT 'UKN',
  payload     TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_events_event_date ON funnel_events(event, occurred_at);
CREATE INDEX idx_events_session ON funnel_events(session_id);

CREATE TABLE open_questions (
  id          TEXT PRIMARY KEY,
  tier        INTEGER NOT NULL,
  business    TEXT NOT NULL,
  question    TEXT NOT NULL,
  why_it_matters TEXT NOT NULL,
  how_to_answer  TEXT NOT NULL,
  consequence_if_unanswered TEXT NOT NULL,
  owner       TEXT NOT NULL,
  blocks      TEXT NOT NULL DEFAULT '[]',
  status      TEXT NOT NULL CHECK (status IN ('open','chasing','answered','dropped')) DEFAULT 'open',
  answer      TEXT,
  answered_at TEXT,
  updated_at  TEXT NOT NULL
);

CREATE TABLE audit_log (
  id         TEXT PRIMARY KEY,
  user_id    TEXT,
  entity     TEXT NOT NULL,
  entity_id  TEXT NOT NULL,
  action     TEXT NOT NULL,
  detail     TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_audit_entity ON audit_log(entity, entity_id, created_at DESC);
`,
  },
];
