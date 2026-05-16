// server/mcp/audit.ts
// Records every tool call. Sanitizes args (strips base64 blobs / file contents).
import { db } from "../db";
import { agentAuditLog, type InsertAgentAuditLog } from "@shared/schema";

const BASE64_MIN_LEN = 200; // strings longer than this that look base64 → elided

export function sanitizeArgs(input: unknown): unknown {
  if (input == null) return input;
  if (typeof input === "string") {
    if (input.length >= BASE64_MIN_LEN && /^[A-Za-z0-9+/=_-]+$/.test(input.slice(0, 200))) {
      return `[base64 elided, ${input.length} bytes]`;
    }
    return input;
  }
  if (Array.isArray(input)) return input.map(sanitizeArgs);
  if (typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      // Drop common secret-looking keys outright
      if (/token|password|secret|api[_-]?key/i.test(k)) {
        out[k] = "[redacted]";
      } else {
        out[k] = sanitizeArgs(v);
      }
    }
    return out;
  }
  return input;
}

export interface AuditPayload {
  agentId: string;
  tokenFingerprint: string;
  tool: string;
  tier: "read" | "write" | "destructive" | "ai";
  args: unknown;
  before?: unknown;
  resultStatus: "ok" | "error" | "dry_run";
  resultSummary?: string;
  affectedTable?: string;
  affectedIds?: (string | number)[];
  durationMs: number;
  transactionId?: string;
}

export async function writeAudit(p: AuditPayload): Promise<void> {
  const row: InsertAgentAuditLog = {
    agentId: p.agentId,
    tokenFingerprint: p.tokenFingerprint,
    tool: p.tool,
    tier: p.tier,
    argsJson: JSON.stringify(sanitizeArgs(p.args)),
    beforeJson: p.before === undefined ? null : JSON.stringify(sanitizeArgs(p.before)),
    resultStatus: p.resultStatus,
    resultSummary: p.resultSummary?.slice(0, 1000) ?? null,
    affectedTable: p.affectedTable ?? null,
    affectedIds: p.affectedIds ? JSON.stringify(p.affectedIds) : null,
    durationMs: p.durationMs,
    transactionId: p.transactionId ?? null,
  };
  try {
    await db.insert(agentAuditLog).values(row);
  } catch (err) {
    console.error("[mcp] audit write failed:", err);
    // Never throw — audit failure must not break the tool response.
  }
}
