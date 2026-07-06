CREATE TABLE IF NOT EXISTS grants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  funder TEXT NOT NULL,
  reporting_period_start TEXT NOT NULL,
  reporting_period_end TEXT NOT NULL,
  report_due TEXT NOT NULL,
  template_ref TEXT
);

CREATE TABLE IF NOT EXISTS requirements (
  id TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL,
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  type TEXT NOT NULL,
  required INTEGER NOT NULL DEFAULT 1,
  params_json TEXT
);

CREATE TABLE IF NOT EXISTS evidence (
  id TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL,
  requirement_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  claim_text TEXT NOT NULL,
  quote_text TEXT,
  value_json TEXT,
  confidence REAL NOT NULL,
  pii_state TEXT NOT NULL DEFAULT 'none',
  status TEXT NOT NULL DEFAULT 'proposed',
  extracted_at TEXT NOT NULL,
  confirmed_by TEXT,
  confirmed_at TEXT,
  masked_claim_text TEXT,
  masked_quote_text TEXT
);

CREATE TABLE IF NOT EXISTS conflicts (
  id TEXT PRIMARY KEY,
  requirement_id TEXT NOT NULL,
  evidence_a TEXT NOT NULL,
  evidence_b TEXT,
  kind TEXT NOT NULL,
  note TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  resolved_choice TEXT,
  resolved_by TEXT,
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS drafts (
  id TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL,
  section TEXT NOT NULL,
  content_md TEXT NOT NULL,
  citations_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed',
  created_at TEXT NOT NULL,
  approved_by TEXT
);

CREATE TABLE IF NOT EXISTS audit (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  details_json TEXT,
  at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS evidence_requirement_source_dedup
  ON evidence(requirement_id, source_ref);
