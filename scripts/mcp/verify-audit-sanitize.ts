// Run: npx tsx --env-file=.env scripts/mcp/verify-audit-sanitize.ts
// Tests sanitization logic only — no DB write. The --env-file flag is required
// because importing ../server/mcp/audit transitively loads server/db.ts, which
// throws at module load if DATABASE_URL is missing.
import { sanitizeArgs } from "../../server/mcp/audit.js";

function eq(a: unknown, b: unknown) { return JSON.stringify(a) === JSON.stringify(b); }
function assert(cond: boolean, msg: string) {
  if (!cond) { console.error("FAIL:", msg); process.exit(1); }
  console.log("OK:", msg);
}

assert(sanitizeArgs(null) === null, "null passthrough");
assert(sanitizeArgs("hello") === "hello", "short string passthrough");
const big = "A".repeat(500);
assert(typeof sanitizeArgs(big) === "string" && (sanitizeArgs(big) as string).startsWith("[base64 elided"), "long base64-like elided");
const obj = { token: "abc", password: "xyz", api_key: "k", name: "ok", nested: { secret: "s", v: 1 } };
const out = sanitizeArgs(obj) as Record<string, any>;
assert(out.token === "[redacted]" && out.password === "[redacted]" && out.api_key === "[redacted]", "secret keys redacted");
assert(out.name === "ok", "normal field preserved");
assert(out.nested.secret === "[redacted]" && out.nested.v === 1, "nested secret redacted, nested value preserved");
assert(eq(sanitizeArgs([1, 2, "x"]), [1, 2, "x"]), "array passthrough");

console.log("\nAll audit sanitization checks passed.");
