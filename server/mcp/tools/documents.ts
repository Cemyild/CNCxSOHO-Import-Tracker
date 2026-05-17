// server/mcp/tools/documents.ts
// Wraps the existing PDF extraction (server/document-extraction.ts) so Cowork
// can call it as an MCP tool. The underlying function takes a Buffer, so we
// decode the base64 input first.
//
// Audit-log safety: the `pdf_base64` argument is auto-elided by
// server/mcp/audit.ts#sanitizeArgs (any string >= 200 chars matching the
// base64 charset is replaced with "[base64 elided, N bytes]") — no special
// handling needed here.
//
// Requires ANTHROPIC_API_KEY in env, because extractFromPdf calls
// analyzePdfWithClaude under the hood.
import { registerTool } from "../registry";
import { McpToolError } from "../errors";
import { extractFromPdf, extractFromExcel } from "../../document-extraction";

registerTool({
  name: "ai_extract_pdf",
  tier: "ai",
  description:
    "Extract structured invoice/document data from a base64-encoded PDF using Claude. " +
    "Returns { products: ExtractedProduct[], invoiceMetadata?: InvoiceMetadata }. " +
    "Requires ANTHROPIC_API_KEY on the server.",
  inputSchema: {
    type: "object",
    properties: {
      pdf_base64: {
        type: "string",
        description: "Base64-encoded PDF (NO 'data:application/pdf;base64,' prefix).",
      },
      doc_type: {
        type: "string",
        description:
          "Document type hint, e.g. 'commercial_invoice'. Currently informational only — the underlying extractor uses a fixed invoice-oriented prompt.",
        default: "commercial_invoice",
      },
    },
    required: ["pdf_base64"],
    additionalProperties: false,
  },
  handler: async (args: any) => {
    let buf: Buffer;
    try {
      buf = Buffer.from(args.pdf_base64, "base64");
    } catch {
      throw new McpToolError("pdf_base64 is not valid base64");
    }
    if (buf.length === 0) {
      throw new McpToolError("pdf_base64 decoded to an empty buffer");
    }

    const result = await extractFromPdf(buf);
    const productCount = result?.products?.length ?? 0;
    const hasMeta = !!result?.invoiceMetadata;
    return {
      data: result,
      meta: {
        summary: `Extracted ${productCount} products from PDF${hasMeta ? " (with invoice metadata)" : ""}`,
      },
    };
  },
});

// ai_extract_excel — symmetric to ai_extract_pdf but for .xlsx invoices.
// Uses the same ExtractedProduct/InvoiceMetadata shape so downstream tools
// (write_save_extracted_invoice etc.) accept the output unchanged.
registerTool({
  name: "ai_extract_excel",
  tier: "ai",
  description:
    "Extract structured invoice/product data from a base64-encoded .xlsx file. " +
    "Returns the same { products, invoiceMetadata } shape as ai_extract_pdf, " +
    "so its output can be piped directly into write_save_extracted_invoice.",
  inputSchema: {
    type: "object",
    properties: {
      xlsx_base64: {
        type: "string",
        description: "Base64-encoded .xlsx (NO data: prefix).",
      },
    },
    required: ["xlsx_base64"],
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
    const result = await extractFromExcel(buf);
    const productCount = result?.products?.length ?? 0;
    const hasMeta = !!result?.invoiceMetadata;
    return {
      data: result,
      meta: {
        summary: `Extracted ${productCount} products from Excel${hasMeta ? " (with invoice metadata)" : ""}`,
      },
    };
  },
});
