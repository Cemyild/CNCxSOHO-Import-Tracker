// Verifies auth middleware logic in isolation (no HTTP).
// Run with: npx tsx scripts/mcp/verify-auth.ts
process.env.MCP_BEARER_TOKEN = "test-token-".padEnd(40, "x");
process.env.MCP_AGENT_ID = "cowork-test";

// Dynamic import so env vars above are set before auth.ts module-level code runs.
const { fingerprint, expectedFingerprint, mcpAuth } = await import("../../server/mcp/auth.js");

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
