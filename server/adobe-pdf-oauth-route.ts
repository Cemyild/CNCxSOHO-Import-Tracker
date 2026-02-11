/**
 * Test route for Adobe PDF Services using OAuth authentication
 */
import { Router, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { adobePdfOAuthService } from './adobe-pdf-oauth';
import { createExampleInvoice } from '../example-service-invoice.mjs';

const router = Router();

// Sample JSON data for PDF generation using our procedure template
const sampleData = {
  "company": {
    "name": "SEA PALLETS",
    "logo": "Company Logo.png",
    "address": "123 Shipping Lane, Istanbul, Turkey",
    "contact": "+90 212 555 1234",
    "email": "info@seapallets.com"
  },
  "procedure": {
    "reference": "PROC-2025-0042",
    "status": "Completed",
    "client": "Global Logistics Co.",
    "date": "May 8, 2025",
    "arrivalDate": "May 15, 2025",
    "description": "Pallets shipment via sea freight"
  },
  "finances": {
    "subtotal": 45000,
    "tax": 8100,
    "total": 53100,
    "totalUSD": 1770,
    "exchangeRate": 30
  },
  "expenses": [
    {
      "category": "Import Tax",
      "amount": 12500,
      "amountUSD": 416.67,
      "date": "May 10, 2025",
      "notes": "Standard import duty"
    },
    {
      "category": "Customs Fee",
      "amount": 3500,
      "amountUSD": 116.67,
      "date": "May 10, 2025",
      "notes": "Processing fee"
    },
    {
      "category": "Port Charges",
      "amount": 8000,
      "amountUSD": 266.67,
      "date": "May 12, 2025",
      "notes": "Docking and handling"
    }
  ],
  "invoiceItems": [
    {
      "description": "Sea freight service",
      "quantity": 1,
      "unitPrice": 25000,
      "amount": 25000
    },
    {
      "description": "Documentation fee",
      "quantity": 1,
      "unitPrice": 2000,
      "amount": 2000
    },
    {
      "description": "Insurance",
      "quantity": 1,
      "unitPrice": 5000,
      "amount": 5000
    }
  ]
};

// Initialize the Adobe PDF Service when the server starts
async function initializeAdobePdf() {
  if (!process.env.ADOBE_PDF_CLIENT_ID || !process.env.ADOBE_PDF_CLIENT_SECRET) {
    console.error('[ADOBE OAUTH] Missing Adobe PDF Services credentials');
    return false;
  }
  
  return await adobePdfOAuthService.initialize({
    clientId: process.env.ADOBE_PDF_CLIENT_ID,
    clientSecret: process.env.ADOBE_PDF_CLIENT_SECRET
  });
}

// Initialize on startup
initializeAdobePdf().then(success => {
  if (success) {
    console.log('[ADOBE OAUTH] Adobe PDF Services OAuth initialized successfully!');
  } else {
    console.error('[ADOBE OAUTH] Failed to initialize Adobe PDF Services OAuth');
  }
});

// Helper function to check if the service is initialized
function checkServiceInitialized(res: Response): boolean {
  if (!adobePdfOAuthService.isReady()) {
    console.error('[ADOBE OAUTH ROUTE] Adobe PDF service not initialized');
    res.status(503).json({
      success: false,
      message: 'Adobe PDF Service not initialized',
      error: 'The PDF generation service is currently unavailable. Please try again later or contact support.'
    });
    return false;
  }
  return true;
}

// Helper function to check if the template exists
function getTemplatePath(templateName = 'procedure-report-template.docx'): string | null {
  // In ES modules, __dirname is not available, so we use process.cwd() instead
  const templateDir = path.join(process.cwd(), 'assets', 'templates');
  if (!fs.existsSync(templateDir)) {
    fs.mkdirSync(templateDir, { recursive: true });
  }
  
  const templatePath = path.join(templateDir, templateName);
  if (!fs.existsSync(templatePath)) {
    console.error(`[ADOBE OAUTH ROUTE] Template not found: ${templateName}`);
    return null;
  }
  
  return templatePath;
}

// Test route to generate a sample PDF using a template
router.get('/test-generate-oauth', async (req, res) => {
  console.log('[ADOBE OAUTH ROUTE] Generating test PDF with OAuth...');
  
  try {
    // Check if service is initialized
    if (!checkServiceInitialized(res)) return;
    
    // Get template path
    const templatePath = getTemplatePath();
    if (!templatePath) {
      return res.status(500).json({
        success: false,
        message: 'Template not found',
        error: 'The required PDF template is missing. Please upload the template first.'
      });
    }
    
    // Generate PDF
    const pdfBuffer = await adobePdfOAuthService.generatePDF({
      templatePath,
      data: sampleData
    });
    
    if (!pdfBuffer) {
      console.error('[ADOBE OAUTH ROUTE] Failed to generate PDF');
      return res.status(500).json({
        success: false,
        message: 'Failed to generate PDF',
        error: 'PDF generation failed. The service encountered an error while processing your request.'
      });
    }
    
    // Return PDF file
    res.contentType('application/pdf');
    res.send(pdfBuffer);
    console.log('[ADOBE OAUTH ROUTE] PDF generated and sent successfully');
  } catch (error) {
    console.error('[ADOBE OAUTH ROUTE] Error generating PDF:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate PDF',
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

// Route to generate a procedure report PDF
router.post('/generate-procedure-report', async (req, res) => {
  console.log('[ADOBE OAUTH ROUTE] Generating procedure report PDF with OAuth...');
  
  try {
    // Check if service is initialized
    if (!checkServiceInitialized(res)) return;
    
    // Validate input data
    const { procedureData } = req.body;
    if (!procedureData) {
      return res.status(400).json({
        success: false,
        message: 'Missing procedure data',
        error: 'The request must include procedure data for PDF generation.'
      });
    }
    
    // Get template path
    const templatePath = getTemplatePath('procedure-report-template.docx');
    if (!templatePath) {
      return res.status(500).json({
        success: false,
        message: 'Template not found',
        error: 'The required procedure report PDF template is missing. Please upload the template first.'
      });
    }
    
    // Generate PDF
    console.log('[ADOBE OAUTH ROUTE] Generating procedure report for:', 
      procedureData.procedure?.reference || 'Unknown reference');
    
    const pdfBuffer = await adobePdfOAuthService.generatePDF({
      templatePath,
      data: procedureData
    });
    
    if (!pdfBuffer) {
      console.error('[ADOBE OAUTH ROUTE] Failed to generate procedure report PDF');
      return res.status(500).json({
        success: false,
        message: 'Failed to generate procedure report PDF',
        error: 'PDF generation failed. The service encountered an error while processing your request.'
      });
    }
    
    // Return PDF file with a more specific filename
    const filename = `procedure-report-${procedureData.procedure?.reference || 'unknown'}.pdf`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.contentType('application/pdf');
    res.send(pdfBuffer);
    console.log('[ADOBE OAUTH ROUTE] Procedure report PDF generated and sent successfully');
  } catch (error) {
    console.error('[ADOBE OAUTH ROUTE] Error generating procedure report PDF:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate procedure report PDF',
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

// Route to generate an expense report PDF
router.post('/generate-expense-report', async (req, res) => {
  console.log('[ADOBE OAUTH ROUTE] Generating expense report PDF with OAuth...');
  
  try {
    // Check if service is initialized
    if (!checkServiceInitialized(res)) return;
    
    // Validate input data
    const { expenseData } = req.body;
    if (!expenseData) {
      return res.status(400).json({
        success: false,
        message: 'Missing expense data',
        error: 'The request must include expense data for PDF generation.'
      });
    }
    
    // Get template path - using the same template for now, can be replaced with a specific expense template
    const templatePath = getTemplatePath('procedure-report-template.docx');
    if (!templatePath) {
      return res.status(500).json({
        success: false,
        message: 'Template not found',
        error: 'The required expense report PDF template is missing. Please upload the template first.'
      });
    }
    
    // Generate PDF
    console.log('[ADOBE OAUTH ROUTE] Generating expense report for:', 
      expenseData.procedure?.reference || expenseData.expense?.id || 'Unknown reference');
    
    const pdfBuffer = await adobePdfOAuthService.generatePDF({
      templatePath,
      data: expenseData
    });
    
    if (!pdfBuffer) {
      console.error('[ADOBE OAUTH ROUTE] Failed to generate expense report PDF');
      return res.status(500).json({
        success: false,
        message: 'Failed to generate expense report PDF',
        error: 'PDF generation failed. The service encountered an error while processing your request.'
      });
    }
    
    // Return PDF file with a more specific filename
    const reference = expenseData.procedure?.reference || expenseData.expense?.id || 'unknown';
    const filename = `expense-report-${reference}.pdf`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.contentType('application/pdf');
    res.send(pdfBuffer);
    console.log('[ADOBE OAUTH ROUTE] Expense report PDF generated and sent successfully');
  } catch (error) {
    console.error('[ADOBE OAUTH ROUTE] Error generating expense report PDF:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate expense report PDF',
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

// Route to generate a service invoice PDF using the new example template
router.get('/test-service-invoice', async (req, res) => {
  console.log('[ADOBE OAUTH ROUTE] Generating service invoice PDF with OAuth...');
  
  try {
    // Check if service is initialized
    if (!checkServiceInitialized(res)) return;
    
    // Get template path
    const templatePath = getTemplatePath('procedure-report-template.docx');
    if (!templatePath) {
      return res.status(500).json({
        success: false,
        message: 'Template not found',
        error: 'The required PDF template is missing. Please upload the template first.'
      });
    }
    
    // Get example invoice data
    const invoiceData = await createExampleInvoice();
    
    console.log('[ADOBE OAUTH ROUTE] Using example service invoice data:', invoiceData.reference);
    
    // Generate PDF
    const pdfBuffer = await adobePdfOAuthService.generatePDF({
      templatePath,
      data: invoiceData
    });
    
    if (!pdfBuffer) {
      console.error('[ADOBE OAUTH ROUTE] Failed to generate service invoice PDF');
      return res.status(500).json({
        success: false,
        message: 'Failed to generate service invoice PDF',
        error: 'PDF generation failed. The service encountered an error while processing your request.'
      });
    }
    
    // Return PDF file with a specific filename
    const filename = `service-invoice-${invoiceData.reference}.pdf`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.contentType('application/pdf');
    res.send(pdfBuffer);
    console.log('[ADOBE OAUTH ROUTE] Service invoice PDF generated and sent successfully');
  } catch (error) {
    console.error('[ADOBE OAUTH ROUTE] Error generating service invoice PDF:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate service invoice PDF',
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

export default router;