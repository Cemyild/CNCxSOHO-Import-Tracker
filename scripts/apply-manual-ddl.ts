import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

// Required for Neon serverless with Drizzle
neonConfig.webSocketConstructor = ws;

/**
 * Applies every db/manual-ddl/*.sql file in sorted order.
 * Files must be idempotent (IF NOT EXISTS / duplicate_object guards).
 * Used by the deploy workflow (the VPS has no psql); each file is sent
 * as a single multi-statement query so dollar-quoted DO blocks work.
 */
async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('[ddl] DATABASE_URL not set, skipping');
    process.exitCode = 1;
    return;
  }

  const dir = join(process.cwd(), 'db', 'manual-ddl');
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    console.log('[ddl] no files in db/manual-ddl/, nothing to do');
    return;
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  let failed = 0;

  try {
    for (const file of files) {
      const sql = readFileSync(join(dir, file), 'utf8');
      try {
        await pool.query(sql);
        console.log(`[ddl] applied: ${file}`);
      } catch (error) {
        failed++;
        console.error(
          `[ddl] FAILED: ${file}:`,
          error instanceof Error ? error.message : error,
        );
      }
    }
  } finally {
    await pool.end();
  }

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
