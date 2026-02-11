/**
 * Direct HTML to PDF Module
 * This module provides functions to convert HTML directly to PDF bypassing the Adobe PDF template
 * which is having issues with tag replacement.
 */
import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { format } from 'date-fns';
import { adobePdfOAuthService } from './adobe-pdf-oauth';

// Create router
const router = Router();

// Sample test data
const testData = {
  title: "DIRECT HTML PAYMENT REPORT",
  subtitle: "Generated for testing HTML-to-PDF conversion",
  summary: {
    total_payments_received: "€1,500,000.00",
    total_distributed: "€1,200,000.00",
    total_pending_distribution: "€300,000.00",
    procedures_with_distributions: 5
  },
  payments: [
    {
      id: "PAY001",
      date: "15.05.2025",
      amount: "€500,000.00",
      status: "Fully Distributed"
    },
    {
      id: "PAY002",
      date: "18.05.2025",
      amount: "€750,000.00",
      status: "Partially Distributed"
    },
    {
      id: "PAY003",
      date: "20.05.2025",
      amount: "€250,000.00",
      status: "Pending Distribution"
    }
  ]
};

/**
 * Generate HTML for a payment report
 */
function generatePaymentReportHTML(data: any) {
  // Map the payment items
  const paymentItems = data.payments.map((payment: any) => `
    <div class="payment-item">
      <div class="payment-header">Payment ID: ${payment.id}</div>
      <div class="payment-detail"><strong>Date:</strong> ${payment.date}</div>
      <div class="payment-detail"><strong>Amount:</strong> ${payment.amount}</div>
      <div class="payment-detail"><strong>Status:</strong> ${payment.status}</div>
    </div>
  `).join('');
  
  // Generate the HTML
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>${data.title}</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        h1 { text-align: center; color: #2c3e50; margin-bottom: 10px; }
        h2 { color: #3498db; margin-top: 20px; }
        .summary { background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin-bottom: 20px; }
        .summary h2 { margin-top: 0; }
        .summary-row { margin-bottom: 5px; }
        .summary-row span:first-child { font-weight: bold; margin-right: 10px; }
        .payment-item { border: 1px solid #e0e0e0; padding: 12px; margin-bottom: 15px; border-radius: 5px; }
        .payment-header { font-weight: bold; color: #3498db; margin-bottom: 10px; }
        .payment-detail { margin-bottom: 5px; }
        @media print {
          body { font-size: 11pt; }
          .payment-item { break-inside: avoid; }
        }
      </style>
    </head>
    <body>
      <h1>${data.title}</h1>
      <p style="text-align: center; color: #7f8c8d;">${data.subtitle}</p>
      
      <div class="summary">
        <h2>Payment Summary</h2>
        <div class="summary-row">
          <span>Total Payments Received:</span>
          <span>${data.summary.total_payments_received}</span>
        </div>
        <div class="summary-row">
          <span>Total Distributed:</span>
          <span>${data.summary.total_distributed}</span>
        </div>
        <div class="summary-row">
          <span>Pending Distribution:</span>
          <span>${data.summary.total_pending_distribution}</span>
        </div>
        <div class="summary-row">
          <span>Procedures with Distributions:</span>
          <span>${data.summary.procedures_with_distributions}</span>
        </div>
      </div>
      
      <h2>Payment List</h2>
      ${paymentItems}
    </body>
    </html>
  `;
}

/**
 * Create a temporary HTML file
 */
function createTempHTMLFile(html: string): string {
  const tmpDir = path.join(process.cwd(), 'tmp');
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }
  
  const timestamp = Date.now();
  const htmlPath = path.join(tmpDir, `payment-report-${timestamp}.html`);
  
  fs.writeFileSync(htmlPath, html);
  return htmlPath;
}

/**
 * Test endpoint for direct HTML-to-PDF conversion
 */
router.get('/test', async (req, res) => {
  console.log('[DIRECT HTML] Testing direct HTML-to-PDF conversion');
  
  try {
    // Generate HTML
    const html = generatePaymentReportHTML(testData);
    
    // Save to temp file
    const htmlPath = createTempHTMLFile(html);
    console.log(`[DIRECT HTML] HTML saved to temporary file: ${htmlPath}`);
    
    // Set content type to HTML for direct viewing
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
    
  } catch (error) {
    console.error('[DIRECT HTML] Error generating HTML:', error);
    res.status(500).json({
      error: 'HTML generation failed',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * Convert payment report data to PDF using direct HTML method
 */
export async function generatePaymentReportPDF(data: any) {
  console.log('[DIRECT HTML] Generating payment report PDF from HTML');
  
  try {
    // Generate HTML
    const html = generatePaymentReportHTML(data);
    
    // Save to temp file for debugging
    const htmlPath = createTempHTMLFile(html);
    console.log(`[DIRECT HTML] Saved HTML to: ${htmlPath}`);
    
    // Here you would convert the HTML to PDF
    // For now, we'll just return the HTML as a string
    // In a real implementation, you would use a library like puppeteer or html-pdf
    return html;
    
  } catch (error) {
    console.error('[DIRECT HTML] Error generating PDF:', error);
    throw error;
  }
}

export default router;