# Procedure Auto-Sync from Tax Calculation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a tax calculation that is linked to a procedure is recalculated (e.g. after removing products on the edit page), automatically sync the procedure's `amount`, `piece`, and `invoice_line_items` — no manual button needed.

**Architecture:** Extract the proven procedure-sync block from the `replace-products` endpoint into a shared helper `syncProcedureFromCalculation` in `server/routes.ts`. Call it from the `calculate` endpoint (covers the edit-page save flow) and from `replace-products` (replacing the inline block). The edit page reads the new `procedureSynced`/`procedureId` response fields, shows feedback, and invalidates procedure caches.

**Tech Stack:** Express + Drizzle ORM (server), React + TanStack Query (client). **No test framework exists in this repo** (no test script in package.json, zero test files) — verification is `npm run check` (tsc) plus live verification against the dev server. Do not introduce a test framework for this change.

**Spec:** `docs/superpowers/specs/2026-06-11-procedure-auto-sync-design.md`

**Important repo facts for the implementer:**
- `server/routes.ts` is a ~395 KB monolith. All routes are registered inside one big function. `storage`, `db`, `invoiceLineItems`, `eq` are already imported at the top of the file — no new imports needed.
- Line numbers below are approximate (file is huge); always locate code by searching for the quoted anchor strings.
- Dev server on Windows: `node --env-file=.env --import tsx server/index.ts` (NOT `npm run dev` — it's broken on Windows). Port 5000, hard-coded.
- `npm run check` (tsc) may report pre-existing errors elsewhere in the repo. The bar is: **no NEW errors in `server/routes.ts` or `client/src/pages/tax-calculation-edit.tsx`**.

---

### Task 1: Add `syncProcedureFromCalculation` helper and call it from the calculate endpoint

**Files:**
- Modify: `server/routes.ts` (calculate endpoint at ~line 6031, anchor: `"/api/tax-calculation/calculations/:id/calculate"`)

- [ ] **Step 1: Add the helper function**

In `server/routes.ts`, find the route registration:

```ts
  app.post(
    "/api/tax-calculation/calculations/:id/calculate",
```

Immediately ABOVE that `app.post(` block, insert:

```ts
  // Sync the linked procedure (header totals + invoice line items) from a tax
  // calculation's current state. No-op when the calculation has no procedure.
  async function syncProcedureFromCalculation(
    calculationId: number,
    userId?: number,
  ): Promise<{ synced: boolean; procedureId?: number }> {
    const calculation = await storage.getTaxCalculation(calculationId);
    if (!calculation?.procedure_id) {
      return { synced: false };
    }

    const items = await storage.getTaxCalculationItems(calculationId);

    await storage.updateProcedure(calculation.procedure_id, {
      amount: calculation.total_value,
      piece: calculation.total_quantity,
    });

    await db
      .delete(invoiceLineItems)
      .where(eq(invoiceLineItems.procedureReference, calculation.reference));

    if (items.length > 0) {
      const lineItemsData = items.map((item, index) => ({
        procedureReference: calculation.reference,
        styleNo: item.style,
        description: item.category,
        quantity: item.unit_count,
        unitPrice: item.cost,
        totalPrice: item.total_value,
        sortOrder: index,
        source: 'tax_calculation',
        createdBy: userId || 3,
      }));
      await db.insert(invoiceLineItems).values(lineItemsData);
    }

    return { synced: true, procedureId: calculation.procedure_id };
  }
```

Note: this is the same mapping as the existing inline block in `replace-products` (anchor: `// b. replace invoice line items by procedure reference`) — Task 2 will delete that block.

- [ ] **Step 2: Call the helper from the calculate endpoint**

Replace the existing endpoint body:

```ts
  app.post(
    "/api/tax-calculation/calculations/:id/calculate",
    async (req, res) => {
      try {
        const id = parseInt(req.params.id);
        await calculateAllItems(id);
        const calculation = await storage.getTaxCalculation(id);
        const items = await storage.getTaxCalculationItems(id);
        res.json({ calculation, items });
      } catch (error) {
        res
          .status(500)
          .json({ message: "Failed to calculate taxes", error: String(error) });
      }
    },
  );
```

with:

```ts
  app.post(
    "/api/tax-calculation/calculations/:id/calculate",
    async (req, res) => {
      try {
        const id = parseInt(req.params.id);
        await calculateAllItems(id);
        const sync = await syncProcedureFromCalculation(id, req.body?.userId);
        const calculation = await storage.getTaxCalculation(id);
        const items = await storage.getTaxCalculationItems(id);
        res.json({
          calculation,
          items,
          procedureSynced: sync.synced,
          procedureId: sync.procedureId ?? null,
        });
      } catch (error) {
        res
          .status(500)
          .json({ message: "Failed to calculate taxes", error: String(error) });
      }
    },
  );
```

The helper runs AFTER `calculateAllItems` (which refreshes `total_value`/`total_quantity` on the calculation), so the procedure receives fresh totals.

- [ ] **Step 3: Typecheck**

Run: `npm run check`
Expected: no NEW errors mentioning `server/routes.ts` lines near the helper or calculate endpoint (pre-existing errors elsewhere are acceptable — compare against a baseline run from before the change if unsure).

- [ ] **Step 4: Live verification (read-mostly)**

Start the dev server: `node --env-file=.env --import tsx server/index.ts`

Pick a tax calculation WITHOUT a linked procedure (`procedure_id` is null — check via `GET http://localhost:5000/api/tax-calculation/calculations` and look at the `procedure_id` field), then:

```
curl -X POST http://localhost:5000/api/tax-calculation/calculations/<ID>/calculate -H "Content-Type: application/json" -d "{}"
```

Expected: HTTP 200, response JSON contains `"procedureSynced": false, "procedureId": null` and the usual `calculation` + `items`. This proves the no-op path is safe.

(The synced=true path is verified end-to-end in Task 4 — recalculating a real linked calculation mutates real procedure data, so it is done once, deliberately, at the end.)

- [ ] **Step 5: Commit**

```bash
git add server/routes.ts
git commit -m "feat(tax-calc): sync linked procedure on recalculate"
```

---

### Task 2: Refactor `replace-products` to use the helper

**Files:**
- Modify: `server/routes.ts` (~lines 6518-6561, anchor: `// 6. If a procedure is already linked, sync it`)

- [ ] **Step 1: Replace the inline sync block**

In the `replace-products` endpoint, find this block (from `// 5. Read fresh state` through the `res.json({...})` that follows it):

```ts
        // 5. Read fresh state
        const refreshedCalculation = await storage.getTaxCalculation(id);
        const refreshedItems = await storage.getTaxCalculationItems(id);

        // 6. If a procedure is already linked, sync it
        let procedureSynced = false;
        if (refreshedCalculation?.procedure_id) {
          const procId = refreshedCalculation.procedure_id;

          // a. update procedure header (invoice metadata if provided + totals)
          const procUpdate: Record<string, any> = {
            amount: refreshedCalculation.total_value,
            piece: refreshedCalculation.total_quantity,
          };
          if (invoiceMetadata?.invoice_no) procUpdate.invoice_no = invoiceMetadata.invoice_no;
          if (invoiceMetadata?.invoice_date) procUpdate.invoice_date = invoiceMetadata.invoice_date;
          if (invoiceMetadata?.shipper) procUpdate.shipper = invoiceMetadata.shipper;
          await storage.updateProcedure(procId, procUpdate);

          // b. replace invoice line items by procedure reference
          await db.delete(invoiceLineItems).where(eq(invoiceLineItems.procedureReference, refreshedCalculation.reference));

          if (refreshedItems.length > 0) {
            const lineItemsData = refreshedItems.map((item, index) => ({
              procedureReference: refreshedCalculation.reference,
              styleNo: item.style,
              description: item.category,
              quantity: item.unit_count,
              unitPrice: item.cost,
              totalPrice: item.total_value,
              sortOrder: index,
              source: 'tax_calculation',
              createdBy: userId || 3,
            }));
            await db.insert(invoiceLineItems).values(lineItemsData);
          }
          procedureSynced = true;
        }

        res.json({
          calculation: refreshedCalculation,
          items: refreshedItems,
          procedureSynced,
        });
```

Replace it with:

```ts
        // 5. Read fresh state
        const refreshedCalculation = await storage.getTaxCalculation(id);
        const refreshedItems = await storage.getTaxCalculationItems(id);

        // 6. If a procedure is already linked, sync it (totals + line items),
        // then apply invoice metadata that only exists in this flow.
        const sync = await syncProcedureFromCalculation(id, userId);
        if (sync.synced && sync.procedureId) {
          const procUpdate: Record<string, any> = {};
          if (invoiceMetadata?.invoice_no) procUpdate.invoice_no = invoiceMetadata.invoice_no;
          if (invoiceMetadata?.invoice_date) procUpdate.invoice_date = invoiceMetadata.invoice_date;
          if (invoiceMetadata?.shipper) procUpdate.shipper = invoiceMetadata.shipper;
          if (Object.keys(procUpdate).length > 0) {
            await storage.updateProcedure(sync.procedureId, procUpdate);
          }
        }

        res.json({
          calculation: refreshedCalculation,
          items: refreshedItems,
          procedureSynced: sync.synced,
        });
```

Behavior is identical to before: same procedure fields updated, same line-item replacement, same `procedureSynced` response field.

- [ ] **Step 2: Typecheck**

Run: `npm run check`
Expected: no NEW errors in `server/routes.ts`.

- [ ] **Step 3: Commit**

```bash
git add server/routes.ts
git commit -m "refactor(tax-calc): replace-products uses shared procedure sync helper"
```

---

### Task 3: Edit page — surface sync result and invalidate procedure caches

**Files:**
- Modify: `client/src/pages/tax-calculation-edit.tsx` (mutation at lines ~169-279)

- [ ] **Step 1: Capture the sync result in the mutation**

In `updateCalculationMutation`'s `mutationFn`, find the calculate step:

```ts
      if (data.calculate) {
        setLoadingStep('Calculating');
        console.log('🧮 STEP 3: CALCULATING TAXES...');
        
        const calcTaxResponse = await apiRequest("POST", `/api/tax-calculation/calculations/${id}/calculate`, {});
        if (!calcTaxResponse.ok) throw new Error("Failed to calculate taxes");
        
        setLoadingProgress(100);
        console.log('✅ CALCULATION COMPLETE');
        
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      return { id };
```

Replace with:

```ts
      let procedureSynced = false;
      let procedureId: number | null = null;

      if (data.calculate) {
        setLoadingStep('Calculating');
        console.log('🧮 STEP 3: CALCULATING TAXES...');
        
        const calcTaxResponse = await apiRequest("POST", `/api/tax-calculation/calculations/${id}/calculate`, {});
        if (!calcTaxResponse.ok) throw new Error("Failed to calculate taxes");
        const calcResult = await calcTaxResponse.json();
        procedureSynced = !!calcResult.procedureSynced;
        procedureId = calcResult.procedureId ?? null;
        
        setLoadingProgress(100);
        console.log('✅ CALCULATION COMPLETE');
        
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      return { id, procedureSynced, procedureId };
```

- [ ] **Step 2: Use the result in `onSuccess`**

Find:

```ts
    onSuccess: () => {
      setIsLoading(false);
      queryClient.invalidateQueries({ queryKey: ["/api/tax-calculation/calculations"] });
      queryClient.invalidateQueries({ queryKey: [`/api/tax-calculation/calculations/${id}`] });
      
      if (removedProducts.length > 0) {
        setPendingRemovedItems(removedProducts);
        setShowRemovedItemsDialog(true);
      } else {
        toast({
          title: "Success",
          description: "Calculation updated successfully",
        });
        navigate(`/tax-calculation/${id}`);
      }
    },
```

Replace with:

```ts
    onSuccess: (result) => {
      setIsLoading(false);
      queryClient.invalidateQueries({ queryKey: ["/api/tax-calculation/calculations"] });
      queryClient.invalidateQueries({ queryKey: [`/api/tax-calculation/calculations/${id}`] });
      if (result.procedureSynced) {
        queryClient.invalidateQueries({ queryKey: ["/api/procedures"] });
      }
      
      if (removedProducts.length > 0) {
        if (result.procedureSynced) {
          toast({
            title: "Procedure updated",
            description: `Linked procedure #${result.procedureId} was updated with the new totals`,
          });
        }
        setPendingRemovedItems(removedProducts);
        setShowRemovedItemsDialog(true);
      } else {
        toast({
          title: "Success",
          description: result.procedureSynced
            ? `Calculation updated — linked procedure #${result.procedureId} also updated`
            : "Calculation updated successfully",
        });
        navigate(`/tax-calculation/${id}`);
      }
    },
```

(The `["/api/procedures"]` invalidation matches the existing pattern in `tax-calculation-results.tsx:106`.)

- [ ] **Step 3: Typecheck**

Run: `npm run check`
Expected: no NEW errors in `client/src/pages/tax-calculation-edit.tsx`.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/tax-calculation-edit.tsx
git commit -m "feat(tax-calc-edit): show linked procedure sync result, refresh procedure caches"
```

---

### Task 4: End-to-end verification (mutates real dev data — do this deliberately)

**Files:** none (manual verification)

- [ ] **Step 1: Start the dev server**

Run: `node --env-file=.env --import tsx server/index.ts` (port 5000)

- [ ] **Step 2: Pick or create a linked test calculation**

Find a calculation with `procedure_id` set (`GET http://localhost:5000/api/tax-calculation/calculations`). Prefer a disposable/test one; if none exists, create a small calculation in the UI and click Create Procedure on it.

- [ ] **Step 3: Record the before-state**

Note the linked procedure's current `amount` and `piece` (`GET http://localhost:5000/api/procedures`, find by `reference`).

- [ ] **Step 4: Remove a product and save**

In the UI: open the calculation's edit page (`/tax-calculation/<id>/edit`), remove one product, save (with recalculation).

Expected:
- Toast mentions the linked procedure number.
- Procedures page shows the NEW (lower) `amount` and `piece` for that procedure without a manual refresh.
- Procedure detail page shows the updated invoice line items (removed product gone).

- [ ] **Step 5: Regression check — unlinked calculation**

Edit and save a calculation WITHOUT a linked procedure. Expected: normal success toast ("Calculation updated successfully"), no errors.

- [ ] **Step 6: Regression check — replace-products flow**

In the UI, run the existing "Update Product List" flow on the linked calculation (tax-calculation-results page). Expected: works as before, procedure stays in sync.

---

## Self-Review Notes

- Spec coverage: helper (Task 1), calculate call site + response fields (Task 1), replace-products refactor preserving invoiceMetadata handling (Task 2), client toast + cache invalidation (Task 3), verification incl. no-procedure path (Tasks 1/4). `taxes` table explicitly out of scope per spec.
- TDD deviation is deliberate and documented: the repo has no test infrastructure; adding one is out of scope (YAGNI, repo convention).
- Type consistency: `syncProcedureFromCalculation(calculationId, userId?)` returning `{ synced, procedureId? }` is used identically in Tasks 1 and 2; client fields `procedureSynced`/`procedureId` match the server response shape defined in Task 1.
