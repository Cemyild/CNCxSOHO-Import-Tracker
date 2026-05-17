-- agent_audit_log: enum types, table, and indexes. Applied as one-off DDL
-- because `drizzle-kit push` is currently blocked by pre-existing schema drift
-- on unrelated tables. Idempotent; safe to re-apply.
-- This directory (db/manual-ddl/) is intentionally separate from drizzle-kit's
-- `migrations/` output path (see drizzle.config.ts).
-- Source of truth for column shape: shared/schema.ts → agentAuditLog.

DO $$ BEGIN
  CREATE TYPE agent_tier AS ENUM ('read', 'write', 'destructive', 'ai');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE agent_result_status AS ENUM ('ok', 'error', 'dry_run');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS agent_audit_log (
  id SERIAL PRIMARY KEY,
  ts TIMESTAMP NOT NULL DEFAULT NOW(),
  agent_id TEXT NOT NULL,
  token_fingerprint TEXT NOT NULL,
  tool TEXT NOT NULL,
  tier agent_tier NOT NULL,
  args_json TEXT NOT NULL,
  before_json TEXT,
  result_status agent_result_status NOT NULL,
  result_summary TEXT,
  affected_table TEXT,
  affected_ids TEXT,
  duration_ms INTEGER,
  transaction_id TEXT
);

CREATE INDEX IF NOT EXISTS agent_audit_log_ts_idx ON agent_audit_log (ts);
CREATE INDEX IF NOT EXISTS agent_audit_log_tool_ts_idx ON agent_audit_log (tool, ts);
CREATE INDEX IF NOT EXISTS agent_audit_log_txn_idx ON agent_audit_log (transaction_id);
