// server/mcp/registry.ts
// Central tool registry. Each tool registers a definition (for tools/list) and
// a runner (for tools/call). Runner is wrapped to record audit log and time.
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { writeAudit, type AuditPayload } from "./audit";
import { asToolErrorResponse, McpToolError } from "./errors";
import { randomUUID } from "crypto";

export type Tier = "read" | "write" | "destructive" | "ai";

export interface ToolContext {
  agentId: string;
  tokenFingerprint: string;
  transactionId: string;
}

export interface ToolResultMeta {
  affectedTable?: string;
  affectedIds?: (string | number)[];
  before?: unknown;
  status?: "ok" | "dry_run";
  summary?: string;
}

export interface ToolHandlerResult {
  // What the LLM sees. Should be JSON-serializable; we wrap it.
  data: unknown;
  meta?: ToolResultMeta;
}

export interface ToolDefinition {
  name: string;
  tier: Tier;
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema
  handler: (args: any, ctx: ToolContext) => Promise<ToolHandlerResult>;
}

const TOOLS: Map<string, ToolDefinition> = new Map();

export function registerTool(def: ToolDefinition): void {
  if (TOOLS.has(def.name)) throw new Error(`Duplicate MCP tool: ${def.name}`);
  TOOLS.set(def.name, def);
}

export function listToolDefinitions() {
  return Array.from(TOOLS.values()).map(t => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));
}

export function wireRegistryToServer(
  server: Server,
  authInfoProvider: () => { agentId: string; tokenFingerprint: string },
): void {
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: listToolDefinitions(),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    const def = TOOLS.get(name);
    if (!def) {
      return asToolErrorResponse(`Unknown tool: ${name}`);
    }
    const { agentId, tokenFingerprint } = authInfoProvider();
    const transactionId = (args.__txn as string | undefined) ?? randomUUID();
    const ctx: ToolContext = { agentId, tokenFingerprint, transactionId };
    const t0 = Date.now();
    try {
      const out = await def.handler(args, ctx);
      const auditPayload: AuditPayload = {
        agentId, tokenFingerprint, tool: name, tier: def.tier,
        args, before: out.meta?.before,
        resultStatus: out.meta?.status ?? "ok",
        resultSummary: out.meta?.summary,
        affectedTable: out.meta?.affectedTable,
        affectedIds: out.meta?.affectedIds,
        durationMs: Date.now() - t0,
        transactionId,
      };
      await writeAudit(auditPayload);
      return {
        content: [{ type: "text", text: JSON.stringify(out.data) }],
        isError: false,
      };
    } catch (err: any) {
      const summary = err instanceof McpToolError
        ? (err.publicSummary ?? err.message)
        : `Internal error: ${err?.message ?? String(err)}`;
      await writeAudit({
        agentId, tokenFingerprint, tool: name, tier: def.tier,
        args, resultStatus: "error", resultSummary: summary,
        durationMs: Date.now() - t0, transactionId,
      });
      return asToolErrorResponse(summary);
    }
  });
}
