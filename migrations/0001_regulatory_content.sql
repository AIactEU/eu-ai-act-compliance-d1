-- Regulatory content tables for the Comply AI platform.
-- These sit alongside the application tables owned by the Flask app
-- (users, tenants, ai_systems, risk_assessments, documents, training_progress,
-- team_invitations, audit_log) and are read by both the Flask app and this worker.

CREATE TABLE IF NOT EXISTS compliance_deadlines (
  id              TEXT PRIMARY KEY,
  effective_date  TEXT NOT NULL,                      -- ISO-8601 date (YYYY-MM-DD)
  title           TEXT NOT NULL,
  summary         TEXT NOT NULL,
  legal_basis     TEXT,
  applies_to      TEXT NOT NULL DEFAULT '[]',         -- JSON array of role slugs
  status          TEXT NOT NULL DEFAULT 'confirmed'   -- confirmed | backstop | conditional
                  CHECK (status IN ('confirmed', 'backstop', 'conditional')),
  changed_by      TEXT,                               -- amending act, e.g. 'Regulation (EU) 2026/1744'
  original_date   TEXT,                               -- date before amendment, if any
  sort_order      INTEGER NOT NULL DEFAULT 0,
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_compliance_deadlines_date
  ON compliance_deadlines (effective_date, sort_order);

CREATE TABLE IF NOT EXISTS regulatory_updates (
  id              TEXT PRIMARY KEY,
  published_on    TEXT NOT NULL,                      -- ISO-8601 date
  title           TEXT NOT NULL,
  summary         TEXT NOT NULL,
  category        TEXT NOT NULL                       -- legislation | guidance | standards | enforcement | code_of_practice
                  CHECK (category IN ('legislation', 'guidance', 'standards', 'enforcement', 'code_of_practice')),
  impact          TEXT NOT NULL DEFAULT 'medium'
                  CHECK (impact IN ('high', 'medium', 'low')),
  affected_roles  TEXT NOT NULL DEFAULT '[]',         -- JSON array of role slugs
  sources         TEXT NOT NULL DEFAULT '[]',         -- JSON array of {title, url}
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_regulatory_updates_published
  ON regulatory_updates (published_on DESC);

CREATE TABLE IF NOT EXISTS training_modules (
  id                TEXT PRIMARY KEY,
  title             TEXT NOT NULL,
  description       TEXT NOT NULL,
  category          TEXT NOT NULL                     -- foundation | technical | leadership | role_specific
                    CHECK (category IN ('foundation', 'technical', 'leadership', 'role_specific')),
  tier_required     TEXT NOT NULL                     -- free | starter | pro | enterprise
                    CHECK (tier_required IN ('free', 'starter', 'pro', 'enterprise')),
  duration_min      INTEGER NOT NULL,
  order_index       INTEGER NOT NULL,
  content_version   TEXT NOT NULL,                    -- bump when sections/quiz change
  regulatory_basis  TEXT NOT NULL DEFAULT '[]',       -- JSON array of article / act references
  content           TEXT NOT NULL,                    -- JSON {sections: [...], quiz: [...]} (quiz includes correct answers)
  is_published      INTEGER NOT NULL DEFAULT 1,
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_training_modules_order
  ON training_modules (is_published, order_index);
