import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { getTableConfig } from "drizzle-orm/pg-core";
import {
  emailAccounts,
  emailWatchedSenders,
  emails,
  emailAttachments,
} from "@shared/schema";

const sql = readFileSync(
  join(process.cwd(), "db", "manual-ddl", "004_email_inbox.sql"),
  "utf8",
);

/** DDL'deki CREATE TABLE gövdesinden kolon adlarını çıkarır. */
function ddlColumns(tableName: string): string[] {
  const match = sql.match(
    new RegExp(`CREATE TABLE IF NOT EXISTS ${tableName} \\(([\\s\\S]*?)\\n\\);`),
  );
  if (!match) throw new Error(`DDL'de tablo bulunamadı: ${tableName}`);
  return match[1]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !/^(CONSTRAINT|PRIMARY KEY|UNIQUE)\b/i.test(line))
    .map((line) => line.split(/\s+/)[0])
    .filter((name) => /^[a-z_]+$/.test(name));
}

describe("email inbox şeması", () => {
  const cases: Array<[string, any]> = [
    ["email_accounts", emailAccounts],
    ["email_watched_senders", emailWatchedSenders],
    ["emails", emails],
    ["email_attachments", emailAttachments],
  ];

  it.each(cases)("%s: DDL ile Drizzle tanımı aynı kolonlara sahip", (name, table) => {
    const fromDrizzle = getTableConfig(table).columns.map((c) => c.name).sort();
    expect(ddlColumns(name).sort()).toEqual(fromDrizzle);
  });
});
