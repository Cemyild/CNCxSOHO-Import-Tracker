// Run: npx tsx --env-file=.env scripts/mcp/verify-write-tools.ts
// Creates and updates a test procedure to confirm round-trip + audit log.
const BASE = process.env.MCP_BASE_URL ?? "http://127.0.0.1:5000";
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
  // NOTE: procedures table has no `company`/`notes` columns — drizzle drops unknown keys.
  // We patch a real column (`shipper`) in the update step.
  const created = await callTool("write_create_procedure", {
    reference: ref, shipper: "MCP Test Shipper",
  });
  console.log("Created procedure id =", created.procedure.id);

  console.log("--- write_update_procedure ---");
  const updated = await callTool("write_update_procedure", {
    id: created.procedure.id, patch: { shipper: "MCP Test Shipper (updated)" },
  });
  console.log("Updated shipper =", updated.procedure.shipper);

  console.log("--- read_audit_log (latest) ---");
  const audit = await callTool("read_audit_log", { tool: "write_update_procedure", limit: 1 });
  const last = audit.rows?.[0];
  // Drizzle returns camelCase by default (beforeJson); accept either form.
  const beforeJson = last?.before_json ?? last?.beforeJson;
  if (!last || !beforeJson) throw new Error("audit entry missing 'before_json'");
  console.log("OK before_json captured: shipper =", JSON.parse(beforeJson).shipper);

  console.log(`\n‼ CLEANUP: this test procedure was NOT deleted. Manual delete via DB:`);
  console.log(`  DELETE FROM procedures WHERE id = ${created.procedure.id};`);
}
main().catch(e => { console.error("FAIL:", e); process.exit(1); });
