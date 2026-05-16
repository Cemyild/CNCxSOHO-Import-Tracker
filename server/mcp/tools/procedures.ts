// server/mcp/tools/procedures.ts
import { registerTool } from "../registry";
import { runQueryProcedures } from "../../ai-ask-tools";
import { storage } from "../../storage";
import { db } from "../../db";
import { procedures as proceduresTable, users as usersTable } from "@shared/schema";
import { asc, eq } from "drizzle-orm";
import { McpToolError } from "../errors";

// procedures.created_by is NOT NULL → if caller didn't supply one (the typical
// MCP write path), fall back to MCP_AGENT_USER_ID, else the lowest existing user id.
let __cachedAgentUserId: number | null = null;
async function resolveAgentUserId(tx: typeof db): Promise<number> {
  if (__cachedAgentUserId != null) return __cachedAgentUserId;
  const envId = process.env.MCP_AGENT_USER_ID;
  if (envId && Number.isFinite(Number(envId))) {
    __cachedAgentUserId = Number(envId);
    return __cachedAgentUserId;
  }
  const [u] = await tx.select({ id: usersTable.id }).from(usersTable).orderBy(asc(usersTable.id)).limit(1);
  if (!u) throw new McpToolError("Cannot resolve a created_by user id (users table is empty)");
  __cachedAgentUserId = u.id;
  return __cachedAgentUserId;
}

registerTool({
  name: "read_procedures",
  tier: "read",
  description: "List import procedures with optional filters. Returns rows + totals_by_currency and counts.",
  inputSchema: {
    type: "object",
    properties: {
      company: { type: "string", description: "ALO, AMIRI, SOHO, or company name substring" },
      shipper_contains: { type: "string" },
      reference_contains: { type: "string" },
      arrival_date_from: { type: "string", description: "YYYY-MM-DD" },
      arrival_date_to: { type: "string", description: "YYYY-MM-DD" },
      invoice_date_from: { type: "string", description: "YYYY-MM-DD" },
      invoice_date_to: { type: "string", description: "YYYY-MM-DD" },
      list_limit: { type: "integer", minimum: 0, maximum: 500, default: 50 },
      group_by: { type: "string", description: "e.g. shipper, company, month" },
    },
    additionalProperties: false,
  },
  handler: async (args) => ({ data: await runQueryProcedures(args) }),
});

registerTool({
  name: "read_procedure_detail",
  tier: "read",
  description: "Fetch one procedure plus its linked tax, expenses, invoices, and payments.",
  inputSchema: {
    type: "object",
    properties: { id: { type: "integer" }, reference: { type: "string" } },
    additionalProperties: false,
  },
  handler: async (args: any) => {
    let proc;
    if (args.id) {
      proc = await storage.getProcedure(args.id);
    } else if (args.reference) {
      const arr = await storage.getProcedureByReference(args.reference);
      proc = arr[0];
    } else {
      throw new Error("read_procedure_detail requires either id or reference");
    }
    if (!proc) return { data: { procedure: null } };
    const [tax, expenses, invoices] = await Promise.all([
      storage.getTaxByProcedureReference(proc.reference),
      storage.getImportExpensesByReference(proc.reference),
      storage.getImportServiceInvoicesByReference(proc.reference),
    ]);
    return { data: { procedure: proc, tax: tax ?? null, expenses, serviceInvoices: invoices } };
  },
});

registerTool({
  name: "write_create_procedure",
  tier: "write",
  description: "Create a new import procedure. Returns the created row with assigned id.",
  inputSchema: {
    type: "object",
    properties: {
      reference: { type: "string", description: "Unique procedure reference (required)" },
      company: { type: "string" },
      shipper: { type: "string" },
      arrival_date: { type: "string", description: "YYYY-MM-DD" },
      invoice_date: { type: "string", description: "YYYY-MM-DD" },
      invoice_no: { type: "string" },
      origin_country: { type: "string" },
      notes: { type: "string" },
    },
    required: ["reference"],
    additionalProperties: true, // permissive: allow any column on procedures table
  },
  handler: async (args: any) => {
    return await db.transaction(async (tx) => {
      // Inject createdBy if missing (NOT NULL constraint on procedures.created_by).
      const values: any = { ...args };
      if (values.createdBy == null && values.created_by == null) {
        values.createdBy = await resolveAgentUserId(tx as any);
      }
      const [created] = await tx.insert(proceduresTable).values(values).returning();
      if (!created) throw new McpToolError("Insert returned no row");
      return {
        data: { procedure: created },
        meta: { affectedTable: "procedures", affectedIds: [created.id], summary: `Created procedure ${created.reference}` },
      };
    });
  },
});

registerTool({
  name: "write_update_procedure",
  tier: "write",
  description: "Patch fields on an existing procedure. Records 'before' state in audit log for reversibility.",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "integer" },
      patch: { type: "object", description: "Partial procedure fields to update", additionalProperties: true },
    },
    required: ["id", "patch"],
    additionalProperties: false,
  },
  handler: async (args: any) => {
    return await db.transaction(async (tx) => {
      const [before] = await tx.select().from(proceduresTable).where(eq(proceduresTable.id, args.id));
      if (!before) throw new McpToolError(`Procedure ${args.id} not found`);
      const [after] = await tx.update(proceduresTable).set(args.patch).where(eq(proceduresTable.id, args.id)).returning();
      return {
        data: { procedure: after },
        meta: {
          affectedTable: "procedures",
          affectedIds: [args.id],
          before,
          summary: `Updated procedure ${args.id}: ${Object.keys(args.patch).join(", ")}`,
        },
      };
    });
  },
});
