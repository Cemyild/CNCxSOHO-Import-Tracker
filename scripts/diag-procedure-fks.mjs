// Reports current foreign-key state of child tables on procedure_reference.
// Read-only — does not modify anything.

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

const childTables = ['taxes', 'import_expenses', 'import_service_invoices'];

console.log('\n=== Mevcut FK constraints (procedures.reference\'a bağlı) ===');
const fk = await c.query(`
  SELECT
    tc.table_name AS child_table,
    kcu.column_name AS child_column,
    ccu.table_name AS parent_table,
    ccu.column_name AS parent_column,
    rc.delete_rule
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
  JOIN information_schema.constraint_column_usage ccu
    ON tc.constraint_name = ccu.constraint_name
  JOIN information_schema.referential_constraints rc
    ON tc.constraint_name = rc.constraint_name
  WHERE tc.constraint_type = 'FOREIGN KEY'
    AND ccu.table_name = 'procedures'
    AND ccu.column_name = 'reference'
  ORDER BY tc.table_name
`);
if (fk.rows.length === 0) {
  console.log('  (HİÇBİR FK YOK — child rows orphan kalabilir)');
} else {
  console.table(fk.rows);
}

console.log('\n=== Her child tabloda orphan satır sayısı ===');
for (const table of childTables) {
  const r = await c.query(`
    SELECT COUNT(*) AS orphan_count
    FROM ${table} t
    LEFT JOIN procedures p ON t.procedure_reference = p.reference
    WHERE p.reference IS NULL
  `);
  console.log(`  ${table}: ${r.rows[0].orphan_count} orphan`);
}

c.release();
await pool.end();
