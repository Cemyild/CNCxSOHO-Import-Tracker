import { db } from "../server/db";
import { importExpenses, expenseCategoryEnum } from "../shared/schema";
import { sql } from "drizzle-orm";

/**
 * This script updates the import_expenses table to add new fields and updates the expense_category enum.
 * It preserves existing data while migrating to the new schema.
 */
async function main() {
  console.log("Starting import expenses migration...");

  try {
    // 1. First check if the table exists
    const tableExists = await db.execute(sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'import_expenses'
      );
    `);

    console.log("Table exists check result:", tableExists);

    if (!tableExists.rows || !tableExists.rows[0] || !tableExists.rows[0].exists) {
      console.log("The import_expenses table doesn't exist yet. Creating table with new schema.");
      
      // Create the type first
      await db.execute(sql`
        CREATE TYPE expense_category AS ENUM (
          'export_registry_fee',
          'insurance',
          'awb_fee',
          'airport_storage_fee', 
          'bonded_warehouse_storage_fee',
          'transportation',
          'international_transportation',
          'tareks_fee',
          'customs_inspection',
          'azo_test',
          'other'
        );
      `);
      
      console.log("Expense category enum type created.");
      
      // Now create the table
      await db.execute(sql`
        CREATE TABLE import_expenses (
          id SERIAL PRIMARY KEY,
          procedure_reference TEXT NOT NULL,
          category expense_category NOT NULL,
          amount DECIMAL(10, 2) NOT NULL DEFAULT 0,
          currency TEXT DEFAULT 'USD',
          invoice_number TEXT,
          invoice_date TIMESTAMP,
          document_number TEXT,
          policy_number TEXT,
          issuer TEXT,
          notes TEXT,
          created_by INTEGER REFERENCES users(id),
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        );
      `);
      
      console.log("Import expenses table created successfully!");
      return;
    }

    // 2. Check if we already have the new columns
    const documentNumberColumnExists = await db.execute(sql`
      SELECT EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_name = 'import_expenses' AND column_name = 'document_number'
      );
    `);
    
    console.log("Column exists check result:", documentNumberColumnExists);

    // 3. Add new columns if they don't exist
    if (!documentNumberColumnExists.rows || !documentNumberColumnExists.rows[0] || !documentNumberColumnExists.rows[0].exists) {
      console.log("Adding new columns to import_expenses table...");
      
      await db.execute(sql`
        ALTER TABLE import_expenses 
        ADD COLUMN IF NOT EXISTS document_number TEXT,
        ADD COLUMN IF NOT EXISTS policy_number TEXT,
        ADD COLUMN IF NOT EXISTS issuer TEXT;
      `);
      
      console.log("New columns added successfully.");
    } else {
      console.log("New columns already exist. Skipping this step.");
    }

    // 4. Update the enum type with new values
    console.log("Updating expense_category enum type...");
    
    // First get the current enum values
    const currentEnumValues = await db.execute(sql`
      SELECT enum_range(NULL::expense_category);
    `);
    
    const currentValuesStr = currentEnumValues.rows[0].enum_range;
    console.log("Current enum values:", currentValuesStr);
    
    // Define the new enum values
    const newEnumValues = [
      'export_registry_fee',
      'insurance',
      'awb_fee',
      'airport_storage_fee', 
      'bonded_warehouse_storage_fee',
      'transportation',
      'international_transportation',
      'tareks_fee',
      'customs_inspection',
      'azo_test',
      'other'
    ];
    
    // Compare and see if we need to update
    const currentValuesArray = currentValuesStr
      .replace('{', '')
      .replace('}', '')
      .split(',');
    
    const needsUpdate = !newEnumValues.every(val => currentValuesArray.includes(val));
    
    if (needsUpdate) {
      console.log("Updating enum values...");
      
      // Create a temporary table to hold the data
      await db.execute(sql`
        CREATE TABLE temp_import_expenses AS SELECT * FROM import_expenses;
      `);
      
      // Drop the original table
      await db.execute(sql`DROP TABLE import_expenses;`);
      
      // Create a new type with the updated values
      await db.execute(sql`
        DROP TYPE IF EXISTS expense_category;
        CREATE TYPE expense_category AS ENUM (
          'export_registry_fee',
          'insurance',
          'awb_fee',
          'airport_storage_fee', 
          'bonded_warehouse_storage_fee',
          'transportation',
          'international_transportation',
          'tareks_fee',
          'customs_inspection',
          'azo_test',
          'other'
        );
      `);
      
      // Recreate the table with the new schema
      await db.execute(sql`
        CREATE TABLE import_expenses (
          id SERIAL PRIMARY KEY,
          procedure_reference TEXT NOT NULL,
          category expense_category NOT NULL,
          amount DECIMAL(10, 2) NOT NULL DEFAULT 0,
          currency TEXT DEFAULT 'USD',
          invoice_number TEXT,
          invoice_date TIMESTAMP,
          document_number TEXT,
          policy_number TEXT,
          issuer TEXT,
          notes TEXT,
          created_by INTEGER REFERENCES users(id),
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        );
      `);
      
      // Map old categories to new ones
      const categoryMapping = {
        'freight': 'international_transportation',
        'customs_clearance': 'customs_inspection',
        'warehouse': 'bonded_warehouse_storage_fee',
        'inland_transportation': 'transportation',
        'insurance': 'insurance',
        'inspection': 'customs_inspection',
        'certification': 'tareks_fee',
        'other': 'other'
      };
      
      // For each record in the temp table
      const oldRecords = await db.execute(sql`SELECT * FROM temp_import_expenses;`);
      
      for (const record of oldRecords.rows) {
        const oldCategory = record.category;
        const newCategory = categoryMapping[oldCategory] || 'other';
        
        console.log(`Migrating record: ${record.id} from category ${oldCategory} to ${newCategory}`);
        
        // Insert into the new table with the mapped category
        await db.execute(sql`
          INSERT INTO import_expenses (
            id, procedure_reference, category, amount, currency, 
            invoice_number, invoice_date, notes, created_by, created_at, updated_at
          ) VALUES (
            ${record.id}, ${record.procedure_reference}, ${newCategory}::expense_category, 
            ${record.amount}, ${record.currency || 'USD'}, 
            ${record.invoice_number}, ${record.invoice_date}, 
            ${record.notes}, ${record.created_by}, ${record.created_at}, ${record.updated_at}
          );
        `);
      }
      
      // Set the sequence to the next value
      await db.execute(sql`
        SELECT setval('import_expenses_id_seq', (SELECT MAX(id) FROM import_expenses) + 1);
      `);
      
      // Drop the temporary table
      await db.execute(sql`DROP TABLE temp_import_expenses;`);
      
      console.log("Enum values updated and data migrated successfully.");
    } else {
      console.log("Enum values are already up to date. Skipping this step.");
    }
    
    console.log("Import expenses migration completed successfully!");
  } catch (error) {
    console.error("Error during import expenses migration:", error);
    throw error;
  }
}

main()
  .then(() => {
    console.log("Migration completed.");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Migration failed:", error);
    process.exit(1);
  });