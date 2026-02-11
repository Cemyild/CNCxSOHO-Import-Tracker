/**
 * This file contains functions to transform data from the database into the format
 * expected by the Adobe PDF Services for document generation.
 * 
 * This is a simplified version to address the specific issue with procedure payment differences.
 */
import { db } from "./db";
import { paymentDistributions } from "@shared/schema";
import { eq } from "drizzle-orm";

/**
 * Format a date string in DD.MM.YYYY format specifically for the Adobe template
 */
function formatDateForTemplate(date: string | Date | null): string {
  if (!date) return "";
  
  const dateObj = date instanceof Date ? date : new Date(date);
  
  if (isNaN(dateObj.getTime())) {
    return "";
  }
  
  const day = dateObj.getDate().toString().padStart(2, '0');
  const month = (dateObj.getMonth() + 1).toString().padStart(2, '0');
  const year = dateObj.getFullYear();
  
  return `${day}.${month}.${year}`;
}

/**
 * Format currency with commas for thousands separator and two decimal places
 * This matches the format in the provided JSON example: "31,189.23"
 */
function formatNumberWithCommas(amount: string | number): string {
  if (amount === null || amount === undefined) return "0.00";
  
  // If it's already a string with commas, return it as is
  if (typeof amount === 'string' && amount.includes(',')) {
    return amount;
  }
  
  // Clean the input if it's a string
  let numericValue = amount;
  if (typeof amount === 'string') {
    // Remove non-numeric characters except decimal point
    // Keep only the first decimal point if multiple exist
    const parts = amount.split('.');
    const firstPart = parts[0].replace(/[^\d]/g, '');
    
    if (parts.length > 1) {
      // Keep only the first two decimal places
      const secondPart = parts[1].replace(/[^\d]/g, '').substring(0, 2).padEnd(2, '0');
      numericValue = parseFloat(`${firstPart}.${secondPart}`);
    } else {
      numericValue = parseInt(firstPart, 10);
    }
  }
  
  // Handle special cases
  if (isNaN(Number(numericValue))) return "0.00";
  
  // Format the number with thousands separator and two decimal places
  return Number(numericValue).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

/**
 * Transform data specifically for the excess payment vs remaining balance case.
 * This function takes the actual procedure data from the database and ensures the 
 * financial summary contains the correct is_excess_payment flag and values.
 */
export async function generateFixedTemplate(procedureData: any): Promise<any> {
  const procedure = procedureData.procedure;
  const tax = procedureData.tax || null;
  const importExpenses = procedureData.importExpenses || [];
  const serviceInvoices = procedureData.serviceInvoices || [];
  const payments = procedureData.payments || [];
  const freightAmount = procedureData.freightAmount || 0;
  
  // Log reference to ensure we're working with the right data
  const reference = procedure.reference;
  console.log(`[Enhanced Transformer] Processing procedure reference: ${reference}`);
  console.log(`[Enhanced Transformer] Procedure ID: ${procedure.id}`);
  
  // Calculate expense totals
  // First calculate total taxes
  const totalTaxes = tax ? (
    parseFloat(tax.customsTax || '0') +
    parseFloat(tax.additionalCustomsTax || '0') +
    parseFloat(tax.kkdf || '0') +
    parseFloat(tax.vat || '0') +
    parseFloat(tax.stampTax || '0')
  ) : 0;
  
  // Calculate total import expenses
  const totalImportExpenses = importExpenses.reduce((sum: number, expense: any) => {
    return sum + parseFloat(expense.amount || '0');
  }, 0);
  
  // Calculate total service invoices
  const totalServiceInvoices = serviceInvoices.reduce((sum: number, invoice: any) => {
    return sum + parseFloat(invoice.amount || '0');
  }, 0);
  
  // Calculate import_expenses_total (Import Expenses only, NOT including Service Invoices)
  const importExpensesTotal = totalImportExpenses;
  
  console.log(`[Enhanced Transformer] DETAILED CALCULATION BREAKDOWN:`);
  console.log(`[Enhanced Transformer] - totalImportExpenses (direct from DB): ${totalImportExpenses}`);
  console.log(`[Enhanced Transformer] - totalServiceInvoices (direct from DB): ${totalServiceInvoices}`);
  console.log(`[Enhanced Transformer] - importExpensesTotal (import expenses only): ${importExpensesTotal}`);
  
  // Calculate total expenses (Taxes + Import Expenses + Service Invoices)
  const totalExpenses = totalTaxes + importExpensesTotal + totalServiceInvoices;
  
  console.log(`[Enhanced Transformer] DETAILED TOTAL EXPENSES CALCULATION:`);
  console.log(`[Enhanced Transformer] - totalTaxes: ${totalTaxes}`);
  console.log(`[Enhanced Transformer] - importExpensesTotal: ${importExpensesTotal}`);
  console.log(`[Enhanced Transformer] - totalServiceInvoices: ${totalServiceInvoices}`);
  console.log(`[Enhanced Transformer] - freightAmount: ${freightAmount} (NOT included in total_expenses)`);
  console.log(`[Enhanced Transformer] - TOTAL EXPENSES (sum of taxes + import expenses + service invoices): ${totalExpenses}`);
  console.log(`[Enhanced Transformer] - Expected total (1,014,329.85 + 18,731.12 + 8,669.50): 1,041,730.47`);
  
  // Calculate total payments from both traditional payments and distributions
  // First get all payment distributions for this procedure
  const distributions = await db.select().from(paymentDistributions)
    .where(eq(paymentDistributions.procedureReference, reference));
    
  console.log(`[Enhanced Transformer] Found ${distributions.length} payment distributions for ${reference}`);
  
  // Calculate total payments from traditional payments
  const totalTraditionalPayments = payments.reduce((sum: number, payment: any) => {
    const amount = parseFloat(payment.amount.toString());
    return sum + amount;
  }, 0);
  
  // Calculate total payments from distributions
  const totalDistributedPayments = distributions.reduce((sum: number, dist: any) => {
    const amount = typeof dist.distributedAmount === 'string'
      ? parseFloat(dist.distributedAmount)
      : Number(dist.distributedAmount);
    return sum + amount;
  }, 0);
  
  // Combined total payments
  const totalPayments = totalTraditionalPayments + totalDistributedPayments;
  
  console.log(`[Enhanced Transformer] Payment breakdown for ${reference}:`, {
    totalTraditionalPayments,
    totalDistributedPayments,
    totalPayments
  });
  
  // Calculate the difference to determine excess payment or remaining balance
  const paymentDifference = totalPayments - totalExpenses;
  
  // Format values with commas
  const formattedTotalExpenses = formatNumberWithCommas(totalExpenses);
  const formattedTotalPayments = formatNumberWithCommas(totalPayments);
  
  // Determine if this is an excess payment or remaining balance
  const isExcessPayment = paymentDifference > 0;
  const excessPayment = isExcessPayment ? paymentDifference : 0;
  const remainingBalance = !isExcessPayment ? Math.abs(paymentDifference) : 0;
  
  // Determine payment status
  let paymentStatus;
  if (Math.abs(paymentDifference) < 0.01) {
    paymentStatus = "Paid";
  } else if (isExcessPayment) {
    paymentStatus = "Overpaid";
  } else {
    paymentStatus = "Unpaid";
  }
  
  // Debug values
  console.log(`[Enhanced Transformer] Financial calculations for ${reference}:`, {
    totalTaxes,
    totalImportExpenses,
    totalServiceInvoices,
    importExpensesTotal, // Add the new value to the debug output
    freightAmount,
    totalExpenses,
    totalPayments,
    paymentDifference,
    isExcessPayment,
    excessPayment,
    remainingBalance,
    paymentStatus
  });
  
  // Create the data for the template with the correct financial summary
  const templateData = {
    reference: procedure.reference,
    shipper: procedure.shipper,
    invoice_no: procedure.invoice_no,
    invoice_date: formatDateForTemplate(procedure.invoice_date),
    amount: formatNumberWithCommas(procedure.amount),
    currency: procedure.currency,
    piece: procedure.piece?.toString() || "0",
    import_dec_number: procedure.import_dec_number || "N/A",
    
    taxes: {
      customs_tax: tax ? formatNumberWithCommas(tax.customsTax) : "0.00",
      additional_customs_tax: tax ? formatNumberWithCommas(tax.additionalCustomsTax) : "0.00",
      kkdf: tax ? formatNumberWithCommas(tax.kkdf) : "0.00",
      vat: tax ? formatNumberWithCommas(tax.vat) : "0.00",
      stamp_tax: tax ? formatNumberWithCommas(tax.stampTax) : "0.00",
      total_tax: formatNumberWithCommas(totalTaxes)
    },
    
    // Create import expenses structure based on actual data
    import_expenses: {
      export_registry_fee: formatNumberWithCommas(importExpenses.find((exp: any) => exp.category === 'export_registry_fee')?.amount || "0"),
      insurance: formatNumberWithCommas(importExpenses.find((exp: any) => exp.category === 'insurance')?.amount || "0"),
      awb_fee: formatNumberWithCommas(importExpenses.find((exp: any) => exp.category === 'awb_fee')?.amount || "0"),
      airport_storage_fee: formatNumberWithCommas(importExpenses.find((exp: any) => exp.category === 'airport_storage_fee')?.amount || "0"),
      bonded_warehouse_storage_fee: formatNumberWithCommas(importExpenses.find((exp: any) => exp.category === 'bonded_warehouse_storage_fee')?.amount || "0"),
      transportation: formatNumberWithCommas(importExpenses.find((exp: any) => exp.category === 'transportation')?.amount || "0"),
      international_transportation: formatNumberWithCommas(importExpenses.find((exp: any) => exp.category === 'international_transportation')?.amount || "0"),
      tareks_fee: formatNumberWithCommas(importExpenses.find((exp: any) => exp.category === 'tareks_fee')?.amount || "0"),
      customs_inspection: formatNumberWithCommas(importExpenses.find((exp: any) => exp.category === 'customs_inspection')?.amount || "0"),
      azo_test: formatNumberWithCommas(importExpenses.find((exp: any) => exp.category === 'azo_test')?.amount || "0"),
      other: formatNumberWithCommas(importExpenses.find((exp: any) => exp.category === 'other')?.amount || "0"),
      import_expenses_total: formatNumberWithCommas(importExpensesTotal)
    },
    
    service_invoices_total: formatNumberWithCommas(totalServiceInvoices),
    
    // Add the new combined field for import expenses and service invoices
    import_and_service_total: formatNumberWithCommas(importExpensesTotal + totalServiceInvoices),
    
    // This is the critical part - set the correct financial summary values
    financial_summary: {
      total_expenses: formattedTotalExpenses,
      total_payment: formattedTotalPayments,
      balance_value: formatNumberWithCommas(Math.max(excessPayment, remainingBalance)),
      is_excess_payment: isExcessPayment,
      excess_payment: formatNumberWithCommas(excessPayment),
      remaining_balance: formatNumberWithCommas(remainingBalance),
      payment_status: paymentStatus
    }
  };
  
  console.log(`[Enhanced Transformer] Returning template data for ${reference} with is_excess_payment=${isExcessPayment}`);
  return templateData;
}