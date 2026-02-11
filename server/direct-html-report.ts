/**
 * Direct HTML to PDF Report Generation
 * This skips the problematic Adobe PDF template process and generates clean PDFs directly
 */
import { Router } from 'express';
import { storage } from './storage';
import { format } from 'date-fns';

const router = Router();

/**
 * Generate a direct HTML report that will be properly formatted
 */
router.get('/html-report', async (req, res) => {
  try {
    // Get payment data
    const incomingPayments = await storage.getAllIncomingPayments();
    
    // Transform data for the report
    const paymentRows = incomingPayments.map(payment => {
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
      
      return {
        id: payment.paymentId,
        date: formatDate(payment.dateReceived),
        amount: formatCurrency(payment.totalAmount),
        status: statusDisplay
      };
    });
    
    // Calculate payment totals
    const totalPaymentsReceived = incomingPayments.reduce((sum, payment) => 
      sum + parseFloat(payment.totalAmount), 0);
      
    // Calculate distributions and build procedure data
    let totalDistributed = 0;
    const procedureDistributionMap = new Map();
    
    // Get all procedures first and their financial summaries
    const allProcedures = await storage.getAllProcedures();
    const procedureDetailsMap = new Map();
    const financialSummariesMap = new Map();
    
    for (const procedure of allProcedures) {
      procedureDetailsMap.set(procedure.reference, procedure);
      
      // Get financial summary for proper calculations
      try {
        if (procedure.reference) {
          const financialSummary = await storage.calculateFinancialSummary(procedure.reference);
          financialSummariesMap.set(procedure.reference, financialSummary);
        }
      } catch (error) {
        console.error(`Error getting financial summary for ${procedure.reference}:`, error);
      }
    }
    
    // For each payment, get its distributions
    for (const payment of incomingPayments) {
      const distributions = await storage.getPaymentDistributions(payment.id);
      
      for (const distribution of distributions) {
        // Add to total distributed
        totalDistributed += parseFloat(distribution.distributedAmount);
        
        // Build procedure distribution data
        if (!procedureDistributionMap.has(distribution.procedureReference)) {
          procedureDistributionMap.set(distribution.procedureReference, []);
        }
        
        procedureDistributionMap.get(distribution.procedureReference).push({
          paymentId: payment.paymentId,
          amount: formatCurrency(distribution.distributedAmount),
          date: formatDate(payment.dateReceived),
          type: distribution.paymentType || 'advance'
        });
      }
    }
    
    const proceduresWithDistributions = procedureDistributionMap.size;
    const totalPendingDistribution = totalPaymentsReceived - totalDistributed;
    
    // Generate payment rows HTML
    const paymentItemsHtml = paymentRows.map(payment => `
      <tr>
        <td>${payment.id}</td>
        <td>${payment.date}</td>
        <td>${payment.amount}</td>
        <td>${payment.status}</td>
      </tr>
    `).join('');
    
    // Generate procedure details HTML
    const procedureDetailsHtml = Array.from(procedureDistributionMap.entries()).map(([procedureRef, distributions]) => {
      const procedure = procedureDetailsMap.get(procedureRef);
      const financialSummary = financialSummariesMap.get(procedureRef);
      
      // Use correct financial calculations from the financial summary
      const totalExpenses = financialSummary?.totalExpenses || 0;
      const totalPayment = financialSummary?.totalPayments || 0;
      const remainingBalance = financialSummary?.remainingBalance || 0;
      
      // Generate distributions for this procedure
      const distributionsHtml = distributions.map((dist: any) => `
        <tr>
          <td>${dist.paymentId}</td>
          <td>${dist.amount}</td>
          <td>${dist.date}</td>
          <td>${dist.type.charAt(0).toUpperCase() + dist.type.slice(1)}</td>
        </tr>
      `).join('');
      
      return `
        <div class="procedure-section">
          <h3>${procedureRef}</h3>
          <div class="procedure-details">
            <p><strong>Shipper:</strong> ${procedure?.shipper || 'N/A'}</p>
            <p><strong>Invoice Number:</strong> ${procedure?.invoice_no || 'N/A'}</p>
            <p><strong>Invoice Date:</strong> ${procedure?.invoice_date ? formatDate(procedure.invoice_date) : 'N/A'}</p>
            <p><strong>Pieces:</strong> ${procedure?.piece || 'N/A'}</p>
            <p><strong>Import Declaration Number:</strong> ${procedure?.import_dec_number || 'N/A'}</p>
            <p><strong>Import Declaration Date:</strong> ${procedure?.import_dec_date ? formatDate(procedure.import_dec_date) : 'N/A'}</p>
            <p><strong>Payment Status:</strong> ${procedure?.payment_status || 'N/A'}</p>
            <p><strong>Shipment Status:</strong> ${procedure?.shipment_status || 'N/A'}</p>
          </div>
          
          <div class="financial-summary">
            <h4>Financial Summary</h4>
            <p><strong>Total Expenses:</strong> ${formatCurrency(totalExpenses)}</p>
            <p><strong>Total Payment:</strong> ${formatCurrency(totalPayment)}</p>
            <p><strong>Remaining Balance:</strong> ${formatCurrency(remainingBalance)}</p>
          </div>
          
          <h4>Payment Distributions</h4>
          <table>
            <thead>
              <tr>
                <th>Payment ID</th>
                <th>Amount</th>
                <th>Date</th>
                <th>Type</th>
              </tr>
            </thead>
            <tbody>
              ${distributionsHtml}
            </tbody>
          </table>
        </div>
      `;
    }).join('');
    
    // Generate the HTML content
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Payment Report</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; }
          h1 { text-align: center; color: #2c3e50; margin-bottom: 10px; }
          h2 { color: #3498db; margin-top: 30px; margin-bottom: 15px; }
          h3 { color: #2c3e50; margin-top: 25px; margin-bottom: 10px; border-bottom: 2px solid #3498db; padding-bottom: 5px; }
          h4 { color: #34495e; margin-top: 15px; margin-bottom: 10px; }
          .subtitle { text-align: center; color: #7f8c8d; margin-bottom: 30px; }
          .summary { background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin-bottom: 20px; }
          .summary h2 { color: #3498db; margin-top: 0; }
          .procedure-section { background-color: #fdfdfd; border: 1px solid #e1e8ed; border-radius: 5px; padding: 15px; margin-bottom: 20px; }
          .procedure-details { background-color: #f8f9fa; padding: 10px; border-radius: 3px; margin-bottom: 15px; }
          .procedure-details p { margin: 5px 0; }
          .financial-summary { background-color: #e8f5e8; border: 1px solid #c3e6c3; padding: 10px; border-radius: 3px; margin-bottom: 15px; }
          .financial-summary p { margin: 5px 0; font-weight: 500; }
          table { width: 100%; border-collapse: collapse; margin: 15px 0; }
          th { background-color: #f2f2f2; padding: 10px; text-align: left; border: 1px solid #ddd; font-weight: bold; }
          td { padding: 8px; border: 1px solid #ddd; }
          tr:nth-child(even) { background-color: #f9f9f9; }
          @media print {
            body { font-size: 12pt; }
            table { page-break-inside: avoid; }
            .procedure-section { page-break-inside: avoid; }
          }
        </style>
      </head>
      <body>
        <h1>PAYMENT REPORT</h1>
        <p class="subtitle">Generated on: ${format(new Date(), 'dd.MM.yyyy HH:mm')}</p>
        
        <div class="summary">
          <h2>Payment Summary</h2>
          <table>
            <tr>
              <td><strong>Total Payments Received:</strong></td>
              <td>${formatCurrency(totalPaymentsReceived)}</td>
            </tr>
            <tr>
              <td><strong>Total Distributed:</strong></td>
              <td>${formatCurrency(totalDistributed)}</td>
            </tr>
            <tr>
              <td><strong>Pending Distribution:</strong></td>
              <td>${formatCurrency(totalPendingDistribution)}</td>
            </tr>
            <tr>
              <td><strong>Procedures with Distributions:</strong></td>
              <td>${proceduresWithDistributions}</td>
            </tr>
          </table>
        </div>
        
        <h2>Payment List</h2>
        <table>
          <thead>
            <tr>
              <th>Payment ID</th>
              <th>Date</th>
              <th>Amount</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${paymentItemsHtml}
          </tbody>
        </table>
        
        <h2>Procedure Details & Payment Distributions</h2>
        ${procedureDetailsHtml}
      </body>
      </html>
    `;
    
    // Send the HTML for download or viewing
    if (req.query.download === 'true') {
      // Set headers for download
      res.setHeader('Content-Type', 'text/html');
      res.setHeader('Content-Disposition', `attachment; filename="Payment_Report_${format(new Date(), 'yyyy-MM-dd')}.html"`);
    } else {
      // Set header for viewing
      res.setHeader('Content-Type', 'text/html');
    }
    
    res.send(html);
    
  } catch (error) {
    console.error('Error generating HTML report:', error);
    res.status(500).json({
      error: 'Failed to generate HTML report',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Helper function to format currency amounts in Turkish Lira
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