// One-off smoke test for Phase 4.2 — exercises write_create_product end-to-end.
// Run: npx tsx --env-file=.env scripts/mcp/verify-write-product.ts
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
  await call("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "verify-write-product", version: "0.0.1" } });
  const style = `MCP-TEST-PROD-${Date.now()}`;
  console.log(`--- write_create_product (style=${style}) ---`);
  const out = await callTool("write_create_product", {
    style,
    description: "MCP smoke-test product (safe to delete)",
    category: "TEST",
    fabric_content: "100% test",
    hts_code: "9999.99.99",
  });
  console.log("Created product:", JSON.stringify(out.product, null, 2));
  console.log(`\nCLEANUP SQL:\n  DELETE FROM products WHERE id = ${out.product.id};`);
}
main().catch(e => { console.error("FAIL:", e); process.exit(1); });
