-- payment_offsets: künye tablosu. Bir prosedürdeki fazla ödemenin başka bir
-- prosedürün borcuna aktarılmasını kaydeder. Paranın kendisi
-- payment_distributions tablosunda bir çift satır olarak durur (kaynakta eksi,
-- hedefte artı, ikisi de aynı incoming_payment_id'ye bağlı); offset_id bu iki
-- satırı künyeye bağlar.
-- Applied as one-off DDL because `drizzle-kit push` is blocked by
-- pre-existing schema drift (see 000_*). Idempotent; safe to re-apply.
-- Source of truth for column shape: shared/schema.ts → paymentOffsets.

CREATE TABLE IF NOT EXISTS payment_offsets (
  id             SERIAL PRIMARY KEY,
  batch_id       TEXT NOT NULL,
  from_reference TEXT NOT NULL,
  to_reference   TEXT NOT NULL,
  amount         NUMERIC(15, 2) NOT NULL,
  offset_date    TIMESTAMP NOT NULL DEFAULT NOW(),
  mode           TEXT NOT NULL,
  notes          TEXT,
  created_by     INTEGER REFERENCES users(id),
  created_at     TIMESTAMP DEFAULT NOW(),
  reversed_at    TIMESTAMP,
  reversed_by    INTEGER REFERENCES users(id)
);

ALTER TABLE payment_distributions
  ADD COLUMN IF NOT EXISTS offset_id INTEGER REFERENCES payment_offsets(id);

CREATE INDEX IF NOT EXISTS idx_payment_offsets_batch
  ON payment_offsets (batch_id);
CREATE INDEX IF NOT EXISTS idx_payment_offsets_from
  ON payment_offsets (from_reference);
CREATE INDEX IF NOT EXISTS idx_payment_offsets_to
  ON payment_offsets (to_reference);
CREATE INDEX IF NOT EXISTS idx_payment_distributions_offset
  ON payment_distributions (offset_id);
