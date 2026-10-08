-- Invoice Maker: kullanıcıların eklediği açılır menü seçenekleri.
--
-- Önceden her tarayıcının kendi localStorage'ında duruyordu; artık herkes
-- aynı listeyi görsün diye veritabanında. kind: goods | port | destination |
-- paymentTerm. Idempotent; tekrar uygulanması güvenlidir.

CREATE TABLE IF NOT EXISTS invoice_maker_options (
  id SERIAL PRIMARY KEY,
  kind TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT invoice_maker_options_kind_value_key UNIQUE (kind, value)
);
