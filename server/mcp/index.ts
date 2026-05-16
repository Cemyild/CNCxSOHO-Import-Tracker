// server/mcp/index.ts
// Express sub-router for /mcp.
import { Router, type Request, type Response, type NextFunction } from "express";
import { mcpAuth } from "./auth";
import { handleMcpRequest } from "./transport";
import { registerAllTools } from "./tools/index";

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

// Streamable HTTP: POST for client→server, GET for server→client stream, DELETE to close.
mcpRouter.post("/", handleMcpRequest);
mcpRouter.get("/", handleMcpRequest);
mcpRouter.delete("/", handleMcpRequest);
