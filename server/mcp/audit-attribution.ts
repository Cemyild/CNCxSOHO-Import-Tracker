// server/mcp/audit-attribution.ts
// Shared helper for resolving the `createdBy` user id used by MCP write tools.
//
// Background: several tables (procedures, payments, importServiceInvoices,
// invoiceLineItems, paymentDistributions, incomingPayments) have a `createdBy`
// FK to users.id. On `procedures` it is NOT NULL; on the others it is
// nullable but we still want to attribute writes to a recognizable user so
// the audit trail / activity log makes sense. Resolution order:
//   1. env MCP_AGENT_USER_ID (set per-deployment to a dedicated agent user)
//   2. lowest existing users.id (typically the seed/admin account)
// The result is cached for the process lifetime to avoid extra queries.
import { asc } from "drizzle-orm";
import { users as usersTable } from "@shared/schema";
import { db } from "../db";
import { McpToolError } from "./errors";
import { signToken } from "../auth-token";

let __cachedAgentUserId: number | null = null;

export async function resolveAgentUserId(tx: typeof db = db): Promise<number> {
  if (__cachedAgentUserId != null) return __cachedAgentUserId;
  const envId = process.env.MCP_AGENT_USER_ID;
  if (envId && Number.isFinite(Number(envId))) {
    __cachedAgentUserId = Number(envId);
    return __cachedAgentUserId;
  }
  const [u] = await tx.select({ id: usersTable.id }).from(usersTable).orderBy(asc(usersTable.id)).limit(1);
  if (!u) throw new McpToolError("Cannot resolve a created_by user id (users table is empty)");
  __cachedAgentUserId = u.id;
  return __cachedAgentUserId;
}

// MCP tools call the app's own HTTP routes internally. The server auth gate
// requires a signed bearer token / session on write requests, so internal
// fetches must authenticate exactly like the React UI. This returns an
// Authorization header carrying the MCP agent user's signed token.
export async function internalAuthHeader(): Promise<Record<string, string>> {
  const uid = await resolveAgentUserId();
  return { Authorization: `Bearer ${signToken(uid)}` };
}
