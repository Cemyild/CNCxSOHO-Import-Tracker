/**
 * Excel Report Generation Module
 * Generates Excel spreadsheets for payment data using xlsx library
 */
import { Router } from 'express';
import { storage } from './storage';
import { format } from 'date-fns';
import * as XLSX from 'xlsx';

const router = Router();

/**
 * Generate an Excel report for payment data
 */
router.get('/download', async (req, res) => {
  try {
    console.log('[EXCEL-REPORT] Generating Excel payment report');
    
    // Get payment data
    const incomingPayments = await storage.getAllIncomingPayments();
    
    // Transform the data to match the Excel format - now includes remaining balance
    const paymentRows = [];
    for (const payment of incomingPayments) {
      // Format status for display
      let statusDisplay = 'Pending';
      switch(payment.distributionStatus) {
        case 'fully_distributed':
          statusDisplay = 'Fully Distributed';
          break;
        case 'partially_distributed':
          statusDisplay = 'Partially Distributed';
          break;
        case 'pending_distribution':
          statusDisplay = 'Pending Distribution';
          break;
      }
      
      // Calculate remaining balance for this payment
      const paymentAmount = parseFloat(payment.totalAmount);
      const distributions = await storage.getPaymentDistributions(payment.id);
      const totalDistributed = distributions.reduce((sum, dist) => 
        sum + parseFloat(dist.distributedAmount), 0);
      const remainingBalance = paymentAmount - totalDistributed;
      
      paymentRows.push({
        id: payment.paymentId,
        date: formatDate(payment.dateReceived),
        amount: formatCurrency(payment.totalAmount),
        status: statusDisplay,
        remainingBalance: formatCurrency(remainingBalance)
      });
    }
    
    // Calculate payment totals
    const totalPaymentsReceived = incomingPayments.reduce((sum, payment) => 
      sum + parseFloat(payment.totalAmount), 0);
      
    // Calculate distributions  
    let totalDistributed = 0;
    let proceduresWithDistributions = 0;
    const procedureDistributionMap = new Map();
    const distributionDetails: any[] = [];
    
    // For each payment, get its distributions
    for (const payment of incomingPayments) {
      const distributions = await storage.getPaymentDistributions(payment.id);
      
      for (const distribution of distributions) {
        // Add to total distributed
        totalDistributed += parseFloat(distribution.distributedAmount);
        
        // Track unique procedures
        if (!procedureDistributionMap.has(distribution.procedureReference)) {
          procedureDistributionMap.set(distribution.procedureReference, true);
        }
        
        // Add to distribution details for the second sheet
        const procedures = await storage.getProcedureByReference(distribution.procedureReference);
        const procedure = procedures.length > 0 ? procedures[0] : null;
        
        distributionDetails.push({
          procedureReference: distribution.procedureReference,
          invoiceNumber: procedure?.invoice_no || '-',
          paymentId: payment.paymentId,
          amount: formatCurrency(distribution.distributedAmount),
          date: formatDate(payment.dateReceived),
          type: distribution.paymentType === 'advance' ? 'Advance' : 'Balance',
          invoiceValue: procedure?.amount ? parseFloat(procedure.amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-',
          piece: procedure?.piece || '-'
        });
      }
    }
    
    proceduresWithDistributions = procedureDistributionMap.size;
    const totalPendingDistribution = totalPaymentsReceived - totalDistributed;
    
    // Create workbook
    const workbook = XLSX.utils.book_new();
    
    // Create summary sheet
    const summaryData = [
      ['PAYMENT REPORT SUMMARY'],
      ['Generated on:', format(new Date(), 'dd.MM.yyyy HH:mm')],
      [''],
      ['Total Payments Received:', formatCurrency(totalPaymentsReceived)],
      ['Total Distributed:', formatCurrency(totalDistributed)],
      ['Pending Distribution:', formatCurrency(totalPendingDistribution)],
      ['Procedures with Distributions:', proceduresWithDistributions.toString()]
    ];
    const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
    
    // Create payments sheet - now includes Remaining Balance column
    const paymentsHeaders = [['Payment ID', 'Date', 'Amount', 'Status', 'Remaining Balance']];
    const paymentsData = paymentRows.map(p => [p.id, p.date, p.amount, p.status, p.remainingBalance]);
    const paymentsSheet = XLSX.utils.aoa_to_sheet([...paymentsHeaders, ...paymentsData]);
    
    // Create distributions sheet - reordered columns and removed ₺ from Invoice Value
    const distributionsHeaders = [['Procedure Reference', 'Invoice Number', 'Invoice Value', 'Piece', 'Payment ID', 'Amount', 'Date', 'Type']];
    const distributionsData = distributionDetails.map(d => [
      d.procedureReference,      // Column 1: Procedure Reference
      d.invoiceNumber || '-',    // Column 2: Invoice Number
      d.invoiceValue || '-',     // Column 3: Invoice Value (no currency symbol)
      d.piece || '-',            // Column 4: Piece
      d.paymentId,               // Column 5: Payment ID
      d.amount,                  // Column 6: Amount (with ₺)
      d.date,                    // Column 7: Date
      d.type                     // Column 8: Type
    ]);
    const distributionsSheet = XLSX.utils.aoa_to_sheet([...distributionsHeaders, ...distributionsData]);
    
    // Add sheets to workbook
    XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');
    XLSX.utils.book_append_sheet(workbook, paymentsSheet, 'Payments');
    XLSX.utils.book_append_sheet(workbook, distributionsSheet, 'Distributions');
    
    // Generate Excel buffer
    const excelBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    
    // Set headers for download
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Payment_Report_${format(new Date(), 'yyyy-MM-dd')}.xlsx"`);
    res.setHeader('Content-Length', excelBuffer.length);
    
    // Send the Excel file
    res.send(excelBuffer);
    console.log('[EXCEL-REPORT] Excel report generated and sent successfully');
    
  } catch (error) {
    console.error('[EXCEL-REPORT] Error generating Excel report:', error);
    res.status(500).json({
      error: 'Excel report generation failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Helper function to format currency amounts
 */
function formatCurrency(amount: string | number): string {
  const numericAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
  return new Intl.NumberFormat('tr-TR', {
    style: 'currency',
    currency: 'TRY',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(numericAmount);
}

/**
 * Formats a date string or Date object to a standardized string format
 */
function formatDate(date: string | Date | null): string {
  if (!date) return '-';
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(dateObj.getTime())) return '-';
  return format(dateObj, 'dd.MM.yyyy');
}

export default router;