// server/mcp/tools/procedures.ts
import { registerTool } from "../registry";
import { runQueryProcedures } from "../../ai-ask-tools";
import { storage } from "../../storage";

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
