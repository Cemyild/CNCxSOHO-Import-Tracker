# Bulk Document Download — Design Spec

**Date:** 2026-05-15
**Status:** Draft — awaiting implementation
**Author:** Cem (with Claude)

## Problem

Users currently download import-related documents one at a time from a procedure's detail page. For audit, archival, and handover work the user needs to grab everything related to a procedure (or many procedures, or a date range, or the entire archive) in a single organized ZIP.

## Goals

1. A dedicated page where the user picks documents in one of four modes:
   - **Single procedure** — dropdown
   - **Multi-select** — checkbox list of procedures
   - **Date range** — filter by `procedures.import_dec_date`
   - **Everything** — one button, no filter
2. The resulting ZIP is organized so a non-developer can find a specific document immediately, without reading any docs.
3. The work runs on the existing Hetzner VPS + S3-compatible object storage stack with no new infrastructure.

## Non-goals

- No background-job system, no progress bar, no email-when-ready. Streaming download is enough for the expected size range.
- No selective document-type filtering (e.g. "give me only the AWBs across all procedures"). Out of scope.
- No re-organization of the existing `expense_documents` schema. Build on top of what's there.

## Decisions (locked)

- **ZIP folder structure**: business-category subfolders per procedure (Option B from brainstorm).
- **Date-range filter**: `procedures.import_dec_date`.
- **Display date format**: `dd/mm/yyyy` in UI and manifest. `dd.mm.yyyy` inside folder names because `/` is illegal in ZIP paths.
- **Architecture**: synchronous server-side streaming ZIP (Approach A).
- **ZIP library**: `archiver` (true streaming; bounded memory). `JSZip` exists in the codebase but buffers the entire archive in memory, which is unsafe for the "Everything" case (~1 GB worst-case).

## User experience

### Sidebar entry

Add to `client/src/lib/nav-items.tsx`:

```ts
{ title: "Bulk Download", url: "/bulk-download", icon: Archive }
```

Use `Archive` from lucide-react. Place it after "Reports", before "Ask CNC?".

### Page layout

Single page at `/bulk-download`. Four tabs across the top, each switching the body. Common footer shows the live selection summary and the Download button.

```
┌───────────────────────────────────────────────────────────────────┐
│  Bulk Document Download                                            │
├───────────────────────────────────────────────────────────────────┤
│  [ Single ]  [ Multi-select ]  [ Date Range ]  [ Everything ]     │
├───────────────────────────────────────────────────────────────────┤
│                                                                    │
│  (active tab body — see below)                                    │
│                                                                    │
├───────────────────────────────────────────────────────────────────┤
│  Selection: 12 procedures · 158 files · ~280 MB                   │
│                                                  [ Download ZIP ] │
└───────────────────────────────────────────────────────────────────┘
```

The summary line is updated reactively from a lightweight server-side count endpoint (see "Count endpoint" below). It is not load-bearing — the user can still click Download without the summary loaded.

### Tab bodies

**Single**
- Searchable combobox. Source: `GET /api/procedures` (existing). Display: `<reference> — <shipper>` (or just reference if no shipper).
- One procedure selectable. Download enabled once a procedure is picked.

**Multi-select**
- Same procedure list. Each row: checkbox + reference + shipper + import_dec_date (dd/mm/yyyy) + file count.
- Top-row controls: search box, "Select all visible", "Clear".
- Download enabled once ≥1 procedure is selected.

**Date Range**
- Two date pickers, `From` and `To`. Display dd/mm/yyyy, internal ISO yyyy-mm-dd.
- Range filters `procedures.import_dec_date`.
- Below the pickers, a note: "Procedures with no declaration date are excluded. (N excluded)" — N updated reactively from the count endpoint.
- Download enabled once both dates are set and at least 1 procedure matches.

**Everything**
- Single button: `Download all procedures (~N MB)`.
- Optional confirmation dialog if the total is over 500 MB: "This will download ~X GB and may take several minutes. Continue?"

### ZIP filename

The downloaded file:

| Mode        | Filename                                                            |
|-------------|---------------------------------------------------------------------|
| Single      | `CNCxSOHO-<REFERENCE>-<dd.mm.yyyy>.zip`                             |
| Multi       | `CNCxSOHO-Documents-<dd.mm.yyyy>.zip`                               |
| Date range  | `CNCxSOHO-Documents-<dd.mm.yyyy>_<dd.mm.yyyy>.zip`                  |
| Everything  | `CNCxSOHO-Documents-All-<dd.mm.yyyy>.zip`                           |

The date is the current server date in the user's timezone (Turkey).

## ZIP internal structure

Top-level layout:

```
CNCxSOHO-Documents-15.05.2026.zip
├── manifest.csv
├── CNCALO-1 - 25341200IM010527 - 15.03.2024/
│   ├── 01-Import-Documents/
│   │   ├── Invoice.pdf
│   │   ├── Packing-List.pdf
│   │   ├── AWB.pdf
│   │   ├── Insurance.pdf
│   │   └── Import-Declaration.pdf
│   ├── 02-Expense-Receipts/
│   │   ├── Storage-Receipt.pdf
│   │   └── Tareks-Invoice.pdf
│   └── 03-Service-Invoices/
│       └── CNC-Service-Fee.pdf
├── CNCALO-2 - 25341200IM010532 - 22.03.2024/
│   └── …
└── CNCSOHO-7 - 25341200IM010540 - 05.04.2024/
    └── …
```

### Per-procedure folder name

Builder logic:

```
parts = [reference]
if (import_dec_number) parts.push(sanitize(import_dec_number))
if (import_dec_date)   parts.push(formatDot(import_dec_date))   // dd.mm.yyyy
folderName = parts.join(' - ')
```

- `sanitize(s)` — replace `/ \ : * ? " < > |` with `_`, trim, collapse multiple `_` into one.
- `formatDot(s)` — parse `import_dec_date` text leniently (accept `yyyy-mm-dd`, `dd/mm/yyyy`, `dd.mm.yyyy`, `dd-mm-yyyy`), output as `dd.mm.yyyy`. If parsing fails, fall back to the raw value passed through `sanitize`.

### Subfolder mapping

Documents inside a procedure folder are grouped by `expense_documents.expenseType`:

| `expenseType`     | Subfolder              |
|-------------------|------------------------|
| `import_document` | `01-Import-Documents/` |
| `import_expense`  | `02-Expense-Receipts/` |
| `service_invoice` | `03-Service-Invoices/` |
| `tax`             | `04-Tax-Documents/`    |

**Empty subfolders are omitted.** If a procedure has no service invoices, there is no `03-Service-Invoices/` folder.

### File names inside subfolders

- Use `expense_documents.originalFilename` directly (DB already stores the clean user-facing name without the upload-timestamp prefix).
- If two documents in the same subfolder have identical original filenames, suffix with ` (2)`, ` (3)`, … before the extension.
- Sanitize the same illegal characters as folder names.

### manifest.csv

A CSV at ZIP root listing every file in the archive. Useful for audit, search, and reconciliation against the database.

Columns:

| Column                | Source                                            |
|-----------------------|---------------------------------------------------|
| `procedure_reference` | `procedures.reference`                            |
| `import_dec_number`   | `procedures.import_dec_number`                    |
| `import_dec_date`     | `procedures.import_dec_date` → dd/mm/yyyy         |
| `shipper`             | `procedures.shipper`                              |
| `category`            | Folder name (01-Import-Documents, etc.)           |
| `original_filename`   | `expense_documents.originalFilename`              |
| `path_in_zip`         | Full relative path inside the ZIP                 |
| `file_size_bytes`     | `expense_documents.fileSize`                      |
| `status`              | `OK` or `ERROR: <reason>` (if fetch failed)       |

UTF-8 with BOM so Excel opens Turkish characters correctly.

## Backend

### New file: `server/bulk-download.ts`

Exports a single function `registerBulkDownloadRoutes(app)` that mounts two endpoints on the Express app. Called once from `server/routes.ts` near the other route mounts.

### Endpoints

#### `POST /api/bulk-download/count`

Returns a lightweight preview of what would be in the ZIP. The UI uses it to show the selection summary.

Request body (same shape as `/api/bulk-download`):

```json
{
  "mode": "single" | "multi" | "dateRange" | "all",
  "procedureIds": [1, 2, 3],
  "dateFrom": "2024-01-01",
  "dateTo":   "2024-12-31"
}
```

Response:

```json
{
  "procedureCount": 12,
  "fileCount": 158,
  "totalBytes": 293601280,
  "excludedNoDecDate": 3
}
```

`excludedNoDecDate` is only populated for `mode: "dateRange"` and counts procedures that match no other filter but were dropped because their `import_dec_date` is null.

#### `POST /api/bulk-download`

Streams the ZIP. Body is identical to the count endpoint.

Response headers:

```
Content-Type: application/zip
Content-Disposition: attachment; filename="<computed>"
Transfer-Encoding: chunked
```

### Server-side flow

1. **Validate** body with zod (`bulkDownloadRequestSchema`). Mode-specific required fields enforced.
2. **Resolve procedure set** based on mode:
   - `single` / `multi`: `procedureIds` directly
   - `dateRange`: fetch `{id, import_dec_date}` for all procedures in one cheap query (single table, no joins, < 1 KB per row), then in JS parse each `import_dec_date` text leniently (try `yyyy-mm-dd`, `dd/mm/yyyy`, `dd.mm.yyyy`, `dd-mm-yyyy`; reject NaN), keep IDs whose parsed date falls inside `[dateFrom, dateTo]` inclusive. Procedures with null or unparseable `import_dec_date` are excluded; their count goes into `excludedNoDecDate` in the count endpoint response. JS-side because the column is `text` with no enforced format — SQL `BETWEEN` on raw text would be wrong.
   - `all`: all procedure IDs
3. **Fetch metadata in one query**: join `expense_documents` with `procedures` and order by `procedure_reference, expenseType, originalFilename`. This is the working set.
4. **Compute names** in JS:
   - folder name per procedure (builder logic above)
   - subfolder per document
   - dedup filename within (procedure, subfolder) bucket
   - resulting `pathInZip` for each row
5. **Initialize archiver**:

   ```ts
   const archive = archiver('zip', { zlib: { level: 1 } }); // light compression — PDFs are already compressed
   archive.on('error', err => { logger.error(err); res.end(); });
   archive.pipe(res);
   ```

   Set headers BEFORE piping.
6. **Stream files** sequentially:

   ```ts
   for (const doc of docs) {
     try {
       const { buffer } = await getFile(doc.objectKey);
       archive.append(buffer, { name: doc.pathInZip });
       manifestRows.push({ ...doc, status: 'OK' });
     } catch (err) {
       logger.warn(`Failed to fetch ${doc.objectKey}: ${err.message}`);
       manifestRows.push({ ...doc, status: `ERROR: ${err.message}` });
     }
   }
   ```

   Sequential, not parallel — keeps S3 load and Node memory bounded.
7. **Append manifest.csv** as the last entry: build CSV in memory from `manifestRows`, prepend BOM, `archive.append(csvBuffer, { name: 'manifest.csv' })`.
8. **Finalize**: `await archive.finalize();`. The response ends when the stream ends.

### Failure handling

- A single file fetch failure does not abort the download. The manifest records the error.
- If the response stream is closed by the client mid-download, `archiver` emits `error`; the loop is interrupted and the request ends cleanly.
- If procedure resolution returns 0 rows, return `400` with `{ error: "No procedures match the filter" }` — do not start the ZIP.

### Authentication

Reuse the existing session middleware. No role check — any logged-in user can use it. (Easy to gate to admin/accountant later if needed.)

### Dependencies

Add to `package.json` `dependencies`:

```
"archiver": "^7.0.1",
```

And to `devDependencies`:

```
"@types/archiver": "^6.0.2",
```

`archiver` is already present transitively in `node_modules`, but declaring it directly makes the dependency contract explicit.

## Frontend

### New file: `client/src/pages/bulk-download.tsx`

Page component. Uses existing UI primitives from `client/src/components/ui/` (Tabs, Button, Combobox, Checkbox, DateRangePicker, Card, Badge). State managed with `useState` + TanStack Query for procedure list and count preview.

Key bits:

```tsx
type Mode = 'single' | 'multi' | 'dateRange' | 'all';

const [mode, setMode] = useState<Mode>('single');
const [singleId, setSingleId] = useState<number | null>(null);
const [multiIds, setMultiIds] = useState<number[]>([]);
const [dateFrom, setDateFrom] = useState<string>('');
const [dateTo, setDateTo] = useState<string>('');

const body = useMemo(() => buildBody(mode, singleId, multiIds, dateFrom, dateTo), [...]);

const { data: countData } = useQuery({
  queryKey: ['/api/bulk-download/count', body],
  queryFn: () => apiRequest('POST', '/api/bulk-download/count', body).then(r => r.json()),
  enabled: isBodyValid(body),
});
```

Download trigger uses a plain `fetch` (not `apiRequest`) so we can stream the response into a blob URL and trigger browser download:

```tsx
async function handleDownload() {
  setDownloading(true);
  try {
    const res = await fetch('/api/bulk-download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'include',
    });
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    const blob = await res.blob();
    const filename = parseFilenameFromHeader(res.headers.get('content-disposition'))
                  ?? 'CNCxSOHO-Documents.zip';
    triggerBlobDownload(blob, filename);
  } catch (e) {
    toast({ title: 'Download failed', description: String(e), variant: 'destructive' });
  } finally {
    setDownloading(false);
  }
}
```

### Routing registration

Add to `client/src/App.tsx`:

```tsx
import BulkDownloadPage from "@/pages/bulk-download";
…
<Route path="/bulk-download">
  {() => (<ProtectedRoute><BulkDownloadPage /></ProtectedRoute>)}
</Route>
```

### Nav entry

In `client/src/lib/nav-items.tsx`, import `Archive` and append:

```ts
{ title: "Bulk Download", url: "/bulk-download", icon: Archive },
```

Place after "Reports", before "Ask CNC?".

## Files touched

**New**
- `server/bulk-download.ts`
- `client/src/pages/bulk-download.tsx`
- `docs/superpowers/specs/2026-05-15-bulk-document-download-design.md` (this file)

**Modified**
- `server/routes.ts` — mount the new routes
- `client/src/App.tsx` — register `/bulk-download` route
- `client/src/lib/nav-items.tsx` — append nav item
- `package.json` — add `archiver` + `@types/archiver`

## Open questions

None blocking. Default decisions documented above. Easy follow-ups if the user later asks:

- Restrict to admin / accountant role — gate at `server/bulk-download.ts` line 1.
- Include a per-procedure summary PDF — extend manifest generation.
- Parallel S3 fetches — change the loop to `Promise.all` with concurrency limit.

## Testing plan

Manual:
1. **Single** — pick CNCALO-1, download, verify folder structure and that originalFilename is preserved.
2. **Multi** — pick 3 procedures, download, verify each has its own folder with the dec-no/dec-date suffix.
3. **Date range** — pick a range, verify only procedures whose `import_dec_date` falls inside the range are included; verify the "excluded" count.
4. **Everything** — verify ZIP contains all procedures and `manifest.csv`.
5. **Missing dec data** — pick a procedure with null `import_dec_number` and null `import_dec_date`; folder is just `CNCALO-N/`.
6. **Duplicate filenames** — upload two files with the same name to the same procedure/category, verify ZIP contains `Name.pdf` and `Name (2).pdf`.
7. **S3 fetch failure** — temporarily break one objectKey, verify the ZIP still completes and `manifest.csv` shows `ERROR` for that row.
8. **Empty subfolder** — pick a procedure that has only import_documents, verify no `02-Expense-Receipts/` etc. in its folder.
9. **Manifest opens cleanly in Excel** — Turkish characters render correctly thanks to UTF-8 BOM.
10. **Large download** — simulate the "everything" case; confirm streaming starts within a few seconds (no upfront buffering) and the response does not hit the nginx 60s timeout.
