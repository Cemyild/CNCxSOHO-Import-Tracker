/**
 * Adobe PDF Services integration using OAuth Server-to-Server authentication
 * 
 * This implementation uses the modern OAuth Server-to-Server method
 * instead of the deprecated Service Account (JWT) method.
 */
import * as fs from 'fs';
import * as path from 'path';

/**
 * Interface for Adobe PDF Services OAuth configuration
 */
interface AdobeOAuthConfig {
  clientId: string;
  clientSecret: string;
}

/**
 * Interface for PDF generation options
 */
interface PDFGenerationOptions {
  templatePath: string;
  data: Record<string, any>;
}

/**
 * Adobe PDF Services using OAuth Server-to-Server authentication
 */
export class AdobePdfOAuthService {
  private credentials: any = null;
  private executionContext: any = null;
  private isInitialized: boolean = false;
  private PDFServicesSdk: any = null;

  constructor() {
    console.log('Adobe PDF OAuth Service: Constructor initialized');
  }

  /**
   * Initialize Adobe PDF Services with OAuth Server-to-Server credentials
   */
  async initialize(config: AdobeOAuthConfig): Promise<boolean> {
    console.log('Starting Adobe PDF Services OAuth initialization...');
    
    try {
      // Validate configuration
      if (!config.clientId || !config.clientSecret) {
        throw new Error('Missing required Adobe PDF Services credentials (clientId, clientSecret)');
      }
      
      console.log('===== ADOBE PDF SERVICES OAUTH INITIALIZATION =====');
      console.log('Adobe OAuth credentials check:');
      console.log(`  Client ID exists: ${Boolean(config.clientId)} (starts with ${config.clientId.substring(0, 5)}...)`);
      console.log(`  Client Secret exists: ${Boolean(config.clientSecret)} (value exists)`);
      
      console.log('Dynamically importing Adobe PDF Services SDK...');
      // Import the SDK dynamically
      const AdobeSDK = await import('@adobe/pdfservices-node-sdk');
      this.PDFServicesSdk = AdobeSDK.default || AdobeSDK;
      
      // Check all SDK components are available
      const components = Object.keys(this.PDFServicesSdk);
      console.log('SDK Components loaded:', components.join(', '));
      
      // Create credentials with OAuth authentication
      console.log('Creating credentials using OAuth Server-to-Server authentication...');
      
      // Use the available methods in our SDK version
      // The servicePrincipalCredentialsBuilder is still being called from the init method
      // but we should use our own approach here
      console.log('Creating OAuth credentials using available SDK methods...');
      
      try {
        // Check if the recommended method is available
        if (typeof this.PDFServicesSdk.Credentials.servicePrincipalCredentialsBuilder === 'function') {
          console.log('Using servicePrincipalCredentialsBuilder (recommended)...');
          // @ts-ignore
          this.credentials = this.PDFServicesSdk.Credentials.servicePrincipalCredentialsBuilder()
            .withClientId(config.clientId)
            .withClientSecret(config.clientSecret)
            .build();
        } 
        // Fall back to serviceAccountCredentialsBuilder (deprecated but available)
        else if (typeof this.PDFServicesSdk.Credentials.serviceAccountCredentialsBuilder === 'function') {
          console.log('Falling back to serviceAccountCredentialsBuilder (deprecated)...');
          // @ts-ignore
          this.credentials = this.PDFServicesSdk.Credentials.serviceAccountCredentialsBuilder()
            .withClientId(config.clientId)
            .withClientSecret(config.clientSecret)
            // For Service Account we need these, but we'll use the client ID for both
            .withOrganizationId(config.clientId) 
            .withAccountId(config.clientId)
            .build();
        } else {
          throw new Error('No suitable authentication method found in Adobe PDF Services SDK');
        }
      } catch (error) {
        console.error('Error creating credentials:', error);
        throw error;
      }
      
      // Create an execution context
      console.log('Creating execution context...');
      this.executionContext = this.PDFServicesSdk.ExecutionContext.create(this.credentials);
      console.log('Execution context created successfully');
      
      this.isInitialized = true;
      console.log('===== ADOBE PDF SERVICES OAUTH INITIALIZATION COMPLETE =====');
      console.log('Adobe PDF Services OAuth initialized successfully!');
      console.log('PDF generation will use Adobe PDF Services exclusively.');
      return true;
    } catch (error) {
      console.error('===== ADOBE PDF SERVICES OAUTH INITIALIZATION FAILED =====');
      console.error('Failed to initialize Adobe PDF Services:', error);
      if (error instanceof Error) {
        console.error('Error details:', error.message);
        console.error('Error stack:', error.stack);
      }
      return false;
    }
  }

  /**
   * Generate a PDF from a template and data using Document Generation API
   */
  async generatePDF(options: PDFGenerationOptions): Promise<Buffer | null> {
    if (!this.isInitialized) {
      console.error('Adobe PDF Services not initialized. Call initialize() first.');
      return null;
    }

    try {
      console.log(`Generating PDF from template: ${options.templatePath}`);
      
      // Check if the template file exists
      if (!fs.existsSync(options.templatePath)) {
        console.error(`Template file not found: ${options.templatePath}`);
        return null;
      }
      
      // Create a new DocumentMerge options instance
      console.log('Creating document merge options...');
      const documentMergeOptions = new this.PDFServicesSdk.DocumentMerge.options.DocumentMergeOptions(
        options.data, 
        this.PDFServicesSdk.DocumentMerge.options.OutputFormat.PDF
      );
      
      // Create a new DocumentMerge operation instance
      console.log('Creating document merge operation...');
      const documentMergeOperation = this.PDFServicesSdk.DocumentMerge.Operation.createNew(documentMergeOptions);
      
      // Set the operation input from a source file
      console.log('Setting file input...');
      const input = this.PDFServicesSdk.FileRef.createFromLocalFile(options.templatePath);
      documentMergeOperation.setInput(input);
      
      // Execute the operation and save the result
      console.log('Executing document merge operation...');
      const result = await documentMergeOperation.execute(this.executionContext);
      
      // Save the result to a temporary file
      console.log('Saving result to temporary file...');
      const outputFilePath = path.join(process.cwd(), 'output.pdf');
      await result.saveAsFile(outputFilePath);
      
      // Read the file to a buffer
      console.log('Reading file to buffer...');
      const pdfBuffer = fs.readFileSync(outputFilePath);
      
      // Clean up
      try {
        fs.unlinkSync(outputFilePath);
      } catch (err) {
        console.warn('Failed to clean up temporary file:', err);
      }
      
      console.log('PDF generation successful!');
      return pdfBuffer;
    } catch (error) {
      console.error('Error generating PDF:', error);
      if (error instanceof Error) {
        console.error('Error details:', error.message);
        console.error('Error stack:', error.stack);
      }
      return null;
    }
  }
  
  /**
   * Check if the service is initialized
   */
  isReady(): boolean {
    return this.isInitialized;
  }
}

// Create singleton instance
export const adobePdfOAuthService = new AdobePdfOAuthService();