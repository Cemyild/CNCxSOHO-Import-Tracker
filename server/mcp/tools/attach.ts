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
import { uploadFile } from "../../object-storage";
import { resolveAgentUserId } from "../audit-attribution";

registerTool({
  name: "write_attach_document",
  tier: "write",
  description:
    "Attach a document (PDF, image, Excel, …) to a procedure. The base64 payload is uploaded to S3 (or local fallback) under the procedure's directory, then a procedure_documents row is inserted referencing the resulting object key. " +
    "Note: procedure_documents only has columns {name, type, path, procedureId, uploadedBy}; mime_type/notes/document_type are not persisted. " +
    "For richer expense-attached uploads use the expense_documents flow (not exposed here).",
  inputSchema: {
    type: "object",
    properties: {
      procedure_id: {
        type: "integer",
        description: "procedures.id of the parent procedure (used both to look up the reference for the S3 path and as the FK on procedure_documents).",
      },
      filename: { type: "string", description: "Original filename, e.g. 'invoice.pdf' — persisted as procedure_documents.name." },
      mime_type: { type: "string", description: "Used for the S3 ContentType header only; not persisted." },
      file_base64: { type: "string", description: "Base64-encoded file content (NO 'data:...;base64,' prefix)." },
      document_type: {
        type: "string",
        description: "Free-form string persisted as procedure_documents.type (e.g. 'invoice', 'awb'). Not validated against the importDocumentType enum.",
      },
    },
    required: ["procedure_id", "filename", "mime_type", "file_base64"],
    additionalProperties: false,
  },
  handler: async (args: any) => {
    // Decode the file first so we fail fast on bad input.
    let buf: Buffer;
    try {
      buf = Buffer.from(args.file_base64, "base64");
    } catch {
      throw new McpToolError("file_base64 is not valid base64");
    }
    if (buf.length === 0) {
      throw new McpToolError("file_base64 decoded to an empty buffer");
    }

    // Look up the procedure to get its reference (uploadFile uses it as the
    // S3 path prefix, so the file lives under SOHO/<safeRef>/<ts>-<name>).
    const proc = await storage.getProcedure(args.procedure_id);
    if (!proc) throw new McpToolError(`Procedure ${args.procedure_id} not found`);

    const objectKey = await uploadFile(buf, args.filename, args.mime_type, proc.reference);
    if (!objectKey) {
      throw new McpToolError("uploadFile did not return an object key");
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
      data: { document: doc, object_key: objectKey, byte_size: buf.length },
      meta: {
        affectedTable: "procedure_documents",
        affectedIds: [doc.id],
        summary: `Attached ${args.filename} (${buf.length} bytes) to procedure ${args.procedure_id} (${proc.reference})`,
      },
    };
  },
});
