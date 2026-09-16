-- Tareks Reports: teste giden ürünlerin test raporları.
-- Tasarım: docs/superpowers/specs/2026-09-16-tareks-reports-design.md
-- Kolon şeklinin kaynağı: shared/schema.ts → tareksReports / tareksReportStyles.
-- Bir rapor 1..n style'a bağlanabilir (tareks_report_styles).
-- Idempotent; tekrar uygulanması güvenlidir.

CREATE TABLE IF NOT EXISTS tareks_reports (
  id                  SERIAL PRIMARY KEY,
  original_filename   TEXT NOT NULL,
  object_key          TEXT NOT NULL,
  file_size           INTEGER NOT NULL DEFAULT 0,
  file_type           TEXT NOT NULL DEFAULT 'application/pdf',
  procedure_reference TEXT REFERENCES procedures(reference) ON DELETE SET NULL ON UPDATE CASCADE,
  test_date           TEXT,
  notes               TEXT,
  uploaded_by         INTEGER REFERENCES users(id),
  created_at          TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tareks_report_styles (
  id         SERIAL PRIMARY KEY,
  report_id  INTEGER NOT NULL REFERENCES tareks_reports(id) ON DELETE CASCADE,
  style      TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT tareks_report_styles_report_style_key UNIQUE (report_id, style)
);

CREATE INDEX IF NOT EXISTS tareks_report_styles_style_idx ON tareks_report_styles (style);
CREATE INDEX IF NOT EXISTS tareks_report_styles_report_idx ON tareks_report_styles (report_id);
CREATE INDEX IF NOT EXISTS tareks_reports_procedure_idx ON tareks_reports (procedure_reference);
