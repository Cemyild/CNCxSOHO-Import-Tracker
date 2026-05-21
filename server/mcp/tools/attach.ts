// server/mcp/tools/attach.ts
// Attach a document to a procedure: upload base64 file to S3 (or local
// fallback), then create a procedureDocuments row.
//
// Schema notes (verified against shared/schema.ts):
//
//   procedureDocuments (NOT NULL): name, type, path, procedureId.
//     Optional: uploadedBy (FK users.id). There is NO mime_type, file_size,
//     notes, s3_key, or documentType column on this table — the row simply
//     stores the original filename in `name`, a string `type` (free-form),
//     and the S3 object key in `path`. Richer expense-attached uploads use
//     the separate `expense_documents` table (out of scope for this tool).
//
//   server/object-storage.ts exports:
//     uploadFile(buffer: Buffer, fileName: string, mimeType: string,
//                procedureReference: string): Promise<string>
//   The returned string is the S3 object key, which we store in
//   procedureDocuments.path verbatim (the existing route at
//   /api/documents/:procedureId in routes.ts works the same way — clients
//   call uploadFile then POST the resulting key).
import { registerTool } from "../registry";
import { McpToolError } from "../errors";
import { storage } from "../../storage";
import { uploadFile, getFile } from "../../object-storage";
import { resolveAgentUserId } from "../audit-attribution";

registerTool({
  name: "write_attach_document",
  tier: "write",
  description:
    "Attach a document (PDF, image, Excel, …) to a procedure. " +
    "PREFER s3_key (obtained via prepare_invoice_upload + PUT) over base64 — same rationale as ai_extract_*: base64 inflates ~33%, exceeds proxy timeouts, and Chrome-extension automation cannot programmatically file-pick. " +
    "When s3_key is supplied, the existing object is simply referenced (no S3 round-trip). When file_base64 is supplied, the bytes are uploaded to S3 under the procedure's directory first. " +
    "Either way a procedure_documents row is inserted with {name, type, path}. " +
    "Note: procedure_documents only has columns {name, type, path, procedureId, uploadedBy}; mime_type/notes are not persisted. " +
    "For richer expense-attached uploads use the expense_documents flow (not exposed here).",
  inputSchema: {
    type: "object",
    properties: {
      procedure_id: {
        type: "integer",
        description: "procedures.id of the parent procedure (used both to look up the reference for the S3 path and as the FK on procedure_documents).",
      },
      filename: { type: "string", description: "Original filename, e.g. 'invoice.pdf' — persisted as procedure_documents.name." },
      mime_type: { type: "string", description: "Used for the S3 ContentType header when re-uploading base64 input. Ignored when s3_key is supplied." },
      s3_key: {
        type: "string",
        description: "S3 object key (e.g. from prepare_invoice_upload + curl PUT). Preferred path — file is already in S3, just gets referenced by the new procedure_documents row.",
      },
      file_base64: {
        type: "string",
        description: "Base64-encoded file content (NO 'data:...;base64,' prefix). Use only when s3_key is impractical (small files).",
      },
      document_type: {
        type: "string",
        description: "Free-form string persisted as procedure_documents.type (e.g. 'invoice', 'awb', 'packing_list', 'insurance', 'freight_invoice'). Not validated against the importDocumentType enum.",
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
      objectKey = await uploadFile(buf, args.filename, args.mime_type ?? "application/octet-stream", proc.reference);
      if (!objectKey) {
        throw new McpToolError("uploadFile did not return an object key");
      }
      byteSize = buf.length;
    }

    const uploadedBy = await resolveAgentUserId();
    const doc = await storage.uploadDocument({
      name: args.filename,
      type: args.document_type ?? "document",
      path: objectKey,
      procedureId: args.procedure_id,
      uploadedBy,
    } as any);

    return {
      data: { document: doc, object_key: objectKey, byte_size: byteSize },
      meta: {
        affectedTable: "procedure_documents",
        affectedIds: [doc.id],
        summary: `Attached ${args.filename} (${byteSize} bytes) to procedure ${args.procedure_id} (${proc.reference})`,
      },
    };
  },
});
