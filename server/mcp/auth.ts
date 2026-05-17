// server/mcp/auth.ts
// Bearer-token middleware for /mcp. Single token in env; rotation can be added later.
import { createHash, timingSafeEqual } from "crypto";
import type { Request, Response, NextFunction } from "express";

const TOKEN = process.env.MCP_BEARER_TOKEN ?? "";
const AGENT_ID = process.env.MCP_AGENT_ID ?? "cowork";

if (!TOKEN || TOKEN.length < 32) {
  console.error("[mcp] MCP_BEARER_TOKEN is missing or too short. /mcp will reject all requests.");
}

const EXPECTED_BUF = Buffer.from(TOKEN, "utf8");

export function fingerprint(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex").slice(0, 16);
}

export const expectedFingerprint = TOKEN ? fingerprint(TOKEN) : "";

export interface McpAuthInfo {
  agentId: string;
  tokenFingerprint: string;
}

declare module "express-serve-static-core" {
  interface Request {
    mcpAuth?: McpAuthInfo;
  }
}

export function mcpAuth(req: Request, res: Response, next: NextFunction): void {
  if (!TOKEN || TOKEN.length < 32) {
    res.status(503).json({ error: "MCP server not configured: MCP_BEARER_TOKEN missing" });
    return;
  }
  const header = req.header("authorization") ?? "";
  const m = /^Bearer (.+)$/.exec(header);
  if (!m) {
    res.status(401).json({ error: "Missing or malformed Authorization header" });
    return;
  }
  const provided = Buffer.from(m[1], "utf8");
  if (provided.length !== EXPECTED_BUF.length) {
    res.status(401).json({ error: "Invalid token" });
    return;
  }
  if (!timingSafeEqual(provided, EXPECTED_BUF)) {
    res.status(401).json({ error: "Invalid token" });
    return;
  }
  req.mcpAuth = { agentId: AGENT_ID, tokenFingerprint: expectedFingerprint };
  next();
}
