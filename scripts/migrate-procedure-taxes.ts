import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { procedures, taxes } from "../shared/schema";
import { eq } from "drizzle-orm";

// This script performs a one-time data migration to populate the taxes table
// with corresponding records for each procedure using the reference field.

async function main() {
  // Connect to the database
  const connectionString = process.env.DATABASE_URL || '';
  const client = postgres(connectionString);
  const db = drizzle(client);

  try {
    console.log("Starting tax migration...");
    
    // 1. Get all procedures from the database
    const allProcedures = await db.select({
      id: procedures.id,
      reference: procedures.reference,
      createdBy: procedures.createdBy
    }).from(procedures);
    
    console.log(`Found ${allProcedures.length} procedures to migrate`);
    
    // 2. Create tax records for each procedure
    let successCount = 0;
    let errorCount = 0;
    
    for (const procedure of allProcedures) {
      try {
        // Skip any procedures with null or empty references
        if (!procedure.reference) {
          console.log(`Skipping procedure ID ${procedure.id} with no reference`);
          continue;
        }
        
        // Check if a tax record already exists for this reference
        const existingTax = await db.select()
          .from(taxes)
          .where(eq(taxes.procedureReference, procedure.reference))
          .limit(1);
          
        if (existingTax.length > 0) {
          console.log(`Tax record already exists for reference ${procedure.reference}`);
          continue;
        }
        
        // Insert a new tax record with default values
        await db.insert(taxes).values({
          procedureReference: procedure.reference,
          customsTax: 0,
          additionalCustomsTax: 0,
          kkdf: 0,
          vat: 0,
          stampTax: 0,
          createdBy: procedure.createdBy,
          createdAt: new Date(),
          updatedAt: new Date()
        });
        
        successCount++;
        console.log(`Created tax record for procedure reference: ${procedure.reference}`);
      } catch (err) {
        errorCount++;
        console.error(`Error creating tax record for procedure ID ${procedure.id}:`, err);
      }
    }
    
    console.log(`Migration completed!`);
    console.log(`Successfully created ${successCount} tax records`);
    
    if (errorCount > 0) {
      console.log(`Failed to create ${errorCount} tax records (see error logs above)`);
    }
    
  } catch (error) {
    console.error("Migration failed:", error);
  } finally {
    // Close the database connection
    await client.end();
    console.log("Database connection closed");
  }
}

// Run the migration
main().catch(err => {
  console.error("Unhandled error in migration script:", err);
  process.exit(1);
});