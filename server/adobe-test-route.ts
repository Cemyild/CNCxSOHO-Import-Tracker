/**
 * Adobe PDF Test Route
 * This route provides a test endpoint to verify Adobe PDF template tag processing
 */
import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { adobePdfOAuthService } from './adobe-pdf-oauth';

const router = Router();

// Simple test data that matches our template structure
const testData = {
  title: "TEST PAYMENT REPORT",
  subtitle: "Generated for Testing Tag Replacement",
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
 * Test endpoint to verify Adobe PDF template processing
 */
router.get('/test-template', async (req, res) => {
  console.log('[ADOBE TEST] Testing simplified template with Adobe PDF Services');
  
  try {
    // Check if Adobe PDF services are initialized
    if (!adobePdfOAuthService.isReady()) {
      console.error('[ADOBE TEST] Adobe PDF Services not initialized');
      return res.status(500).json({
        error: 'PDF service not initialized',
        details: 'The Adobe PDF Services are not properly initialized.'
      });
    }
    
    // Get template path - using the simple-payment-report.docx template
    const templatePath = path.join(process.cwd(), 'assets', 'templates', 'simple-payment-report.docx');
    
    if (!fs.existsSync(templatePath)) {
      console.error(`[ADOBE TEST] Template not found: ${templatePath}`);
      return res.status(500).json({
        error: 'Template file not found',
        details: `The template file was not found: ${templatePath}`
      });
    }
    
    console.log(`[ADOBE TEST] Using template: ${templatePath}`);
    console.log('[ADOBE TEST] Test data:', JSON.stringify(testData, null, 2));
    
    // Generate the PDF using Adobe PDF Services
    const pdfBuffer = await adobePdfOAuthService.generatePDF({
      templatePath,
      data: testData
    });
    
    if (!pdfBuffer) {
      console.error('[ADOBE TEST] Failed to generate PDF');
      return res.status(500).json({
        error: 'PDF generation failed',
        details: 'Failed to generate the test PDF'
      });
    }
    
    // Generate the filename
    const filename = `Test_Template_PDF_${Date.now()}.pdf`;
    
    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    
    // Send the PDF
    res.end(pdfBuffer);
    console.log('[ADOBE TEST] Test PDF generated and sent successfully');
    
  } catch (error) {
    console.error('[ADOBE TEST] Error in test endpoint:', error);
    res.status(500).json({
      error: 'PDF generation test failed',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

export default router;