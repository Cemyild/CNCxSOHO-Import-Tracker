# Procedure Auto-Sync from Tax Calculation — Design

**Date:** 2026-06-11
**Status:** Approved

## Problem

After a procedure is created from a tax calculation (`POST /api/tax-calculation/calculations/:id/create-procedure`), the user can later remove products from the calculation via the edit page (`client/src/pages/tax-calculation-edit.tsx`). Saving updates `tax_calculations.total_value` / `total_quantity` and recalculates taxes, but the linked procedure keeps its original `amount`, `piece`, and `invoice_line_items` — stale data on the Procedures page.

The `replace-products` endpoint (`PUT /api/tax-calculation/calculations/:id/replace-products`, routes.ts ~6430) already contains working sync logic for this exact case, but the edit-page save flow never triggers it.

## Decision

Automatic server-side sync (no manual "Update Procedure" button). Extract the existing sync block into a shared helper and call it from every flow that recalculates a calculation.

## Design

### 1. Helper: `syncProcedureFromCalculation(calculationId, userId?)`

New function in `server/routes.ts`, placed above the route definitions.

- Loads the calculation; if `procedure_id` is null → returns `{ synced: false }` (no-op).
- Otherwise:
  - Updates the procedure: `amount` ← `tax_calculations.total_value`, `piece` ← `tax_calculations.total_quantity` (via `storage.updateProcedure`).
  - Deletes `invoice_line_items` where `procedureReference = calculation.reference`, then re-inserts from current `tax_calculation_items` (same mapping as the existing block at routes.ts ~6538-6553: styleNo, description=category, quantity, unitPrice, totalPrice, sortOrder, source='tax_calculation', createdBy=userId||3).
- Returns `{ synced: true, procedureId }`.

### 2. Call sites

1. **`POST /api/tax-calculation/calculations/:id/calculate`** (routes.ts ~6028): after `calculateAllItems(id)` completes, call the helper. Add `procedureSynced` and `procedureId` to the JSON response.
2. **`replace-products`** (routes.ts ~6430): replace the inline sync block (lines ~6522-6555) with a call to the helper. The `invoice_no` / `invoice_date` / `shipper` updates from `invoiceMetadata` stay inline in this endpoint (they only exist in that flow). Behavior is otherwise identical, including `procedureSynced` in the response.

### 3. Client feedback (`tax-calculation-edit.tsx`)

- Read `procedureSynced` / `procedureId` from the calculate response.
- If synced, success toast says the linked procedure was also updated (e.g. "Calculation updated — linked procedure #X also updated").
- Invalidate procedure-related query caches (`/api/procedures` family) so the Procedures page shows fresh amounts.

### 4. Error handling

The sync runs inside the calculate endpoint's existing try/catch. If sync fails, the endpoint returns an error and the user sees it — no silent stale data.

### 5. Out of scope

- The `taxes` table (per-procedure tax breakdown) is entered manually on the procedure page and is not fed from tax calculations today; it is not synced by this change.
- Creating the new procedure for the removed products is an existing separate flow and is unchanged.

## Verification

1. On a calculation linked to a procedure: remove a product on the edit page, save with recalculate → Procedures page shows updated `amount`/`piece`; procedure detail shows updated line items; toast mentions the procedure.
2. On a calculation without a linked procedure: save with recalculate → works as before, no error, no procedure side effects.
3. `replace-products` flow: unchanged behavior, `procedureSynced: true` when linked.
