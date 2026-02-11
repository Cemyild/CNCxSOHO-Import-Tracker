import { db } from '../server/db';
import { sql } from 'drizzle-orm';

/**
 * This script updates the expense_documents table to support import documents
 * and creates the import_document_type enum.
 */
async function main() {
  console.log('Adding support for import documents...');
  
  try {
    // First, check if the import_document_type enum exists
    const enumCheck = await db.execute(sql`
      SELECT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'import_document_type'
      );
    `);
    
    // Create the import_document_type enum if it doesn't exist
    if (!enumCheck[0].exists) {
      console.log('Creating import_document_type enum');
      await db.execute(sql`
        CREATE TYPE import_document_type AS ENUM (
          'tax_calculation_spreadsheet',
          'advance_taxletter',
          'invoice',
          'packing_list',
          'insurance',
          'awb',
          'import_declaration',
          'transit_declaration',
          'pod',
          'expense_receipt',
          'final_balance_letter'
        );
      `);
      console.log('Created import_document_type enum');
    } else {
      console.log('import_document_type enum already exists');
    }
    
    // Now update the expense_type enum to add 'import_document'
    console.log('Updating expense_type enum to add import_document');
    
    // Check if the value already exists in the enum
    const valueExistsCheck = await db.execute(sql`
      SELECT EXISTS (
        SELECT 1 FROM pg_enum e 
        JOIN pg_type t ON e.enumtypid = t.oid 
        WHERE t.typname = 'expense_type' AND e.enumlabel = 'import_document'
      );
    `);
    
    if (!valueExistsCheck[0].exists) {
      // Adding the new enum value
      await db.execute(sql`
        ALTER TYPE expense_type ADD VALUE 'import_document';
      `);
      console.log('Added import_document to expense_type enum');
    } else {
      console.log('import_document value already exists in expense_type enum');
    }
    
    // Now check if the importDocumentType column exists
    const columnCheck = await db.execute(sql`
      SELECT EXISTS (
        SELECT FROM information_schema.columns
        WHERE table_name = 'expense_documents'
        AND column_name = 'import_document_type'
      );
    `);
    
    if (!columnCheck[0].exists) {
      // Add the import_document_type column
      await db.execute(sql`
        ALTER TABLE expense_documents
        ADD COLUMN import_document_type import_document_type;
      `);
      console.log('Added import_document_type column to expense_documents table');
    } else {
      console.log('import_document_type column already exists');
    }
    
    console.log('Migration completed successfully');
  } catch (error) {
    console.error('Error during migration:', error);
    process.exit(1);
  }
}

main().then(() => {
  console.log('Import documents migration completed');
  process.exit(0);
}).catch(error => {
  console.error('Migration failed:', error);
  process.exit(1);
});