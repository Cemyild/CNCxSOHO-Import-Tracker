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

console.log('\n=== CNCAMIRI-18 /1 ve CNCAMIRI-18/2 için mevcut tax kayıtları ===');
const r = await c.query(`
  SELECT
    t.id,
    t.procedure_reference,
    t.customs_tax,
    t.additional_customs_tax,
    t.kkdf,
    t.vat,
    t.stamp_tax,
    (COALESCE(t.customs_tax,0) + COALESCE(t.additional_customs_tax,0) +
     COALESCE(t.kkdf,0) + COALESCE(t.vat,0) + COALESCE(t.stamp_tax,0)) AS total,
    t.created_at
  FROM taxes t
  WHERE t.procedure_reference IN ('CNCAMIRI-18 /1', 'CNCAMIRI-18/2', 'CNCAMIRI-18')
  ORDER BY t.procedure_reference, t.created_at
`);
console.table(r.rows);

console.log('\n=== Procedures detayı (her iki referansın import bilgileri) ===');
const p = await c.query(`
  SELECT reference, shipper, invoice_no, invoice_date, import_dec_number, import_dec_date, amount, currency
  FROM procedures
  WHERE reference IN ('CNCAMIRI-18 /1', 'CNCAMIRI-18/2')
  ORDER BY import_dec_date
`);
console.table(p.rows);

c.release();
await pool.end();
