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

  // Accept the token from EITHER `Authorization: Bearer <token>` header (preferred,
  // used by API consumers and by clients that support custom auth headers) OR a
  // `?token=<token>` query-string parameter (used by Claude Desktop's Cowork
  // connector form, which currently only exposes OAuth fields in the UI and has
  // no built-in slot for a static bearer token).
  let providedRaw: string | null = null;
  const header = req.header("authorization") ?? "";
  const m = /^Bearer (.+)$/.exec(header);
  if (m) {
    providedRaw = m[1];
  } else if (typeof req.query.token === "string" && req.query.token.length > 0) {
    providedRaw = req.query.token;
  }

  if (!providedRaw) {
    res.status(401).json({ error: "Missing token: send Authorization: Bearer <token> header OR ?token=<token> query param" });
    return;
  }

  const provided = Buffer.from(providedRaw, "utf8");
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
