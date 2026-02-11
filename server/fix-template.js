/**
 * Script to generate a properly tagged Adobe PDF Services template
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Define the template content with proper Adobe Document Generation tags
const templateContent = `
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; padding: 20px; }
    h1 { text-align: center; color: #333; }
    h2 { margin-top: 20px; color: #555; }
    .summary { margin: 15px 0; padding: 10px; background-color: #f5f5f5; }
    .item { margin-bottom: 10px; padding: 10px; border-bottom: 1px solid #ddd; }
  </style>
</head>
<body>
  <h1>{{title}}</h1>
  <p>{{subtitle}}</p>
  
  <div class="summary">
    <h2>Payment Summary</h2>
    <p>Total Payments Received: {{summary.total_payments_received}}</p>
    <p>Total Distributed: {{summary.total_distributed}}</p>
    <p>Pending Distribution: {{summary.total_pending_distribution}}</p>
    <p>Procedures with Distributions: {{summary.procedures_with_distributions}}</p>
  </div>
  
  <h2>Payment List</h2>
  {{#each payments}}
  <div class="item">
    <p><strong>Payment ID:</strong> {{id}}</p>
    <p><strong>Date:</strong> {{date}}</p>
    <p><strong>Amount:</strong> {{amount}}</p>
    <p><strong>Status:</strong> {{status}}</p>
  </div>
  {{/each}}
</body>
</html>
`;

// Save as HTML file for reference
const htmlPath = path.join(__dirname, '..', 'tmp', 'payment-template-reference.html');
fs.writeFileSync(htmlPath, templateContent);

console.log('Template reference saved to:', htmlPath);
console.log('\nIMPORTANT INSTRUCTIONS:');
console.log('------------------------');
console.log('1. Create a new Word document and copy/paste this HTML content');
console.log('2. Format as needed in Word while preserving all the template tags');
console.log('3. Save as a .docx file and upload to assets/templates/payment-report-template.docx');
console.log('4. Restart the application and test the PDF generation');