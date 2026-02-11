/**
 * HTML Payment Report Generator
 * Creates a properly formatted HTML report that works with Adobe PDF Services
 */
import path from 'path';
import fs from 'fs';
import { format } from 'date-fns';

/**
 * Generate a properly formatted HTML payment report
 * @param {Object} reportData The payment report data
 * @returns {string} HTML string for the report
 */
export function generateHTMLPaymentReport(reportData) {
  // Generate the payment items HTML
  const paymentItems = reportData.paymentRows.map(payment => `
    <div class="payment-item">
      <div class="payment-header">Payment ID: ${payment.payment_id}</div>
      <div class="payment-detail"><strong>Date:</strong> ${payment.payment_date}</div>
      <div class="payment-detail"><strong>Amount:</strong> ${payment.amount}</div>
      <div class="payment-detail"><strong>Status:</strong> ${payment.status}</div>
    </div>
  `).join('');

  // Generate the complete HTML
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Payment Report</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        h1 { text-align: center; color: #2c3e50; margin-bottom: 10px; }
        .summary { background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin-bottom: 20px; }
        .summary h2 { color: #3498db; margin-top: 0; }
        .summary-row { display: flex; justify-content: space-between; margin-bottom: 5px; }
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
      <h1>PAYMENT REPORT</h1>
      <p style="text-align: center; color: #7f8c8d;">Generated on: ${reportData.summary.report_date}</p>
      
      <div class="summary">
        <h2>Payment Summary</h2>
        <div class="summary-row">
          <span>Total Payments Received:</span>
          <span>${reportData.summary.total_payments_received}</span>
        </div>
        <div class="summary-row">
          <span>Total Distributed:</span>
          <span>${reportData.summary.total_distributed}</span>
        </div>
        <div class="summary-row">
          <span>Pending Distribution:</span>
          <span>${reportData.summary.total_pending_distribution}</span>
        </div>
        <div class="summary-row">
          <span>Procedures with Distributions:</span>
          <span>${reportData.summary.procedures_with_distributions}</span>
        </div>
      </div>
      
      <h2>Payment List</h2>
      ${paymentItems}
    </body>
    </html>
  `;
}

/**
 * Save HTML report to a file
 * @param {string} html The HTML content
 * @returns {string} Path to the saved file
 */
export function saveHTMLReport(html) {
  const timestamp = format(new Date(), 'yyyyMMddHHmmss');
  const filePath = path.join(process.cwd(), 'tmp', `payment-report-${timestamp}.html`);
  
  // Ensure tmp directory exists
  const tmpDir = path.join(process.cwd(), 'tmp');
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }
  
  // Write the file
  fs.writeFileSync(filePath, html);
  return filePath;
}