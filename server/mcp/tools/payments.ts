// server/mcp/tools/payments.ts
import { registerTool } from "../registry";
import { runQueryPayments } from "../../ai-ask-tools";

registerTool({
  name: "read_payments",
  tier: "read",
  description: "Query outgoing payments and their distributions. Note: payments table has no currency column — currency lives on the parent procedure.",
  inputSchema: {
    type: "object",
    properties: {
      procedure_id: { type: "integer" },
      reference_contains: { type: "string" },
      type: { type: "string", description: "advance | balance" },
      status: { type: "string" },
      date_from: { type: "string", description: "YYYY-MM-DD" },
      date_to: { type: "string", description: "YYYY-MM-DD" },
      list_limit: { type: "integer", minimum: 0, maximum: 500, default: 50 },
      group_by: { type: "string" },
    },
    additionalProperties: false,
  },
  handler: async (args) => ({ data: await runQueryPayments(args) }),
});
