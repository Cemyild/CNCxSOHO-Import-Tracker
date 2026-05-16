// server/mcp/index.ts
// Express sub-router for /mcp.
import { Router, type Request, type Response } from "express";
import { mcpAuth } from "./auth";
import { handleMcpRequest } from "./transport";
import { registerAllTools } from "./tools/index";

// Tools are registered once at module load (idempotent).
registerAllTools();

export const mcpRouter = Router();

// Health endpoint — unauthenticated, used by uptime monitors.
mcpRouter.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", server: "cncxsoho-mcp", ts: new Date().toISOString() });
});

// Everything else requires auth.
mcpRouter.use(mcpAuth);

// Streamable HTTP: POST for client→server, GET for server→client stream, DELETE to close.
mcpRouter.post("/", handleMcpRequest);
mcpRouter.get("/", handleMcpRequest);
mcpRouter.delete("/", handleMcpRequest);
