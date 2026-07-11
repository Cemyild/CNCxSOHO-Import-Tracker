// server/master-excel-helper.ts
// Builds the cell-value array(s) used to append a procedure into the master IMPORT LIST sheet.
// Mirrors the column layout used by the existing /api/procedures/:reference/export/excel endpoint.

import { db } from "./db";
import { eq } from "drizzle-orm";
import { storage } from "./storage";
import { taxes, importExpenses, importServiceInvoices } from "@shared/schema";

export type CellValue = string | number | Date | null;

// 54 cells per row — matches columns A (index 1) … BB (index 54) in the master sheet.
export const MASTER_COLUMN_COUNT = 54;

// 1-indexed Excel columns that should be formatted as date / number (mirror the export route).
export const DATE_COLUMNS = [5, 10, 15, 25, 29, 33, 37, 41, 44, 47, 50, 54];
export const NUMBER_COLUMNS = [6, 16, 17, 18, 19, 20, 21, 22, 23, 26, 30, 34, 38, 42, 45, 48, 51, 52];

function parseDate(date: any): Date | null {
  if (!date) return null;
  if (date instanceof Date) return isNaN(date.getTime()) ? null : date;
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const [year, month, day] = date.split('-').map(Number);
    return new Date(year, month - 1, day);
  }
  return null;
}

function num(val: any): number | null {
  if (val == null || val === '') return null;
  const n = typeof val === 'number' ? val : Number(val);
  return isFinite(n) ? n : null;
}

// --- Same-category merge helpers -------------------------------------------
// When a procedure has more than one expense in the same category we collapse
// them into a single cell instead of emitting one row per expense:
//   amount        -> sum of all non-blank amounts
//   issuer/inv no -> non-blank values joined with " - " (repeats de-duplicated)
//   invoiceDate   -> a real Excel date when there is one distinct day, otherwise
//                    a "15/20.06.2026" (same month) or "15.06.2026 - 20.07.2026"
//                    (different month/year) text string.

// Sum the given amount field across items, skipping blanks. null if nothing to sum.
function sumAmounts(items: any[], key: string): number | null {
  let total = 0;
  let any = false;
  for (const it of items) {
    const n = num(it?.[key]);
    if (n != null) { total += n; any = true; }
  }
  return any ? total : null;
}

// Join text values with " - ", de-duplicating repeats while preserving
// first-seen order. For each item the first non-blank key in `keys` wins
// (mirrors the fallback chains used in the original layout, e.g. insurance's
// policyNumber || invoiceNumber || documentNumber). Returns '' when empty.
function joinUnique(items: any[], keys: string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const it of items) {
    let val = '';
    for (const k of keys) {
      const v = it?.[k];
      if (v != null && String(v).trim() !== '') { val = String(v).trim(); break; }
    }
    if (val && !seen.has(val)) { seen.add(val); out.push(val); }
  }
  return out.join(' - ');
}

function fmtDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${d.getFullYear()}`;
}

// Merge the invoiceDate field across items into a single cell value.
function mergeDates(items: any[], key: string): CellValue {
  const dates: Date[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    const d = parseDate(it?.[key]);
    if (!d) continue;
    const dayKey = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (seen.has(dayKey)) continue; // one entry per distinct day
    seen.add(dayKey);
    dates.push(d);
  }
  if (dates.length === 0) return null;
  if (dates.length === 1) return dates[0]; // real date cell — Excel formats it

  const sameMonthYear = dates.every(
    d => d.getMonth() === dates[0].getMonth() && d.getFullYear() === dates[0].getFullYear(),
  );
  if (sameMonthYear) {
    const days = dates.map(d => String(d.getDate()).padStart(2, '0')).join('/');
    const mm = String(dates[0].getMonth() + 1).padStart(2, '0');
    return `${days}.${mm}.${dates[0].getFullYear()}`;
  }
  return dates.map(fmtDate).join(' - ');
}
// ---------------------------------------------------------------------------

export interface ProcedureMasterRows {
  reference: string;
  rows: CellValue[][];
}

export async function buildProcedureMasterRows(reference: string): Promise<ProcedureMasterRows> {
  const procedures = await storage.getProcedureByReference(reference);
  if (!procedures || procedures.length === 0) {
    throw new Error(`Procedure not found: ${reference}`);
  }
  const procedure = procedures[0];

  const taxResults = await db.select().from(taxes).where(eq(taxes.procedureReference, reference));
  const tax = taxResults[0] || null;

  const expenses = await db.select().from(importExpenses).where(eq(importExpenses.procedureReference, reference));
  const serviceInvoices = await db.select().from(importServiceInvoices).where(eq(importServiceInvoices.procedureReference, reference));

  const expensesByCategory = {
    export_registry_fee: expenses.filter(e => e.category === 'export_registry_fee'),
    insurance: expenses.filter(e => e.category === 'insurance'),
    awb_fee: expenses.filter(e => e.category === 'awb_fee'),
    airport_storage_fee: expenses.filter(e => e.category === 'airport_storage_fee'),
    bonded_warehouse_storage_fee: expenses.filter(e => e.category === 'bonded_warehouse_storage_fee'),
    transportation: expenses.filter(e => e.category === 'transportation'),
    tareks_fee: expenses.filter(e => e.category === 'tareks_fee'),
    international_transportation: expenses.filter(e => e.category === 'international_transportation'),
    customs_inspection: expenses.filter(e => e.category === 'customs_inspection'),
  };

  // One consolidated row per procedure: every category is merged into a single
  // cell (see the merge helpers above) instead of emitting one row per expense.
  const reg = expensesByCategory.export_registry_fee;
  const ins = expensesByCategory.insurance;
  const awb = expensesByCategory.awb_fee;
  const air = expensesByCategory.airport_storage_fee;
  const bwh = expensesByCategory.bonded_warehouse_storage_fee;
  const trn = expensesByCategory.transportation;
  const trk = expensesByCategory.tareks_fee;
  const itr = expensesByCategory.international_transportation;
  const cin = expensesByCategory.customs_inspection;

  const row: CellValue[] = [
    procedure.reference || '',                                                           // A
    procedure.shipper || '',                                                             // B
    procedure.invoice_no || '',                                                          // C
    '',                                                                                  // D STATUS — left blank to match existing export
    parseDate(procedure.invoice_date),                                                   // E
    num(procedure.amount),                                                               // F
    procedure.currency || '',                                                            // G
    (procedure as any).piece ?? '',                                                      // H
    (procedure as any).kg ?? '',                                                         // I
    parseDate((procedure as any).arrival_date),                                          // J
    (procedure as any).awb_number || '',                                                 // K
    (procedure as any).carrier || '',                                                    // L
    (procedure as any).customs || '',                                                    // M
    (procedure as any).import_dec_number || '',                                          // N
    parseDate((procedure as any).import_dec_date),                                       // O
    num((tax as any)?.customsTax),                                                       // P
    num((tax as any)?.additionalCustomsTax),                                             // Q
    num((tax as any)?.kkdf),                                                             // R
    num((tax as any)?.vat),                                                              // S
    num((tax as any)?.stampTax),                                                         // T
    null,                                                                                // U TOTAL TAX (formula in master)
    sumAmounts(reg, 'amount'),                                                           // V  export registry
    sumAmounts(ins, 'amount'),                                                           // W  insurance
    joinUnique(ins, ['policyNumber', 'invoiceNumber', 'documentNumber']),                // X  insurance doc no
    mergeDates(ins, 'invoiceDate'),                                                      // Y  insurance date
    sumAmounts(awb, 'amount'),                                                           // Z  awb
    joinUnique(awb, ['issuer']),                                                         // AA awb issuer
    joinUnique(awb, ['invoiceNumber']),                                                  // AB awb invoice no
    mergeDates(awb, 'invoiceDate'),                                                      // AC awb date
    sumAmounts(air, 'amount'),                                                           // AD airport storage
    joinUnique(air, ['issuer']),                                                         // AE
    joinUnique(air, ['invoiceNumber']),                                                  // AF
    mergeDates(air, 'invoiceDate'),                                                      // AG
    sumAmounts(bwh, 'amount'),                                                           // AH bonded warehouse
    joinUnique(bwh, ['issuer']),                                                         // AI
    joinUnique(bwh, ['invoiceNumber']),                                                  // AJ
    mergeDates(bwh, 'invoiceDate'),                                                      // AK
    sumAmounts(trn, 'amount'),                                                           // AL transportation
    joinUnique(trn, ['issuer']),                                                         // AM
    joinUnique(trn, ['invoiceNumber']),                                                  // AN
    mergeDates(trn, 'invoiceDate'),                                                      // AO
    sumAmounts(trk, 'amount'),                                                           // AP tareks
    joinUnique(trk, ['invoiceNumber']),                                                  // AQ
    mergeDates(trk, 'invoiceDate'),                                                      // AR
    sumAmounts(itr, 'amount'),                                                           // AS international transport
    joinUnique(itr, ['invoiceNumber']),                                                  // AT
    mergeDates(itr, 'invoiceDate'),                                                      // AU
    sumAmounts(cin, 'amount'),                                                           // AV customs inspection
    mergeDates(cin, 'invoiceDate'),                                                      // AW
    null,                                                                                // AX DATE43
    null,                                                                                // AY TOTAL FEES PAID (formula)
    sumAmounts(serviceInvoices, 'amount'),                                               // AZ service fee
    joinUnique(serviceInvoices, ['invoiceNumber']),                                      // BA
    mergeDates(serviceInvoices, 'date'),                                                 // BB
  ];

  return { reference: procedure.reference, rows: [row] };
}
