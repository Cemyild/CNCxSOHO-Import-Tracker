-- Admin mail takibi. Tasarım: docs/superpowers/specs/2026-09-14-admin-email-inbox-design.md
-- Kolon şeklinin kaynağı: shared/schema.ts → emailAccounts / emailWatchedSenders /
-- emails / emailAttachments. Durum kolonları bilinçli olarak TEXT (enum değil):
-- mevcut tablolardaki enum'lar şema kaymasına yol açıyor.
-- Idempotent; tekrar uygulanması güvenlidir.

CREATE TABLE IF NOT EXISTS email_accounts (
  id               SERIAL PRIMARY KEY,
  user_id          INTEGER NOT NULL REFERENCES users(id),
  provider         TEXT NOT NULL DEFAULT 'gmail',
  email_address    TEXT NOT NULL,
  access_token     TEXT,
  refresh_token    TEXT,
  token_expires_at TIMESTAMP,
  last_synced_at   TIMESTAMP,
  status           TEXT NOT NULL DEFAULT 'connected',
  last_error       TEXT,
  created_at       TIMESTAMP DEFAULT NOW(),
  updated_at       TIMESTAMP DEFAULT NOW(),
  CONSTRAINT email_accounts_user_address_key UNIQUE (user_id, email_address)
);

CREATE TABLE IF NOT EXISTS email_watched_senders (
  id         SERIAL PRIMARY KEY,
  pattern    TEXT NOT NULL UNIQUE,
  label      TEXT,
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS emails (
  id                SERIAL PRIMARY KEY,
  account_id        INTEGER NOT NULL REFERENCES email_accounts(id),
  gmail_message_id  TEXT NOT NULL UNIQUE,
  gmail_thread_id   TEXT,
  from_address      TEXT,
  from_name         TEXT,
  to_address        TEXT,
  subject           TEXT,
  sent_at           TIMESTAMP,
  snippet           TEXT,
  body_text         TEXT,
  summary           TEXT,
  category          TEXT,
  urgency           TEXT,
  action_items      JSONB,
  extracted_refs    JSONB,
  procedure_id      INTEGER REFERENCES procedures(id),
  match_confidence  TEXT,
  match_reason      TEXT,
  status            TEXT NOT NULL DEFAULT 'new',
  ai_status         TEXT NOT NULL DEFAULT 'pending',
  ai_error          TEXT,
  ai_attempts       INTEGER NOT NULL DEFAULT 0,
  has_attachments   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMP DEFAULT NOW(),
  updated_at        TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS emails_sent_at_idx      ON emails (sent_at DESC);
CREATE INDEX IF NOT EXISTS emails_status_idx       ON emails (status);
CREATE INDEX IF NOT EXISTS emails_procedure_id_idx ON emails (procedure_id);
CREATE INDEX IF NOT EXISTS emails_ai_status_idx    ON emails (ai_status);

CREATE TABLE IF NOT EXISTS email_attachments (
  id                    SERIAL PRIMARY KEY,
  email_id              INTEGER NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
  gmail_attachment_id   TEXT NOT NULL,
  filename              TEXT,
  mime_type             TEXT,
  size_bytes            INTEGER,
  storage_path          TEXT,
  procedure_document_id INTEGER REFERENCES procedure_documents(id),
  status                TEXT NOT NULL DEFAULT 'pending',
  created_at            TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS email_attachments_email_id_idx ON email_attachments (email_id);
