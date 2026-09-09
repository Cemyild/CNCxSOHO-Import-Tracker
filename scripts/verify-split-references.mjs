/**
 * Read-only check of a split reference family.
 *
 *   node --env-file=.env scripts/verify-split-references.mjs CNCALO-108
 *
 * Prints the procedures sharing the root, the tax calculations linked to them,
 * and the row counts each reference carries across the tables that store it as
 * text. Writes nothing.
 */
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

neonConfig.webSocketConstructor = ws;

const root = process.argv[2];
if (!root) {
  console.error('Usage: node --env-file=.env scripts/verify-split-references.mjs <root reference>');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const procs = await pool.query(
  `SELECT id, reference FROM procedures WHERE reference LIKE $1 ORDER BY id`,
  [`${root}%`],
);
console.log(`Procedures matching "${root}":`);
for (const row of procs.rows) console.log(`  #${row.id} ${JSON.stringify(row.reference)}`);

const calcs = await pool.query(
  `SELECT id, reference, procedure_id FROM tax_calculations WHERE reference LIKE $1 ORDER BY id`,
  [`${root}%`],
);
console.log(`\nTax calculations matching "${root}":`);
for (const row of calcs.rows) {
  console.log(`  #${row.id} ${JSON.stringify(row.reference)} -> procedure ${row.procedure_id}`);
}

const TABLES = [
  'invoice_line_items',
  'invoice_line_items_config',
  'expense_documents',
  'payments',
  'payment_distributions',
  'procedure_status_details',
  'taxes',
  'import_expenses',
  'import_service_invoices',
];

console.log('\nRows per reference:');
for (const row of procs.rows) {
  const counts = [];
  for (const table of TABLES) {
    const r = await pool.query(
      `SELECT count(*)::int AS n FROM ${table} WHERE procedure_reference = $1`,
      [row.reference],
    );
    if (r.rows[0].n > 0) counts.push(`${table}=${r.rows[0].n}`);
  }
  console.log(`  ${JSON.stringify(row.reference)}: ${counts.join(', ') || 'no linked rows'}`);
}

await pool.end();
