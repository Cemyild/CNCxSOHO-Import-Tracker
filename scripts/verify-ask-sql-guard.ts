// Pure-logic verification for assertReadOnlySelect (no DB needed).
// Run: npx tsx scripts/verify-ask-sql-guard.ts
import { assertReadOnlySelect } from "../server/ai-ask-sql";

let failures = 0;
const ok = (name: string, fn: () => void) => {
  try { fn(); console.log(`PASS ${name}`); }
  catch (e: any) { failures++; console.error(`FAIL ${name}: ${e?.message ?? e}`); }
};
const shouldThrow = (name: string, sql: string) =>
  ok(name, () => {
    let threw = false;
    try { assertReadOnlySelect(sql); } catch { threw = true; }
    if (!threw) throw new Error("expected to throw but did not");
  });
const shouldPass = (name: string, sql: string) =>
  ok(name, () => assertReadOnlySelect(sql));

shouldPass("simple select", "SELECT * FROM procedures LIMIT 5");
shouldPass("cte select", "WITH x AS (SELECT 1) SELECT * FROM x");
shouldPass("trailing semicolon ok", "SELECT 1;");
shouldThrow("update", "UPDATE procedures SET amount = 0");
shouldThrow("delete", "DELETE FROM payments");
shouldThrow("insert", "INSERT INTO products (style) VALUES ('x')");
shouldThrow("drop", "DROP TABLE procedures");
shouldThrow("multi statement", "SELECT 1; DROP TABLE procedures");
shouldThrow("update disguised", "select 1; update procedures set amount=1");
shouldThrow("write cte", "WITH w AS (UPDATE procedures SET amount=0 RETURNING reference) SELECT * FROM w");
shouldThrow("empty", "   ");

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
