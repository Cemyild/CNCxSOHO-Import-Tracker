-- procedures.customs_file_no: the broker's own file number ("26-09933"),
-- carried in the DOSYA NO column of the monthly import report. Populated by
-- the Excel enrichment flow and used as a cross-reference when corresponding
-- with the broker.
-- Applied as one-off DDL because `drizzle-kit push` is blocked by
-- pre-existing schema drift (see 000_*). Idempotent; safe to re-apply.
-- Source of truth for column shape: shared/schema.ts → procedures.

ALTER TABLE procedures ADD COLUMN IF NOT EXISTS customs_file_no TEXT;
