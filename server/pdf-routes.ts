import type { Express } from "express";
import fs from 'fs';
import path from 'path';
import { storage } from './storage';
import { adobePdfOAuthService } from './adobe-pdf-oauth';
import { transformProcedureData } from './pdf-data-transformer';
import { generateFixedTemplate } from './transformer-fix';

/**
 * Initialize Adobe PDF Services with credentials using OAuth Server-to-Server authentication
 * This should be called when the server starts
 */
async function initializeAdobePdfService() {
  try {
    console.log('===== ADOBE PDF SERVICES OAUTH INITIALIZATION =====');
    
    // Check for Adobe PDF Services credentials in environment variables
    const clientId = process.env.ADOBE_PDF_CLIENT_ID;
    const clientSecret = process.env.ADOBE_PDF_CLIENT_SECRET;

    // Debug the values (making sure to not print the entire values for security)
    console.log('Adobe OAuth credentials check:');
    console.log('  Client ID exists:', !!clientId, clientId ? `(starts with ${clientId.substring(0, 4)}...)` : '(missing)');
    console.log('  Client Secret exists:', !!clientSecret, clientSecret ? '(value exists)' : '(missing)');

    if (!clientId || !clientSecret) {
      console.error('ERROR: Adobe PDF Services OAuth credentials not found in environment variables. PDF generation will fail.');
      console.error('Please set ADOBE_PDF_CLIENT_ID and ADOBE_PDF_CLIENT_SECRET environment variables.');
      return false;
    }

    // Check for proper format of clientId and clientSecret
    if (clientId.length < 10) {
      console.error('ERROR: ADOBE_PDF_CLIENT_ID appears to be invalid (too short). PDF generation will fail.');
      return false;
    }

    if (clientSecret.length < 10) {
      console.error('ERROR: ADOBE_PDF_CLIENT_SECRET appears to be invalid (too short). PDF generation will fail.');
      return false;
    }
    
    // Log that we're starting initialization
    console.log('Initializing Adobe PDF Services with OAuth credentials...');
    
    // Initialize Adobe PDF Services with the OAuth credentials
    const initialized = await adobePdfOAuthService.initialize({
      clientId: clientId.trim(),
      clientSecret: clientSecret.trim()
    });

    if (initialized) {
      console.log('Adobe PDF Services OAuth initialized successfully!');
      console.log('PDF generation will use Adobe PDF Services exclusively.');
    } else {
      console.error('CRITICAL ERROR: Failed to initialize Adobe PDF Services OAuth.');
      console.error('PDF generation will fail until this is resolved - no fallback methods are available.');
      console.error('Please check your Adobe PDF Services credentials and network connectivity.');
      console.error('IMPORTANT: The application only supports Adobe PDF Services for PDF generation.');
    }
    
    console.log('===== END ADOBE PDF SERVICES OAUTH INITIALIZATION =====');
    return initialized;
  } catch (error) {
    console.error('CRITICAL ERROR: Exception during Adobe PDF Services OAuth initialization:', error);
    if (error instanceof Error) {
      console.error('Error message:', error.message);
      console.error('Stack trace:', error.stack);
    }
    console.error('===== ADOBE PDF SERVICES OAUTH INITIALIZATION FAILED =====');
    return false;
  }
}

/**
 * Check if PDF generation services are available
 */
function isPdfServiceInitialized(req: any, res: any) {
  // Check if Adobe PDF Services OAuth is initialized and ready
  const adobeInitialized = adobePdfOAuthService.isReady();
  
  // Only Adobe PDF Services OAuth is now supported
  res.json({ 
    initialized: adobeInitialized,
    adobeInitialized,
    message: adobeInitialized 
      ? "Adobe PDF Services OAuth is available" 
      : "Adobe PDF Services OAuth is not initialized. PDF generation will not work."
  });
}

/**
 * Generate a PDF for a specific procedure
 */
async function generatePdf(req: any, res: any) {
  const requestStartTime = Date.now();
  console.log(`[PDF Generation] Starting generation process for reference: ${req.params.reference}`);
  
  try {
    // Get procedure reference from URL parameters
    const reference = decodeURIComponent(req.params.reference);
    
    if (!reference) {
      console.error('[PDF Generation] Missing procedure reference');
      return res.status(400).json({ error: 'Procedure reference is required' });
    }
    
    console.log(`[PDF Generation] Fetching data for procedure: ${reference}`);
    
    // Get procedure data
    const procedures = await storage.getProcedureByReference(reference);
    
    if (!procedures || procedures.length === 0) {
      console.error(`[PDF Generation] Procedure not found: ${reference}`);
      return res.status(404).json({ error: 'Procedure not found' });
    }
    
    const procedure = procedures[0];
    console.log(`[PDF Generation] Found procedure: ${procedure.reference} (ID: ${procedure.id})`);
    
    // Get tax data
    const tax = await storage.getTaxByProcedureReference(reference);
    console.log(`[PDF Generation] Tax data found: ${tax ? 'Yes' : 'No'}`);
    
    // Get import expenses
    const importExpenses = await storage.getImportExpensesByReference(reference);
    console.log(`[PDF Generation] Import expenses found: ${importExpenses.length}`);
    
    // Get service invoices
    const serviceInvoices = await storage.getImportServiceInvoicesByReference(reference);
    console.log(`[PDF Generation] Service invoices found: ${serviceInvoices.length}`);
    
    // Get payments
    const payments = await storage.getPaymentsByProcedureReference(reference);
    console.log(`[PDF Generation] Payments found: ${payments.length}`);
    
    // Get freight amount
    const freightAmount = procedure.freight_amount || 0;
    console.log(`[PDF Generation] Freight amount: ${freightAmount}`);
    
    // Log data preparation time
    console.log(`[PDF Generation] Data collection completed in ${Date.now() - requestStartTime}ms`);
    
    try {
      console.log('[PDF Generation] Transforming data for PDF template');
      const transformStartTime = Date.now();
      
      // Log financial details before transformation for debugging
      console.log('[PDF Generation] Financial data before transformation:');
      console.log(`  - Total import expenses: ${importExpenses.reduce((sum, expense) => sum + parseFloat(expense.amount), 0)}`);
      console.log(`  - Total service invoices: ${serviceInvoices.reduce((sum, invoice) => sum + parseFloat(invoice.amount), 0)}`);
      console.log(`  - Total taxes: ${tax ? (
        parseFloat(tax.customsTax) +
        parseFloat(tax.additionalCustomsTax) +
        parseFloat(tax.kkdf) +
        parseFloat(tax.vat) +
        parseFloat(tax.stampTax)
      ) : 0}`);
      console.log(`  - Total payments: ${payments.reduce((sum, payment) => {
        const amount = typeof payment.amount === 'string' ? parseFloat(payment.amount) : payment.amount;
        return sum + amount;
      }, 0)}`);
      
      // Transform the data for the PDF template
      console.log('[PDF Generation] Transforming data to exact format required by Adobe template');
      
      // Use our enhanced transformer to ensure proper payment status using actual data
      console.log('[PDF Generation] Using enhanced transformer with reference:', reference);
      const pdfData = await generateFixedTemplate({
        procedure: procedure,
        tax: tax,
        importExpenses: importExpenses,
        serviceInvoices: serviceInvoices,
        payments: payments,
        freightAmount: freightAmount
      });
      
      // Log the financial summary from the transformed data
      if (pdfData.financial_summary) {
        console.log('[PDF Generation] Financial summary in transformed data:');
        console.log(`  - Total expenses: ${pdfData.financial_summary.total_expenses}`);
        console.log(`  - Total payment: ${pdfData.financial_summary.total_payment}`);
        console.log(`  - Is excess payment: ${pdfData.financial_summary.is_excess_payment}`);
        console.log(`  - Excess payment: ${pdfData.financial_summary.excess_payment}`);
        console.log(`  - Remaining balance: ${pdfData.financial_summary.remaining_balance}`);
        console.log(`  - Payment status: ${pdfData.financial_summary.payment_status}`);
      }
      
      console.log(`[PDF Generation] Data transformation completed in ${Date.now() - transformStartTime}ms`);
      
      // Verify the data structure matches the template expectation
      console.log(`[PDF Generation] Verifying transformed data structure`);
      console.log(`[PDF Generation] Top-level keys: ${Object.keys(pdfData).join(', ')}`);
      console.log(`[PDF Generation] Taxes structure included: ${!!pdfData.taxes}`);
      console.log(`[PDF Generation] Import expenses structure included: ${!!pdfData.import_expenses}`);
      console.log(`[PDF Generation] Financial summary included: ${!!pdfData.financial_summary}`);
      console.log(`[PDF Generation] Import and service total included: ${!!pdfData.import_and_service_total} (value: ${pdfData.import_and_service_total})`);
      
      // Log a sample of the data to verify format
      if (process.env.NODE_ENV === 'development') {
        console.log('[PDF Generation] Data sample (first few fields):');
        console.log(` - reference: ${pdfData.reference}`);
        console.log(` - shipper: ${pdfData.shipper}`);
        console.log(` - invoice_no: ${pdfData.invoice_no}`);
        console.log(` - taxes.customs_tax: ${pdfData.taxes?.customs_tax}`);
        console.log(` - import_expenses.import_expenses_total: ${pdfData.import_expenses?.import_expenses_total}`);
      }
      
      // Buffer to hold the generated PDF
      let pdfBuffer: Buffer;
      
      // Check if Adobe PDF Services OAuth is initialized
      const adobeServiceInitialized = adobePdfOAuthService.isReady();
      console.log(`[PDF Generation] Adobe PDF Services OAuth initialized: ${adobeServiceInitialized}`);
      
      // Accept optional parameter to open in browser vs download
      const inline = req.query.inline === 'true';
      
      try {
        // Get the template path
        const templatePath = path.join(process.cwd(), 'assets', 'templates', 'procedure-report-template.docx');
        console.log(`[PDF Generation] Template path: ${templatePath}`);
        console.log(`[PDF Generation] Template exists: ${fs.existsSync(templatePath)}`);
        
        // Detailed template verification
        if (fs.existsSync(templatePath)) {
          try {
            const stats = fs.statSync(templatePath);
            console.log(`[PDF Generation] Template file details:`, {
              size: stats.size,
              created: stats.birthtime.toISOString(),
              modified: stats.mtime.toISOString(),
              isFile: stats.isFile(),
              permissions: stats.mode.toString(8).slice(-3)
            });
            
            // Read first few bytes to confirm it's really a DOCX file
            const fd = fs.openSync(templatePath, 'r');
            const buffer = Buffer.alloc(8);
            fs.readSync(fd, buffer, 0, 8, 0);
            fs.closeSync(fd);
            
            // DOCX files should begin with PK (it's a ZIP format)
            const isPKZip = buffer[0] === 0x50 && buffer[1] === 0x4B;
            console.log(`[PDF Generation] Template header check: ${isPKZip ? 'Valid DOCX/ZIP format' : 'NOT a valid DOCX format'}`);
            console.log(`[PDF Generation] First 8 bytes: ${buffer.toString('hex')}`);
            
            if (!isPKZip) {
              console.error('[PDF Generation] CRITICAL ERROR: Template is not a valid DOCX file!');
              return res.status(500).json({ 
                error: 'PDF template is not valid',
                details: 'The template file exists but is not in DOCX format required by Adobe PDF Services'
              });
            }
          } catch (statErr) {
            console.error('[PDF Generation] Error checking template details:', statErr);
          }
        } else {
          console.error('[PDF Generation] CRITICAL ERROR: Template file does not exist!');
          console.log('[PDF Generation] Checking assets directory structure:');
          
          // Check parent directories
          const assetsDir = path.join(process.cwd(), 'assets');
          const templatesDir = path.join(assetsDir, 'templates');
          
          console.log(`[PDF Generation] Assets directory exists: ${fs.existsSync(assetsDir)}`);
          console.log(`[PDF Generation] Templates directory exists: ${fs.existsSync(templatesDir)}`);
          
          // List contents of directories if they exist
          if (fs.existsSync(templatesDir)) {
            try {
              const files = fs.readdirSync(templatesDir);
              console.log(`[PDF Generation] Templates directory contents: ${files.join(', ')}`);
            } catch (readErr) {
              console.error('[PDF Generation] Error reading templates directory:', readErr);
            }
          } else if (fs.existsSync(assetsDir)) {
            try {
              const files = fs.readdirSync(assetsDir);
              console.log(`[PDF Generation] Assets directory contents: ${files.join(', ')}`);
            } catch (readErr) {
              console.error('[PDF Generation] Error reading assets directory:', readErr);
            }
          }
          
          // Return error to user
          return res.status(500).json({ 
            error: 'PDF template not found',
            details: 'The template file is missing. Please upload a template file in the settings page.'
          });
        }
        
        // Handle HTML format request (no longer supported)
        if (req.query.format === 'html') {
          console.error('[PDF Generation] HTML format requested but no longer supported');
          return res.status(400).json({ 
            error: 'HTML format no longer supported',
            details: 'The system has been updated to use only Adobe PDF Services'
          });
        }
        
        // Verify Adobe is initialized
        if (!adobeServiceInitialized) {
          console.error('[PDF Generation] CRITICAL ERROR: Adobe PDF Services not initialized');
          return res.status(500).json({ 
            error: 'Adobe PDF Services not initialized',
            details: 'The Adobe PDF Services are not properly initialized. Check credentials in environment variables.'
          });
        }
        
        // Use Adobe PDF Services
        console.log('[PDF Generation] Using Adobe PDF Services for PDF generation');
        
        const pdfStartTime = Date.now();
        try {
          // Generate PDF with Adobe PDF Services OAuth
          pdfBuffer = await adobePdfOAuthService.generatePDF({
            templatePath,
            data: pdfData
          });
          
          console.log(`[PDF Generation] Adobe PDF generation completed in ${Date.now() - pdfStartTime}ms`);
          
          // Check if the buffer is valid
          if (pdfBuffer.length > 4) {
            // Check for PDF magic number (%PDF)
            if (pdfBuffer[0] === 0x25 && pdfBuffer[1] === 0x50 && pdfBuffer[2] === 0x44 && pdfBuffer[3] === 0x46) {
              console.log('[PDF Generation] Generated buffer is a valid PDF');
            } else {
              console.warn('[PDF Generation] Warning: Generated buffer does not start with PDF header');
              console.log('[PDF Generation] First 20 bytes:', pdfBuffer.slice(0, 20).toString('hex'));
              
              // No fallback - return an error
              console.error('[PDF Generation] CRITICAL ERROR: Generated content is not a valid PDF');
              return res.status(500).json({ 
                error: 'PDF generation failed',
                details: 'Adobe PDF Services did not generate a valid PDF file. Check template format and data structure.'
              });
            }
          } else {
            console.error('[PDF Generation] CRITICAL ERROR: Adobe generated an empty or invalid buffer');
            return res.status(500).json({ 
              error: 'PDF generation failed',
              details: 'Adobe PDF Services generated an empty or invalid buffer. Check template format and data structure.'
            });
          }
        } catch (adobeError) {
          console.error('[PDF Generation] CRITICAL ERROR: Failed to generate PDF with Adobe PDF Services');
          console.error('[PDF Generation] Error details:', adobeError);
          
          // Return error to client
          return res.status(500).json({ 
            error: 'PDF generation failed',
            details: adobeError instanceof Error ? adobeError.message : 'Unknown error during PDF generation'
          });
        }
      } catch (genError) {
        console.error('[PDF Generation] CRITICAL ERROR: Error in PDF generation process:', genError);
        return res.status(500).json({ 
          error: 'PDF generation process failed', 
          details: genError instanceof Error ? genError.message : 'Unknown error in PDF generation process'
        });
      }
      
      console.log(`[PDF Generation] Total generation time: ${Date.now() - requestStartTime}ms`);
      console.log(`[PDF Generation] Buffer size: ${pdfBuffer.length} bytes`);
      console.log(`[PDF Generation] Generation method: Adobe PDF Services`);
      
      // Set content type to PDF - we only support PDF now
      const contentType = 'application/pdf';
      
      // Determine whether to display inline or as attachment
      const contentDisposition = inline 
        ? 'inline' 
        : `attachment; filename="Procedure-${reference}.pdf"`;
      
      // Set the response headers
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', contentDisposition);
      res.setHeader('Content-Length', pdfBuffer.length);
      res.setHeader('X-Generation-Method', 'adobe-pdf-services');
      res.setHeader('X-Generation-Time', `${Date.now() - requestStartTime}ms`);
      
      // Send the response
      console.log('[PDF Generation] Sending response to client');
      res.send(pdfBuffer);
      console.log('[PDF Generation] Response sent successfully');
      
    } catch (transformError) {
      console.error('[PDF Generation] Error transforming data:', transformError);
      res.status(500).json({ 
        error: 'Failed to transform procedure data', 
        message: transformError instanceof Error ? transformError.message : 'Unknown error',
        stack: transformError instanceof Error ? transformError.stack : undefined
      });
    }
  } catch (error) {
    console.error('[PDF Generation] Error generating PDF:', error);
    res.status(500).json({ 
      error: 'Failed to generate PDF', 
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });
  }
}

/**
 * Uploads a PDF template file
 */
async function uploadPdfTemplate(req: any, res: any) {
  try {
    // Check if file is provided
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    // Get the uploaded file
    const file = req.file;
    
    // Check if it's a DOCX file
    if (file.mimetype !== 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      return res.status(400).json({ error: 'Template must be a DOCX file' });
    }
    
    // Save the file to the templates directory
    const templatesDir = path.join(process.cwd(), 'assets', 'templates');
    
    // Create the directory if it doesn't exist
    if (!fs.existsSync(templatesDir)) {
      fs.mkdirSync(templatesDir, { recursive: true });
    }
    
    // Save the file as procedure-report-template.docx
    const templatePath = path.join(templatesDir, 'procedure-report-template.docx');
    fs.writeFileSync(templatePath, file.buffer);
    
    res.json({ 
      success: true, 
      message: 'PDF template uploaded successfully',
      path: templatePath
    });
  } catch (error) {
    console.error('Error uploading PDF template:', error);
    res.status(500).json({ 
      error: 'Failed to upload PDF template', 
      message: error instanceof Error ? error.message : 'Unknown error' 
    });
  }
}

export default async function registerPdfRoutes(app: Express) {
  // Initialize Adobe PDF Services when the server starts
  try {
    console.log('Starting Adobe PDF Services initialization...');
    const initialized = await initializeAdobePdfService();
    console.log('Adobe PDF Services initialization completed:', initialized ? 'Success' : 'Failed');
  } catch (error) {
    console.error('Error during Adobe PDF Services initialization:', error);
  }
  
  // Route to check if PDF service is initialized
  app.get('/api/pdf/status', isPdfServiceInitialized);
  
  // Route to generate a PDF for a specific procedure
  app.get('/api/pdf/generate/:reference', generatePdf);
  
  // NOTE: The PDF template upload route is configured in server/routes.ts
  // to properly use multer middleware for file uploads
  
  // PDF test routes have been removed as per requirements 
  // The application now uses only Adobe PDF Services with no fallback options
  
  return app;
}