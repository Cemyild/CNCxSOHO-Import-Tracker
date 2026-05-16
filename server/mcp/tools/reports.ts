// server/mcp/tools/reports.ts
import { registerTool } from "../registry";
import { runQueryTimeSeries } from "../../ai-ask-tools";
import { db } from "../../db";
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
  handler: async (args: any) => {
    // Map MCP-facing field names to the underlying runQueryTimeSeries arg names.
    const mapped: any = {
      source: args.table,
      granularity: args.bucket ?? "month",
      metric: args.metric,
      start_date: args.date_from,
      end_date: args.date_to,
      ...(args.filters ?? {}),
    };
    return { data: await runQueryTimeSeries(mapped) };
  },
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
    const conds: any[] = [];
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
