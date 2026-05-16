// server/mcp/tools/expenses.ts
import { registerTool } from "../registry";
import { runQueryExpenses } from "../../ai-ask-tools";

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
