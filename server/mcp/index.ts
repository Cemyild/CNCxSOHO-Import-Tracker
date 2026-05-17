// server/mcp/index.ts
// Express sub-router for /mcp.
import { Router, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { mcpAuth } from "./auth";
import { handleMcpRequest } from "./transport";
import { registerAllTools } from "./tools/index";
import { uploadFile } from "../object-storage";

// Tools are registered once at module load (idempotent). registerAllTools is
// async because it uses dynamic import() under ESM. We kick it off immediately
// and gate authenticated requests on it so tools/list returns the full set.
const toolsReady: Promise<void> = registerAllTools();

export const mcpRouter = Router();

// Health endpoint — unauthenticated, used by uptime monitors.
mcpRouter.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", server: "cncxsoho-mcp", ts: new Date().toISOString() });
});

// Everything else requires auth.
mcpRouter.use(mcpAuth);

// Ensure tool registrations have completed before serving MCP requests.
mcpRouter.use(async (_req: Request, _res: Response, next: NextFunction) => {
  try {
    await toolsReady;
    next();
  } catch (err) {
    next(err);
  }
});

// --- /mcp/upload --------------------------------------------------------
// Multipart file upload endpoint. Stores the file in S3 under
// `SOHO/mcp-uploads/<timestamp>-<filename>` and returns the S3 key. The
// caller (Cowork) then passes the key to import_invoice_from_file etc.,
// avoiding base64-in-context entirely.
//
// Bearer auth applied above (via mcpAuth middleware) — same MCP_BEARER_TOKEN.
// Memory-storage multer; 20MB limit (matches the React UI's documentUpload).
const mcpFileUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

mcpRouter.post("/upload", mcpFileUpload.single("file"), async (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: "Multipart 'file' field is required." });
    return;
  }
  try {
    const objectKey = await uploadFile(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
      "mcp-uploads"
    );
    res.json({
      s3_key: objectKey,
      filename: req.file.originalname,
      size: req.file.size,
      content_type: req.file.mimetype,
      hint: `Pass s3_key='${objectKey}' to import_invoice_from_file (or another tool that supports it). The server will fetch from S3 directly — no base64 needed.`,
    });
  } catch (err: any) {
    console.error("[/mcp/upload]", err);
    res.status(500).json({ error: "Upload failed", details: err?.message ?? String(err) });
  }
});

// Streamable HTTP: POST for client→server, GET for server→client stream, DELETE to close.
mcpRouter.post("/", handleMcpRequest);
mcpRouter.get("/", handleMcpRequest);
mcpRouter.delete("/", handleMcpRequest);
