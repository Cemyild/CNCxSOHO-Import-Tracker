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

console.log('\n=== Orphan tax rows — full detail ===');
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
    t.created_at,
    t.updated_at
  FROM taxes t
  LEFT JOIN procedures p ON t.procedure_reference = p.reference
  WHERE p.reference IS NULL
  ORDER BY t.created_at DESC
`);
console.table(r.rows);

console.log('\n=== Bu reference\'lara benzer procedures var mı? (typo / case farkı kontrolü) ===');
for (const row of r.rows) {
  const ref = row.procedure_reference;
  const similar = await c.query(`
    SELECT reference, shipper, invoice_no, import_dec_date
    FROM procedures
    WHERE reference ILIKE $1 OR reference ILIKE $2
    LIMIT 10
  `, [`%${ref}%`, `%${ref.replace(/[^a-zA-Z0-9]/g, '%')}%`]);
  console.log(`\n  "${ref}" için benzer procedures:`);
  if (similar.rows.length === 0) {
    console.log('    (hiç eşleşme yok)');
  } else {
    console.table(similar.rows);
  }
}

c.release();
await pool.end();
