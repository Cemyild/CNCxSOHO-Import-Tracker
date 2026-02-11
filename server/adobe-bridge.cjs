/**
 * CommonJS Bridge for Adobe PDF Services
 * This file provides compatibility between the CommonJS-style Adobe SDK
 * and our ES Modules environment.
 */

// Use require() for CommonJS modules
const PDFServicesSdk = require('@adobe/pdfservices-node-sdk');

// Export all components
module.exports = {
  PDFServicesSdk,
  DocumentMerge: PDFServicesSdk.DocumentMerge,
  FileRef: PDFServicesSdk.FileRef,
  Credentials: PDFServicesSdk.Credentials,
  ServicePrincipalCredentials: PDFServicesSdk.ServicePrincipalCredentials,
  ExecutionContext: PDFServicesSdk.ExecutionContext
};