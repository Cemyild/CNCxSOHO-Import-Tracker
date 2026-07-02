-- procedures.tareks_notes: free-text notes column for the Dashboard
-- "Tareks Application" section. Applied as one-off DDL because
-- `drizzle-kit push` is blocked by pre-existing schema drift (see 000_*).
-- Idempotent; safe to re-apply.
-- Source of truth for column shape: shared/schema.ts → procedures.

ALTER TABLE procedures ADD COLUMN IF NOT EXISTS tareks_notes TEXT;
