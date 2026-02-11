import { db } from '../server/db';
import { sql } from 'drizzle-orm';

/**
 * This script migrates the expense_documents table to add the object_key column
 * for cloud storage integration
 */
async function main() {
  console.log('Migrating expense_documents table for cloud storage...');
  
  try {
    // Check if the table exists
    const tableCheck = await db.execute(sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'expense_documents'
      );
    `);
    
    // Check the structure of the result
    console.log('Table check result:', JSON.stringify(tableCheck));
    
    if (!tableCheck[0] || !tableCheck[0].exists) {
      console.log('Table expense_documents does not exist, skipping migration');
      return;
    }
    
    // Check if the column already exists
    const columnCheck = await db.execute(sql`
      SELECT EXISTS (
        SELECT FROM information_schema.columns
        WHERE table_name = 'expense_documents'
        AND column_name = 'object_key'
      );
    `);
    
    console.log('Column check result:', JSON.stringify(columnCheck));
    
    if (columnCheck[0] && columnCheck[0].exists) {
      console.log('Column object_key already exists, skipping migration');
      return;
    }
    
    // Add the new column
    await db.execute(sql`
      ALTER TABLE expense_documents
      ADD COLUMN object_key TEXT;
    `);
    
    // Make storedFilename and filePath nullable for existing records
    await db.execute(sql`
      ALTER TABLE expense_documents
      ALTER COLUMN stored_filename DROP NOT NULL,
      ALTER COLUMN file_path DROP NOT NULL;
    `);
    
    console.log('Successfully migrated expense_documents table');
  } catch (error) {
    console.error('Error migrating expense_documents table:', error);
    process.exit(1);
  }
}

main().then(() => {
  console.log('Migration completed');
  process.exit(0);
}).catch(error => {
  console.error('Migration failed:', error);
  process.exit(1);
});