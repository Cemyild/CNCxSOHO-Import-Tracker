// server/mcp/tools/expenses.ts
import { registerTool } from "../registry";
import { runQueryExpenses } from "../../ai-ask-tools";
import { db } from "../../db";
import { importExpenses, importServiceInvoices } from "@shared/schema";
import { McpToolError } from "../errors";

registerTool({
  name: "read_expenses",
  tier: "read",
  description: "Query import expenses and service invoice expenses. Supports filters by category, issuer, date, procedure.",
  inputSchema: {
    type: "object",
    properties: {
      procedure_id: { type: "integer" },
      reference_contains: { type: "string" },
      category: { type: "string", description: "Expense category enum value" },
      issuer_contains: { type: "string", description: "Match issuer column (NOT notes)" },
      currency: { type: "string", description: "TL, USD, EUR..." },
      date_from: { type: "string", description: "YYYY-MM-DD" },
      date_to: { type: "string", description: "YYYY-MM-DD" },
      list_limit: { type: "integer", minimum: 0, maximum: 500, default: 50 },
      group_by: { type: "string", description: "category, issuer, currency, month" },
    },
    additionalProperties: false,
  },
  handler: async (args) => ({ data: await runQueryExpenses(args) }),
});

registerTool({
  name: "write_create_import_expense",
  tier: "write",
  description: "Create an import expense (transportation, AWB, customs, etc.). Returns the created row.",
  inputSchema: {
    type: "object",
    properties: {
      reference: { type: "string", description: "Linked procedure reference (required)" },
      category: { type: "string", description: "expense_category enum value" },
      issuer: { type: "string" },
      invoice_no: { type: "string" },
      invoice_date: { type: "string", description: "YYYY-MM-DD" },
      amount: { type: "string", description: "Decimal as string, e.g. '1234.50'" },
      currency: { type: "string", description: "TL, USD, EUR…" },
      notes: { type: "string" },
    },
    required: ["reference", "category", "amount"],
    additionalProperties: true,
  },
  handler: async (args: any) => {
    return await db.transaction(async (tx) => {
      const [created] = await tx.insert(importExpenses).values(args).returning();
      if (!created) throw new McpToolError("Insert returned no row");
      return {
        data: { expense: created },
        meta: { affectedTable: "import_expenses", affectedIds: [created.id], summary: `Created expense ${created.id}` },
      };
    });
  },
});

registerTool({
  name: "write_create_service_invoice",
  tier: "write",
  description: "Create a service invoice (e.g. customs broker fee). Returns the created row.",
  inputSchema: {
    type: "object",
    properties: {
      reference: { type: "string" },
      issuer: { type: "string" },
      invoice_no: { type: "string" },
      invoice_date: { type: "string" },
      amount: { type: "string" },
      currency: { type: "string" },
      notes: { type: "string" },
    },
    required: ["reference", "amount"],
    additionalProperties: true,
  },
  handler: async (args: any) => {
    return await db.transaction(async (tx) => {
      const [created] = await tx.insert(importServiceInvoices).values(args).returning();
      if (!created) throw new McpToolError("Insert returned no row");
      return {
        data: { invoice: created },
        meta: { affectedTable: "import_service_invoices", affectedIds: [created.id], summary: `Created service invoice ${created.id}` },
      };
    });
  },
});
