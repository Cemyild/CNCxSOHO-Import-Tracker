// server/mcp/tools/invoices.ts
import { registerTool } from "../registry";
import { storage } from "../../storage";
import { db } from "../../db";
import {
  importServiceInvoices,
  invoiceLineItems,
  procedures as proceduresTable,
} from "@shared/schema";
import { eq } from "drizzle-orm";
import { McpToolError } from "../errors";
import { resolveAgentUserId } from "../audit-attribution";

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

// ---------------------------------------------------------------------------
// Write tools (Phase 4.2)
// ---------------------------------------------------------------------------
//
// Schema notes (verified against shared/schema.ts):
//
//   importServiceInvoices (NOT NULL columns):
//     procedureReference (FK procedures.reference, CASCADE),
//     amount (decimal),
//     currency (text, default 'USD'),
//     invoiceNumber (text),
//     date (text).
//     The plan's `issuer` field is not a column on this table — drizzle would
//     silently drop it, so we do not advertise it. notes/createdBy are
//     nullable but we attribute createdBy for the audit trail.
//
//   invoiceLineItems (NOT NULL columns):
//     procedureReference (FK procedures.reference),
//     quantity (integer),
//     unitPrice (decimal),
//     totalPrice (decimal).
//     IMPORTANT: there is no `invoiceId` column on this table — line items
//     attach to a procedure (by reference), not to a specific invoice row.
//     The plan's payload (description, quantity, unit_price, total) maps to
//     (description, quantity, unitPrice, totalPrice). styleNo, finalCost,
//     finalCostPerItem, costMultiplier are optional.

registerTool({
  name: "write_create_invoice_with_line_items",
  tier: "write",
  description:
    "Create a service invoice plus its line items atomically. Note: invoice_line_items attach to a procedure by procedure_reference (no per-invoice FK exists), so all line items inherit the invoice's procedure_reference. Quantity is integer; unit_price/total_price are decimal strings.",
  inputSchema: {
    type: "object",
    properties: {
      invoice: {
        type: "object",
        properties: {
          procedure_reference: { type: "string", description: "FK → procedures.reference" },
          amount: { type: "string", description: "Decimal as string" },
          currency: { type: "string", description: "Defaults to 'USD' if omitted" },
          invoice_number: { type: "string" },
          date: { type: "string", description: "YYYY-MM-DD or free-form text" },
          notes: { type: "string" },
        },
        required: ["procedure_reference", "amount", "invoice_number", "date"],
        additionalProperties: false,
      },
      line_items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            style_no: { type: "string" },
            description: { type: "string" },
            quantity: { type: "integer", minimum: 1 },
            unit_price: { type: "string", description: "Decimal as string" },
            total_price: { type: "string", description: "Decimal as string" },
            final_cost: { type: "string" },
            final_cost_per_item: { type: "string" },
            cost_multiplier: { type: "string" },
            sort_order: { type: "integer" },
            source: { type: "string", description: "manual | excel | csv | pdf" },
          },
          required: ["quantity", "unit_price", "total_price"],
          additionalProperties: false,
        },
      },
    },
    required: ["invoice", "line_items"],
    additionalProperties: false,
  },
  handler: async (args: any) => {
    return await db.transaction(async (tx) => {
      const invIn = args.invoice;
      // Verify the procedure exists so the FK violation is wrapped in a clear error.
      const [proc] = await tx
        .select({ id: proceduresTable.id })
        .from(proceduresTable)
        .where(eq(proceduresTable.reference, invIn.procedure_reference));
      if (!proc) {
        throw new McpToolError(
          `Procedure with reference "${invIn.procedure_reference}" does not exist`,
        );
      }

      const createdBy = await resolveAgentUserId(tx as any);
      const [inv] = await tx
        .insert(importServiceInvoices)
        .values({
          procedureReference: invIn.procedure_reference,
          amount: invIn.amount,
          currency: invIn.currency ?? "USD",
          invoiceNumber: invIn.invoice_number,
          date: invIn.date,
          notes: invIn.notes ?? null,
          createdBy,
        })
        .returning();
      if (!inv) throw new McpToolError("Invoice insert returned no row");

      const items = args.line_items.length
        ? await tx
            .insert(invoiceLineItems)
            .values(
              args.line_items.map((li: any) => ({
                procedureReference: invIn.procedure_reference,
                styleNo: li.style_no ?? null,
                description: li.description ?? null,
                quantity: li.quantity,
                unitPrice: li.unit_price,
                totalPrice: li.total_price,
                finalCost: li.final_cost ?? null,
                finalCostPerItem: li.final_cost_per_item ?? null,
                costMultiplier: li.cost_multiplier ?? null,
                sortOrder: li.sort_order ?? null,
                source: li.source ?? "manual",
                createdBy,
              })),
            )
            .returning()
        : [];

      return {
        data: { invoice: inv, line_items: items },
        meta: {
          affectedTable: "import_service_invoices",
          affectedIds: [inv.id],
          summary: `Created invoice ${inv.id} (${inv.invoiceNumber}) on procedure ${invIn.procedure_reference} with ${items.length} line items`,
        },
      };
    });
  },
});
