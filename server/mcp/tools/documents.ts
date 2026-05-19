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
import { getFile } from "../../object-storage";

// Resolve a Buffer from either an s3_key (preferred for files > 100 KB) or a
// base64-encoded payload. Exactly one must be provided.
async function loadBuffer(
  s3Key: string | undefined,
  base64: string | undefined,
  base64FieldName: string,
): Promise<Buffer> {
  if (s3Key && base64) {
    throw new McpToolError(`Provide either s3_key or ${base64FieldName}, not both`);
  }
  if (s3Key) {
    try {
      const { buffer } = await getFile(s3Key);
      if (buffer.length === 0) {
        throw new McpToolError(`s3_key '${s3Key}' resolved to an empty file`);
      }
      return buffer;
    } catch (err: any) {
      if (err instanceof McpToolError) throw err;
      throw new McpToolError(`Failed to fetch s3_key '${s3Key}': ${err?.message ?? err}`);
    }
  }
  if (!base64) {
    throw new McpToolError(`Either s3_key or ${base64FieldName} is required`);
  }
  let buf: Buffer;
  try {
    buf = Buffer.from(base64, "base64");
  } catch {
    throw new McpToolError(`${base64FieldName} is not valid base64`);
  }
  if (buf.length === 0) {
    throw new McpToolError(`${base64FieldName} decoded to an empty buffer`);
  }
  return buf;
}

registerTool({
  name: "ai_extract_pdf",
  tier: "ai",
  description:
    "Extract structured invoice/document data from a PDF using Claude. " +
    "PREFER s3_key (obtained via prepare_invoice_upload + PUT) for any file > 100 KB — " +
    "base64 payloads inflate ~33% and can exceed proxy timeouts. " +
    "Returns { products: ExtractedProduct[], invoiceMetadata?: InvoiceMetadata }. " +
    "Requires ANTHROPIC_API_KEY on the server.",
  inputSchema: {
    type: "object",
    properties: {
      s3_key: {
        type: "string",
        description: "S3 object key returned by prepare_invoice_upload (preferred path). Server downloads the PDF from S3 directly.",
      },
      pdf_base64: {
        type: "string",
        description: "Base64-encoded PDF (NO 'data:application/pdf;base64,' prefix). Use only when s3_key is impractical (small files).",
      },
      doc_type: {
        type: "string",
        description:
          "Document type hint, e.g. 'commercial_invoice'. Currently informational only — the underlying extractor uses a fixed invoice-oriented prompt.",
        default: "commercial_invoice",
      },
    },
    additionalProperties: false,
  },
  handler: async (args: any) => {
    const buf = await loadBuffer(args.s3_key, args.pdf_base64, "pdf_base64");

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
    "Extract structured invoice/product data from an .xlsx file. " +
    "PREFER s3_key (obtained via prepare_invoice_upload + PUT) over base64 — " +
    "base64 payloads inflate ~33% and can exceed proxy timeouts on the MCP transport. " +
    "Returns the same { products, invoiceMetadata } shape as ai_extract_pdf, " +
    "so its output can be piped directly into write_save_extracted_invoice.",
  inputSchema: {
    type: "object",
    properties: {
      s3_key: {
        type: "string",
        description: "S3 object key returned by prepare_invoice_upload (preferred path). Server downloads the .xlsx from S3 directly.",
      },
      xlsx_base64: {
        type: "string",
        description: "Base64-encoded .xlsx (NO data: prefix). Use only when s3_key is impractical (small files).",
      },
    },
    additionalProperties: false,
  },
  handler: async (args: any) => {
    const buf = await loadBuffer(args.s3_key, args.xlsx_base64, "xlsx_base64");
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
