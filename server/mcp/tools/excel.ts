// server/mcp/tools/excel.ts
// Bulk Excel import. Uses `xlsx` (already in package.json deps, line ~100) for
// minimal parsing. Header row 1 must use the Drizzle camelCase column names of
// the target table (e.g. procedureReference, invoiceNumber, amount).
//
// Schema notes (verified against shared/schema.ts):
//
//   importExpenses (NOT NULL): procedureReference, category, amount.
//     Optional: currency (default USD), invoiceNumber, invoiceDate,
//     documentNumber, policyNumber, issuer, notes.
//
//   importServiceInvoices (NOT NULL): procedureReference, amount, currency
//     (default USD), invoiceNumber, date. Optional: notes.
//
// Drizzle will silently drop unknown keys and surface NOT NULL violations as
// pg errors — we let those bubble up to the MCP error path verbatim so the
// caller can adjust their xlsx headers.
import { registerTool } from "../registry";
import { McpToolError } from "../errors";
import { db } from "../../db";
import { importExpenses, importServiceInvoices } from "@shared/schema";
import { resolveAgentUserId } from "../audit-attribution";
import * as XLSX from "xlsx";

registerTool({
  name: "write_import_excel",
  tier: "write",
  description:
    "Bulk-import rows from a base64-encoded Excel file (first sheet only). " +
    "The `type` parameter selects the target table. " +
    "Headers in row 1 must match the target table's Drizzle column names (camelCase), e.g. procedureReference, invoiceNumber, amount, category. " +
    "Unknown headers are silently dropped by drizzle-orm. Use dry_run=true to preview parsed rows without inserting.",
  inputSchema: {
    type: "object",
    properties: {
      xlsx_base64: {
        type: "string",
        description: "Base64-encoded .xlsx file content (NO 'data:...;base64,' prefix).",
      },
      type: {
        type: "string",
        enum: ["import_expenses", "import_service_invoices"],
        description: "Target table for inserted rows.",
      },
      dry_run: {
        type: "boolean",
        default: false,
        description: "If true, parse and validate but DO NOT insert. Returns parsed_count and a sample of the first 3 rows.",
      },
    },
    required: ["xlsx_base64", "type"],
    additionalProperties: false,
  },
  handler: async (args: any) => {
    let buf: Buffer;
    try {
      buf = Buffer.from(args.xlsx_base64, "base64");
    } catch {
      throw new McpToolError("xlsx_base64 is not valid base64");
    }
    if (buf.length === 0) {
      throw new McpToolError("xlsx_base64 decoded to an empty buffer");
    }

    let wb: XLSX.WorkBook;
    try {
      wb = XLSX.read(buf, { type: "buffer" });
    } catch (e: any) {
      throw new McpToolError(`Failed to parse xlsx: ${e?.message ?? String(e)}`);
    }
    const sheetName = wb.SheetNames[0];
    if (!sheetName) throw new McpToolError("Workbook contains no sheets");
    const sheet = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: null }) as Record<string, unknown>[];
    if (!Array.isArray(rows)) throw new McpToolError("Sheet parsed to non-array");

    if (args.dry_run) {
      return {
        data: {
          parsed_count: rows.length,
          sample: rows.slice(0, 3),
          dry_run: true,
          sheet_name: sheetName,
        },
        meta: {
          status: "dry_run" as const,
          summary: `[dry_run] Would import ${rows.length} rows into ${args.type} from sheet "${sheetName}"`,
        },
      };
    }

    if (rows.length === 0) {
      return {
        data: { inserted_count: 0, ids: [] },
        meta: {
          affectedTable: args.type,
          affectedIds: [],
          summary: `Imported 0 rows into ${args.type} (sheet "${sheetName}" was empty)`,
        },
      };
    }

    const target = args.type === "import_expenses" ? importExpenses : importServiceInvoices;
    return await db.transaction(async (tx) => {
      const createdBy = await resolveAgentUserId(tx as any);
      const valuesWithAttribution = rows.map((r) => ({ ...r, createdBy }));
      const inserted = await tx
        .insert(target as any)
        .values(valuesWithAttribution as any)
        .returning();
      const ids = inserted.map((r: any) => r.id);
      return {
        data: { inserted_count: inserted.length, ids, sheet_name: sheetName },
        meta: {
          affectedTable: args.type,
          affectedIds: ids,
          summary: `Imported ${inserted.length} rows into ${args.type} from sheet "${sheetName}"`,
        },
      };
    });
  },
});
