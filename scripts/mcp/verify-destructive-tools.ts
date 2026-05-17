// Run: npx tsx --env-file=.env scripts/mcp/verify-destructive-tools.ts
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

  // Find one procedure to "would-delete". read_procedures items omit id,
  // so fetch a reference and resolve the id via read_procedure_detail.
  const procs = await callTool("read_procedures", { list_limit: 1 });
  const item = (procs.items ?? procs.rows ?? procs)?.[0];
  if (!item?.reference) throw new Error("No procedures found to test against");
  const detail = await callTool("read_procedure_detail", { reference: item.reference });
  const id = detail?.procedure?.id;
  if (!id) throw new Error(`Could not resolve id for reference ${item.reference}`);

  console.log("--- destructive_delete_record dry_run (procedures id=", id, ") ---");
  const dry = await callTool("destructive_delete_record", { table: "procedures", id, dry_run: true });
  if (!dry.dry_run || !dry.would_delete) throw new Error("Expected dry_run: true and would_delete payload");
  console.log("OK: dry_run preview returned for", dry.would_delete?.reference);

  console.log("--- destructive_delete_record DEFAULT dry_run should also be dry ---");
  const dry2 = await callTool("destructive_delete_record", { table: "procedures", id }); // no dry_run flag
  if (!dry2.dry_run) throw new Error("Default dry_run was not true");
  console.log("OK: default dry_run is true");

  console.log("--- destructive_close_procedure dry_run ---");
  const close = await callTool("destructive_close_procedure", { id, dry_run: true });
  if (!close.dry_run && !close.already_closed) throw new Error("Expected dry_run or already_closed");
  console.log("OK: close dry_run path verified (already_closed=" + !!close.already_closed + ")");

  console.log("\nAll destructive-tool checks passed (no actual mutations).");
}
main().catch(e => { console.error("FAIL:", e); process.exit(1); });
