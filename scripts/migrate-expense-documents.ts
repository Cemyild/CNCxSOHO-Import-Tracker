import { db } from '../server/db';
import { expenseDocuments } from '../shared/schema';
import { sql } from 'drizzle-orm';

/**
 * This script creates the expense_documents table
 */
async function main() {
  console.log('Creating expense_documents table...');
  
  try {
    // First check if the table already exists
    const tables = await db.execute(sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name = 'expense_documents'
    `);
    
    if (tables.length > 0) {
      console.log('Table expense_documents already exists, skipping creation');
      return;
    }

    // Create the expense_type enum if it doesn't exist
    try {
      await db.execute(sql`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'expense_type') THEN
            CREATE TYPE expense_type AS ENUM ('tax', 'import_expense', 'service_invoice');
          END IF;
        END
        $$;
      `);
      console.log('Created or verified expense_type enum');
    } catch (error) {
      console.error('Error creating expense_type enum:', error);
      throw error;
    }

    // Create the expense_documents table
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS expense_documents (
        id SERIAL PRIMARY KEY,
        expense_type expense_type NOT NULL,
        expense_id INTEGER NOT NULL,
        original_filename TEXT NOT NULL,
        stored_filename TEXT NOT NULL,
        file_path TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        file_type TEXT NOT NULL,
        uploaded_by INTEGER REFERENCES users(id),
        procedure_reference TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    console.log('Successfully created expense_documents table');
  } catch (error) {
    console.error('Error creating expense_documents table:', error);
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