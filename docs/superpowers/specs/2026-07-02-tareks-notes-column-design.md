# Dashboard Tareks Application — Notes Column — Design Spec

**Date:** 2026-07-02
**Status:** Implemented, awaiting deploy approval

---

## Overview

Add a free-text "Notes" column to the far right of the Dashboard "Tareks Application" table. The user types anything into the cell; it saves automatically when they click away or press Enter.

---

## Database

New nullable column on `procedures`:

```sql
ALTER TABLE procedures ADD COLUMN IF NOT EXISTS tareks_notes TEXT;
```

Applied via `db/manual-ddl/001_procedures_tareks_notes.sql`. The deploy workflow's DDL step was generalized to apply **all** `db/manual-ddl/*.sql` files (sorted, idempotent) before the PM2 reload, so the column exists before the new code starts. A pattern-consistent one-off script also exists at `scripts/migrate-tareks-notes.ts`.

`drizzle-kit push` is intentionally not used (pre-existing schema drift; see memory).

## Backend

- `shared/schema.ts`: `tareks_notes: text("tareks_notes")` on `procedures`.
- `GET /api/dashboard/tareks-application`: query now selects `p.tareks_notes`.
- Excel export endpoint: same column in the query + a "Notes" column (width 40) at the end of the sheet.
- `PATCH /api/procedures/:id`: no change needed — it passes arbitrary fields through `storage.updateProcedure`, which spreads them into the Drizzle update.

## Frontend

`client/src/components/tareks-procedures-list.tsx`:

- New `NotesCell` component: borderless inline `<input>` that shows a border on hover/focus. Saves on blur or Enter (only if the trimmed value changed); Escape reverts. Empty value is stored as `NULL`.
- `key` includes the server value so the cell resets after a refetch without clobbering in-progress typing.
- Separate `notesMutation` (PATCH `{ tareks_notes }`) with its own saving state, success/error toasts.
- Skeleton and empty-state colSpan updated 8 → 9.

## i18n

`tareks.col.notes`, `tareks.notesPlaceholder`, `tareks.notesSaved`, `tareks.notesSaveFailed` in both `tr.json` and `en.json`.

## Out of Scope

- Notes on the procedure details page or other tables.
- Multi-line editor / history of note changes.
