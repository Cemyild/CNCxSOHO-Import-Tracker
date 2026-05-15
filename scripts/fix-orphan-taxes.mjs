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

const TARGET_IDS = [93, 111];

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const c = await pool.connect();

try {
  console.log('\n=== BACKUP (silinmeden önce kayıtların tam hali) ===');
  const backup = await c.query(`SELECT * FROM taxes WHERE id = ANY($1::int[])`, [TARGET_IDS]);
  console.log(JSON.stringify(backup.rows, null, 2));

  if (backup.rows.length !== TARGET_IDS.length) {
    console.error(`HATA: Beklenen ${TARGET_IDS.length} kayıt yerine ${backup.rows.length} bulundu. Silme iptal.`);
    process.exit(1);
  }

  // Yedek dosyaya da yaz
  const backupFile = path.join(__dirname, `taxes-backup-${Date.now()}.json`);
  fs.writeFileSync(backupFile, JSON.stringify(backup.rows, null, 2), 'utf8');
  console.log(`\n  Yedek dosya: ${backupFile}`);

  console.log('\n=== TRANSACTION BAŞLIYOR ===');
  await c.query('BEGIN');

  const del = await c.query(
    `DELETE FROM taxes WHERE id = ANY($1::int[]) RETURNING id, procedure_reference`,
    [TARGET_IDS]
  );
  console.log(`  Silinen kayıtlar:`);
  console.table(del.rows);

  if (del.rows.length !== TARGET_IDS.length) {
    await c.query('ROLLBACK');
    console.error(`HATA: ${del.rows.length} kayıt silindi, beklenen ${TARGET_IDS.length}. ROLLBACK yapıldı.`);
    process.exit(1);
  }

  await c.query('COMMIT');
  console.log('  ✓ COMMIT tamam.');

  console.log('\n=== DOĞRULAMA ===');

  const remainingOrphans = await c.query(`
    SELECT COUNT(*) AS cnt
    FROM taxes t
    LEFT JOIN procedures p ON t.procedure_reference = p.reference
    WHERE p.reference IS NULL
  `);
  console.log(`  Kalan orphan kayıt sayısı: ${remainingOrphans.rows[0].cnt}`);

  const newTotal = await c.query(`
    SELECT
      COUNT(*) AS row_count,
      SUM(COALESCE(t.customs_tax,0) + COALESCE(t.additional_customs_tax,0) +
          COALESCE(t.kkdf,0) + COALESCE(t.vat,0) + COALESCE(t.stamp_tax,0)) AS total
    FROM taxes t
    INNER JOIN procedures p ON t.procedure_reference = p.reference
  `);
  console.log(`  Yeni Dashboard toplam (INNER JOIN procedures):`);
  console.table(newTotal.rows);

  const taxAnalyticsTotal = await c.query(`
    WITH procs AS (SELECT reference FROM procedures WHERE import_dec_date IS NOT NULL)
    SELECT
      COUNT(*) AS row_count,
      SUM(COALESCE(t.customs_tax,0) + COALESCE(t.additional_customs_tax,0) +
          COALESCE(t.kkdf,0) + COALESCE(t.vat,0) + COALESCE(t.stamp_tax,0)) AS total
    FROM taxes t
    WHERE t.procedure_reference IN (SELECT reference FROM procs)
  `);
  console.log(`  Tax Analytics toplam:`);
  console.table(taxAnalyticsTotal.rows);
} finally {
  c.release();
  await pool.end();
}
