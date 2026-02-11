/**
 * Custom Report Generation Module
 * Generates custom reports based on selected report type and filters
 */
import { Router } from 'express';
import { storage } from './storage';
import { format } from 'date-fns';
import ExcelJS from 'exceljs';

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

interface ReportData {
  reference: string;
  [key: string]: any;
}

/**
 * Generate custom report based on filters
 */
router.post('/generate', async (req, res) => {
  console.log('[custom-report] Generating custom report with filters:', req.body);
  
  try {
    const filters: ReportFilters = req.body;
    
    if (!filters.reportType) {
      return res.status(400).json({ error: 'Report type is required' });
    }

    // Get all procedures
    const procedures = await storage.getAllProcedures();
    let filteredProcedures = procedures;

    // Apply date range filter (import declaration date)
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
        filters.shippers!.includes(proc.shipper)
      );
    }

    console.log(`[custom-report] Filtered to ${filteredProcedures.length} procedures`);

    // Generate report data based on report type
    const reportData: ReportData[] = [];

    for (const procedure of filteredProcedures) {
      const row: ReportData = {
        reference: procedure.reference // Always include reference as first column
      };

      // Add procedure-based data
      if (filters.reportType === 'import_procedures' || filters.reportType === 'all_details') {
        if (!filters.categories || filters.categories.includes('shipper')) {
          row.shipper = procedure.shipper;
        }
        if (!filters.categories || filters.categories.includes('invoice_no')) {
          row.invoice_no = procedure.invoice_no;
        }
        if (!filters.categories || filters.categories.includes('invoice_date')) {
          row.invoice_date = procedure.invoice_date ? format(new Date(procedure.invoice_date), 'dd/MM/yyyy') : '';
        }
        if (!filters.categories || filters.categories.includes('amount')) {
          row.amount = formatCurrencyWithComma(procedure.amount, procedure.currency || 'USD');
        }
        if (!filters.categories || filters.categories.includes('piece')) {
          row.piece = procedure.piece;
        }
        if (!filters.categories || filters.categories.includes('package')) {
          row.package = procedure.package;
        }
        if (!filters.categories || filters.categories.includes('kg')) {
          row.kg = procedure.kg;
        }
        if (!filters.categories || filters.categories.includes('arrival_date')) {
          row.arrival_date = procedure.arrival_date ? format(new Date(procedure.arrival_date), 'dd/MM/yyyy') : '';
        }
        if (!filters.categories || filters.categories.includes('awb_number')) {
          row.awb_number = procedure.awb_number;
        }
        if (!filters.categories || filters.categories.includes('carrier')) {
          row.carrier = procedure.carrier;
        }
        if (!filters.categories || filters.categories.includes('customs')) {
          row.customs = procedure.customs;
        }
        if (!filters.categories || filters.categories.includes('import_dec_number')) {
          row.import_dec_number = procedure.import_dec_number;
        }
        if (!filters.categories || filters.categories.includes('import_dec_date')) {
          row.import_dec_date = procedure.import_dec_date ? format(new Date(procedure.import_dec_date), 'dd/MM/yyyy') : '';
        }
      }

      // Add tax data
      if (filters.reportType === 'tax_details' || filters.reportType === 'all_details') {
        // Add basic procedure info for tax report
        if (!filters.categories || filters.categories.includes('shipper')) {
          row.shipper = procedure.shipper;
        }
        if (!filters.categories || filters.categories.includes('invoice_no')) {
          row.invoice_no = procedure.invoice_no;
        }
        if (!filters.categories || filters.categories.includes('invoice_date')) {
          row.invoice_date = procedure.invoice_date ? format(new Date(procedure.invoice_date), 'dd/MM/yyyy') : '';
        }
        if (!filters.categories || filters.categories.includes('amount')) {
          row.amount = formatCurrencyWithComma(procedure.amount, procedure.currency || 'USD');
        }
        if (!filters.categories || filters.categories.includes('piece')) {
          row.piece = procedure.piece;
        }

        // Get tax data
        try {
          const taxData = await storage.getTaxByProcedureReference(procedure.reference);
          if (taxData) {
            if (!filters.categories || filters.categories.includes('customs_tax')) {
              row.customs_tax = formatTurkishLira(taxData.customsTax);
            }
            if (!filters.categories || filters.categories.includes('additional_customs_tax')) {
              row.additional_customs_tax = formatTurkishLira(taxData.additionalCustomsTax);
            }
            if (!filters.categories || filters.categories.includes('kkdf')) {
              row.kkdf = formatTurkishLira(taxData.kkdf);
            }
            if (!filters.categories || filters.categories.includes('vat')) {
              row.vat = formatTurkishLira(taxData.vat);
            }
            if (!filters.categories || filters.categories.includes('stamp_tax')) {
              row.stamp_tax = formatTurkishLira(taxData.stampTax);
            }
          }
        } catch (error) {
          console.log(`[custom-report] No tax data found for ${procedure.reference}`);
        }
      }

      // Add import expenses data
      if (filters.reportType === 'import_expenses' || filters.reportType === 'all_details') {
        // Add basic procedure info
        if (!filters.categories || filters.categories.includes('shipper')) {
          row.shipper = procedure.shipper;
        }
        if (!filters.categories || filters.categories.includes('invoice_no')) {
          row.invoice_no = procedure.invoice_no;
        }
        if (!filters.categories || filters.categories.includes('invoice_date')) {
          row.invoice_date = procedure.invoice_date ? format(new Date(procedure.invoice_date), 'dd/MM/yyyy') : '';
        }
        if (!filters.categories || filters.categories.includes('amount')) {
          row.amount = procedure.amount;
        }
        if (!filters.categories || filters.categories.includes('piece')) {
          row.piece = procedure.piece;
        }

        // Get import expenses data
        try {
          const importExpenses = await storage.getImportExpensesByReference(procedure.reference || '');
          console.log(`[custom-report] Found ${importExpenses.length} import expenses for ${procedure.reference}`);
          
          // Group expenses by category
          const expensesByCategory: { [key: string]: any[] } = {};
          importExpenses.forEach((expense: any) => {
            const categoryKey = expense.category; // Use exact category name from database
            if (!expensesByCategory[categoryKey]) {
              expensesByCategory[categoryKey] = [];
            }
            expensesByCategory[categoryKey].push({
              amount: expense.amount,
              currency: expense.currency,
              invoiceNumber: expense.invoiceNumber || expense.invoice_number,
              invoiceDate: expense.invoiceDate || expense.invoke_date ? format(new Date(expense.invoiceDate || expense.invoice_date), 'dd/MM/yyyy') : '',
              documentNumber: expense.documentNumber || expense.document_number,
              policyNumber: expense.policyNumber || expense.policy_number,
              issuer: expense.issuer
            });
          });

          console.log(`[custom-report] Expenses by category for ${procedure.reference}:`, Object.keys(expensesByCategory));

          // Map UI categories to database categories
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

          Object.keys(categoryMapping).forEach(categoryKey => {
            const dbCategoryName = categoryMapping[categoryKey];
            const categoryExpenses = expensesByCategory[dbCategoryName] || [];
            
            if (!filters.categories || filters.categories.includes(categoryKey)) {
              if (categoryExpenses.length > 0) {
                // Combine all expenses for this category with detailed formatting
                const expenseDetails = categoryExpenses.map(exp => {
                  // Use appropriate document number based on category
                  let documentRef = '';
                  
                  // Debug logging for insurance category
                  if (categoryKey === 'insurance') {
                    console.log(`[custom-report] DEBUG Insurance for ${procedure.reference}:`, {
                      categoryKey,
                      policyNumber: exp.policyNumber,
                      documentNumber: exp.documentNumber,
                      invoiceNumber: exp.invoiceNumber,
                      allFields: Object.keys(exp)
                    });
                  }
                  
                  if (categoryKey === 'export_registry_fee' && exp.documentNumber) {
                    documentRef = `(${exp.documentNumber})`;
                  } else if (categoryKey === 'insurance' && exp.policyNumber) {
                    documentRef = `(${exp.policyNumber})`;
                  } else if (exp.invoiceNumber) {
                    documentRef = `(${exp.invoiceNumber})`;
                  }
                  
                  return `${exp.amount || '0'} ${exp.currency || 'TRY'} ${documentRef} ${exp.issuer ? `- ${exp.issuer}` : ''} ${exp.invoiceDate ? `- ${exp.invoiceDate}` : ''}`;
                }).join('; ');
                row[categoryKey] = expenseDetails;
                console.log(`[custom-report] Added ${categoryKey} for ${procedure.reference}: ${expenseDetails}`);
              } else {
                row[categoryKey] = '';
              }
            }
          });

          // Get service invoices
          if (!filters.categories || filters.categories.includes('service_invoice')) {
            const serviceInvoices = await storage.getImportServiceInvoicesByReference(procedure.reference);
            if (serviceInvoices.length > 0) {
              const serviceDetails = serviceInvoices.map(invoice => 
                `${invoice.amount} ${invoice.currency} (${invoice.invoiceNumber}) - ${format(new Date(invoice.date), 'dd/MM/yyyy')}`
              ).join('; ');
              row.service_invoice = serviceDetails;
            } else {
              row.service_invoice = '';
            }
          }
        } catch (error) {
          console.log(`[custom-report] No import expenses found for ${procedure.reference}`);
        }
      }

      // Add payment and expense summary data
      if (filters.reportType === 'payment_expense' || filters.reportType === 'all_details') {
        // Add basic procedure info
        if (!filters.categories || filters.categories.includes('shipper')) {
          row.shipper = procedure.shipper;
        }
        if (!filters.categories || filters.categories.includes('invoice_no')) {
          row.invoice_no = procedure.invoice_no;
        }
        if (!filters.categories || filters.categories.includes('invoice_date')) {
          row.invoice_date = procedure.invoice_date ? format(new Date(procedure.invoice_date), 'dd/MM/yyyy') : '';
        }
        if (!filters.categories || filters.categories.includes('amount')) {
          row.amount = procedure.amount;
        }
        if (!filters.categories || filters.categories.includes('piece')) {
          row.piece = procedure.piece;
        }

        // Get financial summary
        try {
          const financialSummary = await storage.calculateFinancialSummary(procedure.reference);
          
          if (!filters.categories || filters.categories.includes('total_expenses')) {
            row.total_expenses = financialSummary.totalExpenses;
          }
          if (!filters.categories || filters.categories.includes('payment_distributions')) {
            row.payment_distributions = financialSummary.distributedPayments;
          }
          if (!filters.categories || filters.categories.includes('remaining_balance')) {
            row.remaining_balance = financialSummary.remainingBalance;
          }
        } catch (error) {
          console.log(`[custom-report] No financial data found for ${procedure.reference}`);
        }
      }

      reportData.push(row);
    }

    console.log(`[custom-report] Generated report with ${reportData.length} rows`);

    res.json({
      success: true,
      reportType: filters.reportType,
      totalRows: reportData.length,
      data: reportData
    });

  } catch (error) {
    console.error('[custom-report] Error generating report:', error);
    res.status(500).json({
      error: 'Failed to generate report',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Dynamic currency formatting function
const formatCurrencyWithComma = (amount: string | number | null | undefined, currency: string = 'TRY'): string => {
  if (!amount || amount === '' || amount === '0') return '';
  
  const numericAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(numericAmount)) return '';
  
  // Use Turkish locale for comma decimal separator
  return new Intl.NumberFormat('tr-TR', {
    style: 'currency',
    currency: currency || 'TRY',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(numericAmount);
};

// Fixed currency formatting for Turkish Lira (for taxes and fees)
const formatTurkishLira = (amount: string | number | null | undefined): string => {
  if (!amount || amount === '' || amount === '0') return '';
  
  const numericAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(numericAmount)) return '';
  
  return new Intl.NumberFormat('tr-TR', {
    style: 'currency',
    currency: 'TRY',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(numericAmount);
};

// Helper function to format Turkish Lira with ₺ symbol and comma separator
const formatCurrencyTurkishLiraSymbol = (value: string | number): string => {
  if (!value || value === '0' || value === 0 || value === '') return '';
  const numValue = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(numValue)) return '';
  return `₺${numValue.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

// Helper function to parse multiple expenses from a concatenated string with full details
const parseMultipleExpenses = (expenseString: string): string[] => {
  if (!expenseString || expenseString.trim() === '') return [];
  
  // Split by semicolon to get individual expenses
  const expenses = expenseString.split(';').map(expense => expense.trim());
  const formattedExpenses: string[] = [];
  
  expenses.forEach(expense => {
    // Extract amount, document number, company and date from the expense string
    // Format: "8979.24 TRY (-) - ZIM / BELSTAR - 16/05/2025"
    const match = expense.match(/^(\d+(?:\.\d{2})?)\s*TRY\s*(.+)/);
    if (match) {
      const amount = match[1];
      const details = match[2].trim();
      // Format as: ₺8.979,24 (-) - ZIM / BELSTAR - 16/05/2025
      formattedExpenses.push(`₺${parseFloat(amount).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${details}`);
    }
  });
  
  return formattedExpenses;
};

// Helper function to filter out empty columns from report data
const filterEmptyColumns = (headers: string[], data: any[][]): { filteredHeaders: string[], filteredData: any[][] } => {
  const nonEmptyColumns: number[] = [];
  
  // Check each column to see if it has any non-empty data
  headers.forEach((header, colIndex) => {
    const hasData = data.some(row => {
      const cellValue = row[colIndex];
      return cellValue && cellValue !== '' && cellValue !== '₺0,00' && cellValue !== 0;
    });
    
    // Always include REFERENCE column and any column with actual expense data
    if (hasData || header.includes('REFERENCE')) {
      nonEmptyColumns.push(colIndex);
    }
  });
  
  // Filter headers and data based on non-empty columns
  const filteredHeaders = nonEmptyColumns.map(index => headers[index]);
  const filteredData = data.map(row => nonEmptyColumns.map(index => row[index]));
  
  return { filteredHeaders, filteredData };
};

// Dynamic Report Configurations for Each Report Type
const REPORT_CONFIGURATIONS: { [key: string]: { title: string; headers: string[]; dataMapping: (row: any) => any[] } } = {
  'import_procedures': {
    title: 'IMPORT PROCEDURES SUMMARY',
    headers: ['REFERENCE', 'SHIPPER', 'INVOICE NO', 'INVOICE DATE', 'AMOUNT', 'PIECES', 'PACKAGES', 'WEIGHT (KG)', 'ARRIVAL DATE', 'AWB NUMBER', 'CARRIER', 'CUSTOMS', 'IMPORT DEC NUMBER', 'IMPORT DEC DATE'],
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
  'tax_details': {
    title: 'TAX DETAILS SUMMARY',
    headers: ['REFERENCE', 'SHIPPER', 'INVOICE NO', 'INVOICE DATE', 'AMOUNT', 'PIECES', 'CUSTOMS TAX', 'ADD. CUSTOMS TAX', 'KKDF', 'VAT', 'STAMP TAX'],
    dataMapping: (row: any) => [
      row.reference,
      row.shipper || '',
      row.invoice_no || '',
      row.invoice_date ? format(new Date(row.invoice_date), 'dd/MM/yyyy') : '',
      formatCurrencyWithComma(row.amount, row.currency) || '',
      row.piece || '',
      formatTurkishLira(row.customs_tax) || '',
      formatTurkishLira(row.additional_customs_tax) || '',
      formatTurkishLira(row.kkdf) || '',
      formatTurkishLira(row.vat) || '',
      formatTurkishLira(row.stamp_tax) || ''
    ]
  },
  'import_expenses': {
    title: 'IMPORT EXPENSES SUMMARY',
    headers: ['REFERENCE', 'EXPORT REGISTRY FEE', 'INSURANCE', 'AWB FEE 1', 'AWB FEE 2', 'AIRPORT STORAGE FEE 1', 'AIRPORT STORAGE FEE 2', 'AIRPORT STORAGE FEE 3', 'BONDED WAREHOUSE STORAGE FEE 1', 'BONDED WAREHOUSE STORAGE FEE 2', 'TRANSPORTATION 1', 'TRANSPORTATION 2', 'TRANSPORTATION 3', 'TRANSPORTATION 4', 'INTERNATIONAL TRANSPORTATION', 'TAREKS FEE', 'CUSTOMS INSPECTION', 'AZO TEST', 'OTHER'],
    dataMapping: (row: any) => {
      // Parse multiple expenses for each category with full details
      const awbFees = parseMultipleExpenses(row.awb_fee || '');
      const airportStorageFees = parseMultipleExpenses(row.airport_storage_fee || '');
      const bondedWarehouseFees = parseMultipleExpenses(row.bonded_warehouse_storage_fee || '');
      const transportationFees = parseMultipleExpenses(row.transportation || '');
      
      return [
        row.reference,
        formatCurrencyTurkishLiraSymbol(row.export_registry_fee || ''),
        formatCurrencyTurkishLiraSymbol(row.insurance || ''),
        awbFees[0] || '',
        awbFees[1] || '',
        airportStorageFees[0] || '',
        airportStorageFees[1] || '',
        airportStorageFees[2] || '',
        bondedWarehouseFees[0] || '',
        bondedWarehouseFees[1] || '',
        transportationFees[0] || '',
        transportationFees[1] || '',
        transportationFees[2] || '',
        transportationFees[3] || '',
        formatCurrencyTurkishLiraSymbol(row.international_transportation || ''),
        formatCurrencyTurkishLiraSymbol(row.tareks_fee || ''),
        formatCurrencyTurkishLiraSymbol(row.customs_inspection || ''),
        formatCurrencyTurkishLiraSymbol(row.azo_test || ''),
        formatCurrencyTurkishLiraSymbol(row.other || '')
      ];
    }
  },
  'payment_expense': {
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
  'all_details': {
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
      currency: procedure.currency || 'USD', // Include currency field
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
        
        // Debug: Check what fields we have for export_registry_fee and insurance
        const debugExpenses = importExpenses.filter(exp => exp.category === 'export_registry_fee' || exp.category === 'insurance');
        if (debugExpenses.length > 0) {
          console.log(`[custom-report] DEBUG - Sample expenses for ${procedure.reference}:`, 
            debugExpenses.map(exp => ({
              category: exp.category,
              documentNumber: exp.documentNumber,
              policyNumber: exp.policyNumber,
              invoiceNumber: exp.invoiceNumber,
              amount: exp.amount
            }))
          );
        }
        
        // Group expenses by category
        const expensesByCategory: { [key: string]: any[] } = {};
        importExpenses.forEach((expense: any) => {
          const categoryKey = expense.category;
          if (!expensesByCategory[categoryKey]) {
            expensesByCategory[categoryKey] = [];
          }
          expensesByCategory[categoryKey].push({
            amount: expense.amount,
            currency: expense.currency,
            invoiceNumber: expense.invoiceNumber,
            documentNumber: expense.documentNumber,
            policyNumber: expense.policyNumber,
            issuer: expense.issuer,
            invoiceDate: expense.invoiceDate
          });
        });

        // Add expense data to row
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
              
              // Use appropriate document number based on category
              let documentRef = '';
              console.log(`[custom-report] DEBUG: Processing ${categoryKey} for ${procedure.reference}:`, {
                documentNumber: exp.documentNumber,
                policyNumber: exp.policyNumber,
                invoiceNumber: exp.invoiceNumber
              });
              
              if (categoryKey === 'export_registry_fee' && exp.documentNumber) {
                documentRef = `(${exp.documentNumber})`;
                console.log(`[custom-report] DEBUG: Set export_registry_fee documentRef to: ${documentRef}`);
              } else if (categoryKey === 'insurance' && exp.policyNumber) {
                documentRef = `(${exp.policyNumber})`;
                console.log(`[custom-report] DEBUG: Set insurance documentRef to: ${documentRef}`);
              } else if (exp.invoiceNumber) {
                documentRef = `(${exp.invoiceNumber})`;
                console.log(`[custom-report] DEBUG: Set invoiceNumber documentRef to: ${documentRef}`);
              }
              
              return `${exp.amount || '0'} ${exp.currency || 'TRY'} ${documentRef} ${exp.issuer ? `- ${exp.issuer}` : ''} ${dateStr ? `- ${dateStr}` : ''}`;
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
        // Use the same financial calculation logic as Report Preview
        const financialSummary = await storage.calculateFinancialSummary(procedure.reference || '');
        
        row.total_expenses = financialSummary.totalExpenses;
        row.total_payments = financialSummary.totalPayments;
        row.remaining_balance = financialSummary.remainingBalance;
        row.payment_distributions = financialSummary.distributedPayments || 0;
        
        // Set payment status based on remaining balance
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
          console.log(`[custom-report] Added service_invoice for ${procedure.reference}: ${serviceInvoiceDetails}`);
        } else {
          row.service_invoice = '';
          console.log(`[custom-report] No service invoices found for ${procedure.reference}`);
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

// Generate dynamic headers and data mapping based on selected categories
const generateDynamicHeadersAndData = (data: any[], selectedCategories?: string[]) => {
  if (!selectedCategories || selectedCategories.length === 0) {
    // If no categories selected, use all available data
    return {
      headers: ['REFERENCE', 'SHIPPER'],
      mappedData: data.map(row => [row.reference, row.shipper || ''])
    };
  }

  console.log(`[custom-report] Processing ${selectedCategories.length} selected categories`);
  
  // Always start with REFERENCE
  const headers = ['REFERENCE'];
  const dataMapping: { [key: string]: (row: any) => any } = {
    'REFERENCE': (row: any) => row.reference
  };

  // Category mapping for different data types
  const categoryMappings: { [key: string]: { header: string; mapping: (row: any) => any; isMultiple?: boolean } } = {
    // Procedure details
    'shipper': { header: 'SHIPPER', mapping: (row: any) => row.shipper || '' },
    'invoice_no': { header: 'INVOICE NO', mapping: (row: any) => row.invoice_no || '' },
    'invoice_date': { header: 'INVOICE DATE', mapping: (row: any) => row.invoice_date ? format(new Date(row.invoice_date), 'dd/MM/yyyy') : '' },
    'amount': { header: 'AMOUNT', mapping: (row: any) => formatCurrencyWithComma(row.amount, row.currency) || '' },
    'piece': { header: 'PIECES', mapping: (row: any) => row.piece || '' },
    
    // Tax details
    'customs_tax': { header: 'CUSTOMS TAX', mapping: (row: any) => formatCurrencyTurkishLiraSymbol(row.customs_tax || '') },
    'additional_customs_tax': { header: 'ADD. CUSTOMS TAX', mapping: (row: any) => formatCurrencyTurkishLiraSymbol(row.additional_customs_tax || '') },
    'kkdf': { header: 'KKDF', mapping: (row: any) => formatCurrencyTurkishLiraSymbol(row.kkdf || '') },
    'vat': { header: 'VAT', mapping: (row: any) => formatCurrencyTurkishLiraSymbol(row.vat || '') },
    'stamp_tax': { header: 'STAMP TAX', mapping: (row: any) => formatCurrencyTurkishLiraSymbol(row.stamp_tax || '') },
    
    // Import expenses - these need special handling for multiple entries
    'export_registry_fee': { header: 'EXPORT REGISTRY FEE', mapping: (row: any) => formatCurrencyTurkishLiraSymbol(row.export_registry_fee || '') },
    'insurance': { header: 'INSURANCE', mapping: (row: any) => formatCurrencyTurkishLiraSymbol(row.insurance || '') },
    'awb_fee': { header: 'AWB FEE', mapping: (row: any) => row.awb_fee || '', isMultiple: true },
    'airport_storage_fee': { header: 'AIRPORT STORAGE FEE', mapping: (row: any) => row.airport_storage_fee || '', isMultiple: true },
    'bonded_warehouse_storage_fee': { header: 'BONDED WAREHOUSE STORAGE FEE', mapping: (row: any) => row.bonded_warehouse_storage_fee || '', isMultiple: true },
    'transportation': { header: 'TRANSPORTATION', mapping: (row: any) => row.transportation || '', isMultiple: true },
    'international_transportation': { header: 'INTERNATIONAL TRANSPORTATION', mapping: (row: any) => formatCurrencyTurkishLiraSymbol(row.international_transportation || '') },
    'tareks_fee': { header: 'TAREKS FEE', mapping: (row: any) => formatCurrencyTurkishLiraSymbol(row.tareks_fee || '') },
    'customs_inspection': { header: 'CUSTOMS INSPECTION', mapping: (row: any) => formatCurrencyTurkishLiraSymbol(row.customs_inspection || '') },
    'azo_test': { header: 'AZO TEST', mapping: (row: any) => formatCurrencyTurkishLiraSymbol(row.azo_test || '') },
    'other': { header: 'OTHER', mapping: (row: any) => formatCurrencyTurkishLiraSymbol(row.other || '') },
    
    // Service invoices
    'service_invoice': { header: 'SERVICE INVOICE', mapping: (row: any) => row.service_invoice || '', isMultiple: true },
    
    // Payment data
    'total_expenses': { header: 'TOTAL EXPENSES', mapping: (row: any) => formatCurrencyTurkishLiraSymbol(row.total_expenses?.toString() || '0') },
    'total_payments': { header: 'TOTAL PAYMENTS', mapping: (row: any) => formatCurrencyTurkishLiraSymbol(row.total_payments?.toString() || '0') },
    'payment_distributions': { header: 'PAYMENT DISTRIBUTIONS', mapping: (row: any) => formatCurrencyTurkishLiraSymbol(row.total_payments?.toString() || '0') },
    'payment_status': { header: 'PAYMENT STATUS', mapping: (row: any) => row.payment_status || '' },
    'remaining_balance': { header: 'REMAINING BALANCE', mapping: (row: any) => formatCurrencyTurkishLiraSymbol(row.remaining_balance?.toString() || '0') }
  };

  // Process selected categories and handle multiple expenses
  selectedCategories.forEach(category => {
    const mapping = categoryMappings[category];
    if (mapping) {
      if (mapping.isMultiple) {
        // For categories that can have multiple entries, we need to check the data first
        const maxEntries = getMaxEntriesForCategory(data, category);
        for (let i = 1; i <= maxEntries; i++) {
          headers.push(`${mapping.header} ${i}`);
          dataMapping[`${mapping.header} ${i}`] = (row: any) => {
            const expenses = parseMultipleExpenses(mapping.mapping(row));
            return expenses[i - 1] || '';
          };
        }
      } else {
        headers.push(mapping.header);
        dataMapping[mapping.header] = mapping.mapping;
      }
    }
  });

  // Generate mapped data
  const mappedData = data.map(row => {
    return headers.map(header => dataMapping[header] ? dataMapping[header](row) : '');
  });

  return { headers, mappedData };
};

// Helper function to determine max entries for a category across all data
const getMaxEntriesForCategory = (data: any[], category: string): number => {
  let maxEntries = 0;
  data.forEach(row => {
    const value = row[category];
    if (value) {
      const expenses = parseMultipleExpenses(value);
      maxEntries = Math.max(maxEntries, expenses.length);
    }
  });
  return Math.max(maxEntries, 1); // At least 1 column
};

// Dynamic Excel Generator based on selected categories
const generateDynamicExcel = async (reportType: string, data: any[], selectedCategories?: string[]) => {
  console.log(`[custom-report] Generating dynamic Excel for report type: ${reportType}`);
  console.log(`[custom-report] Selected categories: ${selectedCategories?.join(', ') || 'none specified'}`);
  
  // Generate dynamic headers and data mapping based on selected categories
  const { headers, mappedData } = generateDynamicHeadersAndData(data, selectedCategories);
  
  console.log(`[custom-report] Dynamic headers generated: ${headers.join(', ')}`);
  console.log(`[custom-report] Sample data row: ${JSON.stringify(mappedData[0])}`);
  
  let filteredData = mappedData;

  const workbook = new ExcelJS.Workbook();
  const title = reportType.replace('_', ' ').toUpperCase() + ' REPORT';
  const worksheet = workbook.addWorksheet(title.split(' ')[0], {
    pageSetup: {
      paperSize: 9, // A4
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: {
        left: 0.7,
        right: 0.7,
        top: 0.75,
        bottom: 0.75,
        header: 0.3,
        footer: 0.3
      }
    }
  });

  // Remove gridlines for clean PDF-like appearance
  worksheet.views = [{ showGridLines: false }];

  // Create dynamic header section
  worksheet.mergeCells('A1', `${String.fromCharCode(65 + headers.length - 1)}1`);
  worksheet.getCell('A1').value = title;
  worksheet.getCell('A1').style = {
    font: { name: 'Arial', size: 16, bold: true, color: { argb: 'FF1F2937' } },
    alignment: { horizontal: 'center', vertical: 'middle' },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } },
    border: {
      top: { style: 'thin', color: { argb: 'FFD1D5DB' } },
      bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
      left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
      right: { style: 'thin', color: { argb: 'FFD1D5DB' } }
    }
  };

  worksheet.getCell('A2').value = `Generated: ${format(new Date(), 'dd/MM/yyyy')} at ${format(new Date(), 'HH:mm')}`;
  worksheet.getCell('A2').style = {
    font: { name: 'Arial', size: 11, color: { argb: 'FF374151' } },
    alignment: { horizontal: 'left', vertical: 'middle' },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } },
    border: {
      top: { style: 'thin', color: { argb: 'FFD1D5DB' } },
      bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
      left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
      right: { style: 'thin', color: { argb: 'FFD1D5DB' } }
    }
  };

  worksheet.getCell('A3').value = `Total Records: ${data.length}`;
  worksheet.getCell('A3').style = {
    font: { name: 'Arial', size: 11, color: { argb: 'FF374151' } },
    alignment: { horizontal: 'left', vertical: 'middle' },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } },
    border: {
      top: { style: 'thin', color: { argb: 'FFD1D5DB' } },
      bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
      left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
      right: { style: 'thin', color: { argb: 'FFD1D5DB' } }
    }
  };

  // Add dynamic column headers (Row 5)
  const headerRow = worksheet.getRow(5);
  headers.forEach((header: string, index: number) => {
    const cell = headerRow.getCell(index + 1);
    cell.value = header;
    cell.style = {
      font: { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } },
      alignment: { horizontal: 'center', vertical: 'middle' },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } },
      border: {
        top: { style: 'medium', color: { argb: 'FF000000' } },
        bottom: { style: 'medium', color: { argb: 'FF000000' } },
        left: { style: 'thin', color: { argb: 'FF000000' } },
        right: { style: 'thin', color: { argb: 'FF000000' } }
      }
    };
  });

  // Add dynamic data rows (Row 6+)
  filteredData.forEach((rowData, rowIndex) => {
    const row = worksheet.getRow(6 + rowIndex);
    const isEvenRow = rowIndex % 2 === 0;
    
    rowData.forEach((value: any, colIndex: number) => {
      const cell = row.getCell(colIndex + 1);
      cell.value = value;
      cell.style = {
        font: { name: 'Arial', size: 9, color: { argb: 'FF1F2937' } },
        alignment: { 
          horizontal: 'center', // Center align all data cells
          vertical: 'middle' 
        },
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: isEvenRow ? 'FFFFFFFF' : 'FFF8FAFC' } },
        border: {
          top: { style: 'hair', color: { argb: 'FFE5E7EB' } },
          bottom: { style: 'hair', color: { argb: 'FFE5E7EB' } },
          left: { style: 'hair', color: { argb: 'FFE5E7EB' } },
          right: { style: 'hair', color: { argb: 'FFE5E7EB' } }
        }
      };

      // Apply number formatting for amount columns
      if (headers[colIndex]?.includes('AMOUNT') || headers[colIndex]?.includes('TAX') || headers[colIndex]?.includes('BALANCE')) {
        cell.numFmt = '#,##0.00';
      }
    });
  });

  // Set dynamic column widths based on content length
  const columnWidths: number[] = [];
  
  // Calculate width for each column based on header and data content
  headers.forEach((header: string, colIndex: number) => {
    let maxWidth = header.length + 2; // Start with header length + padding
    
    // Check data content length for each row in this column
    filteredData.forEach((rowData, rowIndex) => {
      const cellValue = rowData[colIndex];
      if (cellValue && typeof cellValue === 'string') {
        maxWidth = Math.max(maxWidth, cellValue.length + 2);
      }
    });
    
    // Set minimum and maximum limits for readability
    maxWidth = Math.max(12, Math.min(maxWidth, 60)); // Min 12, Max 60 characters
    columnWidths.push(maxWidth);
  });
  
  // Apply calculated widths to worksheet columns
  worksheet.columns = headers.map((header: string, index: number) => ({
    key: header.toLowerCase(),
    width: columnWidths[index]
  }));

  return workbook;
};

/**
 * Excel export using Report Preview data
 */
router.post('/export-excel', async (req, res) => {
  console.log('[custom-report] Excel export request received');
  
  try {
    const { data, reportType, dateRange, totalRows } = req.body;
    
    if (!data || !Array.isArray(data) || data.length === 0) {
      return res.status(400).json({ error: 'No data provided for Excel export' });
    }
    
    console.log(`[custom-report] Exporting ${totalRows} rows to Excel`);
    
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Logistics Report System';
    workbook.created = new Date();
    
    // Report type mapping for clean titles
    const reportTypeNames = {
      'procedure_details': 'PROCEDURE DETAILS REPORT',
      'import_expenses': 'IMPORT EXPENSES REPORT', 
      'payment_expense': 'PAYMENT AND EXPENSE SUMMARY REPORT'
    };
    
    const title = reportTypeNames[reportType as keyof typeof reportTypeNames] || 'CUSTOM REPORT';
    const worksheet = workbook.addWorksheet('Report', {
      pageSetup: {
        paperSize: 9, // A4
        orientation: 'landscape',
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        margins: {
          left: 0.7,
          right: 0.7,
          top: 0.75,
          bottom: 0.75,
          header: 0.3,
          footer: 0.3
        }
      }
    });
    
    // Remove gridlines for clean appearance
    worksheet.views = [{ showGridLines: false }];
    
    const headers = data[0];
    const dataRows = data.slice(1);
    
    // Create title header (row 1) - merge cells A1 to M1 only as requested
    worksheet.mergeCells('A1:M1');
    worksheet.getCell('A1').value = title;
    worksheet.getCell('A1').style = {
      font: { name: 'Arial', size: 16, bold: true, color: { argb: 'FF1F2937' } },
      alignment: { horizontal: 'center', vertical: 'middle' },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } },
      border: {
        top: { style: 'medium', color: { argb: 'FF374151' } },
        bottom: { style: 'medium', color: { argb: 'FF374151' } },
        left: { style: 'medium', color: { argb: 'FF374151' } },
        right: { style: 'medium', color: { argb: 'FF374151' } }
      }
    };
    worksheet.getRow(1).height = 30;
    
    // Add date and summary info (row 2)
    worksheet.mergeCells('A2:M2');
    let summaryText = `Generated: ${format(new Date(), 'dd/MM/yyyy')} at ${format(new Date(), 'HH:mm')} | Total Records: ${totalRows}`;
    if (dateRange) {
      summaryText += ` | Date Range: ${dateRange.from} to ${dateRange.to}`;
    }
    worksheet.getCell('A2').value = summaryText;
    worksheet.getCell('A2').style = {
      font: { name: 'Arial', size: 11, color: { argb: 'FF6B7280' } },
      alignment: { horizontal: 'center', vertical: 'middle' },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } },
      border: {
        top: { style: 'thin', color: { argb: 'FFD1D5DB' } },
        bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
        left: { style: 'medium', color: { argb: 'FF374151' } },
        right: { style: 'medium', color: { argb: 'FF374151' } }
      }
    };
    worksheet.getRow(2).height = 20;
    
    // Add empty row for spacing (row 3)
    worksheet.getRow(3).height = 10;
    
    // Add column headers (row 4)
    headers.forEach((header: string, index: number) => {
      const cell = worksheet.getCell(4, index + 1);
      cell.value = header.replace(/_/g, ' ').toUpperCase();
      cell.style = {
        font: { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFFFF' } },
        alignment: { horizontal: 'center', vertical: 'middle' },
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF000000' } },
        border: {
          top: { style: 'thin', color: { argb: 'FF000000' } },
          bottom: { style: 'thin', color: { argb: 'FF000000' } },
          left: { style: 'thin', color: { argb: 'FF000000' } },
          right: { style: 'thin', color: { argb: 'FF000000' } }
        }
      };
    });
    worksheet.getRow(4).height = 25;
    
    // Add data rows (starting from row 5)
    dataRows.forEach((row: any[], rowIndex: number) => {
      const excelRowIndex = rowIndex + 5;
      row.forEach((value: any, colIndex: number) => {
        const cell = worksheet.getCell(excelRowIndex, colIndex + 1);
        cell.value = value;
        
        // Alternating row colors for better readability
        const bgColor = rowIndex % 2 === 0 ? 'FFFFFFFF' : 'FFF8FAFC';
        
        cell.style = {
          font: { name: 'Arial', size: 10 },
          alignment: { 
            horizontal: colIndex === 0 ? 'left' : 'center', 
            vertical: 'middle',
            wrapText: true
          },
          fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } },
          border: {
            top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
            bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
            left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
            right: { style: 'thin', color: { argb: 'FFE5E7EB' } }
          }
        };
      });
      worksheet.getRow(excelRowIndex).height = 20;
    });
    
    // Auto-size columns based on content
    headers.forEach((header: string, index: number) => {
      const column = worksheet.getColumn(index + 1);
      const maxLength = Math.max(
        header.length,
        ...dataRows.map(row => String(row[index] || '').length)
      );
      column.width = Math.min(Math.max(maxLength + 2, 12), 50);
    });
    
    // Add outer border to the entire table
    const lastRow = dataRows.length + 4;
    const lastCol = headers.length;
    
    // Top border
    for (let col = 1; col <= lastCol; col++) {
      worksheet.getCell(1, col).border = {
        ...worksheet.getCell(1, col).border,
        top: { style: 'medium', color: { argb: 'FF374151' } }
      };
    }
    
    // Bottom border  
    for (let col = 1; col <= lastCol; col++) {
      worksheet.getCell(lastRow, col).border = {
        ...worksheet.getCell(lastRow, col).border,
        bottom: { style: 'medium', color: { argb: 'FF374151' } }
      };
    }
    
    // Left border
    for (let row = 1; row <= lastRow; row++) {
      worksheet.getCell(row, 1).border = {
        ...worksheet.getCell(row, 1).border,
        left: { style: 'medium', color: { argb: 'FF374151' } }
      };
    }
    
    // Right border
    for (let row = 1; row <= lastRow; row++) {
      worksheet.getCell(row, lastCol).border = {
        ...worksheet.getCell(row, lastCol).border,
        right: { style: 'medium', color: { argb: 'FF374151' } }
      };
    }
    
    console.log('[custom-report] Excel workbook created successfully');
    
    // Generate Excel buffer
    const buffer = await workbook.xlsx.writeBuffer();
    
    // Set response headers for file download
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="report.xlsx"');
    res.setHeader('Content-Length', buffer.length);
    
    // Send the buffer
    res.send(buffer);
    
  } catch (error) {
    console.error('[custom-report] Excel export error:', error);
    res.status(500).json({ 
      error: 'Failed to generate Excel file',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;