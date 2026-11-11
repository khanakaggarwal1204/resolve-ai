-- PayPal Resolve: app-owned persistence (build plan section 4.3).
-- Amounts are stored as decimal TEXT (never floats). Timestamps are ISO-8601 UTC strings.

CREATE TABLE users (
  id             TEXT PRIMARY KEY,
  role           TEXT NOT NULL CHECK (role IN ('buyer', 'merchant')),
  display_name   TEXT NOT NULL,
  merchant_label TEXT,
  source_mode    TEXT NOT NULL DEFAULT 'synthetic_demo' CHECK (source_mode IN ('app_owned', 'synthetic_demo')),
  created_at     TEXT NOT NULL
);

-- paypal_sandbox_verified rows may only be written by server code that just fetched the facts from PayPal.
CREATE TABLE payment_references (
  id               TEXT PRIMARY KEY,
  paypal_order_id  TEXT NOT NULL UNIQUE,
  capture_id       TEXT,
  amount           TEXT NOT NULL,
  currency         TEXT NOT NULL CHECK (length(currency) = 3),
  verified_status  TEXT NOT NULL,
  merchant_label   TEXT,
  created_at       TEXT NOT NULL,
  source_mode      TEXT NOT NULL CHECK (source_mode IN ('paypal_sandbox_verified', 'synthetic_demo'))
);

CREATE TABLE resolution_cases (
  id                   TEXT PRIMARY KEY,
  payment_reference_id TEXT NOT NULL REFERENCES payment_references (id),
  buyer_user_id        TEXT NOT NULL REFERENCES users (id),
  merchant_user_id     TEXT NOT NULL REFERENCES users (id),
  issue_type           TEXT NOT NULL CHECK (issue_type IN ('not_received', 'duplicate_charge', 'incorrect_amount', 'cancelled_order', 'other')),
  narrative            TEXT NOT NULL DEFAULT '',
  status               TEXT NOT NULL CHECK (status IN ('draft', 'submitted', 'under_review', 'awaiting_information', 'resolved', 'closed')),
  source_mode          TEXT NOT NULL CHECK (source_mode IN ('app_owned', 'synthetic_demo')),
  merchant_draft       TEXT,
  reviewed_at          TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);
CREATE INDEX idx_cases_merchant ON resolution_cases (merchant_user_id, status);
CREATE INDEX idx_cases_buyer ON resolution_cases (buyer_user_id);
CREATE INDEX idx_cases_payment ON resolution_cases (payment_reference_id);

CREATE TABLE evidence_items (
  id           TEXT PRIMARY KEY,
  case_id      TEXT NOT NULL REFERENCES resolution_cases (id),
  type         TEXT NOT NULL,
  description  TEXT NOT NULL,
  source       TEXT NOT NULL,
  verified_at  TEXT,               -- NULL = user-provided, unverified
  attached_by  TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_evidence_case ON evidence_items (case_id);

CREATE TABLE ai_recommendations (
  id                   TEXT PRIMARY KEY,
  case_id              TEXT NOT NULL REFERENCES resolution_cases (id),
  summary              TEXT NOT NULL,
  verified_facts_json  TEXT NOT NULL DEFAULT '[]',
  unknowns_json        TEXT NOT NULL DEFAULT '[]',
  evidence_gaps_json   TEXT NOT NULL DEFAULT '[]',
  suggested_next_step  TEXT NOT NULL DEFAULT '',
  draft_message        TEXT,
  confidence_label     TEXT,
  model_version        TEXT,
  extras_json          TEXT NOT NULL DEFAULT '{}',  -- analyzer extras: unverified_claims, contradictions, urgency, human_review, caution, is_fallback
  created_at           TEXT NOT NULL
);
CREATE INDEX idx_recs_case ON ai_recommendations (case_id, created_at);

CREATE TABLE case_actions (
  id               TEXT PRIMARY KEY,
  case_id          TEXT NOT NULL REFERENCES resolution_cases (id),
  actor_id         TEXT NOT NULL,
  action_type      TEXT NOT NULL,
  approved_at      TEXT NOT NULL,
  result           TEXT NOT NULL,
  idempotency_key  TEXT,
  UNIQUE (case_id, idempotency_key)       -- NULL keys never collide
);

-- Append-only: UPDATE and DELETE are blocked by the triggers below.
CREATE TABLE audit_events (
  id                 TEXT PRIMARY KEY,
  actor_id           TEXT NOT NULL,
  event_type         TEXT NOT NULL,
  target_id          TEXT NOT NULL,
  timestamp          TEXT NOT NULL,
  metadata_redacted  TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_audit_target ON audit_events (target_id, timestamp);

CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON audit_events
BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;
CREATE TRIGGER audit_events_no_delete BEFORE DELETE ON audit_events
BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;
