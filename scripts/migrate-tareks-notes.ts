import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import { sql } from 'drizzle-orm';
import * as schema from '../shared/schema';
import ws from 'ws';

// Required for Neon serverless with Drizzle
neonConfig.webSocketConstructor = ws;

/**
 * This script adds the 'tareks_notes' column to the procedures table
 * (free-text notes for the Dashboard Tareks Application section).
 * Same DDL also lives in db/manual-ddl/001_procedures_tareks_notes.sql
 * and is applied automatically on deploy.
 */
async function main() {
  const client = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  const db = drizzle({ client }, { schema });

  try {
    console.log("Starting migration: Add tareks_notes column to procedures table...");

    await db.execute(sql`
      ALTER TABLE procedures
      ADD COLUMN IF NOT EXISTS tareks_notes TEXT
    `);

    console.log("Migration completed successfully! Added tareks_notes column to procedures table.");

  } catch (error) {
    console.error("Migration failed:", error);
    process.exitCode = 1;
  } finally {
    await client.end();
    console.log("Database connection closed");
  }
}

main().catch(console.error);
