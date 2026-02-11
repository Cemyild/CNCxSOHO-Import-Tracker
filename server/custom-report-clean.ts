/**
 * Custom Report Generation Module - Clean Version
 * Generates custom reports based on selected report type and filters
 * Excel export functionality removed - to be rebuilt
 */
import { Router } from 'express';
import { storage } from './storage';
import { format } from 'date-fns';

const router = Router();

interface ReportFilters {
  reportType: 'import_procedures' | 'tax_details' | 'import_expenses' | 'payment_expense' | 'all_details';
  dateRange?: {
    from: string;
    to: string;
  };
  shippers?: string[];
  categories?: string[];
}

// Report type configurations for structured output
const REPORT_CONFIGURATIONS = {
  import_procedures: {
    title: 'IMPORT PROCEDURES REPORT',
    headers: ['REFERENCE', 'SHIPPER', 'INVOICE NO', 'INVOICE DATE', 'AMOUNT', 'PIECES', 'PACKAGE', 'WEIGHT', 'ARRIVAL DATE', 'AWB NUMBER', 'CARRIER', 'CUSTOMS', 'IMPORT DEC NUMBER', 'IMPORT DEC DATE'],
    dataMapping: (row: any) => [
      row.reference,
      row.shipper || '',
      row.invoice_no || '',
      row.invoice_date ? format(new Date(row.invoice_date), 'dd/MM/yyyy') : '',
      formatCurrencyWithComma(row.amount, row.currency) || '',
      row.piece || '',
      row.package || '',
      row.kg || '',
      row.arrival_date ? format(new Date(row.arrival_date), 'dd/MM/yyyy') : '',
      row.awb_number || '',
      row.carrier || '',
      row.customs || '',
      row.import_dec_number || '',
      row.import_dec_date ? format(new Date(row.import_dec_date), 'dd/MM/yyyy') : ''
    ]
  },
  tax_details: {
    title: 'TAX DETAILS REPORT',
    headers: ['REFERENCE', 'SHIPPER', 'INVOICE NO', 'CUSTOMS TAX', 'ADDITIONAL CUSTOMS TAX', 'KKDF', 'VAT', 'STAMP TAX'],
    dataMapping: (row: any) => [
      row.reference,
      row.shipper || '',
      row.invoice_no || '',
      formatTurkishLira(row.customs_tax) || '',
      formatTurkishLira(row.additional_customs_tax) || '',
      formatTurkishLira(row.kkdf) || '',
      formatTurkishLira(row.vat) || '',
      formatTurkishLira(row.stamp_tax) || ''
    ]
  },
  import_expenses: {
    title: 'IMPORT EXPENSES REPORT',
    headers: ['REFERENCE', 'SHIPPER', 'INVOICE NO', 'EXPORT REGISTRY FEE', 'INSURANCE', 'AWB FEE', 'AIRPORT STORAGE FEE', 'BONDED WAREHOUSE STORAGE FEE', 'TRANSPORTATION', 'INTERNATIONAL TRANSPORTATION', 'TAREKS FEE', 'CUSTOMS INSPECTION', 'AZO TEST', 'OTHER', 'SERVICE INVOICE'],
    dataMapping: (row: any) => [
      row.reference,
      row.shipper || '',
      row.invoice_no || '',
      row.export_registry_fee || '',
      row.insurance || '',
      row.awb_fee || '',
      row.airport_storage_fee || '',
      row.bonded_warehouse_storage_fee || '',
      row.transportation || '',
      row.international_transportation || '',
      row.tareks_fee || '',
      row.customs_inspection || '',
      row.azo_test || '',
      row.other || '',
      row.service_invoice || ''
    ]
  },
  payment_expense: {
    title: 'PAYMENT AND EXPENSE SUMMARY',
    headers: ['REFERENCE', 'SHIPPER', 'INVOICE NO', 'AMOUNT', 'PIECES', 'PAYMENT STATUS', 'TOTAL EXPENSES', 'TOTAL PAYMENTS', 'REMAINING BALANCE'],
    dataMapping: (row: any) => [
      row.reference,
      row.shipper || '',
      row.invoice_no || '',
      formatCurrencyWithComma(row.amount, row.currency) || '',
      row.piece || '',
      row.payment_status || 'Pending',
      formatTurkishLira(row.total_expenses) || '',
      formatTurkishLira(row.total_payments) || '',
      formatTurkishLira(row.remaining_balance) || ''
    ]
  },
  all_details: {
    title: 'ALL DETAILS SUMMARY',
    headers: ['REFERENCE', 'SHIPPER', 'INVOICE NO', 'INVOICE DATE', 'AMOUNT', 'PIECES', 'CUSTOMS TAX', 'VAT', 'IMPORT EXPENSES', 'TOTAL PAYMENTS', 'REMAINING BALANCE'],
    dataMapping: (row: any) => [
      row.reference,
      row.shipper || '',
      row.invoice_no || '',
      row.invoice_date ? format(new Date(row.invoice_date), 'dd/MM/yyyy') : '',
      formatCurrencyWithComma(row.amount, row.currency) || '',
      row.piece || '',
      formatTurkishLira(row.customs_tax) || '',
      formatTurkishLira(row.vat) || '',
      formatTurkishLira(row.import_expenses) || '',
      formatTurkishLira(row.total_payments) || '',
      formatTurkishLira(row.remaining_balance) || ''
    ]
  }
};

// Currency formatting functions
const formatTurkishLira = (amount: string | number | null | undefined): string => {
  if (!amount || amount === '' || amount === null || amount === undefined) return '';
  
  const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(numAmount)) return '';
  
  return `₺${numAmount.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const formatCurrencyWithComma = (amount: string | number | null | undefined, currency: string | null | undefined): string => {
  if (!amount || amount === '' || amount === null || amount === undefined) return '';
  
  const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(numAmount)) return '';
  
  const symbol = currency === 'EUR' ? '€' : currency === 'TRY' ? '₺' : '$';
  return `${symbol}${numAmount.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

// Dynamic Data Fetcher for Each Report Type
const fetchReportData = async (reportType: string, filters: ReportFilters) => {
  console.log(`[custom-report] Fetching data for report type: ${reportType}`);
  
  const procedures = await storage.getAllProcedures();
  let filteredProcedures = procedures;

  // Apply date range filter
  if (filters.dateRange?.from && filters.dateRange?.to) {
    const fromDate = new Date(filters.dateRange.from);
    const toDate = new Date(filters.dateRange.to);
    
    filteredProcedures = filteredProcedures.filter(proc => {
      if (!proc.import_dec_date) return false;
      const procDate = new Date(proc.import_dec_date);
      return procDate >= fromDate && procDate <= toDate;
    });
  }

  // Apply shipper filter
  if (filters.shippers && filters.shippers.length > 0) {
    filteredProcedures = filteredProcedures.filter(proc => 
      filters.shippers!.includes(proc.shipper || '')
    );
  }

  const reportData: any[] = [];

  for (const procedure of filteredProcedures) {
    const row: any = {
      reference: procedure.reference,
      shipper: procedure.shipper,
      invoice_no: procedure.invoice_no,
      invoice_date: procedure.invoice_date,
      amount: procedure.amount,
      currency: procedure.currency || 'USD',
      piece: procedure.piece,
      package: procedure.package,
      kg: procedure.kg,
      arrival_date: procedure.arrival_date,
      awb_number: procedure.awb_number,
      carrier: procedure.carrier,
      customs: procedure.customs,
      import_dec_number: procedure.import_dec_number,
      import_dec_date: procedure.import_dec_date
    };

    // Add tax data for relevant report types
    if (reportType === 'tax_details' || reportType === 'all_details') {
      try {
        const taxData = await storage.getTaxByProcedureReference(procedure.reference || '');
        if (taxData) {
          row.customs_tax = taxData.customsTax;
          row.additional_customs_tax = taxData.additionalCustomsTax;
          row.kkdf = taxData.kkdf;
          row.vat = taxData.vat;
          row.stamp_tax = taxData.stampTax;
        }
      } catch (error) {
        console.log(`[custom-report] No tax data found for ${procedure.reference}`);
      }
    }

    // Add import expenses data for relevant report types
    if (reportType === 'import_expenses' || reportType === 'all_details') {
      try {
        const importExpenses = await storage.getImportExpensesByReference(procedure.reference || '');
        
        const expensesByCategory: { [key: string]: any[] } = {};
        importExpenses.forEach((expense: any) => {
          const categoryKey = expense.category;
          if (!expensesByCategory[categoryKey]) {
            expensesByCategory[categoryKey] = [];
          }
          expensesByCategory[categoryKey].push({
            amount: expense.amount,
            currency: expense.currency,
            invoiceNumber: expense.invoiceNumber || expense.invoice_number || expense.document_number,
            issuer: expense.issuer,
            invoiceDate: expense.invoiceDate || expense.invoice_date
          });
        });

        const categoryMapping: { [key: string]: string } = {
          'export_registry_fee': 'export_registry_fee',
          'insurance': 'insurance',
          'awb_fee': 'awb_fee',
          'airport_storage_fee': 'airport_storage_fee',
          'bonded_warehouse_storage_fee': 'bonded_warehouse_storage_fee',
          'transportation': 'transportation',
          'international_transportation': 'international_transportation',
          'tareks_fee': 'tareks_fee',
          'customs_inspection': 'customs_inspection',
          'azo_test': 'azo_test',
          'other': 'other'
        };

        let totalImportExpenses = 0;
        Object.keys(categoryMapping).forEach(categoryKey => {
          const dbCategoryName = categoryMapping[categoryKey];
          const categoryExpenses = expensesByCategory[dbCategoryName] || [];
          
          if (categoryExpenses.length > 0) {
            const expenseDetails = categoryExpenses.map(exp => {
              const amount = parseFloat(exp.amount) || 0;
              totalImportExpenses += amount;
              const dateStr = exp.invoiceDate ? format(new Date(exp.invoiceDate), 'dd/MM/yyyy') : '';
              return `${exp.amount || '0'} ${exp.currency || 'TRY'} ${exp.invoiceNumber ? `(${exp.invoiceNumber})` : ''} ${exp.issuer ? `- ${exp.issuer}` : ''} ${dateStr ? `- ${dateStr}` : ''}`;
            }).join('; ');
            row[categoryKey] = expenseDetails;
          } else {
            row[categoryKey] = '';
          }
        });
        
        row.import_expenses = totalImportExpenses;
      } catch (error) {
        console.log(`[custom-report] No import expenses found for ${procedure.reference}`);
      }
    }

    // Add payment data for relevant report types using calculateFinancialSummary
    if (reportType === 'payment_expense' || reportType === 'all_details') {
      try {
        const financialSummary = await storage.calculateFinancialSummary(procedure.reference || '');
        
        row.total_expenses = financialSummary.totalExpenses;
        row.total_payments = financialSummary.totalPayments;
        row.remaining_balance = financialSummary.remainingBalance;
        row.payment_distributions = financialSummary.distributedPayments || 0;
        
        if (financialSummary.remainingBalance <= 0.01) {
          row.payment_status = 'Paid';
        } else if (financialSummary.totalPayments > 0) {
          row.payment_status = 'Partially Paid';
        } else {
          row.payment_status = 'Pending';
        }
        
        console.log(`[custom-report] Financial summary for ${procedure.reference}:`, {
          totalExpenses: financialSummary.totalExpenses,
          totalPayments: financialSummary.totalPayments,
          distributedPayments: financialSummary.distributedPayments,
          remainingBalance: financialSummary.remainingBalance
        });
      } catch (error) {
        console.log(`[custom-report] Error calculating financial summary for ${procedure.reference}:`, error);
        row.total_expenses = parseFloat(procedure.amount || '0');
        row.total_payments = 0;
        row.payment_distributions = 0;
        row.payment_status = 'Pending';
        row.remaining_balance = parseFloat(procedure.amount || '0');
      }
    }

    // Add service invoice data for relevant report types
    if (reportType === 'import_expenses' || reportType === 'all_details') {
      try {
        const serviceInvoices = await storage.getImportServiceInvoicesByReference(procedure.reference || '');
        
        if (serviceInvoices && serviceInvoices.length > 0) {
          const serviceInvoiceDetails = serviceInvoices.map((invoice: any) => {
            const dateStr = invoice.date ? format(new Date(invoice.date), 'dd/MM/yyyy') : '';
            return `${invoice.amount || '0'} ${invoice.currency || 'TRY'} ${invoice.invoiceNumber ? `(${invoice.invoiceNumber})` : ''} ${invoice.issuer ? `- ${invoice.issuer}` : ''} ${dateStr ? `- ${dateStr}` : ''}`;
          }).join('; ');
          row.service_invoice = serviceInvoiceDetails;
        } else {
          row.service_invoice = '';
        }
      } catch (error) {
        console.log(`[custom-report] Error fetching service invoice data for ${procedure.reference}:`, error);
        row.service_invoice = '';
      }
    }

    reportData.push(row);
  }

  return reportData;
};

// API Routes

// Generate Report Preview
router.post('/generate', async (req, res) => {
  try {
    const filters: ReportFilters = req.body;
    
    console.log('[custom-report] Generating custom report with filters:', filters);

    if (!filters.reportType) {
      return res.status(400).json({ error: 'Report type is required' });
    }

    if (!REPORT_CONFIGURATIONS[filters.reportType]) {
      return res.status(400).json({ error: `Invalid report type: ${filters.reportType}` });
    }

    const reportData = await fetchReportData(filters.reportType, filters);

    if (!reportData || reportData.length === 0) {
      return res.status(404).json({ error: 'No data found for the specified filters' });
    }

    console.log(`[custom-report] Filtered to ${reportData.length} procedures`);
    console.log(`[custom-report] Generated report with ${reportData.length} rows`);

    const config = REPORT_CONFIGURATIONS[filters.reportType];
    const formattedData = reportData.map(config.dataMapping);

    res.json({
      success: true,
      reportType: filters.reportType,
      title: config.title,
      headers: config.headers,
      data: formattedData,
      totalRows: reportData.length
    });

  } catch (error) {
    console.error('[custom-report] Error generating report:', error);
    res.status(500).json({
      error: 'Failed to generate report',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Excel Export Route - TO BE REBUILT
router.post('/export-excel', async (req, res) => {
  res.status(501).json({
    error: 'Excel export functionality temporarily disabled',
    message: 'Excel export is being rebuilt with a better approach'
  });
});

export default router;