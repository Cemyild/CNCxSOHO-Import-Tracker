import { db } from "../server/db";
import { 
  users, procedures, procedureDocuments, procedureComments, 
  procedureActivities, taxCalculations, taxCalculationItems, procedures 
} from "@shared/schema";
import { eq } from "drizzle-orm";
import { storage } from "../server/storage";

async function verifyDeleteProcedure() {
  console.log("Starting verification for procedure deletion...");

  try {
    // 1. Create a dummy user (or get existing one)
    let user = await storage.getUserByUsername("verify_user");
    if (!user) {
      user = await storage.createUser({
        username: "verify_user",
        password: "password123",
        email: "verify@example.com",
        role: "admin"
      });
    }

    // 2. Create a dummy procedure
    const procedureData = {
      reference: "VERIFY-DELETE-" + Date.now(),
      shipper: "Test Shipper",
      createdBy: user.id,
      shipment_status: "created",
      payment_status: "closed",
      document_status: "closed"
    };
    
    // Manual insert to avoid type issues with storage.createProcedure if relevant
    const [proc] = await db.insert(procedures).values(procedureData).returning();
    console.log(`Created test procedure: ${proc.reference} (ID: ${proc.id})`);

    // 3. Add related records
    
    // Document
    await db.insert(procedureDocuments).values({
      name: "Test Doc",
      type: "invoice",
      path: "/tmp/test.pdf",
      uploadedBy: user.id,
      procedureId: proc.id
    });
    console.log("added document");

    // Comment
    await db.insert(procedureComments).values({
      content: "Test Comment",
      procedureId: proc.id,
      createdBy: user.id
    });
    console.log("added comment");

    // Activity
    await db.insert(procedureActivities).values({
      procedureId: proc.id,
      userId: user.id,
      action: "test_action",
      details: "Test Details"
    });
    console.log("added activity");
    
    // Tax Calculation
    const [calc] = await db.insert(taxCalculations).values({
      reference: proc.reference + "-TAX",
      procedure_id: proc.id
    }).returning();
    
    await db.insert(taxCalculationItems).values({
      tax_calculation_id: calc.id,
      line_number: 1,
      style: "Test Style",
      cost: "100",
      unit_count: 5,
      total_value: "500"
    });
    console.log("added tax calculation");

    // 4. Attempt to delete
    console.log("Attempting to delete procedure...");
    const success = await storage.deleteProcedure(proc.id);
    
    if (success) {
      console.log("Procedure deletion returned success.");
    } else {
      console.error("Procedure deletion returned failure.");
      process.exit(1);
    }

    // 5. Verify deletion
    const checkProc = await storage.getProcedure(proc.id);
    if (checkProc) {
      console.error("Procedure still exists!");
      process.exit(1);
    }
    console.log("Procedure deleted successfully.");

    // Check related records are gone
    const docs = await db.select().from(procedureDocuments).where(eq(procedureDocuments.procedureId, proc.id));
    if (docs.length > 0) console.error("Documents still exist!");

    const comments = await db.select().from(procedureComments).where(eq(procedureComments.procedureId, proc.id));
    if (comments.length > 0) console.error("Comments still exist!");

    console.log("Verification checks passed!");

  } catch (error) {
    console.error("Verification failed with error:", error);
    process.exit(1);
  } finally {
      process.exit(0);
  }
}

verifyDeleteProcedure();
