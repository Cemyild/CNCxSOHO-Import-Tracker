# Tareks Application Dashboard Section — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Tareks Application" section to the Dashboard page that lists all procedures with `shipment_status = 'tareks_application'` with a new inline-editable `tareks_status` field.

**Architecture:** Add a `tareks_status` text column to the procedures table (same pattern as existing status fields), a new dashboard API endpoint, a new React component, and wire everything into the dashboard page.

**Tech Stack:** PostgreSQL (Neon), Drizzle ORM, Express.js, React 18, TanStack Query v5, Tailwind CSS, shadcn/ui, Radix UI Select, Lucide React.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `shared/schema.ts` | Modify | Add `tareks_status` column to procedures table |
| `server/routes.ts` | Modify | Add `GET /api/dashboard/tareks-application` endpoint |
| `client/src/components/tareks-procedures-list.tsx` | Create | New list component for dashboard |
| `client/src/pages/dashboard.tsx` | Modify | Fetch tareks data, render new component |

---

## Task 1: Add `tareks_status` Column to Schema

**Files:**
- Modify: `shared/schema.ts` (procedures table, lines 102-135)

- [ ] **Step 1: Add `tareks_status` field to procedures table in schema**

Open `shared/schema.ts`. Find the procedures table definition (starts at line 102). Add `tareks_status` after the `shipment_status` line:

```typescript
// Before (around line 125):
  shipment_status: text("shipment_status"),

// After:
  shipment_status: text("shipment_status"),
  tareks_status: text("tareks_status").default('waiting_response'),
```

- [ ] **Step 2: Push schema change to database**

```bash
npm run db:push
```

Expected output: Drizzle prints the ALTER TABLE statement and confirms the column was added. No data loss — existing rows will get `waiting_response` as the default value.

- [ ] **Step 3: Verify column exists in DB**

```bash
# Run in a quick test or via the debug endpoint:
curl http://localhost:5000/api/dashboard/debug
```

Expected: The columns list for the `procedures` table includes `tareks_status`.

- [ ] **Step 4: Commit**

```bash
git add shared/schema.ts
git commit -m "feat: add tareks_status column to procedures table"
```

---

## Task 2: Add Backend API Endpoint

**Files:**
- Modify: `server/routes.ts` (after line 4502, before the debug endpoint at 4505)

- [ ] **Step 1: Add the endpoint to routes.ts**

Find the `app.get("/api/dashboard/awaiting-payment"` block (ends around line 4502). Add the new endpoint immediately after it:

```typescript
  // GET procedures in tareks_application shipment status
  app.get("/api/dashboard/tareks-application", async (req, res) => {
    try {
      const query = `
        SELECT id, reference, shipper, invoice_no, invoice_date, amount, currency, piece, tareks_status, created_at
        FROM procedures 
        WHERE shipment_status = 'tareks_application'
        ORDER BY created_at DESC
      `;

      const result = await rawDb.query(query);

      res.json({
        count: result.rowCount || 0,
        procedures: result.rows || [],
      });
    } catch (error) {
      console.error("Error fetching tareks application procedures:", error);
      res.status(500).json({
        error: "Failed to fetch tareks application procedures",
      });
    }
  });
```

- [ ] **Step 2: Verify the existing PATCH endpoint already handles tareks_status**

The `PATCH /api/procedures/:id` endpoint at line 906 passes `req.body` directly into `storage.updateProcedure(id, processedData)`. No changes needed — it already accepts any field on the procedures table, including the new `tareks_status`.

- [ ] **Step 3: Start dev server and test endpoint**

```bash
npm run dev
```

In another terminal:
```bash
curl http://localhost:5000/api/dashboard/tareks-application
```

Expected response:
```json
{
  "count": 0,
  "procedures": []
}
```

(Or a non-empty array if any procedures have `shipment_status = 'tareks_application'`.)

- [ ] **Step 4: Commit**

```bash
git add server/routes.ts
git commit -m "feat: add GET /api/dashboard/tareks-application endpoint"
```

---

## Task 3: Create TareksProceduresList Component

**Files:**
- Create: `client/src/components/tareks-procedures-list.tsx`

- [ ] **Step 1: Create the component file**

Create `client/src/components/tareks-procedures-list.tsx` with the following content:

```tsx
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { ClipboardList } from "lucide-react";

type TareksProcedure = {
  id: number;
  reference: string;
  shipper: string | null;
  invoice_no: string | null;
  invoice_date: string | null;
  amount: string | null;
  currency: string | null;
  piece: number | null;
  tareks_status: string;
};

type TareksDashboardData = {
  count: number;
  procedures: TareksProcedure[];
};

const TAREKS_STATUSES = [
  { value: "waiting_response", label: "Waiting Response" },
  { value: "inspection_date_confirmed", label: "Inspection Date Confirmed" },
  { value: "samples_taken", label: "Samples Taken" },
  { value: "lab_testing", label: "Lab Testing" },
] as const;

type TareksSatusValue = typeof TAREKS_STATUSES[number]["value"];

const STATUS_BADGE_STYLES: Record<TareksSatusValue, string> = {
  waiting_response: "bg-amber-100 text-amber-800 border-amber-200",
  inspection_date_confirmed: "bg-blue-100 text-blue-800 border-blue-200",
  samples_taken: "bg-orange-100 text-orange-800 border-orange-200",
  lab_testing: "bg-purple-100 text-purple-800 border-purple-200",
};

function getStatusLabel(value: string): string {
  return TAREKS_STATUSES.find((s) => s.value === value)?.label ?? value;
}

function formatAmount(amount: string | null, currency: string | null): string {
  if (!amount) return "—";
  const num = parseFloat(amount);
  if (isNaN(num)) return "—";
  const curr = currency ?? "USD";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: curr,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(num);
}

export function TareksProceduresList() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [updatingId, setUpdatingId] = useState<number | null>(null);

  const { data, isLoading } = useQuery<TareksDashboardData>({
    queryKey: ["/api/dashboard/tareks-application"],
  });

  const mutation = useMutation({
    mutationFn: async ({
      id,
      tareks_status,
    }: {
      id: number;
      tareks_status: string;
    }) => {
      const res = await fetch(`/api/procedures/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tareks_status }),
      });
      if (!res.ok) throw new Error("Failed to update status");
      return res.json();
    },
    onMutate: ({ id }) => {
      setUpdatingId(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/dashboard/tareks-application"],
      });
      toast({ title: "Status updated" });
    },
    onError: () => {
      toast({ title: "Failed to update status", variant: "destructive" });
    },
    onSettled: () => {
      setUpdatingId(null);
    },
  });

  return (
    <div className="mt-6 rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100">
        <ClipboardList className="h-5 w-5 text-red-500" />
        <h2 className="text-base font-semibold text-gray-900">
          Tareks Application
        </h2>
        {!isLoading && (
          <Badge className="ml-1 bg-red-100 text-red-700 border-red-200 text-xs">
            {data?.count ?? 0}
          </Badge>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
              <th className="px-4 py-3 text-left font-medium">Reference</th>
              <th className="px-4 py-3 text-left font-medium">Shipper</th>
              <th className="px-4 py-3 text-left font-medium">Invoice #</th>
              <th className="px-4 py-3 text-left font-medium">Invoice Date</th>
              <th className="px-4 py-3 text-right font-medium">Amount</th>
              <th className="px-4 py-3 text-right font-medium">Pieces</th>
              <th className="px-4 py-3 text-left font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {isLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: 7 }).map((_, j) => (
                    <td key={j} className="px-4 py-3">
                      <Skeleton className="h-4 w-full" />
                    </td>
                  ))}
                </tr>
              ))
            ) : !data || data.procedures.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-8 text-center text-gray-400 text-sm"
                >
                  No procedures in Tareks Application status
                </td>
              </tr>
            ) : (
              data.procedures.map((proc) => {
                const statusValue = (proc.tareks_status ?? "waiting_response") as TareksSatusValue;
                const badgeStyle = STATUS_BADGE_STYLES[statusValue] ?? STATUS_BADGE_STYLES.waiting_response;
                return (
                  <tr
                    key={proc.id}
                    className="hover:bg-gray-50 transition-colors"
                  >
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {proc.reference ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {proc.shipper ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {proc.invoice_no ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {proc.invoice_date ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-900 font-medium">
                      {formatAmount(proc.amount, proc.currency)}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-600">
                      {proc.piece ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <Select
                        value={statusValue}
                        onValueChange={(val) =>
                          mutation.mutate({
                            id: proc.id,
                            tareks_status: val,
                          })
                        }
                        disabled={updatingId === proc.id}
                      >
                        <SelectTrigger className="h-7 w-[210px] border-0 p-0 shadow-none focus:ring-0">
                          <Badge
                            className={`text-xs font-medium border ${badgeStyle} cursor-pointer`}
                          >
                            {getStatusLabel(statusValue)}
                          </Badge>
                        </SelectTrigger>
                        <SelectContent>
                          {TAREKS_STATUSES.map((s) => (
                            <SelectItem key={s.value} value={s.value}>
                              {s.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify imports exist in the project**

The component uses `useQuery`, `useMutation`, `useQueryClient` from `@tanstack/react-query`, `Select` from `@/components/ui/select`, `Badge` from `@/components/ui/badge`, `Skeleton` from `@/components/ui/skeleton`, `useToast` from `@/hooks/use-toast`, and `ClipboardList` from `lucide-react`. All of these are already in the project.

```bash
ls client/src/components/ui/select.tsx client/src/components/ui/badge.tsx client/src/components/ui/skeleton.tsx
```

Expected: All three files exist.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/tareks-procedures-list.tsx
git commit -m "feat: add TareksProceduresList dashboard component"
```

---

## Task 4: Wire Component into Dashboard Page

**Files:**
- Modify: `client/src/pages/dashboard.tsx`

- [ ] **Step 1: Import TareksProceduresList in dashboard.tsx**

Open `client/src/pages/dashboard.tsx`. Add the import after the existing imports (after line 14):

```typescript
import { TareksProceduresList } from "@/components/tareks-procedures-list";
```

- [ ] **Step 2: Render the component in the return JSX**

In the `return` statement of `DashboardPage` (around line 124), add `<TareksProceduresList />` after the closing `</CardsProvider>` tag but inside `<PageLayout>`:

```tsx
// Before:
      </CardsProvider>
    </PageLayout>

// After:
      </CardsProvider>
      <TareksProceduresList />
    </PageLayout>
```

The full return should look like:

```tsx
  return (
    <PageLayout title="Dashboard" navItems={items}>
      <DashboardSnapshot />
      <CardsProvider>
        <div className="grid gap-4 md:grid-cols-3">
          <DashboardCard
            title="Active Procedures"
            procedures={dashboardData.activeProcedures.procedures}
            count={dashboardData.activeProcedures.count}
            isLoading={loading}
          />
          <DashboardCard
            title="Pending Documents"
            procedures={dashboardData.pendingDocuments.procedures}
            count={dashboardData.pendingDocuments.count}
            isLoading={loading}
          />
          <DashboardCard
            title="Awaiting Payment"
            procedures={dashboardData.awaitingPayment.procedures}
            count={dashboardData.awaitingPayment.count}
            isLoading={loading}
          />
        </div>
      </CardsProvider>
      <TareksProceduresList />
    </PageLayout>
  );
```

- [ ] **Step 3: Run type check**

```bash
npm run check
```

Expected: No TypeScript errors.

- [ ] **Step 4: Start the dev server and verify in browser**

```bash
npm run dev
```

Open `http://localhost:5000/dashboard` in a browser. Verify:
- The "Tareks Application" section appears below the three cards
- It shows the table headers: Reference, Shipper, Invoice #, Invoice Date, Amount, Pieces, Status
- If no procedures have `tareks_application` shipment status, the empty state message shows
- If procedures exist, they render with amber "Waiting Response" badges

- [ ] **Step 5: Test status update (if data exists)**

If a procedure with `shipment_status = 'tareks_application'` exists:
1. Click the status badge in the list
2. Select a different status (e.g., "Inspection Date Confirmed")
3. The badge should update to blue "Inspection Date Confirmed"
4. A toast notification should appear: "Status updated"
5. Reload the page — the updated status should persist

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/dashboard.tsx
git commit -m "feat: add Tareks Application section to dashboard"
```

---

## Done

All four tasks complete. The feature is fully functional:
- `tareks_status` column in the database with default `waiting_response`
- `GET /api/dashboard/tareks-application` returns procedures with `shipment_status = 'tareks_application'`
- `TareksProceduresList` renders the table with inline status editing
- Dashboard page shows the new section below the existing cards
