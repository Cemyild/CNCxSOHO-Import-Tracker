// server/mcp/tools/destructive.ts
// Destructive operations. ALL default to dry_run:true. Even when actually
// executed, the registry's audit logger captures the full "before" state so
// the change can be reconstructed.
//
// Note: procedureStatusEnum is ['draft','pending','approved','rejected','completed'].
// 'closed' is NOT a valid value, so destructive_close_procedure sets status to
// 'completed' (the terminal state in the enum).
import { registerTool } from "../registry";
import { db } from "../../db";
import { storage } from "../../storage";
import {
  procedures as proceduresTable,
  importExpenses,
  importServiceInvoices,
  taxes as taxesTable,
  payments as paymentsTable,
  products as productsTable,
  taxCalculations as taxCalculationsTable,
} from "@shared/schema";
import { eq } from "drizzle-orm";
import { McpToolError } from "../errors";

// Whitelist of tables this tool may touch. Anything outside is rejected.
// Note: tax_calculation_items has FK to tax_calculations with ON DELETE
// CASCADE, so deleting a tax_calculations row also removes its line items
// — Workflow 2 (delete draft + recreate from real invoice) relies on this.
const TABLE_MAP: Record<string, { table: any; pkColumn: any; sqlName: string }> = {
  procedures:               { table: proceduresTable,       pkColumn: proceduresTable.id,       sqlName: "procedures" },
  import_expenses:          { table: importExpenses,        pkColumn: importExpenses.id,        sqlName: "import_expenses" },
  import_service_invoices:  { table: importServiceInvoices, pkColumn: importServiceInvoices.id, sqlName: "import_service_invoices" },
  taxes:                    { table: taxesTable,            pkColumn: taxesTable.id,            sqlName: "taxes" },
  payments:                 { table: paymentsTable,         pkColumn: paymentsTable.id,         sqlName: "payments" },
  products:                 { table: productsTable,         pkColumn: productsTable.id,         sqlName: "products" },
  tax_calculations:         { table: taxCalculationsTable,  pkColumn: taxCalculationsTable.id,  sqlName: "tax_calculations" },
};

registerTool({
  name: "destructive_delete_record",
  tier: "destructive",
  description: "Delete a single record by id from a whitelisted table. Default dry_run=true — preview what would be deleted without committing.",
  inputSchema: {
    type: "object",
    properties: {
      table: { type: "string", enum: Object.keys(TABLE_MAP) },
      id: { type: "integer" },
      dry_run: { type: "boolean", default: true },
    },
    required: ["table", "id"],
    additionalProperties: false,
  },
  handler: async (args: any) => {
    const def = TABLE_MAP[args.table];
    if (!def) throw new McpToolError(`Table not allowed: ${args.table}`);
    const dryRun = args.dry_run ?? true;

    // Procedures need a manual-cascade delete: documents, procedure_comments,
    // procedure_activities all have an integer FK to procedures.id WITHOUT
    // ON DELETE CASCADE in the schema, so a raw DELETE on procedures fails
    // with a foreign-key violation. storage.deleteProcedure() already does
    // the cascade (it's what the UI's DELETE /api/procedures/:id calls), so
    // we delegate to it for the actual delete.
    if (args.table === "procedures") {
      const [before] = await db.select().from(proceduresTable).where(eq(proceduresTable.id, args.id));
      if (!before) throw new McpToolError(`procedures id ${args.id} not found`);
      if (dryRun) {
        return {
          data: { would_delete: before, dry_run: true },
          meta: {
            affectedTable: def.sqlName,
            affectedIds: [args.id],
            before,
            status: "dry_run" as const,
            summary: `[dry_run] Would delete procedure ${args.id} (with cascading documents/comments/activities/tax_calculations/taxes/expenses/service_invoices/payments)`,
          },
        };
      }
      const ok = await storage.deleteProcedure(args.id);
      if (!ok) throw new McpToolError(`storage.deleteProcedure(${args.id}) returned false`);
      return {
        data: { deleted: before, dry_run: false },
        meta: {
          affectedTable: def.sqlName,
          affectedIds: [args.id],
          before,
          status: "ok" as const,
          summary: `Deleted procedure ${args.id} (manual cascade via storage.deleteProcedure)`,
        },
      };
    }

    return await db.transaction(async (tx) => {
      const [before] = await tx.select().from(def.table).where(eq(def.pkColumn, args.id));
      if (!before) throw new McpToolError(`${args.table} id ${args.id} not found`);
      if (dryRun) {
        return {
          data: { would_delete: before, dry_run: true },
          meta: {
            affectedTable: def.sqlName,
            affectedIds: [args.id],
            before,
            status: "dry_run" as const,
            summary: `[dry_run] Would delete ${def.sqlName} ${args.id}`,
          },
        };
      }
      await tx.delete(def.table).where(eq(def.pkColumn, args.id));
      return {
        data: { deleted: before, dry_run: false },
        meta: {
          affectedTable: def.sqlName,
          affectedIds: [args.id],
          before,
          status: "ok" as const,
          summary: `Deleted ${def.sqlName} ${args.id}`,
        },
      };
    });
  },
});

registerTool({
  name: "destructive_close_procedure",
  tier: "destructive",
  description: "Mark a procedure as completed (terminal status). Default dry_run=true. Note: this does not delete any data.",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "integer" },
      dry_run: { type: "boolean", default: true },
    },
    required: ["id"],
    additionalProperties: false,
  },
  handler: async (args: any) => {
    const dryRun = args.dry_run ?? true;
    return await db.transaction(async (tx) => {
      const [before] = await tx.select().from(proceduresTable).where(eq(proceduresTable.id, args.id));
      if (!before) throw new McpToolError(`Procedure ${args.id} not found`);
      if ((before as any).status === "completed") {
        return {
          data: { already_closed: true, procedure: before },
          meta: {
            affectedTable: "procedures",
            affectedIds: [args.id],
            status: "ok" as const,
            summary: `Procedure ${args.id} already completed`,
          },
        };
      }
      if (dryRun) {
        return {
          data: { would_close: before, dry_run: true },
          meta: {
            affectedTable: "procedures",
            affectedIds: [args.id],
            before,
            status: "dry_run" as const,
            summary: `[dry_run] Would mark procedure ${args.id} as completed`,
          },
        };
      }
      const [after] = await tx.update(proceduresTable).set({ status: "completed" as any }).where(eq(proceduresTable.id, args.id)).returning();
      return {
        data: { closed: after, dry_run: false },
        meta: {
          affectedTable: "procedures",
          affectedIds: [args.id],
          before,
          status: "ok" as const,
          summary: `Marked procedure ${args.id} as completed`,
        },
      };
    });
  },
});
