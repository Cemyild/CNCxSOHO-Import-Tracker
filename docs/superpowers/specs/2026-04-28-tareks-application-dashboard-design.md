# Dashboard Tareks Application Section — Design Spec

**Date:** 2026-04-28  
**Status:** Approved

---

## Overview

Add a new "Tareks Application" section to the Dashboard page, displayed below the existing three cards (Active Procedures, Pending Documents, Awaiting Payment). This section lists all procedures currently in `tareks_application` shipment status with a dedicated sub-tracking status for the inspection workflow.

---

## Database Changes

### New Column: `tareks_status` on `procedures` table

```sql
ALTER TABLE procedures 
ADD COLUMN tareks_status TEXT DEFAULT 'waiting_response';
```

Allowed values (enforced in application layer):
- `waiting_response`
- `inspection_date_confirmed`
- `samples_taken`
- `lab_testing`

Default: `waiting_response`

This follows the same pattern as the existing three status fields (`shipment_status`, `document_status`, `payment_status`).

---

## Backend Changes

### 1. Shared Schema (`shared/schema.ts`)

Add `tareksProcedureStatus` enum and `tareks_status` column to the `procedures` table definition.

### 2. New API Endpoint

```
GET /api/dashboard/tareks-application
```

Returns all procedures where `shipment_status = 'tareks_application'`, ordered by `created_at DESC`.

Response shape:
```typescript
{
  count: number;
  procedures: Array<{
    id: number;
    reference: string;
    shipper: string | null;
    invoice_number: string | null;
    invoice_date: string | null;
    amount: string | null;
    currency: string | null;
    pieces: number | null;
    tareks_status: string;
  }>;
}
```

### 3. Update Existing PATCH Endpoint

`PATCH /api/procedures/:id` already supports partial updates. Ensure `tareks_status` is included in the accepted fields and Zod validation schema.

---

## Frontend Changes

### 1. New Component: `TareksProceduresList`

**File:** `client/src/components/tareks-procedures-list.tsx`

A standalone list component (not a card) rendered below the three dashboard cards.

Layout:
- Section header: "Tareks Application" with a red badge showing count
- Table with columns:
  | # | Reference | Shipper | Invoice # | Invoice Date | Amount | Pieces | Status |
- Status column: colored badge + click-to-change dropdown (select from 4 values)
- Empty state: neutral message "No procedures in Tareks Application status"
- Loading state: skeleton rows

Status badge colors:
- `waiting_response` → Yellow (amber)
- `inspection_date_confirmed` → Blue
- `samples_taken` → Orange
- `lab_testing` → Purple

### 2. Update Dashboard Page (`client/src/pages/dashboard.tsx`)

- Add `useQuery` for `GET /api/dashboard/tareks-application`
- Import and render `TareksProceduresList` below the existing cards
- Pass data and a mutation function for status updates

### 3. Status Update Flow

When user clicks a status badge in the list:
- Dropdown appears with 4 options
- On select, fires `PATCH /api/procedures/:id` with `{ tareks_status: newValue }`
- Optimistic update in TanStack Query cache
- Toast notification on success/error

---

## Data Flow

```
Dashboard page loads
  → useQuery('/api/dashboard/tareks-application')
      → Server: SELECT ... FROM procedures WHERE shipment_status = 'tareks_application'
      → Returns procedures array
  → TareksProceduresList renders table

User changes status
  → Dropdown select → useMutation(PATCH /api/procedures/:id)
      → Server updates tareks_status
      → Client invalidates tareks-application query
      → List re-renders with new status
```

---

## Display Labels

| DB Value | Display Label |
|---|---|
| `waiting_response` | Waiting Response |
| `inspection_date_confirmed` | Inspection Date Confirmed |
| `samples_taken` | Samples Taken |
| `lab_testing` | Lab Testing |

---

## Out of Scope

- Sorting/filtering within the tareks list (v1 is simple, ordered by date)
- History/audit trail of tareks_status changes
- Notifications when status changes
