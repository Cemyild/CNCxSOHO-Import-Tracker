import { db } from "../server/db";
import { invoiceLineItems } from "../shared/schema";
import { sql, eq } from "drizzle-orm";

/**
 * This script adds the 'sort_order' column to the invoice_line_items table
 * and populates it based on the createdAt timestamp for existing records
 */
async function main() {
  console.log("Starting migration to add sort_order to invoice line items...");

  try {
    // First, check if the column already exists
    const columnExists = await db.execute(sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'invoice_line_items' AND column_name = 'sort_order';
    `);

    if (columnExists.rows.length === 0) {
      // Add the sort_order column if it doesn't exist
      console.log("Adding sort_order column to invoice_line_items table...");
      await db.execute(sql`
        ALTER TABLE invoice_line_items
        ADD COLUMN sort_order INTEGER;
      `);
      console.log("✅ sort_order column added successfully");
    } else {
      console.log("✅ sort_order column already exists");
    }

    // Get all procedures with line items
    const procedures = await db.execute(sql`
      SELECT DISTINCT procedure_reference
      FROM invoice_line_items;
    `);

    console.log(`Found ${procedures.rows.length} procedures with line items`);

    // Update sort_order for each procedure's line items
    for (const row of procedures.rows) {
      const reference = row.procedure_reference;
      console.log(`Processing procedure: ${reference}`);
      
      // Get all line items for this procedure ordered by creation date
      const lineItems = await db.select()
        .from(invoiceLineItems)
        .where(eq(invoiceLineItems.procedureReference, reference))
        .orderBy(invoiceLineItems.createdAt);
      
      // Update each item with a sequential sort order
      for (let i = 0; i < lineItems.length; i++) {
        await db.update(invoiceLineItems)
          .set({ sortOrder: i })
          .where(eq(invoiceLineItems.id, lineItems[i].id));
      }
      
      console.log(`✅ Updated ${lineItems.length} line items for procedure ${reference}`);
    }

    console.log("Migration completed successfully!");
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

main();