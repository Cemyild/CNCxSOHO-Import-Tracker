import { db } from "../server/db";
import { costDistributionMethodEnum, invoiceLineItems, invoiceLineItemsConfig } from "../shared/schema";
import { sql } from "drizzle-orm";

/**
 * This script creates the invoice_line_items and invoice_line_items_config tables
 * along with the cost_distribution_method enum
 */
async function main() {
  console.log("Starting migration for invoice line items...");

  try {
    // Create the cost_distribution_method enum if it doesn't exist
    await db.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'cost_distribution_method') THEN
          CREATE TYPE cost_distribution_method AS ENUM ('proportional', 'equal');
        END IF;
      END
      $$;
    `);
    console.log("✅ cost_distribution_method enum created or already exists");

    // Create invoice_line_items table
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS invoice_line_items (
        id SERIAL PRIMARY KEY,
        procedure_reference TEXT NOT NULL,
        style_no TEXT,
        description TEXT,
        quantity INTEGER NOT NULL,
        unit_price DECIMAL(10, 2) NOT NULL,
        total_price DECIMAL(10, 2) NOT NULL,
        final_cost DECIMAL(10, 2),
        final_cost_per_item DECIMAL(10, 2),
        cost_multiplier DECIMAL(10, 4),
        source TEXT DEFAULT 'manual',
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log("✅ invoice_line_items table created or already exists");

    // Create invoice_line_items_config table
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS invoice_line_items_config (
        id SERIAL PRIMARY KEY,
        procedure_reference TEXT NOT NULL UNIQUE,
        distribution_method cost_distribution_method DEFAULT 'proportional',
        is_visible BOOLEAN DEFAULT TRUE,
        updated_by INTEGER REFERENCES users(id),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log("✅ invoice_line_items_config table created or already exists");

    console.log("✅ Migration completed successfully!");
  } catch (error) {
    console.error("❌ Migration failed:", error);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

main();