// server/mcp/tools/taxes.ts
import { registerTool } from "../registry";
import { runQueryTaxes } from "../../ai-ask-tools";

registerTool({
  name: "read_taxes",
  tier: "read",
  description: "Query tax records (procedure-level taxes). Supports filters by procedure, type, date range.",
  inputSchema: {
    type: "object",
    properties: {
      procedure_id: { type: "integer" },
      reference_contains: { type: "string" },
      tax_type: { type: "string" },
      date_from: { type: "string", description: "YYYY-MM-DD" },
      date_to: { type: "string", description: "YYYY-MM-DD" },
      list_limit: { type: "integer", minimum: 0, maximum: 500, default: 50 },
      group_by: { type: "string" },
    },
    additionalProperties: false,
  },
  handler: async (args) => ({ data: await runQueryTaxes(args) }),
});
