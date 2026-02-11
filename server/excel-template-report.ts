/**
 * Template-based Excel Report Generation
 * Uses ExcelJS to create professionally formatted Excel reports
 */
import { Router } from 'express';
import { storage } from './storage';
import { format } from 'date-fns';
import ExcelJS from 'exceljs';

const router = Router();

/**
 * Generate an Excel report with professional formatting
 */
router.get('/download', async (req, res) => {
  try {
    console.log('[TEMPLATE-EXCEL-REPORT] ===== STARTING REPORT GENERATION =====');
    console.log('[TEMPLATE-EXCEL-REPORT] Using updated excel-template-report.ts file');
    console.log('[TEMPLATE-EXCEL-REPORT] Expected columns: Payment ID, Date, Amount (₺), Status, Remaining Balance');
    
    // Get payment data
    const incomingPayments = await storage.getAllIncomingPayments();
    console.log(`[TEMPLATE-EXCEL-REPORT] Found ${incomingPayments.length} payments`);
    
    // Create a new workbook
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Logistics Payment System';
    workbook.created = new Date();
    workbook.modified = new Date();
    
    // Create Summary Sheet
    const summarySheet = workbook.addWorksheet('Summary', {
      properties: { tabColor: { argb: '2F75B5' } }
    });
    
    // Add company info section
    summarySheet.getCell('A1').value = 'PAYMENT REPORT';
    summarySheet.getCell('A1').font = { bold: true, size: 16, color: { argb: '2F75B5' } };
    summarySheet.getCell('A1').alignment = { horizontal: 'center' };
    summarySheet.mergeCells('A1:F1');
    
    // Add report date
    summarySheet.getCell('A3').value = 'Generated on:';
    summarySheet.getCell('A3').font = { bold: true };
    summarySheet.getCell('B3').value = format(new Date(), 'dd.MM.yyyy HH:mm');
    
    // Add divider
    summarySheet.getCell('A5').value = 'SUMMARY INFORMATION';
    summarySheet.getCell('A5').font = { bold: true, size: 12, color: { argb: '2F75B5' } };
    summarySheet.mergeCells('A5:F5');
    summarySheet.getRow(5).height = 20;
    summarySheet.getRow(5).getCell(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'E8F4FD' }
    };
    
    // Calculate summary data
    const totalPaymentsReceived = incomingPayments.reduce((sum, payment) => 
      sum + parseFloat(payment.totalAmount), 0);
    
    let totalDistributed = 0;
    const procedureDistributionMap = new Map();
    
    for (const payment of incomingPayments) {
      const distributions = await storage.getPaymentDistributions(payment.id);
      for (const distribution of distributions) {
        totalDistributed += parseFloat(distribution.distributedAmount);
        if (!procedureDistributionMap.has(distribution.procedureReference)) {
          procedureDistributionMap.set(distribution.procedureReference, true);
        }
      }
    }
    
    const proceduresWithDistributions = procedureDistributionMap.size;
    const totalPendingDistribution = totalPaymentsReceived - totalDistributed;
    
    // Calculate Procedure Payments Balance (from financial summary - totalExpenses - totalPayments across all procedures)
    const proceduresForBalance = await storage.getAllProcedures();
    let procedurePaymentsBalance = 0;
    let totalExpenses = 0;
    let totalProcedurePayments = 0;
    
    for (const procedure of proceduresForBalance) {
      try {
        if (!procedure.reference) continue;
        const summary = await storage.calculateFinancialSummary(procedure.reference);
        const expenses = parseFloat(summary.totalExpenses?.toString() || '0');
        const payments = parseFloat(summary.totalPayments?.toString() || '0');
        const balance = parseFloat(summary.remainingBalance?.toString() || '0');
        
        totalExpenses += expenses;
        totalProcedurePayments += payments;
        procedurePaymentsBalance += balance;
      } catch (err) {
        console.error(`Error calculating financial summary for procedure ${procedure.reference}:`, err);
      }
    }
    
    console.log(`[TEMPLATE-EXCEL-REPORT] Procedure Payments Summary - Total Expenses: ${totalExpenses}, Total Payments: ${totalProcedurePayments}, Balance: ${procedurePaymentsBalance}`);
    
    // Add summary rows
    summarySheet.getCell('A7').value = 'Total Payments Received:';
    summarySheet.getCell('A7').font = { bold: true };
    summarySheet.getCell('B7').value = totalPaymentsReceived;
    summarySheet.getCell('B7').numFmt = '₺#,##0.00';
    
    summarySheet.getCell('A8').value = 'Total Distributed:';
    summarySheet.getCell('A8').font = { bold: true };
    summarySheet.getCell('B8').value = totalDistributed;
    summarySheet.getCell('B8').numFmt = '₺#,##0.00';
    
    summarySheet.getCell('A9').value = 'Pending Distribution:';
    summarySheet.getCell('A9').font = { bold: true };
    summarySheet.getCell('B9').value = totalPendingDistribution;
    summarySheet.getCell('B9').numFmt = '₺#,##0.00';
    
    // Add Procedure Payments Balance (after Pending Distribution as requested)
    const isOverpaid = procedurePaymentsBalance < 0;
    summarySheet.getCell('A10').value = isOverpaid ? 'Procedure Payments (Overpaid):' : 'Procedure Payments Balance:';
    summarySheet.getCell('A10').font = { bold: true };
    summarySheet.getCell('B10').value = Math.abs(procedurePaymentsBalance);
    summarySheet.getCell('B10').numFmt = '₺#,##0.00';
    // Color the balance cell based on whether it's overpaid (green) or balance due (red-ish)
    if (isOverpaid) {
      summarySheet.getCell('B10').font = { color: { argb: '107C10' } }; // Green for overpaid
    }
    
    summarySheet.getCell('A11').value = 'Procedures with Distributions:';
    summarySheet.getCell('A11').font = { bold: true };
    summarySheet.getCell('B11').value = proceduresWithDistributions;
    
    // Add borders to summary
    for (let row = 7; row <= 11; row++) {
      for (let col = 1; col <= 2; col++) {
        const cell = summarySheet.getCell(row, col);
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      }
    }
    
    // Set column widths
    summarySheet.getColumn('A').width = 30;
    summarySheet.getColumn('B').width = 20;
    
    // Create Payments Sheet
    const paymentsSheet = workbook.addWorksheet('Payments', {
      properties: { tabColor: { argb: '92D050' } }
    });
    
    // Add title
    paymentsSheet.getCell('A1').value = 'ALL PAYMENTS';
    paymentsSheet.getCell('A1').font = { bold: true, size: 14, color: { argb: '2F75B5' } };
    paymentsSheet.mergeCells('A1:E1');
    paymentsSheet.getRow(1).height = 25;
    
    // Add headers with styling - now includes Remaining Balance column
    const paymentHeaders = ['Payment ID', 'Date', 'Amount (₺)', 'Status', 'Remaining Balance'];
    console.log('[TEMPLATE-EXCEL-REPORT] Adding payment headers:', paymentHeaders);
    const headerRow = paymentsSheet.addRow(paymentHeaders);
    headerRow.height = 20;
    headerRow.font = { bold: true, color: { argb: 'FFFFFF' } };
    headerRow.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: '2F75B5' }
      };
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      };
      cell.alignment = { horizontal: 'center' };
    });
    
    // Add payment data with alternating row colors
    for (let index = 0; index < incomingPayments.length; index++) {
      const payment = incomingPayments[index];
      
      // Format payment status for display
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
      
      const dataRow = paymentsSheet.addRow([
        payment.paymentId,
        formatDate(payment.dateReceived),
        paymentAmount,
        statusDisplay,
        remainingBalance
      ]);
      
      console.log(`[TEMPLATE-EXCEL-REPORT] Added payment row: ${payment.paymentId}, ${formatDate(payment.dateReceived)}, ${paymentAmount}, ${statusDisplay}, ${remainingBalance}`);
      
      // Set number format for amount cells
      dataRow.getCell(3).numFmt = '₺#,##0.00';
      dataRow.getCell(5).numFmt = '₺#,##0.00';
      
      // Alternating row colors
      if (index % 2 === 1) {
        dataRow.eachCell((cell) => {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'F2F2F2' }
          };
        });
      }
      
      // Add thin borders to all cells
      dataRow.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      });
    }
    
    // Set column widths
    paymentsSheet.getColumn(1).width = 20; // Payment ID
    paymentsSheet.getColumn(2).width = 15; // Date
    paymentsSheet.getColumn(3).width = 20; // Amount
    paymentsSheet.getColumn(4).width = 25; // Status
    paymentsSheet.getColumn(5).width = 20; // Remaining Balance
    
    // Create Distributions Sheet
    const distributionsSheet = workbook.addWorksheet('Distributions', {
      properties: { tabColor: { argb: 'FFC000' } }
    });
    
    // Add title
    distributionsSheet.getCell('A1').value = 'PAYMENT DISTRIBUTIONS';
    distributionsSheet.getCell('A1').font = { bold: true, size: 14, color: { argb: '2F75B5' } };
    distributionsSheet.mergeCells('A1:H1');
    distributionsSheet.getRow(1).height = 25;
    
    // Add headers - reordered as requested
    const distHeaders = ['Procedure Reference', 'Invoice Number', 'Invoice Value', 'Piece', 'Payment ID', 'Amount (₺)', 'Date', 'Type'];
    console.log('[TEMPLATE-EXCEL-REPORT] Adding distribution headers:', distHeaders);
    const distHeaderRow = distributionsSheet.addRow(distHeaders);
    distHeaderRow.height = 20;
    distHeaderRow.font = { bold: true, color: { argb: 'FFFFFF' } };
    distHeaderRow.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: '2F75B5' }
      };
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      };
      cell.alignment = { horizontal: 'center' };
    });
    
    // Get distribution details with new column order
    console.log('[TEMPLATE-EXCEL-REPORT] Fetching procedures for distribution mapping...');
    const allProcedures = await storage.getAllProcedures();
    const procedureMap = new Map();
    allProcedures.forEach(proc => {
      if (proc.reference) {
        procedureMap.set(proc.reference, proc);
      }
    });
    console.log(`[TEMPLATE-EXCEL-REPORT] Created procedure lookup map with ${procedureMap.size} entries`);
    
    const distributionDetails = [];
    for (const payment of incomingPayments) {
      const distributions = await storage.getPaymentDistributions(payment.id);
      for (const distribution of distributions) {
        // Get procedure details for invoice info
        const procedure = procedureMap.get(distribution.procedureReference);
        
        distributionDetails.push({
          procedureReference: distribution.procedureReference,
          invoiceNumber: procedure?.invoice_no || '-',
          invoiceValue: procedure?.amount ? parseFloat(procedure.amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-',
          piece: procedure?.piece || '-',
          paymentId: payment.paymentId,
          amount: `₺${parseFloat(distribution.distributedAmount).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          date: formatDate(distribution.createdAt),
          type: distribution.paymentType === 'advance' ? 'Advance' : 'Balance'
        });
      }
    }
    
    // Add distribution data with new column order
    distributionDetails.forEach((dist, index) => {
      const distRow = distributionsSheet.addRow([
        dist.procedureReference,  // Column 1: Procedure Reference
        dist.invoiceNumber,       // Column 2: Invoice Number
        dist.invoiceValue,        // Column 3: Invoice Value (no currency symbol)
        dist.piece,               // Column 4: Piece
        dist.paymentId,           // Column 5: Payment ID
        dist.amount,              // Column 6: Amount (₺)
        dist.date,                // Column 7: Date
        dist.type                 // Column 8: Type
      ]);
      
      // Set number formatting
      distRow.getCell(6).numFmt = '₺#,##0.00';  // Amount (₺) column
      distRow.getCell(3).numFmt = '#,##0.00';   // Invoice Value column (no currency symbol)
      
      // Alternating row colors
      if (index % 2 === 1) {
        distRow.eachCell((cell) => {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFF8E8' }
          };
        });
      }
      
      // Add thin borders to all cells
      distRow.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      });
    });
    
    // Set column widths for distribution sheet (updated for new column order)
    distributionsSheet.getColumn(1).width = 20; // Procedure Reference
    distributionsSheet.getColumn(2).width = 20; // Invoice Number
    distributionsSheet.getColumn(3).width = 15; // Invoice Value
    distributionsSheet.getColumn(4).width = 12; // Piece
    distributionsSheet.getColumn(5).width = 20; // Payment ID
    distributionsSheet.getColumn(6).width = 15; // Amount (₺)
    distributionsSheet.getColumn(7).width = 15; // Date
    distributionsSheet.getColumn(8).width = 15; // Type
    
    // Generate Excel buffer
    const excelBuffer = await workbook.xlsx.writeBuffer();
    
    console.log('[TEMPLATE-EXCEL-REPORT] Excel workbook structure:');
    console.log('[TEMPLATE-EXCEL-REPORT] - Worksheets:', workbook.worksheets.map(ws => ws.name));
    console.log('[TEMPLATE-EXCEL-REPORT] - Payments sheet columns:', paymentsSheet.getRow(2).values);
    console.log('[TEMPLATE-EXCEL-REPORT] - Distributions sheet columns:', distributionsSheet.getRow(2).values);
    
    // Set headers for download
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Payment_Report_${format(new Date(), 'yyyy-MM-dd')}.xlsx"`);
    
    // Send the Excel file
    res.send(excelBuffer);
    console.log('[TEMPLATE-EXCEL-REPORT] ===== REPORT GENERATION COMPLETE =====');
    
  } catch (error) {
    console.error('[TEMPLATE-EXCEL-REPORT] Error generating template-based Excel report:', error);
    res.status(500).json({
      error: 'Template-based Excel report generation failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Helper function to format currency amounts
 */
function formatCurrency(amount: string | number): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(num)) return '₺0.00';
  return `₺${num.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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