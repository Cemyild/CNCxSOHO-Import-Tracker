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
