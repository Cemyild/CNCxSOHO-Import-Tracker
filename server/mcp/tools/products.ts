// server/mcp/tools/products.ts
import { registerTool } from "../registry";
import { runQueryProducts, runQueryHsCodes } from "../../ai-ask-tools";

registerTool({
  name: "read_products",
  tier: "read",
  description: "Search products by style/description/hts_code substring. Returns matched products with their HS code linkage.",
  inputSchema: {
    type: "object",
    properties: {
      style_contains: { type: "string" },
      description_contains: { type: "string" },
      hts_code_contains: { type: "string" },
      list_limit: { type: "integer", minimum: 0, maximum: 500, default: 50 },
    },
    additionalProperties: false,
  },
  handler: async (args: any) => {
    // Map MCP-facing names to the underlying runQueryProducts arg names.
    const mapped: any = {
      list_limit: args.list_limit,
      style_contains: args.style_contains,
    };
    if (args.description_contains) mapped.category_contains = args.description_contains;
    if (args.hts_code_contains) mapped.hts_code_prefix = args.hts_code_contains;
    return { data: await runQueryProducts(mapped) };
  },
});

registerTool({
  name: "read_hs_codes",
  tier: "read",
  description: "Search Turkish HS codes (customs tariff). Returns HS code, description, customs/VAT/KKDF rates.",
  inputSchema: {
    type: "object",
    properties: {
      code_contains: { type: "string" },
      description_contains: { type: "string" },
      list_limit: { type: "integer", minimum: 0, maximum: 500, default: 50 },
    },
    additionalProperties: false,
  },
  handler: async (args: any) => {
    // Map MCP-facing names to the underlying runQueryHsCodes arg names.
    const mapped: any = {
      list_limit: args.list_limit,
      description_contains: args.description_contains,
    };
    if (args.code_contains) mapped.tr_hs_code_prefix = args.code_contains;
    return { data: await runQueryHsCodes(mapped) };
  },
});
