// Run with MCP_BEARER_TOKEN set in env or via .env:
//   npx tsx --env-file=.env scripts/mcp/verify-list-tools.ts
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
  const ct = r.headers.get("content-type") ?? "";
  if (ct.includes("text/event-stream")) {
    const text = await r.text();
    const m = /data:\s*(.+)/.exec(text);
    if (!m) throw new Error(`No data line in SSE response: ${text}`);
    return JSON.parse(m[1]);
  }
  return await r.json();
}

async function main() {
  const init = await jsonRpc("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "cncxsoho-verify", version: "0.0.1" },
  });
  console.log("OK initialize:", init.result?.serverInfo);

  const list = await jsonRpc("tools/list");
  const tools = list.result?.tools ?? [];
  console.log(`OK tools/list returned ${tools.length} tools`);
  for (const t of tools) console.log("  -", t.name);
}
main().catch(e => { console.error(e); process.exit(1); });
