import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import { sql } from 'drizzle-orm';
import ws from 'ws';

// Required for Neon serverless
neonConfig.webSocketConstructor = ws;

/**
 * This script adds the 'freight_amount' column to the procedures table
 */
async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Please set it and try again.');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);

  console.log('Starting migration: Adding freight_amount column to procedures table');

  try {
    // Check if the column already exists
    const columnCheck = await db.execute(sql`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'procedures' AND column_name = 'freight_amount'
    `);

    if (columnCheck.rowCount === 0) {
      // Add the freight_amount column to procedures table
      await db.execute(sql`
        ALTER TABLE procedures
        ADD COLUMN freight_amount DECIMAL(15, 2) DEFAULT 0
      `);
      console.log('Successfully added freight_amount column to procedures table');
    } else {
      console.log('Column freight_amount already exists on procedures table');
    }

    console.log('Migration completed successfully');
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    await pool.end();
  }
}

main().catch(console.error);