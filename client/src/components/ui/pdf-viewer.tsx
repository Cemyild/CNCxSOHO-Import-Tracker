import React, { useState, useEffect } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { ChevronLeft, ChevronRight, Download, ZoomIn, ZoomOut, RotateCcw, RotateCw } from 'lucide-react';
import { Button } from './button';
import { Skeleton } from './skeleton';

// Initialize PDF.js worker
console.log('[PDFViewer] Initializing PDF.js worker. PDF.js version:', pdfjs.version);

// Configure the worker to use a CDN version with HTTPS (more browsers trust this)
pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.js`;
console.log('[PDFViewer] Worker configured to use HTTPS CDN:', pdfjs.GlobalWorkerOptions.workerSrc);

interface PDFViewerProps {
  url: string;
  filename: string;
  onDownload?: () => void;
}

export const PDFViewer: React.FC<PDFViewerProps> = ({ url, filename, onDownload }) => {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [pageNumber, setPageNumber] = useState<number>(1);
  const [scale, setScale] = useState<number>(1);
  const [rotation, setRotation] = useState<number>(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Reset state when URL changes
  useEffect(() => {
    setPageNumber(1);
    setScale(1);
    setRotation(0);
    setLoadError(null);
    setIsLoading(true);
    
    // Log URL for debugging
    console.log('Loading PDF from URL:', url);
  }, [url]);

  function onDocumentLoadSuccess({ numPages }: { numPages: number }) {
    console.log('[PDFViewer] SUCCESS: Document loaded successfully', {
      numPages,
      pageNumber: pageNumber,
      url: url
    });
    setNumPages(numPages);
    setIsLoading(false);
  }

  function onDocumentLoadError(error: Error) {
    console.error('[PDFViewer] ERROR: Document load error:', error);
    console.error('[PDFViewer] ERROR: Error stack:', error.stack);
    console.error('[PDFViewer] ERROR: Current state:', {
      url,
      isLoading,
      pageNumber,
      scale,
      rotation
    });
    
    // Set a user-friendly error message
    setLoadError(`Failed to load PDF: ${error.message}`);
    setIsLoading(false);
    
    // Additional console log with specific error details for debugging
    try {
      // Check if error is related to worker initialization
      if (error.message.includes('worker')) {
        console.error('[PDFViewer] ERROR: Worker initialization issue. Check if PDF.js worker is properly configured');
      }
      // Check if error is related to invalid PDF
      else if (error.message.includes('Invalid PDF') || error.message.includes('not a PDF file')) {
        console.error('[PDFViewer] ERROR: Invalid PDF format received from server');
      }
      // Check if error is CORS related
      else if (error.message.includes('CORS') || error.message.includes('cross-origin')) {
        console.error('[PDFViewer] ERROR: CORS issue detected. Server needs to set proper CORS headers');
      }
    } catch (analyzeError) {
      console.error('[PDFViewer] ERROR: Error while analyzing the error:', analyzeError);
    }
  }

  function changePage(offset: number) {
    if (!numPages) return;
    const newPage = Math.max(1, Math.min(pageNumber + offset, numPages));
    setPageNumber(newPage);
  }

  function previousPage() {
    changePage(-1);
  }

  function nextPage() {
    changePage(1);
  }

  function zoomIn() {
    setScale((prev) => Math.min(prev + 0.2, 3));
  }

  function zoomOut() {
    setScale((prev) => Math.max(prev - 0.2, 0.6));
  }

  function rotateClockwise() {
    setRotation((prev) => (prev + 90) % 360);
  }

  function rotateCounterClockwise() {
    setRotation((prev) => (prev - 90 + 360) % 360);
  }

  // Function to fetch and provide PDF data as Blob
  async function fetchPDF(url: string): Promise<{ data: ArrayBuffer }> {
    try {
      // Log that we're fetching the PDF
      console.log('[PDFViewer] DEBUG: Starting fetch from URL:', url);
      
      // Add cache busting parameter to avoid browser caching issues
      const fetchUrl = `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`;
      console.log('[PDFViewer] DEBUG: Using fetch URL with cache busting:', fetchUrl);
      
      console.log('[PDFViewer] DEBUG: Initiating fetch request...');
      // Fetch the PDF data WITHOUT credentials to avoid CORS preflight issues
      const response = await fetch(fetchUrl, {
        method: 'GET',
        // Removing credentials option to simplify the request
        headers: {
          'Accept': 'application/pdf, */*'
        }
      });
      
      // Log response details for debugging
      console.log('[PDFViewer] DEBUG: Fetch response received:', {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        contentType: response.headers.get('Content-Type'),
        contentLength: response.headers.get('Content-Length')
      });
      
      // Check if response is valid
      if (!response.ok) {
        console.error('[PDFViewer] ERROR: Fetch response not OK', {
          status: response.status,
          statusText: response.statusText
        });
        throw new Error(`HTTP error! status: ${response.status} ${response.statusText}`);
      }
      
      // Convert response to ArrayBuffer
      console.log('[PDFViewer] DEBUG: Reading response as ArrayBuffer...');
      const data = await response.arrayBuffer();
      
      console.log('[PDFViewer] SUCCESS: PDF data successfully fetched', {
        byteLength: data.byteLength,
        validBuffer: data.byteLength > 0,
        firstBytes: data.byteLength > 8 ? 
          new Uint8Array(data.slice(0, 8)).join(',') : 'N/A'
      });
      
      // Check for PDF magic number - %PDF- (in ASCII: 37, 80, 68, 70, 45)
      if (data.byteLength > 5) {
        const header = new Uint8Array(data.slice(0, 5));
        // Check if it starts with %PDF-
        if (header[0] === 37 && header[1] === 80 && header[2] === 68 && header[3] === 70 && header[4] === 45) {
          console.log('[PDFViewer] DEBUG: Valid PDF header detected');
        } else {
          console.warn('[PDFViewer] WARNING: PDF header not detected, response might not be a valid PDF', 
            Array.from(header).map(b => b.toString(16)).join(' '));
        }
      }
      
      // Return in the format expected by the Document component
      return { data };
    } catch (error) {
      console.error('[PDFViewer] CRITICAL ERROR in fetchPDF:', error);
      setLoadError(`Failed to fetch PDF: ${error.message}`);
      throw error;
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* PDF viewer controls */}
      <div className="flex justify-between items-center p-2 bg-gray-100 dark:bg-gray-800 rounded-t-md">
        <div className="flex items-center space-x-1">
          <Button
            variant="outline" 
            size="sm"
            onClick={previousPage}
            disabled={pageNumber <= 1}
            className="h-8 w-8 p-0"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          
          <span className="text-sm whitespace-nowrap">
            {pageNumber} / {numPages || '?'}
          </span>
          
          <Button
            variant="outline" 
            size="sm"
            onClick={nextPage}
            disabled={!numPages || pageNumber >= numPages}
            className="h-8 w-8 p-0"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        
        <div className="flex items-center space-x-1">
          <Button
            variant="outline" 
            size="sm"
            onClick={zoomOut}
            className="h-8 w-8 p-0"
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          
          <span className="text-sm whitespace-nowrap">
            {Math.round(scale * 100)}%
          </span>
          
          <Button
            variant="outline" 
            size="sm"
            onClick={zoomIn}
            className="h-8 w-8 p-0"
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
        </div>
        
        <div className="flex items-center space-x-1">
          <Button
            variant="outline" 
            size="sm"
            onClick={rotateCounterClockwise}
            className="h-8 w-8 p-0"
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
          
          <Button
            variant="outline" 
            size="sm"
            onClick={rotateClockwise}
            className="h-8 w-8 p-0"
          >
            <RotateCw className="h-4 w-4" />
          </Button>
          
          {onDownload && (
            <Button
              variant="outline" 
              size="sm"
              onClick={onDownload}
              className="h-8 px-2"
            >
              <Download className="h-4 w-4 mr-1" />
              <span className="hidden sm:inline">Download</span>
            </Button>
          )}
        </div>
      </div>
      
      {/* PDF document container */}
      <div className="flex-1 overflow-auto bg-gray-50 dark:bg-gray-900 p-4 flex justify-center">
        {loadError ? (
          <div className="flex flex-col items-center justify-center text-center p-8 max-w-md">
            <div className="text-red-500 mb-4">
              <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <h3 className="text-lg font-medium mb-2">Failed to load document</h3>
            <p className="text-sm text-muted-foreground mb-4">{loadError}</p>
            {onDownload && (
              <Button onClick={onDownload} className="mt-2">
                <Download className="h-4 w-4 mr-2" />
                Download Instead
              </Button>
            )}
          </div>
        ) : (
          <Document
            file={() => fetchPDF(url)}
            onLoadSuccess={onDocumentLoadSuccess}
            onLoadError={onDocumentLoadError}
            externalLinkTarget="_blank"
            loading={
              <div className="flex items-center justify-center w-full">
                <div className="flex flex-col items-center">
                  <Skeleton className="h-[500px] w-[400px] bg-gray-200 dark:bg-gray-700" />
                  <div className="mt-4 text-sm text-gray-500 dark:text-gray-400">Loading document...</div>
                </div>
              </div>
            }
            noData={
              <div className="flex flex-col items-center justify-center text-center p-8 max-w-md">
                <p className="text-lg font-medium mb-2">No PDF document</p>
                <p className="text-sm text-muted-foreground mb-4">
                  There was no document data found.
                </p>
              </div>
            }
            className="flex justify-center"
          >
            <Page 
              pageNumber={pageNumber} 
              scale={scale}
              rotate={rotation}
              renderTextLayer={false}
              renderAnnotationLayer={false}
              className="shadow-md bg-white"
              canvasBackground="transparent"
              loading={
                <Skeleton className="h-[500px] w-[400px] bg-gray-200 dark:bg-gray-700" />
              }
              error={
                <div className="flex flex-col items-center justify-center text-center p-8 max-w-md">
                  <p className="text-lg font-medium mb-2 text-red-500">Error rendering page</p>
                  <p className="text-sm text-muted-foreground mb-4">
                    There was a problem displaying this page of the document.
                  </p>
                </div>
              }
            />
          </Document>
        )}
      </div>
      
      {/* Page navigation footer */}
      {numPages && numPages > 1 && (
        <div className="p-2 bg-gray-100 dark:bg-gray-800 rounded-b-md flex justify-center">
          <div className="flex items-center space-x-2">
            <Button
              variant="outline" 
              size="sm"
              onClick={() => setPageNumber(1)}
              disabled={pageNumber === 1}
            >
              First
            </Button>
            
            <Button
              variant="outline" 
              size="sm"
              onClick={previousPage}
              disabled={pageNumber <= 1}
            >
              Previous
            </Button>
            
            <span className="text-sm px-2">
              Page {pageNumber} of {numPages}
            </span>
            
            <Button
              variant="outline" 
              size="sm"
              onClick={nextPage}
              disabled={pageNumber >= numPages}
            >
              Next
            </Button>
            
            <Button
              variant="outline" 
              size="sm"
              onClick={() => setPageNumber(numPages)}
              disabled={pageNumber === numPages}
            >
              Last
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};