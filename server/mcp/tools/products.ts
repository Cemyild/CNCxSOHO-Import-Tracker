// server/mcp/tools/products.ts
import { registerTool } from "../registry";
import { runQueryProducts, runQueryHsCodes } from "../../ai-ask-tools";
import { db } from "../../db";
import { products as productsTable } from "@shared/schema";
import { eq } from "drizzle-orm";
import { McpToolError } from "../errors";

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

// ---------------------------------------------------------------------------
// Write tools (Phase 4.2)
// ---------------------------------------------------------------------------
//
// Schema notes (verified against shared/schema.ts):
//
//   products: ALL columns are nullable. `style` has a UNIQUE constraint.
//   There is no `created_by` column on this table, so no attribution needed.
//   Column names use snake_case JS identifiers (item_description,
//   fabric_content, country_of_origin, hts_code, tr_hs_code) — note that
//   `description` in the plan maps to `item_description` here.

registerTool({
  name: "write_create_product",
  tier: "write",
  description:
    "Create a new product. style is unique (the tool rejects duplicates). description maps to item_description on the table.",
  inputSchema: {
    type: "object",
    properties: {
      style: { type: "string" },
      brand: { type: "string" },
      description: { type: "string", description: "Stored as item_description" },
      category: { type: "string" },
      color: { type: "string" },
      fabric_content: { type: "string" },
      country_of_origin: { type: "string" },
      hts_code: { type: "string" },
      tr_hs_code: { type: "string" },
    },
    required: ["style"],
    additionalProperties: false,
  },
  handler: async (args: any) => {
    return await db.transaction(async (tx) => {
      // Reject obvious duplicates by unique `style`.
      if (args.style) {
        const existing = await tx
          .select({ id: productsTable.id })
          .from(productsTable)
          .where(eq(productsTable.style, args.style))
          .limit(1);
        if (existing.length) {
          throw new McpToolError(
            `Product with style "${args.style}" already exists (id=${existing[0].id})`,
          );
        }
      }
      const [created] = await tx
        .insert(productsTable)
        .values({
          style: args.style ?? null,
          brand: args.brand ?? null,
          item_description: args.description ?? null,
          category: args.category ?? null,
          color: args.color ?? null,
          fabric_content: args.fabric_content ?? null,
          country_of_origin: args.country_of_origin ?? null,
          hts_code: args.hts_code ?? null,
          tr_hs_code: args.tr_hs_code ?? null,
        })
        .returning();
      if (!created) throw new McpToolError("Insert returned no row");
      return {
        data: { product: created },
        meta: {
          affectedTable: "products",
          affectedIds: [created.id],
          summary: `Created product ${created.id} (style=${created.style})`,
        },
      };
    });
  },
});
