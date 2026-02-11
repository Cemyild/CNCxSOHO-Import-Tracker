import { db } from "../server/db";
import { sql } from "drizzle-orm";

/**
 * This script adds 'freight_invoice' to the import_document_type enum.
 */
async function main() {
  console.log('Adding freight_invoice to import_document_type enum...');
  
  try {
    // First, check if the import_document_type enum exists
    const enumCheck = await db.execute(sql`
      SELECT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'import_document_type'
      );
    `);
    
    // Log the result to debug
    console.log('Enum check result:', JSON.stringify(enumCheck));
    
    // From the log we can see the structure is: enumCheck.rows[0].exists
    const enumExists = enumCheck.rows && enumCheck.rows[0] && enumCheck.rows[0].exists;
    
    if (!enumExists) {
      console.error('import_document_type enum does not exist, please run migrate-import-documents.ts first');
      return;
    }
    
    // Check if the value already exists in the enum
    const valueExistsCheck = await db.execute(sql`
      SELECT EXISTS (
        SELECT 1 FROM pg_enum e 
        JOIN pg_type t ON e.enumtypid = t.oid
        WHERE t.typname = 'import_document_type' AND e.enumlabel = 'freight_invoice'
      );
    `);
    
    // Log the result to debug
    console.log('Value check result:', JSON.stringify(valueExistsCheck));
    
    // Using the same structure
    const valueExists = valueExistsCheck.rows && valueExistsCheck.rows[0] && valueExistsCheck.rows[0].exists;
    
    if (!valueExists) {
      // Adding the new enum value
      await db.execute(sql`
        ALTER TYPE import_document_type ADD VALUE 'freight_invoice';
      `);
      console.log('Added freight_invoice to import_document_type enum');
    } else {
      console.log('freight_invoice value already exists in import_document_type enum');
    }
    
    console.log('Migration completed successfully');
  } catch (error) {
    console.error('Error during migration:', error);
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });