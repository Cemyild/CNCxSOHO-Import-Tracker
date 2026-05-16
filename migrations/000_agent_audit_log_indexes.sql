-- Indexes for agent_audit_log. Applied alongside the table creation (one-off
-- DDL). drizzle-kit doesn't manage these; if you drop/recreate the table you
-- must re-apply this file.

CREATE INDEX IF NOT EXISTS agent_audit_log_ts_desc_idx ON agent_audit_log (ts DESC);
CREATE INDEX IF NOT EXISTS agent_audit_log_tool_ts_idx ON agent_audit_log (tool, ts);
CREATE INDEX IF NOT EXISTS agent_audit_log_txn_idx ON agent_audit_log (transaction_id);
