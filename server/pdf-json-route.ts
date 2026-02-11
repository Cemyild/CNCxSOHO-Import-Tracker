/**
 * Route for generating PDFs directly from JSON data
 */
import { Router } from 'express';
import { adobePdfOAuthService } from './adobe-pdf-oauth';
import path from 'path';
import fs from 'fs';

const router = Router();

/**
 * Helper function to get the template path
 */
function getTemplatePath(templateName = 'procedure-report-template.docx'): string | null {
  const templateDir = path.join(process.cwd(), 'assets', 'templates');
  const templatePath = path.join(templateDir, templateName);
  
  if (!fs.existsSync(templatePath)) {
    console.error(`[PDF JSON ROUTE] Template not found: ${templateName}`);
    return null;
  }
  
  return templatePath;
}

/**
 * Generate a PDF from direct JSON data
 */
router.post('/generate-json', async (req, res) => {
  console.log('[PDF JSON ROUTE] Generating PDF from direct JSON data...');
  
  try {
    // Validate input data
    if (!req.body || Object.keys(req.body).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Missing JSON data',
        error: 'The request must include valid JSON data for PDF generation.'
      });
    }
    
    // Check if Adobe PDF service is initialized
    if (!adobePdfOAuthService.isReady()) {
      console.error('[PDF JSON ROUTE] Adobe PDF service not initialized');
      return res.status(503).json({
        success: false,
        message: 'PDF Service not initialized',
        error: 'The PDF generation service is currently unavailable. Please try again later or contact support.'
      });
    }
    
    // Get template path
    const templatePath = getTemplatePath();
    if (!templatePath) {
      return res.status(500).json({
        success: false,
        message: 'Template not found',
        error: 'The required PDF template is missing. Please upload the template first.'
      });
    }
    
    // Log the data structure being used
    const jsonData = req.body;
    console.log('[PDF JSON ROUTE] Using JSON data with reference:', jsonData.reference || 'No reference');
    
    // Add detailed logging for debugging conditional sections
    console.log('[PDF JSON ROUTE] DETAILED DEBUG - JSON Structure:');
    console.log(JSON.stringify(jsonData, null, 2));
    
    if (jsonData.financial_summary) {
      console.log('[PDF JSON ROUTE] Financial Summary Structure:');
      console.log(JSON.stringify(jsonData.financial_summary, null, 2));
      console.log('[PDF JSON ROUTE] is_excess_payment exists:', 'is_excess_payment' in jsonData.financial_summary);
      console.log('[PDF JSON ROUTE] is_excess_payment value:', jsonData.financial_summary.is_excess_payment);
      console.log('[PDF JSON ROUTE] is_excess_payment type:', typeof jsonData.financial_summary.is_excess_payment);
      console.log('[PDF JSON ROUTE] excess_payment exists:', 'excess_payment' in jsonData.financial_summary);
      console.log('[PDF JSON ROUTE] remaining_balance exists:', 'remaining_balance' in jsonData.financial_summary);
      console.log('[PDF JSON ROUTE] payment_status exists:', 'payment_status' in jsonData.financial_summary);
    }
    
    // Generate PDF
    // Ensure the JSON data has the correct financial summary structure
    if (jsonData.financial_summary) {
      console.log('[PDF JSON ROUTE] Processing financial summary data');
      
      // Check for missing is_excess_payment flag
      if (!('is_excess_payment' in jsonData.financial_summary)) {
        console.log('[PDF JSON ROUTE] Adding missing is_excess_payment flag');
        
        // Calculate if this is an excess payment from the data
        const totalExpenses = parseFloat(jsonData.financial_summary.total_expenses?.replace(/,/g, '') || '0');
        const totalPayment = parseFloat(jsonData.financial_summary.total_payment?.replace(/,/g, '') || '0');
        const remainingBalance = parseFloat(jsonData.financial_summary.remaining_balance?.replace(/,/g, '') || '0');
        const excessPayment = parseFloat(jsonData.financial_summary.excess_payment?.replace(/,/g, '') || '0');
        
        // Calculate payment difference based on available data
        const isExcessPayment = excessPayment > 0 || (totalPayment > totalExpenses);
        
        // Update the financial summary
        jsonData.financial_summary.is_excess_payment = isExcessPayment;
        
        console.log('[PDF JSON ROUTE] Added is_excess_payment flag:', isExcessPayment);
      }
      
      // Verification of import_expenses_total calculation
      // For the JSON route, we assume the provided values are already calculated correctly
      // But we'll log the values for verification
      if (jsonData.import_expenses && jsonData.service_invoices_total) {
        console.log('[PDF JSON ROUTE] Verifying financial calculations:');
        
        // Extract all the key values
        const importExpensesValue = parseFloat(jsonData.import_expenses.import_expenses_total?.replace(/,/g, '') || '0');
        const serviceInvoicesValue = parseFloat(jsonData.service_invoices_total?.replace(/,/g, '') || '0');
        const combinedTotal = importExpensesValue + serviceInvoicesValue;
        
        // Log the values but don't recalculate - assume values provided in JSON are correct
        console.log('[PDF JSON ROUTE] Import expenses value:', importExpensesValue);
        console.log('[PDF JSON ROUTE] Service invoices value:', serviceInvoicesValue);
        console.log('[PDF JSON ROUTE] Combined import expenses and service invoices:', combinedTotal);
        
        // Add the import_and_service_total field if it doesn't exist
        if (!jsonData.import_and_service_total) {
          jsonData.import_and_service_total = combinedTotal.toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
          });
          console.log('[PDF JSON ROUTE] Added import_and_service_total field:', jsonData.import_and_service_total);
        } else {
          // Verify the import_and_service_total field matches the calculation
          console.log('[PDF JSON ROUTE] Existing import_and_service_total field:', jsonData.import_and_service_total);
          console.log('[PDF JSON ROUTE] Calculated import_and_service_total:', combinedTotal.toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
          }));
          
          // Replace if the values don't match (after parsing)
          const parsedExisting = parseFloat(jsonData.import_and_service_total.replace(/,/g, ''));
          if (Math.abs(parsedExisting - combinedTotal) > 0.01) {
            console.log('[PDF JSON ROUTE] WARNING: Replacing incorrect import_and_service_total value');
            jsonData.import_and_service_total = combinedTotal.toLocaleString('en-US', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2
            });
          }
        }
      }
      
      console.log('[PDF JSON ROUTE] Updated financial summary:', jsonData.financial_summary);
    }
    
    const pdfBuffer = await adobePdfOAuthService.generatePDF({
      templatePath,
      data: jsonData
    });
    
    if (!pdfBuffer) {
      console.error('[PDF JSON ROUTE] Failed to generate PDF');
      return res.status(500).json({
        success: false,
        message: 'Failed to generate PDF',
        error: 'PDF generation failed. The service encountered an error while processing your request.'
      });
    }
    
    // Return PDF file with a specific filename
    const filename = `report-${jsonData.reference || 'unknown'}.pdf`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.contentType('application/pdf');
    res.send(pdfBuffer);
    console.log('[PDF JSON ROUTE] PDF generated and sent successfully');
  } catch (error) {
    console.error('[PDF JSON ROUTE] Error generating PDF:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate PDF',
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

export default router;