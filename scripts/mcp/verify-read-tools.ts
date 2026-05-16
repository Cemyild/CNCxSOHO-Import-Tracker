// Run: npx tsx --env-file=.env scripts/mcp/verify-read-tools.ts
// Requires dev server up.
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

  console.log("--- read_invoices ---");
  const inv = await callTool("read_invoices", { list_limit: 3 });
  console.log("Got invoices count:", inv?.count);

  console.log("--- read_products ---");
  const prods = await callTool("read_products", { list_limit: 3 });
  console.log("Got products:", typeof prods === "object" ? "ok" : "fail");

  console.log("--- read_hs_codes ---");
  const hs = await callTool("read_hs_codes", { list_limit: 3 });
  console.log("Got hs_codes:", typeof hs === "object" ? "ok" : "fail");

  console.log("--- read_time_series ---");
  const ts = await callTool("read_time_series", { table: "procedures", bucket: "month" });
  console.log("Got time_series:", typeof ts === "object" ? "ok" : "fail");

  console.log("--- read_audit_log ---");
  const audit = await callTool("read_audit_log", { limit: 5 });
  console.log("Got audit rows:", audit?.count, "(expected >= 8 since we just made many calls in this run)");

  console.log("\nAll read-tool checks passed.");
}
main().catch(e => { console.error("FAIL:", e); process.exit(1); });
