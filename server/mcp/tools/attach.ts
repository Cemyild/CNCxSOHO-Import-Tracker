// server/mcp/tools/attach.ts
// Attach a document to a procedure.
//
// IMPORTANT — table choice:
//   The Procedure Details page UI reads attached documents from
//   `expense_documents` (filtered by procedureReference), NOT from
//   `procedure_documents`. The latter is legacy/dead — nothing in the
//   React app queries it. So this tool writes to `expense_documents`
//   with expenseType='import_document'; otherwise the row exists in DB
//   but never renders in the UI.
//
// Schema notes (verified against shared/schema.ts):
//
//   expense_documents (NOT NULL): expenseType, expenseId, originalFilename,
//     objectKey, fileSize, fileType, procedureReference.
//     Optional: importDocumentType (enum), uploadedBy, storedFilename,
//     filePath.
//
//   For an attachment whose parent is a procedure (not a specific expense
//   row), we set expenseType='import_document' and expenseId=procedure.id.
//
//   importDocumentType enum allows: tax_calculation_spreadsheet,
//     advance_taxletter, invoice, packing_list, insurance, awb,
//     import_declaration, transit_declaration, pod, expense_receipt,
//     final_balance_letter, bonded_warehouse_declaration.
//     The tool's `document_type` arg is mapped to this enum when it
//     matches; otherwise importDocumentType is left null (e.g.
//     "freight_invoice" doesn't exist in the enum yet — Cem can ALTER
//     TYPE later, the file still attaches & shows up in the UI).
//
//   server/object-storage.ts exports:
//     uploadFile(buffer, fileName, mimeType, procedureReference) → s3 key
//     getFile(s3Key) → { buffer, contentType }
//
import { registerTool } from "../registry";
import { McpToolError } from "../errors";
import { storage } from "../../storage";
import { db } from "../../db";
import { expenseDocuments } from "@shared/schema";
import { uploadFile, getFile } from "../../object-storage";
import { resolveAgentUserId } from "../audit-attribution";

const IMPORT_DOC_TYPE_ENUM = new Set([
  "tax_calculation_spreadsheet",
  "advance_taxletter",
  "invoice",
  "packing_list",
  "insurance",
  "awb",
  "import_declaration",
  "transit_declaration",
  "pod",
  "expense_receipt",
  "final_balance_letter",
  "bonded_warehouse_declaration",
]);

registerTool({
  name: "write_attach_document",
  tier: "write",
  description:
    "Attach a document (PDF, image, Excel, …) to a procedure. The row lands in `expense_documents` with expense_type='import_document' and expense_id=procedure.id — that's the table the Procedure Details page renders from. " +
    "PREFER s3_key (obtained via prepare_invoice_upload + PUT) over base64: base64 inflates ~33%, exceeds proxy timeouts, and Chrome-extension automation cannot file-pick. " +
    "When s3_key is supplied, the existing object is referenced (no S3 round-trip). When file_base64 is supplied, the bytes are uploaded to S3 under the procedure's directory first. " +
    "`document_type` is matched against the import_document_type enum (invoice, packing_list, insurance, awb, …); unknown values (e.g. 'freight_invoice') leave the enum column null but still attach.",
  inputSchema: {
    type: "object",
    properties: {
      procedure_id: {
        type: "integer",
        description: "procedures.id — used to look up the procedure reference (for S3 path + expense_documents.procedureReference) and stored as expense_documents.expenseId.",
      },
      filename: { type: "string", description: "Original filename, e.g. 'invoice.pdf' — persisted as expense_documents.originalFilename." },
      mime_type: { type: "string", description: "MIME type. Stored as expense_documents.fileType. Also used as ContentType when uploading base64 input." },
      s3_key: {
        type: "string",
        description: "S3 object key (e.g. from prepare_invoice_upload + curl PUT). Preferred path — file already in S3.",
      },
      file_base64: {
        type: "string",
        description: "Base64-encoded file content (NO 'data:...;base64,' prefix). Use only when s3_key is impractical (small files).",
      },
      document_type: {
        type: "string",
        description: "Free-form string. If it matches the import_document_type enum (invoice/packing_list/insurance/awb/…), it's stored as expense_documents.importDocumentType. Unknown values leave that column null.",
      },
    },
    required: ["procedure_id", "filename"],
    additionalProperties: false,
  },
  handler: async (args: any) => {
    if (args.s3_key && args.file_base64) {
      throw new McpToolError("Provide either s3_key or file_base64, not both");
    }
    if (!args.s3_key && !args.file_base64) {
      throw new McpToolError("Either s3_key or file_base64 is required");
    }

    // Look up the procedure (also used as the S3 path prefix for the
    // base64 fallback below, so the file lives under SOHO/<safeRef>/...).
    const proc = await storage.getProcedure(args.procedure_id);
    if (!proc) throw new McpToolError(`Procedure ${args.procedure_id} not found`);

    let objectKey: string;
    let byteSize: number;
    const mimeType = args.mime_type ?? "application/octet-stream";

    if (args.s3_key) {
      // Reference the already-uploaded object — no S3 round-trip.
      // Quick existence/size sanity check so we don't store a dangling key.
      try {
        const { buffer } = await getFile(args.s3_key);
        if (!buffer || buffer.length === 0) {
          throw new McpToolError(`s3_key '${args.s3_key}' resolved to empty file`);
        }
        byteSize = buffer.length;
      } catch (err: any) {
        if (err instanceof McpToolError) throw err;
        throw new McpToolError(`Failed to verify s3_key '${args.s3_key}': ${err?.message ?? err}`);
      }
      objectKey = args.s3_key;
    } else {
      // Legacy base64 fallback. Decode first so we fail fast on bad input.
      let buf: Buffer;
      try {
        buf = Buffer.from(args.file_base64, "base64");
      } catch {
        throw new McpToolError("file_base64 is not valid base64");
      }
      if (buf.length === 0) {
        throw new McpToolError("file_base64 decoded to an empty buffer");
      }
      objectKey = await uploadFile(buf, args.filename, mimeType, proc.reference);
      if (!objectKey) {
        throw new McpToolError("uploadFile did not return an object key");
      }
      byteSize = buf.length;
    }

    const uploadedBy = await resolveAgentUserId();
    const importDocType = args.document_type && IMPORT_DOC_TYPE_ENUM.has(args.document_type)
      ? args.document_type
      : null;

    const [doc] = await db.insert(expenseDocuments).values({
      expenseType: "import_document" as any,
      expenseId: args.procedure_id,
      originalFilename: args.filename,
      objectKey,
      fileSize: byteSize,
      fileType: mimeType,
      importDocumentType: importDocType as any,
      procedureReference: proc.reference,
      uploadedBy,
    }).returning();

    if (!doc) throw new McpToolError("Insert into expense_documents returned no row");

    return {
      data: { document: doc, object_key: objectKey, byte_size: byteSize },
      meta: {
        affectedTable: "expense_documents",
        affectedIds: [doc.id],
        summary: `Attached ${args.filename} (${byteSize} bytes) to procedure ${args.procedure_id} (${proc.reference}) — type=${importDocType ?? args.document_type ?? "document"}`,
      },
    };
  },
});
