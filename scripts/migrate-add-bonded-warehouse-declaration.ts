import { db } from '../server/db';
import { sql } from 'drizzle-orm';

/**
 * This script adds 'bonded_warehouse_declaration' to the import_document_type enum.
 */
async function main() {
  console.log('Adding bonded_warehouse_declaration to import_document_type enum...');
  
  try {
    // First, check if the import_document_type enum exists
    const enumCheck = await db.execute(sql`
      SELECT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'import_document_type'
      );
    `);
    
    if (!enumCheck[0].exists) {
      console.error('import_document_type enum does not exist, please run migrate-import-documents.ts first');
      return;
    }
    
    // Check if the value already exists in the enum
    const valueExistsCheck = await db.execute(sql`
      SELECT EXISTS (
        SELECT 1 FROM pg_enum e 
        JOIN pg_type t ON e.enumtypid = t.oid
        WHERE t.typname = 'import_document_type' AND e.enumlabel = 'bonded_warehouse_declaration'
      );
    `);
    
    if (!valueExistsCheck[0].exists) {
      // Adding the new enum value
      await db.execute(sql`
        ALTER TYPE import_document_type ADD VALUE 'bonded_warehouse_declaration';
      `);
      console.log('Added bonded_warehouse_declaration to import_document_type enum');
    } else {
      console.log('bonded_warehouse_declaration value already exists in import_document_type enum');
    }
    
    console.log('Migration completed successfully');
  } catch (error) {
    console.error('Error during migration:', error);
    process.exit(1);
  }
}

main().catch(console.error).finally(() => {
  db.end();
  process.exit(0);
});