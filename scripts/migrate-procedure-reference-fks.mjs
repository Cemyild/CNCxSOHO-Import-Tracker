// One-time migration:
//   1. Confirm procedures.reference has a UNIQUE constraint (FK target must be unique).
//   2. Remove a known orphan import_expenses row (id=380, ref="CNCALO-29") with backup.
//   3. Add ON DELETE CASCADE foreign keys from
//      - taxes.procedure_reference
//      - import_expenses.procedure_reference
//      - import_service_invoices.procedure_reference
//      → procedures.reference
//   4. Verify final state (0 orphans, 3 new FKs).

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

const childTables = [
  { table: 'taxes', constraintName: 'taxes_procedure_reference_fkey' },
  { table: 'import_expenses', constraintName: 'import_expenses_procedure_reference_fkey' },
  { table: 'import_service_invoices', constraintName: 'import_service_invoices_procedure_reference_fkey' },
];

try {
  // ─── Step 1: Verify procedures.reference is unique ──────────────────────
  console.log('\n=== Step 1: procedures.reference UNIQUE durumu ===');
  const uniqCheck = await c.query(`
    SELECT con.conname, con.contype
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = ANY(con.conkey)
    WHERE rel.relname = 'procedures'
      AND att.attname = 'reference'
      AND con.contype IN ('u', 'p')
  `);
  if (uniqCheck.rows.length === 0) {
    console.log('  procedures.reference üzerinde UNIQUE yok — ekleniyor...');
    // Doublecheck no duplicates before adding the constraint
    const dup = await c.query(`
      SELECT reference, COUNT(*) FROM procedures
      WHERE reference IS NOT NULL
      GROUP BY reference HAVING COUNT(*) > 1
    `);
    if (dup.rows.length > 0) {
      console.error('  HATA: reference duplicate var, UNIQUE eklenemez:', dup.rows);
      process.exit(1);
    }
    await c.query(`ALTER TABLE procedures ADD CONSTRAINT procedures_reference_key UNIQUE (reference)`);
    console.log('  ✓ procedures_reference_key UNIQUE eklendi');
  } else {
    console.log(`  ✓ Mevcut: ${uniqCheck.rows.map(r => r.conname).join(', ')}`);
  }

  // ─── Step 2: Backup + delete orphan import_expenses id=380 ──────────────
  console.log('\n=== Step 2: orphan import_expenses (id=380) temizleme ===');
  const targetExpenseId = 380;
  const expBackup = await c.query(`SELECT * FROM import_expenses WHERE id = $1`, [targetExpenseId]);
  if (expBackup.rows.length === 0) {
    console.log(`  Kayıt yok — zaten temizlenmiş olabilir, atlanıyor.`);
  } else {
    const backupFile = path.join(__dirname, `expenses-backup-${Date.now()}.json`);
    fs.writeFileSync(backupFile, JSON.stringify(expBackup.rows, null, 2), 'utf8');
    console.log(`  Yedek: ${backupFile}`);
    console.log(`  Silinecek:`, expBackup.rows[0]);

    await c.query('BEGIN');
    const del = await c.query(
      `DELETE FROM import_expenses WHERE id = $1 RETURNING id, procedure_reference, amount`,
      [targetExpenseId]
    );
    if (del.rows.length !== 1) {
      await c.query('ROLLBACK');
      console.error(`  HATA: silme başarısız, ROLLBACK`);
      process.exit(1);
    }
    await c.query('COMMIT');
    console.log(`  ✓ id=${targetExpenseId} silindi (${del.rows[0].amount} TRY)`);
  }

  // ─── Step 3: Re-check orphans across all child tables ───────────────────
  console.log('\n=== Step 3: tüm child tablolarda orphan sayımı ===');
  for (const { table } of childTables) {
    const r = await c.query(`
      SELECT COUNT(*) AS cnt
      FROM ${table} t
      LEFT JOIN procedures p ON t.procedure_reference = p.reference
      WHERE p.reference IS NULL
    `);
    const cnt = parseInt(r.rows[0].cnt, 10);
    console.log(`  ${table}: ${cnt} orphan`);
    if (cnt > 0) {
      console.error(`  HATA: ${table} hala ${cnt} orphan içeriyor — FK eklenemez. Önce temizlik gerekli.`);
      process.exit(1);
    }
  }

  // ─── Step 4: Add FK constraints (ON DELETE CASCADE) ─────────────────────
  console.log('\n=== Step 4: FK constraint ekleme ===');
  for (const { table, constraintName } of childTables) {
    // Skip if FK already exists
    const exists = await c.query(`
      SELECT 1 FROM pg_constraint WHERE conname = $1
    `, [constraintName]);
    if (exists.rows.length > 0) {
      console.log(`  ${table}: ${constraintName} zaten var, atlanıyor`);
      continue;
    }
    await c.query(`
      ALTER TABLE ${table}
      ADD CONSTRAINT ${constraintName}
      FOREIGN KEY (procedure_reference)
      REFERENCES procedures(reference)
      ON DELETE CASCADE
      ON UPDATE CASCADE
    `);
    console.log(`  ✓ ${table}: ${constraintName} eklendi (ON DELETE/UPDATE CASCADE)`);
  }

  // ─── Step 5: Final verification ─────────────────────────────────────────
  console.log('\n=== Step 5: Doğrulama ===');
  const finalFks = await c.query(`
    SELECT
      tc.table_name AS child_table,
      kcu.column_name AS child_column,
      ccu.table_name AS parent_table,
      ccu.column_name AS parent_column,
      rc.delete_rule,
      rc.update_rule
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
  console.log('  Procedures.reference FK\'ları:');
  console.table(finalFks.rows);

  console.log('\n✅ Migration tamamlandı.');
} finally {
  c.release();
  await pool.end();
}
