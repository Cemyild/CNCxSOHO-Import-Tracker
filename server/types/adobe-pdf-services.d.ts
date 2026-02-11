// Type definitions for Adobe PDF Services Node.js SDK
declare module '@adobe/pdfservices-node-sdk' {
  export namespace Credentials {
    function serviceAccountCredentialsBuilder(): {
      withClientId(clientId: string): any;
      withClientSecret(clientSecret: string): any;
      withPrivateKey(privateKey: string): any;
      build(): any;
    };
  }

  export namespace ClientConfig {
    function clientConfigBuilder(): {
      withConnectTimeout(timeout: number): any;
      build(): any;
    };
  }

  export namespace ExecutionContext {
    function create(credentials: any, clientConfig?: any): any;
  }

  export namespace FileRef {
    function createFromLocalFile(filePath: string): any;
  }

  export namespace DocumentMerge {
    namespace options {
      class DocumentMergeOptions {
        constructor(jsonDataForMerge: Record<string, any>, outputFormat: string);
      }
      const OutputFormat: {
        PDF: string;
      };
    }

    namespace Operation {
      function createNew(options: any): {
        setInput(inputRef: any): void;
        execute(executionContext: any): Promise<any>;
      };
    }

    const SupportedSourceFormat: {
      DOCX: string;
    };
  }

  export namespace PDFServices {
    function init(credentials: any): void;
  }
}