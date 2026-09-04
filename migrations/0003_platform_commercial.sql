-- Commercial model, checklists, translations and tenant plan fields.
--
-- The application tables (tenants, users, training_progress) are owned by the
-- Flask app and were created outside this migration system. They are created
-- here IF NOT EXISTS in their legacy shape so local development works, then
-- extended with the new plan columns. On the production database the CREATEs
-- are no-ops and only the ALTERs run.

CREATE TABLE IF NOT EXISTS plans (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  kind              TEXT NOT NULL CHECK (kind IN ('free', 'subscription', 'pack', 'enterprise')),
  position          INTEGER NOT NULL,
  price_eur         REAL,                              -- NULL for custom pricing
  billing           TEXT NOT NULL CHECK (billing IN ('free', 'monthly', 'per_seat_monthly', 'one_time', 'custom')),
  seats_included    INTEGER,                           -- NULL = per-seat quantity or unlimited
  seat_min          INTEGER,
  term_months       INTEGER,                           -- packs: access length after purchase
  training_tier     TEXT NOT NULL CHECK (training_tier IN ('free', 'starter', 'pro', 'enterprise')),
  stripe_price_env  TEXT,                              -- env var in the Flask app holding the Stripe price ids
  tagline           TEXT,
  badge             TEXT,
  cta               TEXT,
  highlights        TEXT NOT NULL DEFAULT '[]',        -- JSON array of strings
  entitlements      TEXT NOT NULL DEFAULT '{}',        -- JSON object, see content/plans.json
  is_active         INTEGER NOT NULL DEFAULT 1,        -- 0 = grandfathered, not offered
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS checklists (
  id                TEXT PRIMARY KEY,
  title             TEXT NOT NULL,
  description       TEXT NOT NULL,
  legal_basis       TEXT,
  audience          TEXT,
  content_version   TEXT NOT NULL,
  sections          TEXT NOT NULL,                     -- JSON array of {id, title, items: [...]}
  is_published      INTEGER NOT NULL DEFAULT 1,
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS training_module_translations (
  module_id         TEXT NOT NULL REFERENCES training_modules(id) ON DELETE CASCADE,
  locale            TEXT NOT NULL,
  title             TEXT NOT NULL,
  description       TEXT NOT NULL,
  content           TEXT NOT NULL,                     -- JSON {sections, quiz}; quiz keeps the base answer indexes
  content_version   TEXT NOT NULL,
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (module_id, locale)
);

CREATE TABLE IF NOT EXISTS checklist_translations (
  checklist_id      TEXT NOT NULL REFERENCES checklists(id) ON DELETE CASCADE,
  locale            TEXT NOT NULL,
  title             TEXT NOT NULL,
  description       TEXT NOT NULL,
  sections          TEXT NOT NULL,
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (checklist_id, locale)
);

-- Per-tenant checklist state, written by the Flask app.
CREATE TABLE IF NOT EXISTS checklist_progress (
  id                TEXT PRIMARY KEY,
  tenant_id         TEXT NOT NULL,
  checklist_id      TEXT NOT NULL,
  item_id           TEXT NOT NULL,
  done              INTEGER NOT NULL DEFAULT 0,
  note              TEXT,
  done_by           TEXT,
  done_at           TEXT,
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tenant_id, checklist_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_checklist_progress_tenant
  ON checklist_progress (tenant_id, checklist_id);

-- Legacy application tables (no-op on production).
CREATE TABLE IF NOT EXISTS tenants (
  id                TEXT PRIMARY KEY,
  name              TEXT,
  tier              TEXT NOT NULL DEFAULT 'free',
  stripe_customer   TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id                TEXT PRIMARY KEY,
  tenant_id         TEXT NOT NULL,
  auth0_sub         TEXT,
  email             TEXT,
  name              TEXT,
  role              TEXT NOT NULL DEFAULT 'member',
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS training_progress (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL,
  tenant_id         TEXT NOT NULL,
  module_id         TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'not_started',
  score             INTEGER,
  started_at        TEXT,
  completed_at      TEXT
);

-- Plan fields on tenants. `tier` is kept and mirrors the plan's training tier
-- so existing queries in the Flask app keep working during the transition.
ALTER TABLE tenants ADD COLUMN plan TEXT NOT NULL DEFAULT 'free';
ALTER TABLE tenants ADD COLUMN seats INTEGER;
ALTER TABLE tenants ADD COLUMN plan_expires_at TEXT;          -- packs: ISO timestamp; NULL = no expiry
ALTER TABLE tenants ADD COLUMN stripe_subscription TEXT;
ALTER TABLE tenants ADD COLUMN locale TEXT NOT NULL DEFAULT 'en';

-- Grandfather existing subscribers onto the legacy plans.
UPDATE tenants SET plan = 'legacy_starter', seats = 1 WHERE tier = 'starter';
UPDATE tenants SET plan = 'legacy_pro',     seats = 5 WHERE tier = 'pro';
UPDATE tenants SET plan = 'enterprise'                WHERE tier = 'enterprise';
