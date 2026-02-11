import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import { sql } from 'drizzle-orm';
import * as schema from '../shared/schema';
import ws from 'ws';

// Required for Neon serverless with Drizzle
neonConfig.webSocketConstructor = ws;

/**
 * This script adds the 'usdtl_rate' column to the procedures table
 */
async function main() {
  // Connect to database
  const client = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  const db = drizzle({ client }, { schema });

  try {
    console.log("Starting migration: Add USD/TL rate field to procedures table...");
    
    // Create a new column for usdtl_rate
    await db.execute(sql`
      ALTER TABLE procedures 
      ADD COLUMN IF NOT EXISTS usdtl_rate DECIMAL(10, 4)
    `);
    
    console.log("Migration completed successfully! Added usdtl_rate column to procedures table.");
    
  } catch (error) {
    console.error("Migration failed:", error);
  } finally {
    // Close the database connection
    await client.end();
    console.log("Database connection closed");
  }
}

// Execute the migration
main().catch(console.error);