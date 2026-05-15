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

const r = await c.query(`
  SELECT e.*
  FROM import_expenses e
  LEFT JOIN procedures p ON e.procedure_reference = p.reference
  WHERE p.reference IS NULL
`);

console.log('Orphan import_expenses rows:');
console.log(JSON.stringify(r.rows, null, 2));

for (const row of r.rows) {
  const ref = row.procedure_reference;
  const similar = await c.query(`
    SELECT reference, shipper, invoice_no, import_dec_date
    FROM procedures
    WHERE reference ILIKE $1
    LIMIT 10
  `, [`%${ref}%`]);
  console.log(`\nBenzer procedures for "${ref}":`);
  if (similar.rows.length === 0) console.log('  (yok)');
  else console.table(similar.rows);
}

c.release();
await pool.end();
