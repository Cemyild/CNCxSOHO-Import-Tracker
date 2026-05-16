// Run (with dev server up: `npm run dev` in another terminal):
//   npx tsx scripts/mcp/verify-health.ts
const BASE = process.env.MCP_BASE_URL ?? "http://localhost:5000";

async function main() {
  const r = await fetch(`${BASE}/mcp/health`);
  if (r.status !== 200) { console.error("FAIL: status", r.status); process.exit(1); }
  const body = await r.json() as any;
  if (body.status !== "ok") { console.error("FAIL: body", body); process.exit(1); }
  console.log("OK health:", body);
}
main().catch(e => { console.error(e); process.exit(1); });
