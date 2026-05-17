# Cowork MCP Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a custom MCP server inside the existing Express app at `cncsohoimportmanager.com` so Claude Cowork (Anthropic-hosted) can perform read/write/destructive/AI-chain operations against the CNCxSOHO Import Tracker.

**Architecture:** New `server/mcp/` Express sub-app mounted at `/mcp`, Streamable HTTP transport, bearer-token auth, audit-logged transactional tools. Tools are thin adapters over existing `ai-ask-tools.ts`, `storage.ts`, `document-extraction.ts`, `ai-ask.ts`, `tax-calculation-service.ts`. No refactor of existing code.

**Tech Stack:** Node.js / Express / TypeScript / Drizzle ORM (Neon Postgres) / `@modelcontextprotocol/sdk` / Anthropic SDK (already installed).

**Source spec:** [docs/superpowers/specs/2026-05-16-cowork-mcp-integration-design.md](../specs/2026-05-16-cowork-mcp-integration-design.md)

---

## File Structure

**Create:**
- `server/mcp/index.ts` — Express router, mounts handlers
- `server/mcp/transport.ts` — Streamable HTTP transport bridge
- `server/mcp/auth.ts` — bearer token middleware
- `server/mcp/audit.ts` — audit log writer + arg sanitizer
- `server/mcp/registry.ts` — tool registration helper
- `server/mcp/errors.ts` — JSON-RPC error helpers
- `server/mcp/tools/index.ts` — registers all tools
- `server/mcp/tools/procedures.ts`
- `server/mcp/tools/taxes.ts`
- `server/mcp/tools/expenses.ts`
- `server/mcp/tools/payments.ts`
- `server/mcp/tools/invoices.ts`
- `server/mcp/tools/products.ts`
- `server/mcp/tools/reports.ts`
- `server/mcp/tools/documents.ts`
- `server/mcp/tools/ai.ts`
- `server/mcp/tools/destructive.ts`
- `server/mcp/tools/excel.ts`
- `server/mcp/tools/attach.ts`
- `scripts/mcp/verify-health.ts` — smoke test: health endpoint
- `scripts/mcp/verify-auth.ts` — smoke test: auth rejection / acceptance
- `scripts/mcp/verify-list-tools.ts` — smoke test: tools/list returns expected tools
- `scripts/mcp/verify-read-tools.ts` — smoke test: each read tool against real dev DB
- `scripts/mcp/verify-write-tools.ts` — smoke test: write tools (creates + cleans up)
- `scripts/mcp/verify-destructive-tools.ts` — smoke test: dry_run behavior
- `nginx/cncsoho.mcp.conf.snippet` — nginx location block (for ops to merge)

**Modify:**
- `shared/schema.ts` — add `agentAuditLog` table
- `server/index.ts` — mount `mcpRouter` before `registerRoutes`
- `package.json` — add `@modelcontextprotocol/sdk` dep
- `.env.example` — document `MCP_BEARER_TOKEN`

**Not touched:** `server/routes.ts`, `server/ai-ask.ts`, `server/ai-ask-tools.ts`, `server/document-extraction.ts`, `server/tax-calculation-service.ts`, `server/storage.ts`, `server/claude.ts`, React UI code.

---

## Phase 0 — Pre-flight Verification

### Task 0.1: Verify Cowork supports remote MCP servers

**Files:** None (manual check)

- [ ] **Step 1: Open Claude Desktop → Cowork tab → Settings / Connectors**

Look for "Custom MCP server" / "Add MCP server" option. Confirm it accepts a remote HTTPS URL plus a bearer token. Record the exact UI path in `docs/superpowers/plans/2026-05-16-cowork-mcp-integration.md` notes section below this task.

- [ ] **Step 2: Note Streamable HTTP support**

Confirm the connector supports Streamable HTTP transport (not stdio only). If only stdio is supported, **STOP** and revise the spec — the production HTTPS approach won't work and we'd need an alternate plan (e.g., MCP gateway proxy).

- [ ] **Step 3: Note any Anthropic egress IP allowlist**

Check Anthropic docs (https://docs.anthropic.com) for "MCP egress IPs" or similar. If a stable list exists, copy IPs into this file under "Notes" so Phase 1 nginx config can allowlist them. If not, proceed without IP allowlist (token-only).

### Task 0.2: Verify dev DB and prod DB connections work

**Files:** None

- [ ] **Step 1: Verify local dev**

Run: `npm run dev`
Expected: Server starts on port 5000, no errors. Open `http://localhost:5000/` — UI loads.
Stop the server (Ctrl+C).

- [ ] **Step 2: Verify Drizzle migration tooling**

Run: `npx drizzle-kit --help`
Expected: drizzle-kit prints help. Confirms migration tooling is wired up.

---

## Phase 1 — Foundation

### Task 1.1: Add MCP SDK dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install SDK**

Run: `npm install @modelcontextprotocol/sdk`
Expected: `package.json` `dependencies` gains `"@modelcontextprotocol/sdk": "^1.x.x"` (latest at time of install). `package-lock.json` updates.

- [ ] **Step 2: Verify import works**

Create a temporary file `verify-mcp-import.ts` at repo root:

```ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const s = new Server({ name: "test", version: "0.0.0" }, { capabilities: { tools: {} } });
console.log("Server class:", typeof Server, "Transport class:", typeof StreamableHTTPServerTransport, "Schemas:", !!ListToolsRequestSchema, !!CallToolRequestSchema);
```

Run: `npx tsx verify-mcp-import.ts`
Expected: prints `Server class: function Transport class: function Schemas: true true`
Then: `rm verify-mcp-import.ts`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat(mcp): add @modelcontextprotocol/sdk dependency"
```

### Task 1.2: Add `agent_audit_log` table to schema

**Files:**
- Modify: `shared/schema.ts` (append near other table definitions)

- [ ] **Step 1: Append schema definition**

Add to `shared/schema.ts` (paste at the end of the file, before any default export if present):

```ts
// === MCP / Agent audit log ===
// Records every tool call made by an external agent (Cowork, future Claude Code, etc.)
export const agentAuditLog = pgTable("agent_audit_log", {
  id: serial("id").primaryKey(),
  ts: timestamp("ts").defaultNow().notNull(),
  agentId: text("agent_id").notNull(),
  tokenFingerprint: text("token_fingerprint").notNull(),
  tool: text("tool").notNull(),
  tier: text("tier").notNull(), // 'read' | 'write' | 'destructive' | 'ai'
  argsJson: text("args_json").notNull(),
  beforeJson: text("before_json"),
  resultStatus: text("result_status").notNull(), // 'ok' | 'error' | 'dry_run'
  resultSummary: text("result_summary"),
  affectedTable: text("affected_table"),
  affectedIds: text("affected_ids"),
  durationMs: integer("duration_ms"),
  transactionId: text("transaction_id"),
});

export type AgentAuditLog = typeof agentAuditLog.$inferSelect;
export type InsertAgentAuditLog = typeof agentAuditLog.$inferInsert;
```

- [ ] **Step 2: Push schema to dev DB**

Run: `npm run db:push`
Expected: drizzle-kit shows "Creating table agent_audit_log" and "Changes applied".

- [ ] **Step 3: Verify table exists**

Run (via psql connection or any DB client against your dev `DATABASE_URL`):
```sql
SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'agent_audit_log' ORDER BY ordinal_position;
```
Expected: 13 columns matching the schema above.

- [ ] **Step 4: Commit**

```bash
git add shared/schema.ts
git commit -m "feat(mcp): add agent_audit_log table for tool-call auditing"
```

### Task 1.3: Add MCP env vars

**Files:**
- Modify: `.env.example` (create if missing)
- Modify: `.env` (local only; not committed)

- [ ] **Step 1: Generate a token**

Run: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`
Expected: prints a ~64-char URL-safe random string. Copy it.

- [ ] **Step 2: Add to `.env`**

Append to `.env`:
```
MCP_BEARER_TOKEN=<paste the token from step 1>
MCP_AGENT_ID=cowork
```

- [ ] **Step 3: Document in `.env.example`**

If `.env.example` exists, append:
```
# MCP server — bearer token for Cowork connections
# Generate: node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
MCP_BEARER_TOKEN=
MCP_AGENT_ID=cowork
```
If it doesn't exist, create it with the same content (and any other env vars you find documented elsewhere in the project that belong in an example).

- [ ] **Step 4: Verify `.env` is gitignored**

Run: `git check-ignore .env`
Expected: prints `.env`. If not, **STOP** and add `.env` to `.gitignore` before continuing.

- [ ] **Step 5: Commit example only**

```bash
git add .env.example
git commit -m "chore(mcp): document MCP_BEARER_TOKEN env var"
```

### Task 1.4: Add nginx snippet for `/mcp` location

**Files:**
- Create: `nginx/cncsoho.mcp.conf.snippet`

- [ ] **Step 1: Write snippet**

Create `nginx/cncsoho.mcp.conf.snippet`:

```nginx
# Append inside the existing server { ... } block for cncsohoimportmanager.com
# This location MUST be defined BEFORE the catch-all "location /" if any.

location /mcp {
    # MCP Streamable HTTP needs long-lived SSE responses.
    proxy_pass http://127.0.0.1:5000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_request_buffering off;
    proxy_read_timeout 300s;
    proxy_send_timeout 300s;
    chunked_transfer_encoding on;
}
```

- [ ] **Step 2: Commit (server-side deployment is a separate ops step)**

```bash
git add nginx/cncsoho.mcp.conf.snippet
git commit -m "chore(mcp): add nginx location snippet for /mcp"
```

> **Ops note for Cem:** This snippet must be merged into the production nginx config and `nginx -s reload` run BEFORE the MCP server goes live. Without it, the default 60s `proxy_read_timeout` will kill SSE streams mid-response.

---

## Phase 2 — MCP Skeleton

### Task 2.1: Auth middleware with timing-safe compare

**Files:**
- Create: `server/mcp/auth.ts`

- [ ] **Step 1: Write `auth.ts`**

```ts
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
```

- [ ] **Step 2: Verification script**

Create `scripts/mcp/verify-auth.ts`:

```ts
// Verifies auth middleware logic in isolation (no HTTP).
// Run with: npx tsx scripts/mcp/verify-auth.ts
process.env.MCP_BEARER_TOKEN = "test-token-".padEnd(40, "x");
process.env.MCP_AGENT_ID = "cowork-test";

import { fingerprint, expectedFingerprint, mcpAuth } from "../../server/mcp/auth.js";

function fakeReq(authHeader?: string): any {
  return { header: (n: string) => (n.toLowerCase() === "authorization" ? authHeader : undefined) };
}
function fakeRes(): any {
  let statusCode = 0; let body: any = null;
  return {
    status(c: number) { statusCode = c; return this; },
    json(b: any) { body = b; return this; },
    _get() { return { statusCode, body }; },
  };
}

function assert(cond: boolean, msg: string) {
  if (!cond) { console.error("FAIL:", msg); process.exit(1); }
  console.log("OK:", msg);
}

// Fingerprint stable
assert(fingerprint("abc") === fingerprint("abc"), "fingerprint deterministic");
assert(fingerprint("abc") !== fingerprint("abd"), "fingerprint differs by input");
assert(expectedFingerprint.length === 16, "fingerprint length 16");

// Missing header
{
  const res = fakeRes();
  mcpAuth(fakeReq(undefined), res, () => assert(false, "next() should not run on missing header"));
  const s = res._get();
  assert(s.statusCode === 401, "missing header → 401");
}
// Wrong token
{
  const res = fakeRes();
  mcpAuth(fakeReq("Bearer wrong"), res, () => assert(false, "next() should not run on wrong token"));
  const s = res._get();
  assert(s.statusCode === 401, "wrong token → 401");
}
// Correct token
{
  const res = fakeRes();
  let called = false;
  mcpAuth(fakeReq(`Bearer ${process.env.MCP_BEARER_TOKEN}`), res, () => { called = true; });
  assert(called, "correct token → next() called");
}

console.log("\nAll auth checks passed.");
```

Run: `npx tsx scripts/mcp/verify-auth.ts`
Expected: All "OK" lines and "All auth checks passed."

- [ ] **Step 3: Commit**

```bash
git add server/mcp/auth.ts scripts/mcp/verify-auth.ts
git commit -m "feat(mcp): bearer-token auth middleware with timing-safe compare"
```

### Task 2.2: Audit logger with arg sanitization

**Files:**
- Create: `server/mcp/audit.ts`

- [ ] **Step 1: Write `audit.ts`**

```ts
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
```

- [ ] **Step 2: Verification script**

Create `scripts/mcp/verify-audit-sanitize.ts`:

```ts
// Run: npx tsx scripts/mcp/verify-audit-sanitize.ts
import { sanitizeArgs } from "../../server/mcp/audit.js";

function eq(a: unknown, b: unknown) { return JSON.stringify(a) === JSON.stringify(b); }
function assert(cond: boolean, msg: string) {
  if (!cond) { console.error("FAIL:", msg); process.exit(1); }
  console.log("OK:", msg);
}

assert(sanitizeArgs(null) === null, "null passthrough");
assert(sanitizeArgs("hello") === "hello", "short string passthrough");
const big = "A".repeat(500);
assert(typeof sanitizeArgs(big) === "string" && (sanitizeArgs(big) as string).startsWith("[base64 elided"), "long base64-like elided");
const obj = { token: "abc", password: "xyz", api_key: "k", name: "ok", nested: { secret: "s", v: 1 } };
const out = sanitizeArgs(obj) as Record<string, any>;
assert(out.token === "[redacted]" && out.password === "[redacted]" && out.api_key === "[redacted]", "secret keys redacted");
assert(out.name === "ok", "normal field preserved");
assert(out.nested.secret === "[redacted]" && out.nested.v === 1, "nested secret redacted, nested value preserved");
assert(eq(sanitizeArgs([1, 2, "x"]), [1, 2, "x"]), "array passthrough");

console.log("\nAll audit sanitization checks passed.");
```

Run: `npx tsx scripts/mcp/verify-audit-sanitize.ts`
Expected: All "OK" lines and final pass message.

- [ ] **Step 3: Commit**

```bash
git add server/mcp/audit.ts scripts/mcp/verify-audit-sanitize.ts
git commit -m "feat(mcp): audit logger with arg sanitization (redacts secrets, elides base64)"
```

### Task 2.3: Tool registry, error helpers, and MCP server bootstrap

**Files:**
- Create: `server/mcp/errors.ts`
- Create: `server/mcp/registry.ts`

- [ ] **Step 1: Write `errors.ts`**

```ts
// server/mcp/errors.ts
// Standardized error helpers for MCP tools. McpToolError is converted to a tool
// response with isError=true; other thrown errors become 500-equivalent errors.

export class McpToolError extends Error {
  constructor(message: string, public readonly publicSummary?: string) {
    super(message);
    this.name = "McpToolError";
  }
}

export function asToolErrorResponse(message: string): {
  content: { type: "text"; text: string }[];
  isError: true;
} {
  return { content: [{ type: "text", text: message }], isError: true };
}
```

- [ ] **Step 2: Write `registry.ts`**

```ts
// server/mcp/registry.ts
// Central tool registry. Each tool registers a definition (for tools/list) and
// a runner (for tools/call). Runner is wrapped to record audit log and time.
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { writeAudit, type AuditPayload } from "./audit.js";
import { asToolErrorResponse, McpToolError } from "./errors.js";
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
```

- [ ] **Step 3: Commit**

```bash
git add server/mcp/errors.ts server/mcp/registry.ts
git commit -m "feat(mcp): tool registry with audit-wrapped handler dispatch"
```

### Task 2.4: Streamable HTTP transport bridge

**Files:**
- Create: `server/mcp/transport.ts`

- [ ] **Step 1: Write transport**

```ts
// server/mcp/transport.ts
// Bridges Express POST/GET/DELETE /mcp to the MCP Streamable HTTP transport.
// Stateless mode (sessionIdGenerator: undefined) — single-user agent, no
// long-lived sessions required.
import { Server as McpServer } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { wireRegistryToServer } from "./registry.js";
import type { Request, Response } from "express";

function buildServer(): McpServer {
  return new McpServer(
    { name: "cncxsoho-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );
}

export async function handleMcpRequest(req: Request, res: Response): Promise<void> {
  // Fresh server + transport per request — simplest correct stateless impl.
  const server = buildServer();
  wireRegistryToServer(server, () => ({
    agentId: req.mcpAuth!.agentId,
    tokenFingerprint: req.mcpAuth!.tokenFingerprint,
  }));
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    transport.close().catch(() => {});
    server.close().catch(() => {});
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}
```

- [ ] **Step 2: Commit**

```bash
git add server/mcp/transport.ts
git commit -m "feat(mcp): Streamable HTTP transport bridge (stateless)"
```

### Task 2.5: Router and mount into Express app

**Files:**
- Create: `server/mcp/index.ts`
- Create: `server/mcp/tools/index.ts` (initially empty registry — tools added in Phase 3+)
- Modify: `server/index.ts`

- [ ] **Step 1: Write `tools/index.ts` stub**

```ts
// server/mcp/tools/index.ts
// Imported for its side effects — each tool file calls registerTool() at module load.
// Phase 3+ will populate this file with concrete tool imports.
export function registerAllTools(): void {
  // Phase 3: import "./procedures.js"; import "./taxes.js"; ...
}
```

- [ ] **Step 2: Write `server/mcp/index.ts`**

```ts
// server/mcp/index.ts
// Express sub-router for /mcp.
import { Router, type Request, type Response } from "express";
import { mcpAuth } from "./auth.js";
import { handleMcpRequest } from "./transport.js";
import { registerAllTools } from "./tools/index.js";

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
```

- [ ] **Step 3: Mount in `server/index.ts`**

In `server/index.ts`, after `app.use(express.urlencoded(...))` (around line 33) and BEFORE the session middleware (line 36+), add:

```ts
import { mcpRouter } from "./mcp/index.js";
// ... existing imports ...

// (inside the existing setup, after express.json/urlencoded, before session)
app.use("/mcp", mcpRouter);
```

Concretely, edit `server/index.ts` line 5 area to add the import, and after line 33 (`app.use(express.urlencoded(...));`) add the `app.use("/mcp", mcpRouter);` line. The `/mcp` router does its own auth and does not need session middleware (and we WANT it before session middleware so MCP requests never touch the session store).

- [ ] **Step 4: Smoke test — health endpoint**

Create `scripts/mcp/verify-health.ts`:

```ts
// Run: npx tsx scripts/mcp/verify-health.ts
// Requires dev server running: npm run dev (in another terminal)
const BASE = process.env.MCP_BASE_URL ?? "http://localhost:5000";

async function main() {
  const r = await fetch(`${BASE}/mcp/health`);
  if (r.status !== 200) { console.error("FAIL: status", r.status); process.exit(1); }
  const body = await r.json() as any;
  if (body.status !== "ok") { console.error("FAIL: body", body); process.exit(1); }
  console.log("OK health:", body);
}
main().catch(e => { console.error(e); process.exit(1); });
```

Run (with `npm run dev` in another terminal): `npx tsx scripts/mcp/verify-health.ts`
Expected: `OK health: { status: 'ok', server: 'cncxsoho-mcp', ts: '...' }`

- [ ] **Step 5: Smoke test — auth rejection**

Create `scripts/mcp/verify-auth-http.ts`:

```ts
// Run: npx tsx scripts/mcp/verify-auth-http.ts
const BASE = process.env.MCP_BASE_URL ?? "http://localhost:5000";

async function main() {
  // No token → 401
  const r1 = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
  if (r1.status !== 401) { console.error("FAIL: no-token expected 401, got", r1.status); process.exit(1); }
  console.log("OK no-token → 401");

  // Wrong token → 401
  const r2 = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer wrong", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
  if (r2.status !== 401) { console.error("FAIL: wrong-token expected 401, got", r2.status); process.exit(1); }
  console.log("OK wrong-token → 401");

  console.log("\nAuth HTTP checks passed.");
}
main().catch(e => { console.error(e); process.exit(1); });
```

Run: `npx tsx scripts/mcp/verify-auth-http.ts`
Expected: Both OK lines, then "Auth HTTP checks passed."

- [ ] **Step 6: Commit**

```bash
git add server/mcp/index.ts server/mcp/tools/index.ts server/index.ts scripts/mcp/verify-health.ts scripts/mcp/verify-auth-http.ts
git commit -m "feat(mcp): mount /mcp router with health endpoint and auth-gated transport"
```

### Task 2.6: Verify tools/list handshake (with zero tools registered)

**Files:**
- Create: `scripts/mcp/verify-list-tools.ts`

- [ ] **Step 1: Write smoke script**

```ts
// Run: MCP_BEARER_TOKEN=<your-token> npx tsx scripts/mcp/verify-list-tools.ts
const BASE = process.env.MCP_BASE_URL ?? "http://localhost:5000";
const TOKEN = process.env.MCP_BEARER_TOKEN;
if (!TOKEN) { console.error("Set MCP_BEARER_TOKEN to your dev token"); process.exit(1); }

async function jsonRpc(method: string, params: any = {}) {
  const r = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
      "Authorization": `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`HTTP ${r.status}: ${t}`);
  }
  // Server may stream or respond once. Read full body.
  const ct = r.headers.get("content-type") ?? "";
  if (ct.includes("text/event-stream")) {
    const text = await r.text();
    // Parse first data: line as JSON.
    const m = /data:\s*(.+)/.exec(text);
    if (!m) throw new Error(`No data line in SSE response: ${text}`);
    return JSON.parse(m[1]);
  }
  return await r.json();
}

async function main() {
  // Initialize
  const init = await jsonRpc("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "cncxsoho-verify", version: "0.0.1" },
  });
  console.log("OK initialize:", init.result?.serverInfo);

  // tools/list
  const list = await jsonRpc("tools/list");
  const tools = list.result?.tools ?? [];
  console.log(`OK tools/list returned ${tools.length} tools`);
  for (const t of tools) console.log("  -", t.name);
}
main().catch(e => { console.error(e); process.exit(1); });
```

Run (dev server up, `.env` loaded with `MCP_BEARER_TOKEN`):
```
export $(grep MCP_BEARER_TOKEN .env | xargs)
npx tsx scripts/mcp/verify-list-tools.ts
```
Expected: prints `OK initialize: { name: 'cncxsoho-mcp', version: '0.1.0' }` and `OK tools/list returned 0 tools`.

- [ ] **Step 2: Commit**

```bash
git add scripts/mcp/verify-list-tools.ts
git commit -m "chore(mcp): add tools/list verification script"
```

---

## Phase 3 — Read Tools

> **Reuse strategy:** `server/ai-ask-tools.ts` already exports tested query functions: `runQueryProcedures`, `runQueryTaxes`, `runQueryExpenses`, `runQueryPayments`, `runQueryProducts`, `runQueryHsCodes`, `runQueryTimeSeries`. MCP read tools call these directly (no DB logic duplication).

### Task 3.1: Read tools for procedures/taxes/expenses/payments

**Files:**
- Create: `server/mcp/tools/procedures.ts`
- Create: `server/mcp/tools/taxes.ts`
- Create: `server/mcp/tools/expenses.ts`
- Create: `server/mcp/tools/payments.ts`
- Modify: `server/mcp/tools/index.ts`

- [ ] **Step 1: Write `procedures.ts` (read tools only — write tools come in Phase 4)**

```ts
// server/mcp/tools/procedures.ts
import { registerTool } from "../registry.js";
import { runQueryProcedures } from "../../ai-ask-tools.js";
import { storage } from "../../storage.js";

registerTool({
  name: "read_procedures",
  tier: "read",
  description: "List import procedures with optional filters. Returns rows + totals_by_currency and counts.",
  inputSchema: {
    type: "object",
    properties: {
      company: { type: "string", description: "ALO, AMIRI, SOHO, or company name substring" },
      shipper_contains: { type: "string" },
      reference_contains: { type: "string" },
      arrival_date_from: { type: "string", description: "YYYY-MM-DD" },
      arrival_date_to: { type: "string", description: "YYYY-MM-DD" },
      invoice_date_from: { type: "string", description: "YYYY-MM-DD" },
      invoice_date_to: { type: "string", description: "YYYY-MM-DD" },
      list_limit: { type: "integer", minimum: 0, maximum: 500, default: 50 },
      group_by: { type: "string", description: "e.g. shipper, company, month" },
    },
    additionalProperties: false,
  },
  handler: async (args) => ({ data: await runQueryProcedures(args) }),
});

registerTool({
  name: "read_procedure_detail",
  tier: "read",
  description: "Fetch one procedure plus its linked tax, expenses, invoices, and payments.",
  inputSchema: {
    type: "object",
    properties: { id: { type: "integer" }, reference: { type: "string" } },
    additionalProperties: false,
  },
  handler: async (args: any) => {
    let proc;
    if (args.id) proc = await storage.getProcedure(args.id);
    else if (args.reference) {
      const arr = await storage.getProcedureByReference(args.reference);
      proc = arr[0];
    } else {
      throw new Error("read_procedure_detail requires either id or reference");
    }
    if (!proc) return { data: { procedure: null } };
    const [tax, expenses, invoices] = await Promise.all([
      storage.getTaxByProcedureReference(proc.reference),
      storage.getImportExpensesByReference(proc.reference),
      storage.getImportServiceInvoicesByReference(proc.reference),
    ]);
    return { data: { procedure: proc, tax: tax ?? null, expenses, serviceInvoices: invoices } };
  },
});
```

- [ ] **Step 2: Write `taxes.ts`**

```ts
// server/mcp/tools/taxes.ts
import { registerTool } from "../registry.js";
import { runQueryTaxes } from "../../ai-ask-tools.js";

registerTool({
  name: "read_taxes",
  tier: "read",
  description: "Query tax records (procedure-level taxes). Supports filters by procedure, type, date range.",
  inputSchema: {
    type: "object",
    properties: {
      procedure_id: { type: "integer" },
      reference_contains: { type: "string" },
      tax_type: { type: "string" },
      date_from: { type: "string", description: "YYYY-MM-DD" },
      date_to: { type: "string", description: "YYYY-MM-DD" },
      list_limit: { type: "integer", minimum: 0, maximum: 500, default: 50 },
      group_by: { type: "string" },
    },
    additionalProperties: false,
  },
  handler: async (args) => ({ data: await runQueryTaxes(args) }),
});
```

- [ ] **Step 3: Write `expenses.ts`**

```ts
// server/mcp/tools/expenses.ts
import { registerTool } from "../registry.js";
import { runQueryExpenses } from "../../ai-ask-tools.js";

registerTool({
  name: "read_expenses",
  tier: "read",
  description: "Query import expenses and service invoice expenses. Supports filters by category, issuer, date, procedure.",
  inputSchema: {
    type: "object",
    properties: {
      procedure_id: { type: "integer" },
      reference_contains: { type: "string" },
      category: { type: "string", description: "Expense category enum value" },
      issuer_contains: { type: "string", description: "Match issuer column (NOT notes)" },
      currency: { type: "string", description: "TL, USD, EUR…" },
      date_from: { type: "string", description: "YYYY-MM-DD" },
      date_to: { type: "string", description: "YYYY-MM-DD" },
      list_limit: { type: "integer", minimum: 0, maximum: 500, default: 50 },
      group_by: { type: "string", description: "category, issuer, currency, month" },
    },
    additionalProperties: false,
  },
  handler: async (args) => ({ data: await runQueryExpenses(args) }),
});
```

- [ ] **Step 4: Write `payments.ts`**

```ts
// server/mcp/tools/payments.ts
import { registerTool } from "../registry.js";
import { runQueryPayments } from "../../ai-ask-tools.js";

registerTool({
  name: "read_payments",
  tier: "read",
  description: "Query outgoing payments and their distributions. Note: payments table has no currency column — currency lives on the parent procedure.",
  inputSchema: {
    type: "object",
    properties: {
      procedure_id: { type: "integer" },
      reference_contains: { type: "string" },
      type: { type: "string", description: "advance | balance" },
      status: { type: "string" },
      date_from: { type: "string", description: "YYYY-MM-DD" },
      date_to: { type: "string", description: "YYYY-MM-DD" },
      list_limit: { type: "integer", minimum: 0, maximum: 500, default: 50 },
      group_by: { type: "string" },
    },
    additionalProperties: false,
  },
  handler: async (args) => ({ data: await runQueryPayments(args) }),
});
```

- [ ] **Step 5: Update `tools/index.ts` to load these modules**

```ts
// server/mcp/tools/index.ts
// Imported for its side effects — each tool file calls registerTool() at module load.
export function registerAllTools(): void {
  // Read tools (Phase 3)
  require("./procedures.js");
  require("./taxes.js");
  require("./expenses.js");
  require("./payments.js");
}
```

- [ ] **Step 6: Verify tools/list now returns 5 tools**

Run: `npx tsx scripts/mcp/verify-list-tools.ts` (dev server still up)
Expected: `OK tools/list returned 5 tools` and the names listed: `read_procedures`, `read_procedure_detail`, `read_taxes`, `read_expenses`, `read_payments`.

- [ ] **Step 7: Commit**

```bash
git add server/mcp/tools/procedures.ts server/mcp/tools/taxes.ts server/mcp/tools/expenses.ts server/mcp/tools/payments.ts server/mcp/tools/index.ts
git commit -m "feat(mcp): add read tools for procedures, taxes, expenses, payments"
```

### Task 3.2: Read tools for invoices/products/reports/audit-log

**Files:**
- Create: `server/mcp/tools/invoices.ts`
- Create: `server/mcp/tools/products.ts`
- Create: `server/mcp/tools/reports.ts`
- Modify: `server/mcp/tools/index.ts`

- [ ] **Step 1: Write `invoices.ts`**

```ts
// server/mcp/tools/invoices.ts
import { registerTool } from "../registry.js";
import { storage } from "../../storage.js";

registerTool({
  name: "read_invoices",
  tier: "read",
  description: "List service invoices for a procedure or across procedures, with line items.",
  inputSchema: {
    type: "object",
    properties: {
      procedure_id: { type: "integer" },
      reference: { type: "string", description: "Exact procedure reference" },
      list_limit: { type: "integer", minimum: 0, maximum: 500, default: 50 },
    },
    additionalProperties: false,
  },
  handler: async (args: any) => {
    if (args.reference) {
      const invoices = await storage.getImportServiceInvoicesByReference(args.reference);
      return { data: { invoices: invoices.slice(0, args.list_limit ?? 50), count: invoices.length } };
    }
    const all = await storage.getAllImportServiceInvoices();
    return { data: { invoices: all.slice(0, args.list_limit ?? 50), count: all.length } };
  },
});
```

- [ ] **Step 2: Write `products.ts`**

```ts
// server/mcp/tools/products.ts
import { registerTool } from "../registry.js";
import { runQueryProducts, runQueryHsCodes } from "../../ai-ask-tools.js";

registerTool({
  name: "read_products",
  tier: "read",
  description: "Search products by style/description/hts_code substring. Returns matched products with their HS code linkage.",
  inputSchema: {
    type: "object",
    properties: {
      style_contains: { type: "string" },
      description_contains: { type: "string" },
      hts_code_contains: { type: "string" },
      list_limit: { type: "integer", minimum: 0, maximum: 500, default: 50 },
    },
    additionalProperties: false,
  },
  handler: async (args) => ({ data: await runQueryProducts(args) }),
});

registerTool({
  name: "read_hs_codes",
  tier: "read",
  description: "Search Turkish HS codes (customs tariff). Returns HS code, description, customs/VAT/KKDF rates.",
  inputSchema: {
    type: "object",
    properties: {
      code_contains: { type: "string" },
      description_contains: { type: "string" },
      list_limit: { type: "integer", minimum: 0, maximum: 500, default: 50 },
    },
    additionalProperties: false,
  },
  handler: async (args) => ({ data: await runQueryHsCodes(args) }),
});
```

- [ ] **Step 3: Write `reports.ts`**

```ts
// server/mcp/tools/reports.ts
import { registerTool } from "../registry.js";
import { runQueryTimeSeries } from "../../ai-ask-tools.js";
import { db } from "../../db.js";
import { agentAuditLog } from "@shared/schema";
import { desc, eq, gte, and } from "drizzle-orm";

registerTool({
  name: "read_time_series",
  tier: "read",
  description: "Aggregate any of {procedures, taxes, expenses, payments} by month/year. Returns time-series data for charts.",
  inputSchema: {
    type: "object",
    properties: {
      table: { type: "string", enum: ["procedures", "taxes", "expenses", "payments"] },
      bucket: { type: "string", enum: ["month", "year"], default: "month" },
      metric: { type: "string", description: "count | sum_amount | sum_total" },
      date_from: { type: "string" },
      date_to: { type: "string" },
      filters: { type: "object", additionalProperties: true },
    },
    required: ["table"],
    additionalProperties: false,
  },
  handler: async (args) => ({ data: await runQueryTimeSeries(args) }),
});

registerTool({
  name: "read_audit_log",
  tier: "read",
  description: "Query the MCP agent's own audit log. Useful to verify a write tool actually committed, or to debug a failed task.",
  inputSchema: {
    type: "object",
    properties: {
      tool: { type: "string", description: "Filter by tool name" },
      tier: { type: "string", enum: ["read", "write", "destructive", "ai"] },
      since_ts: { type: "string", description: "ISO timestamp; only rows newer than this" },
      transaction_id: { type: "string" },
      limit: { type: "integer", minimum: 1, maximum: 500, default: 50 },
    },
    additionalProperties: false,
  },
  handler: async (args: any) => {
    const conds = [];
    if (args.tool) conds.push(eq(agentAuditLog.tool, args.tool));
    if (args.tier) conds.push(eq(agentAuditLog.tier, args.tier));
    if (args.transaction_id) conds.push(eq(agentAuditLog.transactionId, args.transaction_id));
    if (args.since_ts) conds.push(gte(agentAuditLog.ts, new Date(args.since_ts)));
    const where = conds.length ? and(...conds) : undefined;
    const rows = await db.select().from(agentAuditLog)
      .where(where as any)
      .orderBy(desc(agentAuditLog.ts))
      .limit(args.limit ?? 50);
    return { data: { rows, count: rows.length } };
  },
});
```

- [ ] **Step 4: Update `tools/index.ts`**

```ts
// server/mcp/tools/index.ts
export function registerAllTools(): void {
  require("./procedures.js");
  require("./taxes.js");
  require("./expenses.js");
  require("./payments.js");
  require("./invoices.js");
  require("./products.js");
  require("./reports.js");
}
```

- [ ] **Step 5: Smoke-test read tools end-to-end**

Create `scripts/mcp/verify-read-tools.ts`:

```ts
// Run: MCP_BEARER_TOKEN=<your-token> npx tsx scripts/mcp/verify-read-tools.ts
const BASE = process.env.MCP_BASE_URL ?? "http://localhost:5000";
const TOKEN = process.env.MCP_BEARER_TOKEN;
if (!TOKEN) { console.error("Set MCP_BEARER_TOKEN"); process.exit(1); }

async function call(method: string, params: any) {
  const r = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
      "Authorization": `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
  const ct = r.headers.get("content-type") ?? "";
  if (ct.includes("text/event-stream")) {
    const t = await r.text();
    const m = /data:\s*(.+)/.exec(t);
    if (!m) throw new Error(`No data line: ${t}`);
    return JSON.parse(m[1]);
  }
  return r.json();
}

async function callTool(name: string, args: any) {
  const r = await call("tools/call", { name, arguments: args });
  if (r.error) throw new Error(`${name}: ${JSON.stringify(r.error)}`);
  if (r.result?.isError) throw new Error(`${name}: ${r.result.content?.[0]?.text}`);
  const textBlock = r.result?.content?.[0]?.text;
  return textBlock ? JSON.parse(textBlock) : null;
}

async function main() {
  // Init handshake first
  await call("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "verify", version: "0.0.1" } });

  console.log("--- read_procedures ---");
  const procs = await callTool("read_procedures", { list_limit: 3 });
  console.log("Got", procs?.count ?? procs?.rows?.length ?? "?", "procedures (limit 3)");

  console.log("--- read_taxes ---");
  const taxes = await callTool("read_taxes", { list_limit: 3 });
  console.log("Got taxes:", typeof taxes === "object" ? "ok" : "fail");

  console.log("--- read_expenses ---");
  const exp = await callTool("read_expenses", { list_limit: 3 });
  console.log("Got expenses:", typeof exp === "object" ? "ok" : "fail");

  console.log("--- read_payments ---");
  const pay = await callTool("read_payments", { list_limit: 3 });
  console.log("Got payments:", typeof pay === "object" ? "ok" : "fail");

  console.log("--- read_audit_log ---");
  const audit = await callTool("read_audit_log", { limit: 5 });
  console.log("Got audit rows:", audit.count, "(expected: >= 5, since we just made 4+ calls)");

  console.log("\nAll read-tool checks passed.");
}
main().catch(e => { console.error("FAIL:", e); process.exit(1); });
```

Run (dev server up): `npx tsx scripts/mcp/verify-read-tools.ts`
Expected: all "Got ..." lines succeed; final audit log contains at least 5 rows.

- [ ] **Step 6: Commit**

```bash
git add server/mcp/tools/invoices.ts server/mcp/tools/products.ts server/mcp/tools/reports.ts server/mcp/tools/index.ts scripts/mcp/verify-read-tools.ts
git commit -m "feat(mcp): add read tools for invoices, products, hs_codes, time_series, audit_log"
```

> **🎯 Phase 3 milestone:** Cowork can now be connected and asked read-only questions. Test from Cowork before continuing to Phase 4 — see [Phase 7 — End-to-end testing](#phase-7--end-to-end-testing) for the connection guide.

---

## Phase 4 — Write Tools

> **Pattern:** Every write handler runs inside `db.transaction()`. Before the change, capture the "before" state and attach it to `meta.before` so the registry writes it to audit log. Return `meta.affectedTable` and `meta.affectedIds`.

### Task 4.1: Write tools for procedures and expenses

**Files:**
- Modify: `server/mcp/tools/procedures.ts` (append write tools)
- Modify: `server/mcp/tools/expenses.ts` (append write tools)
- Modify: `server/mcp/tools/index.ts` — no change (modules already imported)

- [ ] **Step 1: Append write tools to `procedures.ts`**

Add to the end of `server/mcp/tools/procedures.ts`:

```ts
import { db } from "../../db.js";
import { procedures as proceduresTable } from "@shared/schema";
import { eq } from "drizzle-orm";
import { McpToolError } from "../errors.js";

registerTool({
  name: "write_create_procedure",
  tier: "write",
  description: "Create a new import procedure. Returns the created row with assigned id.",
  inputSchema: {
    type: "object",
    properties: {
      reference: { type: "string", description: "Unique procedure reference (required)" },
      company: { type: "string" },
      shipper: { type: "string" },
      arrival_date: { type: "string", description: "YYYY-MM-DD" },
      invoice_date: { type: "string", description: "YYYY-MM-DD" },
      invoice_no: { type: "string" },
      origin_country: { type: "string" },
      notes: { type: "string" },
    },
    required: ["reference"],
    additionalProperties: true, // permissive: allow any column on procedures table
  },
  handler: async (args: any) => {
    return await db.transaction(async (tx) => {
      // Inside transaction, use raw tx for atomicity. storage layer uses default db.
      const [created] = await tx.insert(proceduresTable).values(args).returning();
      if (!created) throw new McpToolError("Insert returned no row");
      return {
        data: { procedure: created },
        meta: { affectedTable: "procedures", affectedIds: [created.id], summary: `Created procedure ${created.reference}` },
      };
    });
  },
});

registerTool({
  name: "write_update_procedure",
  tier: "write",
  description: "Patch fields on an existing procedure. Records 'before' state in audit log for reversibility.",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "integer" },
      patch: { type: "object", description: "Partial procedure fields to update", additionalProperties: true },
    },
    required: ["id", "patch"],
    additionalProperties: false,
  },
  handler: async (args: any) => {
    return await db.transaction(async (tx) => {
      const [before] = await tx.select().from(proceduresTable).where(eq(proceduresTable.id, args.id));
      if (!before) throw new McpToolError(`Procedure ${args.id} not found`);
      const [after] = await tx.update(proceduresTable).set(args.patch).where(eq(proceduresTable.id, args.id)).returning();
      return {
        data: { procedure: after },
        meta: {
          affectedTable: "procedures",
          affectedIds: [args.id],
          before,
          summary: `Updated procedure ${args.id}: ${Object.keys(args.patch).join(", ")}`,
        },
      };
    });
  },
});
```

- [ ] **Step 2: Append write tools to `expenses.ts`**

Add to the end of `server/mcp/tools/expenses.ts`:

```ts
import { db } from "../../db.js";
import { importExpenses, importServiceInvoices } from "@shared/schema";
import { eq } from "drizzle-orm";
import { McpToolError } from "../errors.js";

registerTool({
  name: "write_create_import_expense",
  tier: "write",
  description: "Create an import expense (transportation, AWB, customs, etc.). Returns the created row.",
  inputSchema: {
    type: "object",
    properties: {
      reference: { type: "string", description: "Linked procedure reference (required)" },
      category: { type: "string", description: "expense_category enum value" },
      issuer: { type: "string" },
      invoice_no: { type: "string" },
      invoice_date: { type: "string", description: "YYYY-MM-DD" },
      amount: { type: "string", description: "Decimal as string, e.g. '1234.50'" },
      currency: { type: "string", description: "TL, USD, EUR…" },
      notes: { type: "string" },
    },
    required: ["reference", "category", "amount"],
    additionalProperties: true,
  },
  handler: async (args: any) => {
    return await db.transaction(async (tx) => {
      const [created] = await tx.insert(importExpenses).values(args).returning();
      if (!created) throw new McpToolError("Insert returned no row");
      return {
        data: { expense: created },
        meta: { affectedTable: "import_expenses", affectedIds: [created.id], summary: `Created expense ${created.id}` },
      };
    });
  },
});

registerTool({
  name: "write_create_service_invoice",
  tier: "write",
  description: "Create a service invoice (e.g. customs broker fee). Returns the created row.",
  inputSchema: {
    type: "object",
    properties: {
      reference: { type: "string" },
      issuer: { type: "string" },
      invoice_no: { type: "string" },
      invoice_date: { type: "string" },
      amount: { type: "string" },
      currency: { type: "string" },
      notes: { type: "string" },
    },
    required: ["reference", "amount"],
    additionalProperties: true,
  },
  handler: async (args: any) => {
    return await db.transaction(async (tx) => {
      const [created] = await tx.insert(importServiceInvoices).values(args).returning();
      if (!created) throw new McpToolError("Insert returned no row");
      return {
        data: { invoice: created },
        meta: { affectedTable: "import_service_invoices", affectedIds: [created.id], summary: `Created service invoice ${created.id}` },
      };
    });
  },
});
```

- [ ] **Step 3: Verify tools/list now returns 14 tools**

Run: `npx tsx scripts/mcp/verify-list-tools.ts`
Expected: `OK tools/list returned 14 tools` (10 read tools from Phase 3 + 4 write tools from this task). Confirm names include: `write_create_procedure`, `write_update_procedure`, `write_create_import_expense`, `write_create_service_invoice`.

- [ ] **Step 4: Commit**

```bash
git add server/mcp/tools/procedures.ts server/mcp/tools/expenses.ts
git commit -m "feat(mcp): add write tools for procedures and expenses (transactional, audit-logged)"
```

### Task 4.2: Write tools for payments, invoices, products

**Files:**
- Modify: `server/mcp/tools/payments.ts` (append)
- Modify: `server/mcp/tools/invoices.ts` (append)
- Modify: `server/mcp/tools/products.ts` (append)

- [ ] **Step 1: Append to `payments.ts`**

```ts
import { db } from "../../db.js";
import { payments as paymentsTable, paymentDistributions } from "@shared/schema";
import { eq, sum } from "drizzle-orm";
import { McpToolError } from "../errors.js";

registerTool({
  name: "write_create_payment",
  tier: "write",
  description: "Create a payment (advance or balance) against a procedure.",
  inputSchema: {
    type: "object",
    properties: {
      reference: { type: "string", description: "Linked procedure reference" },
      type: { type: "string", enum: ["advance", "balance"] },
      amount: { type: "string", description: "Decimal as string" },
      payment_date: { type: "string", description: "YYYY-MM-DD" },
      notes: { type: "string" },
    },
    required: ["reference", "type", "amount"],
    additionalProperties: true,
  },
  handler: async (args: any) => {
    return await db.transaction(async (tx) => {
      const [created] = await tx.insert(paymentsTable).values(args).returning();
      if (!created) throw new McpToolError("Insert returned no row");
      return {
        data: { payment: created },
        meta: { affectedTable: "payments", affectedIds: [created.id], summary: `Created ${args.type} payment ${created.id}` },
      };
    });
  },
});

registerTool({
  name: "write_distribute_payment",
  tier: "write",
  description: "Distribute a payment to one or more line items / categories. Validates sum equals payment amount.",
  inputSchema: {
    type: "object",
    properties: {
      payment_id: { type: "integer" },
      allocations: {
        type: "array",
        items: {
          type: "object",
          properties: {
            target_type: { type: "string", description: "expense | invoice | tax | other" },
            target_id: { type: "integer" },
            amount: { type: "string" },
            notes: { type: "string" },
          },
          required: ["target_type", "amount"],
        },
      },
    },
    required: ["payment_id", "allocations"],
    additionalProperties: false,
  },
  handler: async (args: any) => {
    return await db.transaction(async (tx) => {
      const [pay] = await tx.select().from(paymentsTable).where(eq(paymentsTable.id, args.payment_id));
      if (!pay) throw new McpToolError(`Payment ${args.payment_id} not found`);
      const total = args.allocations.reduce((s: number, a: any) => s + parseFloat(a.amount), 0);
      const payAmount = parseFloat((pay as any).amount ?? "0");
      if (Math.abs(total - payAmount) > 0.01) {
        throw new McpToolError(`Allocation total ${total} does not equal payment amount ${payAmount}`);
      }
      const rows = await Promise.all(args.allocations.map((a: any) =>
        tx.insert(paymentDistributions).values({ paymentId: args.payment_id, ...a }).returning()
      ));
      const createdIds = rows.flat().map((r: any) => r.id);
      return {
        data: { distributions: rows.flat() },
        meta: { affectedTable: "payment_distributions", affectedIds: createdIds, summary: `Distributed payment ${args.payment_id} into ${createdIds.length} allocations` },
      };
    });
  },
});
```

- [ ] **Step 2: Append to `invoices.ts`**

```ts
import { db } from "../../db.js";
import { importServiceInvoices, invoiceLineItems } from "@shared/schema";
import { McpToolError } from "../errors.js";

registerTool({
  name: "write_create_invoice_with_line_items",
  tier: "write",
  description: "Create a service invoice plus its line items atomically.",
  inputSchema: {
    type: "object",
    properties: {
      invoice: {
        type: "object",
        properties: {
          reference: { type: "string" },
          issuer: { type: "string" },
          invoice_no: { type: "string" },
          invoice_date: { type: "string" },
          amount: { type: "string" },
          currency: { type: "string" },
        },
        required: ["reference", "amount"],
        additionalProperties: true,
      },
      line_items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            description: { type: "string" },
            quantity: { type: "string" },
            unit_price: { type: "string" },
            total: { type: "string" },
          },
        },
      },
    },
    required: ["invoice", "line_items"],
    additionalProperties: false,
  },
  handler: async (args: any) => {
    return await db.transaction(async (tx) => {
      const [inv] = await tx.insert(importServiceInvoices).values(args.invoice).returning();
      if (!inv) throw new McpToolError("Invoice insert returned no row");
      const items = args.line_items.length
        ? await tx.insert(invoiceLineItems).values(
            args.line_items.map((li: any) => ({ ...li, invoiceId: inv.id }))
          ).returning()
        : [];
      return {
        data: { invoice: inv, line_items: items },
        meta: { affectedTable: "import_service_invoices", affectedIds: [inv.id], summary: `Created invoice ${inv.id} with ${items.length} line items` },
      };
    });
  },
});
```

- [ ] **Step 3: Append to `products.ts`**

```ts
import { db } from "../../db.js";
import { products as productsTable, hsCodes as hsCodesTable } from "@shared/schema";
import { eq } from "drizzle-orm";
import { McpToolError } from "../errors.js";

registerTool({
  name: "write_create_product",
  tier: "write",
  description: "Create a new product with optional HS code linkage. Returns the created row.",
  inputSchema: {
    type: "object",
    properties: {
      style: { type: "string" },
      description: { type: "string" },
      hts_code: { type: "string" },
      fabric_content: { type: "string" },
      category: { type: "string" },
    },
    required: ["style"],
    additionalProperties: true,
  },
  handler: async (args: any) => {
    return await db.transaction(async (tx) => {
      // Reject obvious duplicates by style + hts_code
      if (args.style && args.hts_code) {
        const existing = await tx.select().from(productsTable)
          .where(eq(productsTable.style, args.style))
          .limit(1);
        if (existing.length) throw new McpToolError(`Product with style "${args.style}" already exists (id=${existing[0].id})`);
      }
      const [created] = await tx.insert(productsTable).values(args).returning();
      if (!created) throw new McpToolError("Insert returned no row");
      return {
        data: { product: created },
        meta: { affectedTable: "products", affectedIds: [created.id], summary: `Created product ${created.id} (style=${created.style})` },
      };
    });
  },
});
```

- [ ] **Step 4: Smoke-test write tools**

Create `scripts/mcp/verify-write-tools.ts`:

```ts
// Run: MCP_BEARER_TOKEN=<token> npx tsx scripts/mcp/verify-write-tools.ts
// Creates and then deletes a test procedure to confirm round-trip.
const BASE = process.env.MCP_BASE_URL ?? "http://localhost:5000";
const TOKEN = process.env.MCP_BEARER_TOKEN!;

async function call(method: string, params: any) {
  const r = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json, text/event-stream", "Authorization": `Bearer ${TOKEN}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
  const ct = r.headers.get("content-type") ?? "";
  if (ct.includes("text/event-stream")) {
    const t = await r.text();
    const m = /data:\s*(.+)/.exec(t);
    if (!m) throw new Error(`No data line: ${t}`);
    return JSON.parse(m[1]);
  }
  return r.json();
}
async function callTool(name: string, args: any) {
  const r = await call("tools/call", { name, arguments: args });
  if (r.error) throw new Error(`${name}: ${JSON.stringify(r.error)}`);
  if (r.result?.isError) throw new Error(`${name}: ${r.result.content?.[0]?.text}`);
  return JSON.parse(r.result.content[0].text);
}

async function main() {
  await call("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "verify-write", version: "0.0.1" } });

  const ref = `MCP-TEST-${Date.now()}`;
  console.log("--- write_create_procedure ---");
  const created = await callTool("write_create_procedure", {
    reference: ref, company: "ALO", shipper: "MCP Test Shipper", notes: "auto-generated by verify-write-tools.ts",
  });
  console.log("Created procedure id =", created.procedure.id);

  console.log("--- write_update_procedure ---");
  const updated = await callTool("write_update_procedure", {
    id: created.procedure.id, patch: { notes: "updated by verify script" },
  });
  console.log("Updated notes =", updated.procedure.notes);

  console.log("--- read_audit_log (latest) ---");
  const audit = await callTool("read_audit_log", { tool: "write_update_procedure", limit: 1 });
  const last = audit.rows?.[0];
  if (!last || !last.before_json) throw new Error("audit entry missing 'before_json'");
  console.log("OK before_json captured:", JSON.parse(last.before_json).notes);

  console.log("\n‼ CLEANUP: this test procedure was NOT deleted. Manual delete via DB if you want it gone:");
  console.log(`  DELETE FROM procedures WHERE id = ${created.procedure.id};`);
}
main().catch(e => { console.error("FAIL:", e); process.exit(1); });
```

Run: `npx tsx scripts/mcp/verify-write-tools.ts`
Expected: All 3 sections succeed. Final note tells you the test procedure id for manual cleanup. (Phase 6 will add a `destructive_delete_record` tool that could handle this cleanup automatically.)

- [ ] **Step 5: Commit**

```bash
git add server/mcp/tools/payments.ts server/mcp/tools/invoices.ts server/mcp/tools/products.ts scripts/mcp/verify-write-tools.ts
git commit -m "feat(mcp): add write tools for payments, invoices, products (transactional)"
```

### Task 4.3: Write tools for tax calculation, Excel import, document attach

**Files:**
- Modify: `server/mcp/tools/taxes.ts` (append)
- Create: `server/mcp/tools/excel.ts`
- Create: `server/mcp/tools/attach.ts`
- Modify: `server/mcp/tools/index.ts`

> **Reuse strategy:** these 3 tools wrap existing route handlers / services rather than reimplementing logic. The first sub-step in each is to grep for the existing implementation, then expose it as a tool.

- [ ] **Step 1: Locate tax-calculation orchestration**

Run: `grep -nE "calculateItemTax|calculateAllTaxes|persistTaxResult|insertTax\(" server/*.ts`
Note which function takes a procedure id + invoice + items and writes the resulting `Tax` row. Likely candidates: `server/tax-calculation-service.ts` (has per-item `calculateItemTax`); orchestration may live in `server/routes.ts` (search there too).

If a single orchestrating function exists, use it. If not, this task assembles one inline (see Step 2).

- [ ] **Step 2: Append `write_calculate_tax` to `taxes.ts`**

Add to `server/mcp/tools/taxes.ts` (after the existing `read_taxes` registration):

```ts
import { db } from "../../db.js";
import { taxes as taxesTable, taxCalculations, taxCalculationItems, hsCodes } from "@shared/schema";
import { eq, inArray } from "drizzle-orm";
import { calculateItemTax, isAtrExemptCountry, type AtrContext } from "../../tax-calculation-service.js";
import { McpToolError } from "../errors.js";

registerTool({
  name: "write_calculate_tax",
  tier: "write",
  description: "Run customs/VAT/KKDF tax calculation for an existing tax_calculations row (with items + HS codes), then write the aggregated result into the taxes table for the procedure. Pass tax_calculation_id; returns the aggregated result.",
  inputSchema: {
    type: "object",
    properties: {
      tax_calculation_id: { type: "integer", description: "id from tax_calculations table (the invoice header for the tax calc)" },
      procedure_reference: { type: "string", description: "Procedure reference to attach the resulting taxes row to" },
    },
    required: ["tax_calculation_id", "procedure_reference"],
    additionalProperties: false,
  },
  handler: async (args: any) => {
    return await db.transaction(async (tx) => {
      const [calc] = await tx.select().from(taxCalculations).where(eq(taxCalculations.id, args.tax_calculation_id));
      if (!calc) throw new McpToolError(`tax_calculations id ${args.tax_calculation_id} not found`);
      const items = await tx.select().from(taxCalculationItems).where(eq(taxCalculationItems.tax_calculation_id, args.tax_calculation_id));
      if (items.length === 0) throw new McpToolError("No items found for this tax_calculation_id");

      const htsCodesNeeded = Array.from(new Set(items.map((i: any) => i.hts_code).filter(Boolean))) as string[];
      const hsRows = htsCodesNeeded.length
        ? await tx.select().from(hsCodes).where(inArray(hsCodes.code, htsCodesNeeded))
        : [];
      const hsByCode = new Map(hsRows.map((r: any) => [r.code, r]));

      const atrContext: AtrContext | undefined = (calc as any).is_atr
        ? { isAtr: true, atrRatesMap: new Map() }
        : undefined;

      let totalCustoms = 0, totalAdditional = 0, totalKkdf = 0, totalVat = 0, totalUsd = 0, totalTl = 0;
      const perItem: any[] = [];
      for (const item of items as any[]) {
        const hs = hsByCode.get(item.hts_code);
        if (!hs) {
          perItem.push({ item_id: item.id, error: `HS code ${item.hts_code} not found` });
          continue;
        }
        const r = await calculateItemTax(item, calc as any, hs as any, atrContext);
        perItem.push({ item_id: item.id, result: r });
        totalCustoms += r.customs_tax;
        totalAdditional += r.additional_customs_tax;
        totalKkdf += r.kkdf;
        totalVat += r.vat;
        totalUsd += r.total_tax_usd;
        totalTl += r.total_tax_tl;
      }

      const aggregate = {
        procedure_reference: args.procedure_reference,
        tax_calculation_id: args.tax_calculation_id,
        customs_tax: totalCustoms.toFixed(2),
        additional_customs_tax: totalAdditional.toFixed(2),
        kkdf: totalKkdf.toFixed(2),
        vat: totalVat.toFixed(2),
        total_tax_usd: totalUsd.toFixed(2),
        total_tax_tl: totalTl.toFixed(2),
      };

      // Upsert into taxes table by procedure_reference.
      const [before] = await tx.select().from(taxesTable).where(eq(taxesTable.procedure_reference, args.procedure_reference));
      let after;
      if (before) {
        const [updated] = await tx.update(taxesTable).set(aggregate as any).where(eq(taxesTable.id, before.id)).returning();
        after = updated;
      } else {
        const [inserted] = await tx.insert(taxesTable).values(aggregate as any).returning();
        after = inserted;
      }
      return {
        data: { taxes_row: after, per_item: perItem },
        meta: {
          affectedTable: "taxes",
          affectedIds: [after.id],
          before: before ?? null,
          summary: `Calculated taxes for procedure ${args.procedure_reference}: VAT=${aggregate.vat}, Customs=${aggregate.customs_tax}`,
        },
      };
    });
  },
});
```

> **If the schema column names in your `shared/schema.ts` differ from what's used here** (e.g., `procedure_reference` vs `procedureReference`), match the actual Drizzle column name. The pattern is correct; only the casing may need adjustment.

- [ ] **Step 3: Locate Excel import handler**

Run: `grep -nE "(read|parse|import).*[Ee]xcel|XLSX\.read|exceljs" server/*.ts server/routes.ts | head -30`
Note the function that takes a buffer/file and inserts rows. Common candidates: a route handler under `/api/import-expenses/excel` or similar. Record the function name(s) — you'll wrap them.

- [ ] **Step 4: Write `excel.ts`**

Create `server/mcp/tools/excel.ts`:

```ts
// server/mcp/tools/excel.ts
// Bulk Excel import. Wraps the existing Excel parsing helper. The PARSER
// function must be exported from one of:
//   - server/excel-enrichment.ts
//   - server/master-excel-helper.ts
// If it's currently inline inside server/routes.ts, refactor minimally:
// extract the parsing function to server/excel-enrichment.ts and `export`
// it. Do NOT change route behavior.
import { registerTool } from "../registry.js";
import { McpToolError } from "../errors.js";
import { db } from "../../db.js";
import { importExpenses, importServiceInvoices } from "@shared/schema";
// Adjust to the actual exported parser function from Step 3:
import * as excelHelper from "../../excel-enrichment.js";

registerTool({
  name: "write_import_excel",
  tier: "write",
  description: "Bulk-import rows from a base64-encoded Excel file. The `type` parameter selects target table.",
  inputSchema: {
    type: "object",
    properties: {
      xlsx_base64: { type: "string", description: "Base64-encoded .xlsx file (NO data: prefix)." },
      type: { type: "string", enum: ["import_expenses", "import_service_invoices"], description: "Target table for inserted rows" },
      dry_run: { type: "boolean", default: false, description: "If true, parse and validate but DO NOT insert." },
    },
    required: ["xlsx_base64", "type"],
    additionalProperties: false,
  },
  handler: async (args: any) => {
    const buf = Buffer.from(args.xlsx_base64, "base64");
    // Resolve parser based on what's actually exported. Update this lookup
    // after Step 3 once you know the name.
    const parser =
      (excelHelper as any).parseImportExpensesXlsx ??
      (excelHelper as any).parseExpensesExcel ??
      (excelHelper as any).parseExcelBuffer;
    if (typeof parser !== "function") {
      throw new McpToolError(
        "Excel parser not found. Update server/mcp/tools/excel.ts handler to import the actual parser function exported by your Excel helper module (see Step 3 grep results)."
      );
    }
    const parsed: any[] = await parser(buf);
    if (!Array.isArray(parsed)) throw new McpToolError("Parser did not return an array of rows");

    if (args.dry_run) {
      return {
        data: { parsed_count: parsed.length, sample: parsed.slice(0, 3), dry_run: true },
        meta: { status: "dry_run", summary: `[dry_run] Would import ${parsed.length} rows into ${args.type}` },
      };
    }

    const target = args.type === "import_expenses" ? importExpenses : importServiceInvoices;
    return await db.transaction(async (tx) => {
      const inserted = parsed.length
        ? await tx.insert(target).values(parsed).returning()
        : [];
      return {
        data: { inserted_count: inserted.length, ids: inserted.map((r: any) => r.id) },
        meta: { affectedTable: args.type, affectedIds: inserted.map((r: any) => r.id), summary: `Imported ${inserted.length} rows into ${args.type}` },
      };
    });
  },
});
```

- [ ] **Step 5: Locate document attach handler and S3 helper**

Run: `grep -nE "uploadDocument|object-storage|s3.*upload|putObject" server/*.ts | head -20`
Identify:
- The S3 upload helper (likely in `server/object-storage.ts`) — function that takes a buffer, returns an S3 key/URL.
- The DB insert function for `procedureDocuments` (likely `storage.uploadDocument()`).

- [ ] **Step 6: Write `attach.ts`**

Create `server/mcp/tools/attach.ts`:

```ts
// server/mcp/tools/attach.ts
import { registerTool } from "../registry.js";
import { McpToolError } from "../errors.js";
import { storage } from "../../storage.js";
// Adjust to the actual exported S3 helper (Step 5 grep):
import * as objectStorage from "../../object-storage.js";

registerTool({
  name: "write_attach_document",
  tier: "write",
  description: "Attach a document (PDF, image, Excel) to a procedure. File is uploaded to S3, then a procedureDocuments row is created.",
  inputSchema: {
    type: "object",
    properties: {
      procedure_id: { type: "integer" },
      filename: { type: "string", description: "Original filename, e.g. 'invoice.pdf'" },
      mime_type: { type: "string", description: "e.g. 'application/pdf'" },
      file_base64: { type: "string", description: "Base64-encoded file content" },
      document_type: { type: "string", description: "importDocumentType enum value, e.g. 'invoice'" },
      notes: { type: "string" },
    },
    required: ["procedure_id", "filename", "mime_type", "file_base64"],
    additionalProperties: false,
  },
  handler: async (args: any) => {
    // Resolve uploader after Step 5
    const upload =
      (objectStorage as any).uploadBufferToS3 ??
      (objectStorage as any).uploadBuffer ??
      (objectStorage as any).putObject;
    if (typeof upload !== "function") {
      throw new McpToolError("S3 uploader not found. Update attach.ts to use the actual exported helper.");
    }
    const buf = Buffer.from(args.file_base64, "base64");
    const uploadResult = await upload(buf, { filename: args.filename, mimeType: args.mime_type });
    // uploadResult shape varies — common keys: { key, url, location }.
    const s3Key = uploadResult.key ?? uploadResult.location ?? uploadResult.url;
    if (!s3Key) throw new McpToolError("Upload helper did not return an S3 key/URL");

    const doc = await storage.uploadDocument({
      procedureId: args.procedure_id,
      filename: args.filename,
      mimeType: args.mime_type,
      s3Key,
      documentType: args.document_type,
      notes: args.notes,
    } as any);
    return {
      data: { document: doc, s3_key: s3Key },
      meta: { affectedTable: "procedure_documents", affectedIds: [doc.id], summary: `Attached ${args.filename} (${buf.length} bytes) to procedure ${args.procedure_id}` },
    };
  },
});
```

> **Note:** the `InsertProcedureDocument` shape comes from `shared/schema.ts`. If the column names there differ (e.g., `s3_key` vs `s3Key`), match exactly. Run `grep -A 10 "procedureDocuments = pgTable" shared/schema.ts` to confirm column names.

- [ ] **Step 7: Update `tools/index.ts`**

```ts
// server/mcp/tools/index.ts
export function registerAllTools(): void {
  require("./procedures.js");
  require("./taxes.js");
  require("./expenses.js");
  require("./payments.js");
  require("./invoices.js");
  require("./products.js");
  require("./reports.js");
  require("./excel.js");
  require("./attach.js");
}
```

- [ ] **Step 8: Verify all 21 tools listed**

Run: `npx tsx scripts/mcp/verify-list-tools.ts`
Expected: `OK tools/list returned 21 tools` (10 read from Phase 3 + 11 write from Phase 4.1/4.2/4.3).
After Phase 5 this rises to 23 (+2 ai), after Phase 6 to 25 (+2 destructive) — matching the spec's "25 tool" target.

- [ ] **Step 9: Commit**

```bash
git add server/mcp/tools/taxes.ts server/mcp/tools/excel.ts server/mcp/tools/attach.ts server/mcp/tools/index.ts
git commit -m "feat(mcp): add write tools for tax calculation, excel import, document attach"
```

---

## Phase 5 — AI Wrapper Tools

> **Why thin wrappers:** `ai_extract_pdf` and `ai_ask_internal` just call existing functions. They exist so Cowork can chain them with write tools (e.g., "extract PDF → calculate tax → save").

### Task 5.1: AI tool wrappers

**Files:**
- Create: `server/mcp/tools/documents.ts`
- Create: `server/mcp/tools/ai.ts`
- Modify: `server/mcp/tools/index.ts`

- [ ] **Step 1: Inspect existing PDF extraction signature**

Run: `grep -n "^export" server/document-extraction.ts`
Note the exported function names and signatures. The plan assumes there's an `extractFromPdfBase64(base64: string): Promise<ExtractionResult>` exported function. If the actual export name differs (e.g., `extractInvoiceFromPdf`), substitute it in Step 2 below — DO NOT add a new function in document-extraction.ts.

- [ ] **Step 2: Write `documents.ts`**

```ts
// server/mcp/tools/documents.ts
// Wraps existing PDF extraction so Cowork can call it as a tool.
// Note: input is `pdf_base64` (string). Audit logger automatically elides it as
// "[base64 elided, N bytes]" because the sanitizer detects long base64.
import { registerTool } from "../registry.js";
import { McpToolError } from "../errors.js";
// Adjust the import to match the actual exports in server/document-extraction.ts:
import * as extraction from "../../document-extraction.js";

registerTool({
  name: "ai_extract_pdf",
  tier: "ai",
  description: "Extract structured invoice data from a commercial invoice PDF using Claude. Returns { invoice: {...}, products: [...] }.",
  inputSchema: {
    type: "object",
    properties: {
      pdf_base64: { type: "string", description: "Base64-encoded PDF (NO data: prefix)." },
      doc_type: { type: "string", description: "Document type hint, e.g. 'commercial_invoice'", default: "commercial_invoice" },
    },
    required: ["pdf_base64"],
    additionalProperties: false,
  },
  handler: async (args: any) => {
    // Try the most likely export names in order. The first one defined wins.
    const fn =
      (extraction as any).extractInvoiceFromPdfBase64 ??
      (extraction as any).extractFromPdfBase64 ??
      (extraction as any).extractPdf ??
      (extraction as any).analyzeInvoicePdf;
    if (typeof fn !== "function") {
      throw new McpToolError(
        "PDF extraction function not found in server/document-extraction.ts. " +
        "Update server/mcp/tools/documents.ts handler to call the correct exported name."
      );
    }
    const result = await fn(args.pdf_base64);
    return {
      data: result,
      meta: { summary: `Extracted ${(result?.products?.length ?? 0)} products from PDF` },
    };
  },
});
```

> **Note:** If Step 1 showed a different signature (e.g., the function takes a Buffer instead of a base64 string), adjust the handler accordingly — convert with `Buffer.from(args.pdf_base64, "base64")`.

- [ ] **Step 3: Write `ai.ts`**

```ts
// server/mcp/tools/ai.ts
// Wraps the existing in-app Q&A handler so Cowork can defer narrow analytics
// questions to the same structured answer pipeline used by the React UI.
import { registerTool } from "../registry.js";
import { handleAskRequest } from "../../ai-ask.js";

registerTool({
  name: "ai_ask_internal",
  tier: "ai",
  description: "Run an analytics question through the in-app 'Ask CNC?' pipeline. Returns the same {answer, blocks} structure used by the React UI.",
  inputSchema: {
    type: "object",
    properties: {
      question: { type: "string" },
      today: { type: "string", description: "Optional override for 'today' (YYYY-MM-DD)" },
    },
    required: ["question"],
    additionalProperties: false,
  },
  handler: async (args: any) => {
    const out = await handleAskRequest({ question: args.question, todayISO: args.today });
    return { data: out, meta: { summary: `Ask: ${args.question.slice(0, 80)}` } };
  },
});
```

- [ ] **Step 4: Update `tools/index.ts`**

```ts
// server/mcp/tools/index.ts
export function registerAllTools(): void {
  require("./procedures.js");
  require("./taxes.js");
  require("./expenses.js");
  require("./payments.js");
  require("./invoices.js");
  require("./products.js");
  require("./reports.js");
  require("./excel.js");
  require("./attach.js");
  require("./documents.js");
  require("./ai.js");
}
```

- [ ] **Step 5: Smoke test `ai_ask_internal`**

(Reuse `verify-read-tools.ts` shape) Run an ad-hoc:
```
npx tsx -e "import('./scripts/mcp/verify-list-tools.js')" 2>&1 | grep ai_
```
Or simply rerun `npx tsx scripts/mcp/verify-list-tools.ts` and confirm `ai_extract_pdf` and `ai_ask_internal` appear.

Then, with a known good question:
```bash
curl -s -X POST http://localhost:5000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer $MCP_BEARER_TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"ai_ask_internal","arguments":{"question":"How many procedures do we have in total?"}}}'
```
Expected: returns a JSON-RPC result whose `result.content[0].text` is a JSON-stringified `{answer, blocks, tool_calls}` object. (Requires `ANTHROPIC_API_KEY` configured in `.env`.)

- [ ] **Step 6: Commit**

```bash
git add server/mcp/tools/documents.ts server/mcp/tools/ai.ts server/mcp/tools/index.ts
git commit -m "feat(mcp): add ai wrapper tools (extract_pdf, ask_internal)"
```

---

## Phase 6 — Destructive Tools

> **Safety:** All destructive tools default `dry_run: true`. Cowork must explicitly send `dry_run: false` to execute. Even then, the audit log captures full "before" state.

### Task 6.1: Destructive tools (delete, close, bulk update)

**Files:**
- Create: `server/mcp/tools/destructive.ts`
- Modify: `server/mcp/tools/index.ts`

- [ ] **Step 1: Write `destructive.ts`**

```ts
// server/mcp/tools/destructive.ts
import { registerTool } from "../registry.js";
import { db } from "../../db.js";
import { procedures as proceduresTable, importExpenses, importServiceInvoices, taxes as taxesTable, payments as paymentsTable } from "@shared/schema";
import { eq } from "drizzle-orm";
import { McpToolError } from "../errors.js";

// Whitelist of tables this tool may touch. Anything outside is rejected.
const TABLE_MAP: Record<string, { table: any; pk: string }> = {
  procedures: { table: proceduresTable, pk: "id" },
  import_expenses: { table: importExpenses, pk: "id" },
  import_service_invoices: { table: importServiceInvoices, pk: "id" },
  taxes: { table: taxesTable, pk: "id" },
  payments: { table: paymentsTable, pk: "id" },
};

registerTool({
  name: "destructive_delete_record",
  tier: "destructive",
  description: "Delete a single record by id from a whitelisted table. Default dry_run=true — preview what would be deleted without committing.",
  inputSchema: {
    type: "object",
    properties: {
      table: { type: "string", enum: Object.keys(TABLE_MAP) },
      id: { type: "integer" },
      dry_run: { type: "boolean", default: true },
    },
    required: ["table", "id"],
    additionalProperties: false,
  },
  handler: async (args: any) => {
    const def = TABLE_MAP[args.table];
    if (!def) throw new McpToolError(`Table not allowed: ${args.table}`);
    const dryRun = args.dry_run ?? true;
    return await db.transaction(async (tx) => {
      const [before] = await tx.select().from(def.table).where(eq(def.table[def.pk], args.id));
      if (!before) throw new McpToolError(`${args.table} id ${args.id} not found`);
      if (dryRun) {
        return {
          data: { would_delete: before, dry_run: true },
          meta: { affectedTable: args.table, affectedIds: [args.id], before, status: "dry_run", summary: `[dry_run] Would delete ${args.table} ${args.id}` },
        };
      }
      await tx.delete(def.table).where(eq(def.table[def.pk], args.id));
      return {
        data: { deleted: before, dry_run: false },
        meta: { affectedTable: args.table, affectedIds: [args.id], before, status: "ok", summary: `Deleted ${args.table} ${args.id}` },
      };
    });
  },
});

registerTool({
  name: "destructive_close_procedure",
  tier: "destructive",
  description: "Mark a procedure as closed (status=closed). Default dry_run=true. Note: this does not delete any data.",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "integer" },
      dry_run: { type: "boolean", default: true },
    },
    required: ["id"],
    additionalProperties: false,
  },
  handler: async (args: any) => {
    const dryRun = args.dry_run ?? true;
    return await db.transaction(async (tx) => {
      const [before] = await tx.select().from(proceduresTable).where(eq(proceduresTable.id, args.id));
      if (!before) throw new McpToolError(`Procedure ${args.id} not found`);
      if ((before as any).status === "closed") {
        return {
          data: { already_closed: true, procedure: before },
          meta: { affectedTable: "procedures", affectedIds: [args.id], status: "ok", summary: `Procedure ${args.id} already closed` },
        };
      }
      if (dryRun) {
        return {
          data: { would_close: before, dry_run: true },
          meta: { affectedTable: "procedures", affectedIds: [args.id], before, status: "dry_run", summary: `[dry_run] Would close procedure ${args.id}` },
        };
      }
      const [after] = await tx.update(proceduresTable).set({ status: "closed" as any }).where(eq(proceduresTable.id, args.id)).returning();
      return {
        data: { closed: after, dry_run: false },
        meta: { affectedTable: "procedures", affectedIds: [args.id], before, status: "ok", summary: `Closed procedure ${args.id}` },
      };
    });
  },
});
```

- [ ] **Step 2: Update `tools/index.ts`**

```ts
// server/mcp/tools/index.ts
export function registerAllTools(): void {
  require("./procedures.js");
  require("./taxes.js");
  require("./expenses.js");
  require("./payments.js");
  require("./invoices.js");
  require("./products.js");
  require("./reports.js");
  require("./excel.js");
  require("./attach.js");
  require("./documents.js");
  require("./ai.js");
  require("./destructive.js");
}
```

- [ ] **Step 3: Smoke-test destructive tools (dry_run only — no actual deletes)**

Create `scripts/mcp/verify-destructive-tools.ts`:

```ts
// Run: MCP_BEARER_TOKEN=<token> npx tsx scripts/mcp/verify-destructive-tools.ts
// Tests dry_run behavior only. No real records deleted.
const BASE = process.env.MCP_BASE_URL ?? "http://localhost:5000";
const TOKEN = process.env.MCP_BEARER_TOKEN!;

async function call(method: string, params: any) {
  const r = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json, text/event-stream", "Authorization": `Bearer ${TOKEN}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
  const ct = r.headers.get("content-type") ?? "";
  if (ct.includes("text/event-stream")) {
    const t = await r.text();
    const m = /data:\s*(.+)/.exec(t);
    if (!m) throw new Error(`No data line: ${t}`);
    return JSON.parse(m[1]);
  }
  return r.json();
}
async function callTool(name: string, args: any) {
  const r = await call("tools/call", { name, arguments: args });
  if (r.error) throw new Error(`${name}: ${JSON.stringify(r.error)}`);
  if (r.result?.isError) throw new Error(`${name}: ${r.result.content?.[0]?.text}`);
  return JSON.parse(r.result.content[0].text);
}

async function main() {
  await call("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "verify-destructive", version: "0.0.1" } });

  // Find one procedure to "would-delete"
  const procs = await callTool("read_procedures", { list_limit: 1 });
  const row = procs.rows?.[0] ?? procs[0];
  if (!row?.id) throw new Error("No procedures found to test against");
  const id = row.id;

  console.log("--- destructive_delete_record dry_run (procedures id=", id, ") ---");
  const dry = await callTool("destructive_delete_record", { table: "procedures", id, dry_run: true });
  if (!dry.dry_run || !dry.would_delete) throw new Error("Expected dry_run: true and would_delete payload");
  console.log("OK: dry_run preview returned");

  console.log("--- destructive_delete_record default dry_run should also be dry ---");
  const dry2 = await callTool("destructive_delete_record", { table: "procedures", id }); // no dry_run flag
  if (!dry2.dry_run) throw new Error("Default dry_run was not true");
  console.log("OK: default dry_run is true");

  console.log("--- destructive_close_procedure dry_run ---");
  const close = await callTool("destructive_close_procedure", { id, dry_run: true });
  if (!close.dry_run && !close.already_closed) throw new Error("Expected dry_run or already_closed");
  console.log("OK: close dry_run path verified");

  console.log("\nAll destructive-tool checks passed (no actual mutations).");
}
main().catch(e => { console.error("FAIL:", e); process.exit(1); });
```

Run: `npx tsx scripts/mcp/verify-destructive-tools.ts`
Expected: 3 OK lines, no records deleted, final pass message.

- [ ] **Step 4: Commit**

```bash
git add server/mcp/tools/destructive.ts server/mcp/tools/index.ts scripts/mcp/verify-destructive-tools.ts
git commit -m "feat(mcp): add destructive tools with default dry_run for delete and close_procedure"
```

---

## Phase 7 — End-to-End Testing with Cowork

### Task 7.1: Local Cowork connection smoke test

**Files:** None (manual + screenshots if useful)

- [ ] **Step 1: Expose local dev to Cowork (development only)**

Cowork is cloud-hosted; it cannot reach `localhost:5000` directly. Two options for local testing:

**Option A — ngrok (recommended for one-off testing):**
```bash
ngrok http 5000
```
Copy the HTTPS URL (e.g., `https://abcd1234.ngrok-free.app`). Your MCP endpoint is `https://abcd1234.ngrok-free.app/mcp`.

**Option B — Test against production (after Task 7.2):**
Deploy first, then test against the real domain.

- [ ] **Step 2: Add as Custom MCP server in Cowork**

Claude Desktop → Cowork → Settings → (Custom MCP servers / Connectors — per Task 0.1 findings):
- Name: `CNCxSOHO Dev`
- URL: `https://<ngrok-url>/mcp` (Option A) or `https://cncsohoimportmanager.com/mcp` (Option B)
- Auth: Bearer, paste the value from `.env`'s `MCP_BEARER_TOKEN`
- Save / Connect.

Expected: Cowork shows a tools count > 0 (should match the number from `verify-list-tools.ts`).

- [ ] **Step 3: Smoke prompts from Cowork**

Try in a new Cowork task:
1. "List my 5 most recent import procedures." — should call `read_procedures` with `list_limit: 5`.
2. "What are total customs taxes for ALO in 2026?" — should call `read_taxes` and/or `ai_ask_internal`.
3. "Show me the audit log from this conversation." — should call `read_audit_log` filtered by `since_ts` ~ now.

Verify each:
- Cowork displays a tool call card with the tool name.
- Response is structured (table or paragraph), not "I cannot access your data".
- DB-side: query `agent_audit_log` and confirm rows match.

- [ ] **Step 4: Commit notes (if any docs were created)**

If you took screenshots or wrote notes, save them to `docs/superpowers/cowork-connection-notes.md` and commit.

### Task 7.2: Production deployment

**Files:** Operational (no code)

- [ ] **Step 1: Build and deploy app**

```bash
npm run build
# Deploy via existing PM2 ecosystem (ecosystem.config.cjs) — typically:
pm2 reload ecosystem.config.cjs --update-env
```

Expected: server reloads with the new `server/mcp/` mounted. PM2 logs show no errors. Verify: `curl https://cncsohoimportmanager.com/mcp/health` returns `{"status":"ok",...}`.

- [ ] **Step 2: Apply nginx snippet**

SSH to the VPS, merge `nginx/cncsoho.mcp.conf.snippet` into the active site config (e.g., `/etc/nginx/sites-available/cncsohoimportmanager.com`), then:

```bash
sudo nginx -t
sudo nginx -s reload
```

Expected: `nginx -t` reports "test is successful". After reload, `curl -v https://cncsohoimportmanager.com/mcp/health` returns `200`.

- [ ] **Step 3: Set production env var**

On the VPS, ensure `MCP_BEARER_TOKEN` is set in the environment PM2 reads from (the project's `.env` file at the deploy path, OR PM2's `env:` section in `ecosystem.config.cjs`). Use a **different** token from local dev:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Then `pm2 restart ecosystem.config.cjs --update-env`.

- [ ] **Step 4: Re-connect Cowork to production URL**

In Cowork, update the connector URL to `https://cncsohoimportmanager.com/mcp` and the bearer token to the **production** value (NOT the dev one). Re-run the smoke prompts from Task 7.1 Step 3 against production.

- [ ] **Step 5: Test Gmail Dispatch (Beta) trigger**

In Cowork:
- Configure Dispatch (Beta) to watch your Gmail for a specific filter (e.g., `from:supplier-test subject:"Test Invoice"`).
- Task prompt: "Process the incoming invoice email. Call `ai_extract_pdf` on the PDF attachment. Then summarize the extracted products."
- Send yourself a test email with a sample invoice PDF.
- Wait for Dispatch to fire. Expected: Cowork runs the task, calls `ai_extract_pdf`, summarizes back.

If Dispatch doesn't support Gmail attachments directly, downgrade scope: have Dispatch trigger you a notification with the email content, and you forward the PDF manually for now.

- [ ] **Step 6: Test Scheduled task**

In Cowork → Scheduled:
- Create: "Every Monday 09:00 TR: call `read_dashboard_snapshot` (or fallback `read_time_series` if dashboard tool not added), summarize the week."
- Verify it runs at the scheduled time (or manually trigger). Audit log should show the call.

- [ ] **Step 7: Document final state**

Create `docs/superpowers/cowork-integration-runbook.md` with:
- Production MCP URL.
- How to rotate `MCP_BEARER_TOKEN` (regenerate, update `.env`, `pm2 restart`, update Cowork connector).
- How to query the audit log for debugging.
- Known limitations (rate limit, file size limit for `pdf_base64`).
- Commit this file.

```bash
git add docs/superpowers/cowork-integration-runbook.md
git commit -m "docs(mcp): add Cowork integration runbook"
```

---

## Self-Review Checklist

Run this after the plan is complete (don't dispatch a subagent):

- [ ] **Spec coverage:** every section of `2026-05-16-cowork-mcp-integration-design.md` maps to one or more tasks above. Check Sections 1-12 individually.
- [ ] **Placeholder scan:** search this file for `TBD`, `TODO`, `fill in`, `add appropriate`. Should find 0.
- [ ] **Type consistency:** `registerTool`, `ToolHandlerResult`, `ToolContext`, `meta.before/affectedIds/status/summary` used consistently across Phase 3-6 tools.
- [ ] **Imports:** every code block imports what it uses. `eq`, `db`, `McpToolError`, `registerTool` imported in every tool file.
- [ ] **DB transaction discipline:** every `write_*` and `destructive_*` handler wraps work in `db.transaction(async tx => …)`.
- [ ] **Audit log writes:** registry wraps handler in `writeAudit` → guaranteed for every tool call.
- [ ] **No refactor of legacy code:** `routes.ts`, `ai-ask.ts`, `ai-ask-tools.ts`, `claude.ts`, `document-extraction.ts`, `storage.ts` are never modified by tasks 1-6.
- [ ] **Phase boundaries are testable:** Phase 2 ends with `tools/list` succeeding (0 tools), Phase 3 ends with read tools working, etc.

## Notes (filled in during Task 0.1)

- Cowork "Custom MCP servers" UI path: _<fill in during Task 0.1>_
- Streamable HTTP supported: _<yes/no — fill in during Task 0.1>_
- Anthropic egress IPs (if published): _<fill in during Task 0.1>_
