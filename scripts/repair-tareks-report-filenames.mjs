/**
 * One-off repair for Tareks reports uploaded before the multipart filename fix.
 *
 * Those rows stored the filename as latin1-mangled text ("KAHVERENGÄ°.pdf"),
 * which also meant the browser's style list never matched and the report was
 * saved with no styles at all.
 *
 * This script restores the filename and, for reports that ended up with no
 * styles, detects them from the repaired name.
 *
 * Dry run (default, writes nothing):
 *   node --env-file=.env --import tsx scripts/repair-tareks-report-filenames.mjs
 * Apply:
 *   node --env-file=.env --import tsx scripts/repair-tareks-report-filenames.mjs --apply
 *
 * The object storage key is intentionally left alone: it is an opaque
 * identifier and downloads name the file from original_filename.
 */
import pg from "pg";
// Run with `--import tsx` so these TypeScript modules load directly.
import { decodeMultipartFilename } from "../server/tareks-reports/multipart-filename.ts";
import { detectStyles } from "../server/tareks-reports/style-matcher.ts";

const APPLY = process.argv.includes("--apply");

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const known = (
  await client.query("select style from products where style is not null and style <> ''")
).rows.map((r) => r.style);

const reports = (
  await client.query(`
    select r.id, r.original_filename,
           coalesce(array_agg(s.style) filter (where s.style is not null), '{}') as styles
      from tareks_reports r
      left join tareks_report_styles s on s.report_id = r.id
     group by r.id, r.original_filename
     order by r.id
  `)
).rows;

let renamed = 0;
let restyled = 0;

for (const row of reports) {
  const fixedName = decodeMultipartFilename(row.original_filename);
  const nameChanged = fixedName !== row.original_filename;
  const needsStyles = row.styles.length === 0;
  const detected = needsStyles ? detectStyles(fixedName, known) : [];

  if (!nameChanged && detected.length === 0) continue;

  if (nameChanged) {
    console.log(`#${row.id} ad : ${row.original_filename}\n        -> ${fixedName}`);
    renamed++;
  }
  if (detected.length > 0) {
    console.log(`#${row.id} style: (yok) -> ${detected.join(", ")}`);
    restyled++;
  }

  if (APPLY) {
    if (nameChanged) {
      await client.query("update tareks_reports set original_filename = $1 where id = $2", [
        fixedName,
        row.id,
      ]);
    }
    for (const style of detected) {
      await client.query(
        `insert into tareks_report_styles (report_id, style) values ($1, $2)
         on conflict on constraint tareks_report_styles_report_style_key do nothing`,
        [row.id, style],
      );
    }
  }
}

console.log(
  `\n${reports.length} rapor tarandı · ${renamed} adı düzeltilecek · ${restyled} style eklenecek` +
    (APPLY ? " · UYGULANDI" : " · (deneme, hiçbir şey yazılmadı)"),
);

await client.end();
