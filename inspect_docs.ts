
import { db } from "./server/db";
import { expenseDocuments } from "@shared/schema";
import { sql } from "drizzle-orm";

async function main() {
  try {
    const result = await db.select().from(expenseDocuments).limit(5);
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

main();
