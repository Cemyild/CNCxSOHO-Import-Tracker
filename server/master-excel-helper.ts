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

  const counts = Object.values(expensesByCategory).map(arr => arr.length);
  const maxCount = Math.max(...counts, serviceInvoices.length, 1);

  const rows: CellValue[][] = [];
  for (let i = 0; i < maxCount; i++) {
    const exportRegistry = expensesByCategory.export_registry_fee[i] || null;
    const insurance = expensesByCategory.insurance[i] || null;
    const awbFee = expensesByCategory.awb_fee[i] || null;
    const airportStorage = expensesByCategory.airport_storage_fee[i] || null;
    const bondedWarehouse = expensesByCategory.bonded_warehouse_storage_fee[i] || null;
    const transportation = expensesByCategory.transportation[i] || null;
    const tareksFee = expensesByCategory.tareks_fee[i] || null;
    const intlTransport = expensesByCategory.international_transportation[i] || null;
    const customsInspection = expensesByCategory.customs_inspection[i] || null;
    const serviceFee = serviceInvoices[i] || null;

    rows.push([
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
      num((exportRegistry as any)?.amount),                                                // V
      num((insurance as any)?.amount),                                                     // W
      (insurance as any)?.policyNumber || (insurance as any)?.invoiceNumber || (insurance as any)?.documentNumber || '', // X
      parseDate((insurance as any)?.invoiceDate),                                          // Y
      num((awbFee as any)?.amount),                                                        // Z
      (awbFee as any)?.issuer || '',                                                       // AA
      (awbFee as any)?.invoiceNumber || '',                                                // AB
      parseDate((awbFee as any)?.invoiceDate),                                             // AC
      num((airportStorage as any)?.amount),                                                // AD
      (airportStorage as any)?.issuer || '',                                               // AE
      (airportStorage as any)?.invoiceNumber || '',                                        // AF
      parseDate((airportStorage as any)?.invoiceDate),                                     // AG
      num((bondedWarehouse as any)?.amount),                                               // AH
      (bondedWarehouse as any)?.issuer || '',                                              // AI
      (bondedWarehouse as any)?.invoiceNumber || '',                                       // AJ
      parseDate((bondedWarehouse as any)?.invoiceDate),                                    // AK
      num((transportation as any)?.amount),                                                // AL
      (transportation as any)?.issuer || '',                                               // AM
      (transportation as any)?.invoiceNumber || '',                                        // AN
      parseDate((transportation as any)?.invoiceDate),                                     // AO
      num((tareksFee as any)?.amount),                                                     // AP
      (tareksFee as any)?.invoiceNumber || '',                                             // AQ
      parseDate((tareksFee as any)?.invoiceDate),                                          // AR
      num((intlTransport as any)?.amount),                                                 // AS
      (intlTransport as any)?.invoiceNumber || '',                                         // AT
      parseDate((intlTransport as any)?.invoiceDate),                                      // AU
      num((customsInspection as any)?.amount),                                             // AV
      parseDate((customsInspection as any)?.invoiceDate),                                  // AW
      null,                                                                                // AX DATE43
      null,                                                                                // AY TOTAL FEES PAID (formula)
      num((serviceFee as any)?.amount),                                                    // AZ
      (serviceFee as any)?.invoiceNumber || '',                                            // BA
      parseDate((serviceFee as any)?.date),                                                // BB
    ]);
  }

  return { reference: procedure.reference, rows };
}
