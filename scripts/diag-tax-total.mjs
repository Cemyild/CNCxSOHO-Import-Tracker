import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

if (!process.env.DATABASE_URL) {
  const envPath = path.join(__dirname, '..', '.env');
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach((line) => {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  });
}

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const c = await pool.connect();

console.log('\n=== A. Dashboard SQL eski (no JOIN) ===');
const a = await c.query(`
  SELECT
    COUNT(*) AS row_count,
    SUM(COALESCE(customs_tax,0) + COALESCE(additional_customs_tax,0) +
        COALESCE(kkdf,0) + COALESCE(vat,0) + COALESCE(stamp_tax,0)) AS total
  FROM taxes
`);
console.table(a.rows);

console.log('\n=== B. Dashboard SQL yeni (INNER JOIN procedures) ===');
const b = await c.query(`
  SELECT
    COUNT(*) AS row_count,
    SUM(COALESCE(t.customs_tax,0) + COALESCE(t.additional_customs_tax,0) +
        COALESCE(t.kkdf,0) + COALESCE(t.vat,0) + COALESCE(t.stamp_tax,0)) AS total
  FROM taxes t
  INNER JOIN procedures p ON t.procedure_reference = p.reference
`);
console.table(b.rows);

console.log('\n=== C. Tax Analytics SQL (procedure_reference IN procs with import_dec_date NOT NULL) ===');
const cc = await c.query(`
  WITH procs AS (
    SELECT reference FROM procedures WHERE import_dec_date IS NOT NULL
  )
  SELECT
    COUNT(*) AS row_count,
    SUM(COALESCE(t.customs_tax,0) + COALESCE(t.additional_customs_tax,0) +
        COALESCE(t.kkdf,0) + COALESCE(t.vat,0) + COALESCE(t.stamp_tax,0)) AS total
  FROM taxes t
  WHERE t.procedure_reference IN (SELECT reference FROM procs)
`);
console.table(cc.rows);

console.log('\n=== D. Orphan tax rows (taxes ile eşleşmeyen procedure) ===');
const d = await c.query(`
  SELECT
    COUNT(*) AS orphan_row_count,
    SUM(COALESCE(t.customs_tax,0) + COALESCE(t.additional_customs_tax,0) +
        COALESCE(t.kkdf,0) + COALESCE(t.vat,0) + COALESCE(t.stamp_tax,0)) AS orphan_total
  FROM taxes t
  LEFT JOIN procedures p ON t.procedure_reference = p.reference
  WHERE p.reference IS NULL
`);
console.table(d.rows);

console.log('\n=== E. import_dec_date NULL olan procedure\'ların tax toplamı ===');
const e = await c.query(`
  SELECT
    COUNT(*) AS null_date_proc_tax_rows,
    SUM(COALESCE(t.customs_tax,0) + COALESCE(t.additional_customs_tax,0) +
        COALESCE(t.kkdf,0) + COALESCE(t.vat,0) + COALESCE(t.stamp_tax,0)) AS null_date_total
  FROM taxes t
  INNER JOIN procedures p ON t.procedure_reference = p.reference
  WHERE p.import_dec_date IS NULL
`);
console.table(e.rows);

console.log('\n=== F. Taxes tablosunda procedure_reference duplicate var mı? ===');
const f = await c.query(`
  SELECT procedure_reference, COUNT(*) AS cnt
  FROM taxes
  GROUP BY procedure_reference
  HAVING COUNT(*) > 1
  LIMIT 20
`);
if (f.rows.length === 0) {
  console.log('  Duplicate yok.');
} else {
  console.table(f.rows);
}

console.log('\n=== G. Procedures tablosunda reference duplicate var mı? ===');
const g = await c.query(`
  SELECT reference, COUNT(*) AS cnt
  FROM procedures
  GROUP BY reference
  HAVING COUNT(*) > 1
  LIMIT 20
`);
if (g.rows.length === 0) {
  console.log('  Duplicate yok.');
} else {
  console.table(g.rows);
}

console.log('\n=== H. Tax kayıt sayısı vs procedure sayısı ===');
const h = await c.query(`
  SELECT
    (SELECT COUNT(*) FROM taxes) AS tax_rows,
    (SELECT COUNT(*) FROM procedures) AS procedure_rows,
    (SELECT COUNT(*) FROM procedures WHERE import_dec_date IS NOT NULL) AS proc_with_date,
    (SELECT COUNT(*) FROM procedures WHERE import_dec_date IS NULL) AS proc_without_date
`);
console.table(h.rows);

c.release();
await pool.end();
