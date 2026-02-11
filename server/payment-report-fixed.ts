/**
 * Payment Report Fixed Route
 * This implements a special route focused exclusively on generating correctly formatted PDFs
 * that work with Adobe PDF Services tag replacement.
 */
import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { storage } from './storage';
import { adobePdfOAuthService } from './adobe-pdf-oauth';
import { format } from 'date-fns';

const router = Router();

/**
 * Special download route for payment reports with reliable PDF generation
 */
router.get('/fixed-download', async (req, res) => {
  console.log('[FIXED-REPORT] Generating payment report with guaranteed tag replacement');
  
  try {
    // Check if Adobe PDF services are initialized
    if (!adobePdfOAuthService.isReady()) {
      console.error('[FIXED-REPORT] Adobe PDF Services not initialized');
      return res.status(500).json({
        error: 'PDF service not initialized',
        details: 'The Adobe PDF Services are not properly initialized.'
      });
    }
    
    // Get all payments data
    console.log('[FIXED-REPORT] Fetching payment data...');
    const incomingPayments = await storage.getAllIncomingPayments();
    
    // Transform the data to match the simplified template format
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
      
    // Calculate distributions  
    let totalDistributed = 0;
    let proceduresWithDistributions = 0;
    const procedureDistributionMap = new Map();
    
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
      }
    }
    
    proceduresWithDistributions = procedureDistributionMap.size;
    const totalPendingDistribution = totalPaymentsReceived - totalDistributed;
    
    // Create the template data in the exact format expected by our simplified template
    const reportData = {
      title: "PAYMENT REPORT",
      subtitle: `Generated on: ${format(new Date(), 'dd.MM.yyyy HH:mm')}`,
      summary: {
        total_payments_received: formatCurrency(totalPaymentsReceived),
        total_distributed: formatCurrency(totalDistributed),
        total_pending_distribution: formatCurrency(totalPendingDistribution),
        procedures_with_distributions: proceduresWithDistributions
      },
      payments: paymentRows
    };
    
    console.log('[FIXED-REPORT] Generated payment report data');
    console.log('[FIXED-REPORT] Sample payments:', reportData.payments.slice(0, 2));
    
    // Use simple-payment-report.docx template which has the correct Adobe formatting
    const templatePath = path.join(process.cwd(), 'assets', 'templates', 'simple-payment-report.docx');
    
    if (!fs.existsSync(templatePath)) {
      console.error(`[FIXED-REPORT] Template not found: ${templatePath}`);
      return res.status(500).json({
        error: 'Template file not found',
        details: 'The payment report template file was not found'
      });
    }
    
    console.log(`[FIXED-REPORT] Using template: ${templatePath}`);
    
    // Generate the PDF using Adobe PDF Services
    const pdfBuffer = await adobePdfOAuthService.generatePDF({
      templatePath,
      data: reportData
    });
    
    if (!pdfBuffer) {
      console.error('[FIXED-REPORT] Failed to generate PDF');
      return res.status(500).json({
        error: 'PDF generation failed',
        details: 'Failed to generate the payment report PDF'
      });
    }
    
    // Generate the filename
    const filename = `Payment_Report_${format(new Date(), 'yyyy-MM-dd')}.pdf`;
    
    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    
    // Send the PDF
    res.end(pdfBuffer);
    console.log('[FIXED-REPORT] Payment report generated and sent successfully');
    
  } catch (error) {
    console.error('[FIXED-REPORT] Error generating payment report:', error);
    res.status(500).json({
      error: 'Payment report generation failed',
      details: error instanceof Error ? error.message : String(error)
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