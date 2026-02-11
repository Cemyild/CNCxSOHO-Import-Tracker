/**
 * Payment Report Route Handler
 * Generates HTML reports for payment data
 */
import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { storage } from './storage';
import { format } from 'date-fns';

// Create router
const router = Router();

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

// Define types for the payment report data
interface PaymentRow {
  payment_id: string;
  payment_date: string;
  amount: string;
  status: string;
  raw_status: "pending_distribution" | "partially_distributed" | "fully_distributed" | null;
  raw_amount: number;
}

interface Distribution {
  payment_id: string;
  payment_date: string;
  amount: string;
  payment_type: string;
  raw_amount: number;
  raw_type: string;
}

interface DistributionGroup {
  reference: string;
  bl_reference: string;  // Now used for invoice_no
  distributions: Distribution[];
  total_distributed: string;
  expense_amount?: string;
  remaining_balance?: string;
  raw_expense_amount?: number;
  raw_remaining_balance?: number;
  payment_status?: string;
}

interface ReportSummary {
  total_payments_received: string;
  total_distributed: string;
  total_pending_distribution: string;
  procedures_with_distributions: number;
  report_date: string;
  procedures_with_balances?: number;
}

interface PaymentReportData {
  paymentRows: PaymentRow[];
  distributionGroups: DistributionGroup[];
  summary: ReportSummary;
}

/**
 * Generate payment report data
 */
async function generatePaymentReportData(): Promise<PaymentReportData> {
  console.log('[payment-report] Generating payment report data');
  
  try {
    // Get all payments and their distributions
    console.log('[payment-report] Fetching all incoming payments');
    const incomingPayments = await storage.getAllIncomingPayments();
    
    // Transform the data to be easier to work with in the PDF template
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
        payment_id: payment.paymentId,
        payment_date: formatDate(payment.dateReceived),
        amount: formatCurrency(payment.totalAmount),
        status: statusDisplay,
        raw_status: payment.distributionStatus,
        raw_amount: parseFloat(payment.totalAmount)
      };
    });
    
    // Get all distributions to create procedure groups
    console.log('[payment-report] Fetching all payment distributions');
    const procedureDistributionMap = new Map();
    
    // For each payment, get its distributions
    for (const payment of incomingPayments) {
      const distributions = await storage.getPaymentDistributions(payment.id);
      
      for (const distribution of distributions) {
        // Get the procedure details
        const procedures = await storage.getProcedureByReference(distribution.procedureReference);
        const procedure = procedures.length > 0 ? procedures[0] : null;
        
        // Add to the map
        if (!procedureDistributionMap.has(distribution.procedureReference)) {
          procedureDistributionMap.set(distribution.procedureReference, {
            reference: distribution.procedureReference,
            bl_reference: procedure?.invoice_no || procedure?.awb_number || '-',
            distributions: [],
            total_distributed: 0,
            raw_expense_amount: 0,
            raw_remaining_balance: 0
          });
        }
        
        // Add this distribution to the procedure's list
        const group = procedureDistributionMap.get(distribution.procedureReference);
        group.distributions.push({
          payment_id: payment.paymentId,
          amount: formatCurrency(distribution.distributedAmount),
          raw_amount: parseFloat(distribution.distributedAmount),
          payment_date: formatDate(payment.dateReceived),
          payment_type: distribution.paymentType === 'advance' ? 'Advance' : 'Balance',
          raw_type: distribution.paymentType
        });
        
        // Update total
        group.total_distributed += parseFloat(distribution.distributedAmount);
      }
    }
    
    // Simplify our approach - we'll just use what we know from distribution data
    console.log('[payment-report] Calculating procedure distribution metrics');
    let proceduresWithRemainingBalances = 0;
    
    // For each procedure, get information about its expenses
    for (const group of Array.from(procedureDistributionMap.values())) {
      try {
        // Get the procedure details from storage to estimate expenses
        const procedures = await storage.getProcedureByReference(group.reference);
        const procedure = procedures.length > 0 ? procedures[0] : null;
        
        if (procedure) {
          // For the purposes of this report, let's estimate that the expense amount is the procedure.amount
          // In a real implementation, you would need to get the actual totalExpenses from the financial summary API
          const rawExpenseAmount = parseFloat(procedure.amount || '0');
          const rawDistributedAmount = group.total_distributed;
          const rawRemainingBalance = rawExpenseAmount - rawDistributedAmount;
          
          group.raw_expense_amount = rawExpenseAmount;
          group.expense_amount = formatCurrency(rawExpenseAmount);
          group.raw_remaining_balance = rawRemainingBalance;
          group.remaining_balance = formatCurrency(rawRemainingBalance);
          
          // Determine payment status based on remaining balance
          if (rawRemainingBalance <= 0) {
            group.payment_status = "Fully Paid";
          } else if (rawDistributedAmount > 0) {
            group.payment_status = "Partially Paid";
          } else {
            group.payment_status = "Unpaid";
          }
          
          if (rawRemainingBalance > 0) {
            proceduresWithRemainingBalances++;
          }
        } else {
          // Default values if procedure not found
          group.expense_amount = 'Unknown';
          group.remaining_balance = 'Unknown';
          group.payment_status = 'Unknown';
        }
      } catch (error) {
        console.error(`[payment-report] Error processing expense data for ${group.reference}:`, error);
        // Default values on error
        group.expense_amount = 'Error';
        group.remaining_balance = 'Error';
        group.payment_status = 'Error';
      }
    }
    
    // Convert the map to an array of distribution groups
    const distributionGroups = Array.from(procedureDistributionMap.values()).map(group => ({
      ...group,
      total_distributed: formatCurrency(group.total_distributed)
    }));
    
    // Calculate summary data
    const totalPaymentsReceived = incomingPayments.reduce((sum, payment) => 
      sum + parseFloat(payment.totalAmount), 0);
    
    const totalDistributed = Array.from(procedureDistributionMap.values()).reduce((sum, group) => 
      sum + group.distributions.reduce((groupSum: number, dist: Distribution) => groupSum + dist.raw_amount, 0), 0);
    
    const totalPendingDistribution = totalPaymentsReceived - totalDistributed;
    
    const summary = {
      total_payments_received: formatCurrency(totalPaymentsReceived),
      total_distributed: formatCurrency(totalDistributed),
      total_pending_distribution: formatCurrency(totalPendingDistribution),
      procedures_with_distributions: distributionGroups.length,
      procedures_with_balances: proceduresWithRemainingBalances,
      report_date: format(new Date(), 'dd.MM.yyyy HH:mm')
    };
    
    // Return the complete dataset for the PDF
    console.log('[payment-report] Payment report data generation completed');
    return {
      paymentRows,
      distributionGroups,
      summary
    };
  } catch (error) {
    console.error('[payment-report] Error generating payment report data:', error);
    throw error;
  }
}

/**
 * Generate a Payment Report
 * We're using HTML directly with PDF styling since the Adobe PDF template is problematic
 */
router.get('/generate', async (req, res) => {
  console.log('[payment-report] Request to generate payment report received');
  
  try {
    // Generate the data for the report
    const reportData = await generatePaymentReportData();
    
    console.log('[payment-report] Payment report data generated successfully');
    
    // Check if the user wants to download or view in browser
    const inline = req.query.inline === 'true';
    
    // Set content type to PDF if not viewing inline (future implementation will render actual PDF)
    if (!inline) {
      // For now just render the HTML in either case, but with different headers
      res.setHeader('Content-Disposition', `attachment; filename="Payment_Report_${format(new Date(), 'yyyy-MM-dd')}.html"`);
    }

    // Send enhanced HTML with better styling
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
          <meta charset="UTF-8">
          <title>SOHO Payment Report</title>
          <style>
              @media print {
                  @page { size: A4; margin: 1.5cm; }
                  body { margin: 0; font-family: 'Arial', sans-serif; }
                  .no-print { display: none; }
                  table { page-break-inside: avoid; }
                  .page-break { page-break-before: always; }
                  .header { position: fixed; top: 0; width: 100%; }
                  .content { margin-top: 150px; }
              }
              
              body { 
                  font-family: 'Arial', sans-serif; 
                  margin: 20px; 
                  line-height: 1.5;
                  color: #333;
              }
              .container {
                  max-width: 1000px;
                  margin: 0 auto;
                  padding: 20px;
                  box-shadow: 0 0 20px rgba(0,0,0,0.1);
                  background-color: #fff;
              }
              .header { 
                  text-align: center; 
                  margin-bottom: 30px; 
                  padding-bottom: 20px;
                  border-bottom: 2px solid #f0f0f0;
              }
              .logo {
                  max-width: 200px;
                  margin-bottom: 10px;
              }
              h1, h2, h3 { color: #333; margin-top: 30px; }
              h1 { font-size: 26px; color: #1a1a1a; }
              h2 { 
                  font-size: 22px; 
                  padding-bottom: 10px;
                  border-bottom: 1px solid #e0e0e0;
              }
              
              .summary-box { 
                  background-color: #f9f9f9; 
                  border: 1px solid #e0e0e0; 
                  border-radius: 5px;
                  padding: 20px; 
                  margin-bottom: 30px; 
              }
              .summary-item { 
                  display: flex; 
                  justify-content: space-between; 
                  margin-bottom: 12px;
                  border-bottom: 1px dotted #e0e0e0;
                  padding-bottom: 8px;
              }
              .summary-item:last-child {
                  border-bottom: none;
                  margin-bottom: 0;
                  padding-bottom: 0;
              }
              .summary-label { font-weight: bold; }
              
              table { 
                  width: 100%; 
                  border-collapse: collapse; 
                  margin-bottom: 30px; 
                  box-shadow: 0 2px 5px rgba(0,0,0,0.05);
              }
              th { 
                  background-color: #f2f2f2; 
                  padding: 12px 15px;
                  text-align: left;
                  font-weight: bold;
                  border: 1px solid #ddd;
              }
              td { 
                  border: 1px solid #ddd; 
                  padding: 10px 15px; 
                  text-align: left; 
              }
              tr:nth-child(even) { background-color: #f9f9f9; }
              tr:hover { background-color: #f5f5f5; }
              
              .procedure-section {
                  margin-bottom: 40px;
                  border: 1px solid #e0e0e0;
                  border-radius: 5px;
                  padding: 20px;
                  background-color: #fff;
              }
              
              .procedure-header {
                  display: flex;
                  justify-content: space-between;
                  border-bottom: 2px solid #f0f0f0;
                  padding-bottom: 10px;
                  margin-bottom: 15px;
              }
              
              .procedure-title {
                  font-size: 18px;
                  font-weight: bold;
                  margin: 0 0 5px 0;
              }
              
              .procedure-reference {
                  color: #666;
                  margin: 0;
              }
              
              .total-row {
                  font-weight: bold; 
                  background-color: #e9e9e9;
              }
              
              .footer { 
                  margin-top: 50px; 
                  text-align: center; 
                  font-size: 12px; 
                  color: #666; 
                  border-top: 1px solid #e0e0e0;
                  padding-top: 20px;
              }
              
              .print-button {
                  display: block;
                  margin: 30px auto;
                  padding: 10px 20px;
                  background-color: #0066cc;
                  color: white;
                  border: none;
                  border-radius: 4px;
                  cursor: pointer;
                  font-size: 16px;
              }
              
              .print-button:hover {
                  background-color: #0055b3;
              }
              
              .status-badge {
                  display: inline-block;
                  padding: 4px 8px;
                  border-radius: 4px;
                  font-size: 12px;
                  font-weight: bold;
              }
              
              .status-pending {
                  background-color: #fff0c2;
                  color: #856404;
              }
              
              .status-partial {
                  background-color: #d1ecf1;
                  color: #0c5460;
              }
              
              .status-full {
                  background-color: #d4edda;
                  color: #155724;
              }
              
              @media print {
                  .container {
                      box-shadow: none;
                      margin: 0;
                      padding: 0;
                  }
              }
          </style>
      </head>
      <body>
          <div class="container">
              <div class="header">
                  <h1>SOHO TURKEY - PAYMENT REPORT</h1>
                  <p>Generated on: ${reportData.summary.report_date}</p>
              </div>
              
              <div class="section">
                  <h2>Financial Summary</h2>
                  <div class="summary-box">
                      <div class="summary-item">
                          <span class="summary-label">Total Payments Received:</span>
                          <span>${reportData.summary.total_payments_received}</span>
                      </div>
                      <div class="summary-item">
                          <span class="summary-label">Total Distributed:</span>
                          <span>${reportData.summary.total_distributed}</span>
                      </div>
                      <div class="summary-item">
                          <span class="summary-label">Total Pending Distribution:</span>
                          <span>${reportData.summary.total_pending_distribution}</span>
                      </div>
                      <div class="summary-item">
                          <span class="summary-label">Procedures with Distributions:</span>
                          <span>${reportData.summary.procedures_with_distributions}</span>
                      </div>
                      <div class="summary-item">
                          <span class="summary-label">Procedures with Remaining Balances:</span>
                          <span>${reportData.summary.procedures_with_balances || 0}</span>
                      </div>
                  </div>
              </div>
              
              <div class="section">
                  <h2>All Incoming Payments</h2>
                  <table>
                      <thead>
                          <tr>
                              <th>Payment ID</th>
                              <th>Date Received</th>
                              <th>Amount</th>
                              <th>Status</th>
                          </tr>
                      </thead>
                      <tbody>
                          ${reportData.paymentRows.map(payment => `
                              <tr>
                                  <td>${payment.payment_id}</td>
                                  <td>${payment.payment_date}</td>
                                  <td>${payment.amount}</td>
                                  <td>
                                      <div class="status-badge status-${payment.raw_status === 'fully_distributed' ? 'full' : payment.raw_status === 'partially_distributed' ? 'partial' : 'pending'}">
                                          ${payment.status}
                                      </div>
                                  </td>
                              </tr>
                          `).join('')}
                      </tbody>
                  </table>
              </div>
              
              <div class="section">
                  <h2>Payment Distribution Information</h2>
                  
                  ${reportData.paymentRows.map((payment, index) => {
                    // Find all distributions for this payment ID
                    const paymentDistributions = [];
                    reportData.distributionGroups.forEach(group => {
                      group.distributions.forEach(dist => {
                        if (dist.payment_id === payment.payment_id) {
                          paymentDistributions.push({
                            ...dist,
                            procedure_reference: group.reference,
                            invoice_number: group.bl_reference
                          });
                        }
                      });
                    });
                    
                    return `
                      <div class="payment-section ${index > 0 ? 'mt-8' : ''}">
                          <div class="payment-header" style="background-color: #f8f9fa; padding: 12px 16px; border-radius: 4px; margin-bottom: 12px; border-left: 4px solid #0066cc;">
                              <div class="flex justify-between items-center">
                                  <div>
                                      <h3 class="payment-title" style="margin: 0; font-size: 18px; color: #333;">${payment.payment_id}</h3>
                                      <p style="margin: 5px 0 0 0; color: #666;">Date Received: ${payment.payment_date}</p>
                                      <p style="margin: 5px 0 0 0; font-weight: bold;">Amount: ${payment.amount}</p>
                                  </div>
                                  <div>
                                      <div class="status-badge status-${
                                          payment.raw_status === 'fully_distributed' ? 'full' :
                                          payment.raw_status === 'partially_distributed' ? 'partial' : 'pending'
                                      }">
                                          ${payment.status}
                                      </div>
                                  </div>
                              </div>
                          </div>
                          
                          ${paymentDistributions.length > 0 ? `
                              <h4 style="margin: 16px 0 8px 0; color: #555; font-size: 16px;">Distributed To:</h4>
                              <table>
                                  <thead>
                                      <tr>
                                          <th>Procedure</th>
                                          <th>Invoice Number</th>
                                          <th>Type</th>
                                          <th>Amount</th>
                                      </tr>
                                  </thead>
                                  <tbody>
                                      ${paymentDistributions.map(dist => `
                                          <tr>
                                              <td>${dist.procedure_reference}</td>
                                              <td>${dist.invoice_number}</td>
                                              <td>${dist.payment_type}</td>
                                              <td>${dist.amount}</td>
                                          </tr>
                                      `).join('')}
                                  </tbody>
                              </table>
                          ` : `
                              <div class="no-distributions" style="padding: 16px; background-color: #fff8e1; border-radius: 4px; margin-top: 12px; border-left: 4px solid #ffc107;">
                                  <p style="margin: 0; color: #856404;">This payment has not been distributed to any procedures yet.</p>
                              </div>
                          `}
                      </div>
                  `}).join('')}
              </div>
              
              <div class="footer">
                  <p>This report was automatically generated on ${reportData.summary.report_date}</p>
                  <p>SOHO TURKEY • Payment Management System</p>
                  <button onclick="window.print()" class="print-button no-print">Print Report</button>
              </div>
          </div>
      </body>
      </html>
    `);
    
    console.log('[payment-report] HTML payment report generated successfully');
    
  } catch (error) {
    console.error('[payment-report] Error generating payment report:', error);
    res.status(500).json({
      error: 'Failed to generate payment report',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * Generate an HTML version of the payment report
 * This is useful for testing and debugging the report structure
 */
router.get('/html', async (req, res) => {
  console.log('[payment-report] Request to generate HTML payment report received');
  
  try {
    // Forward to the generate endpoint with inline=true
    res.redirect('/api/payment-report/generate?inline=true');
  } catch (error) {
    console.error('[payment-report] Error generating HTML report:', error);
    res.status(500).send(`
      <html>
        <head><title>Error</title></head>
        <body>
          <h1>Error Generating Report</h1>
          <p>${error instanceof Error ? error.message : 'Unknown error occurred'}</p>
          <a href="javascript:history.back()">Go Back</a>
        </body>
      </html>
    `);
  }
});

export default router;
