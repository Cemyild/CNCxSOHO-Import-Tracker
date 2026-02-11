import React, { useState, useEffect } from 'react';
import { FileText, Download } from 'lucide-react';
import { PDFViewer } from './pdf-viewer';
import { IFramePDFViewer } from './iframe-pdf-viewer';
import { ImageViewer } from './image-viewer';
import { TextViewer } from './text-viewer';
import { Button } from './button';
import { Skeleton } from './skeleton';

// This type corresponds to the Document type in procedure-details.tsx
interface Document {
  id: number;
  expenseType: string;
  expenseId: number;
  originalFilename: string;
  storedFilename: string | null;
  filePath: string | null;
  fileSize: number;
  fileType: string;
  uploadedBy: number;
  procedureReference: string;
  createdAt: string;
  updatedAt: string;
  objectKey?: string;
  importDocumentType?: string;
}

interface DocumentViewerProps {
  document: Document | null;
  onDownload?: () => void;
}

export const DocumentViewer: React.FC<DocumentViewerProps> = ({ document, onDownload }) => {
  const [documentUrl, setDocumentUrl] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    if (document) {
      setIsLoading(true);
      
      // Determine the document URL based on storage method
      let url = '';
      if (document.objectKey) {
        // Use Replit Object Storage path
        url = `/api/expense-documents/file/${encodeURIComponent(document.objectKey)}?preview=true`;
      } else if (document.storedFilename) {
        // Fallback for legacy documents
        url = `/api/expense-documents/${document.id}/download?preview=true`;
      }
      
      console.log('[DocumentViewer] Setting document URL:', url);
      console.log('[DocumentViewer] Document metadata:', {
        id: document.id,
        filename: document.originalFilename,
        fileType: document.fileType,
        fileSize: document.fileSize,
        storageType: document.objectKey ? 'ObjectStorage' : 'Legacy'
      });
      
      // Diagnostic: test if the URL is accessible via a simple fetch
      fetch(url, { 
        method: 'HEAD',
        headers: { 'Accept': '*/*' }
      })
        .then(response => {
          console.log('[DocumentViewer] Diagnostic: URL check result:', {
            url,
            status: response.status,
            ok: response.ok,
            contentType: response.headers.get('Content-Type'),
            contentLength: response.headers.get('Content-Length')
          });
        })
        .catch(error => {
          console.error('[DocumentViewer] Diagnostic: URL check failed:', error);
        });
      
      setDocumentUrl(url);
      setIsLoading(false);
    } else {
      setDocumentUrl('');
      setIsLoading(false);
    }
  }, [document]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center">
          <Skeleton className="h-[500px] w-[400px] bg-gray-200 dark:bg-gray-700" />
          <div className="mt-4 text-sm text-gray-500 dark:text-gray-400">Loading document viewer...</div>
        </div>
      </div>
    );
  }

  if (!document) {
    return (
      <div className="flex flex-col items-center justify-center text-center p-8 max-w-md">
        <FileText className="h-16 w-16 text-gray-400 mx-auto mb-4" />
        <p className="text-lg font-medium mb-2">No document selected</p>
        <p className="text-sm text-muted-foreground">
          Please select a document to preview.
        </p>
      </div>
    );
  }

  if (!documentUrl) {
    return (
      <div className="flex flex-col items-center justify-center text-center p-8 max-w-md">
        <FileText className="h-16 w-16 text-gray-400 mx-auto mb-4" />
        <p className="text-lg font-medium mb-2">Document unavailable</p>
        <p className="text-sm text-muted-foreground mb-4">
          The document could not be found or accessed.
        </p>
        {onDownload && (
          <Button onClick={onDownload} className="mt-2">
            <Download className="h-4 w-4 mr-2" />
            Try Download
          </Button>
        )}
      </div>
    );
  }

  // Choose the appropriate viewer based on file type
  if (document.fileType.includes('pdf')) {
    // Use IFramePDFViewer as our standard PDF viewer
    return (
      <IFramePDFViewer
        url={documentUrl}
        filename={document.originalFilename}
        onDownload={onDownload}
      />
    );
  } else if (document.fileType.includes('image')) {
    return (
      <ImageViewer
        url={documentUrl}
        alt={document.originalFilename}
        onDownload={onDownload}
      />
    );
  } else if (
    document.fileType.includes('text') || 
    document.fileType.includes('json') || 
    document.fileType.includes('xml') ||
    document.fileType.includes('javascript') ||
    document.fileType.includes('html')
  ) {
    return (
      <TextViewer
        url={documentUrl}
        filename={document.originalFilename}
        onDownload={onDownload}
      />
    );
  } else {
    // Unsupported file type
    return (
      <div className="flex flex-col items-center justify-center text-center p-8 max-w-md">
        <FileText className="h-16 w-16 text-gray-400 mx-auto mb-4" />
        <p className="text-lg font-medium mb-2">File type not supported for preview</p>
        <p className="text-sm text-muted-foreground mb-4">
          {document.fileType.includes('excel') || document.fileType.includes('spreadsheet') ? (
            "Excel spreadsheets require specialized software to view."
          ) : document.fileType.includes('word') || document.fileType.includes('document') ? (
            "Word documents require specialized software to view."
          ) : (
            `The file type "${document.fileType}" cannot be previewed in the browser.`
          )}
        </p>
        {onDownload && (
          <Button onClick={onDownload} className="mt-2">
            <Download className="h-4 w-4 mr-2" />
            Download to View
          </Button>
        )}
      </div>
    );
  }
};