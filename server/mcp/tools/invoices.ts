// server/mcp/tools/invoices.ts
import { registerTool } from "../registry";
import { storage } from "../../storage";

registerTool({
  name: "read_invoices",
  tier: "read",
  description: "List service invoices for a procedure or across procedures, with line items.",
  inputSchema: {
    type: "object",
    properties: {
      procedure_id: { type: "integer" },
      reference: { type: "string", description: "Exact procedure reference" },
      list_limit: { type: "integer", minimum: 0, maximum: 500, default: 50 },
    },
    additionalProperties: false,
  },
  handler: async (args: any) => {
    if (args.reference) {
      const invoices = await storage.getImportServiceInvoicesByReference(args.reference);
      return { data: { invoices: invoices.slice(0, args.list_limit ?? 50), count: invoices.length } };
    }
    const all = await storage.getAllImportServiceInvoices();
    return { data: { invoices: all.slice(0, args.list_limit ?? 50), count: all.length } };
  },
});
