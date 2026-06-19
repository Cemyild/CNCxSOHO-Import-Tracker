// server/ai-ask-sql.ts
// Read-only SQL escape hatch for "Ask CNC?". The AI may write a single SELECT;
// we run it inside a READ ONLY transaction so the engine rejects any write,
// with an allowlist guard as a second line of defense and a statement timeout.
//
// NOTE: pool is imported lazily inside runReadOnlyQuery so that importing this
// module (e.g. in pure-guard tests) does not trigger db.ts's DATABASE_URL check.

const FORBIDDEN = /\b(insert|update|delete|drop|alter|truncate|grant|revoke|create|comment|copy|merge|call|do|vacuum|reindex|cluster|refresh|lock|set|reset)\b/i;

/** Throws if `sqlText` is not a single read-only SELECT/WITH statement. */
export function assertReadOnlySelect(sqlText: string): void {
  if (!sqlText || !sqlText.trim()) {
    throw new Error("Empty SQL.");
  }
  // Strip a single trailing semicolon, then forbid any remaining one
  // (which would indicate multiple statements).
  let s = sqlText.trim();
  if (s.endsWith(";")) s = s.slice(0, -1).trim();
  if (s.includes(";")) {
    throw new Error("Only a single statement is allowed (no ';').");
  }
  const first = s.split(/\s+/, 1)[0]?.toLowerCase();
  if (first !== "select" && first !== "with") {
    throw new Error("Only SELECT (or WITH ... SELECT) queries are allowed.");
  }
  if (FORBIDDEN.test(s)) {
    throw new Error("Query contains a forbidden write/DDL keyword.");
  }
}

/**
 * Run a read-only SELECT and return columns + rows (capped at maxRows).
 * Any write is rejected at the engine level by the READ ONLY transaction.
 */
export async function runReadOnlyQuery(
  sqlText: string,
  maxRows = 200,
): Promise<{ columns: string[]; rows: any[]; truncated: boolean }> {
  assertReadOnlySelect(sqlText);
  const { pool } = await import("./db");
  const client = await pool.connect();
  try {
    await client.query("BEGIN TRANSACTION READ ONLY");
    await client.query("SET LOCAL statement_timeout = 8000");
    const res = await client.query(sqlText);
    await client.query("COMMIT");
    const rows = res.rows ?? [];
    const columns = (res.fields ?? []).map((f: any) => f.name);
    return {
      columns,
      rows: rows.slice(0, maxRows),
      truncated: rows.length > maxRows,
    };
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}
