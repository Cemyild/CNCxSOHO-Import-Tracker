import React, { useState, useEffect } from 'react';
import { Download } from 'lucide-react';
import { Button } from './button';
import { Skeleton } from './skeleton';

interface TextViewerProps {
  url: string;
  filename: string;
  onDownload?: () => void;
}

export const TextViewer: React.FC<TextViewerProps> = ({ url, filename, onDownload }) => {
  const [content, setContent] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchTextContent = async () => {
      setIsLoading(true);
      setError(null);
      
      try {
        // Add cache busting parameter
        const fetchUrl = `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`;
        console.log('Fetching text content from:', fetchUrl);
        
        const response = await fetch(fetchUrl, {
          method: 'GET',
          credentials: 'same-origin',
          headers: {
            'Accept': 'text/plain,text/html,application/json,*/*',
            'Cache-Control': 'no-cache'
          }
        });
        
        if (!response.ok) {
          throw new Error(`Failed to fetch text: ${response.status} ${response.statusText}`);
        }
        
        const text = await response.text();
        console.log('Text content fetched successfully, length:', text.length);
        setContent(text);
        setIsLoading(false);
      } catch (err) {
        console.error('Error fetching text content:', err);
        setError(err instanceof Error ? err.message : 'Unknown error occurred');
        setIsLoading(false);
      }
    };

    fetchTextContent();
  }, [url]);

  return (
    <div className="flex flex-col h-full">
      {/* Text viewer header */}
      <div className="flex justify-between items-center p-2 bg-gray-100 dark:bg-gray-800 rounded-t-md">
        <div className="flex-1">
          <h3 className="text-sm font-medium truncate">{filename}</h3>
        </div>
        
        {onDownload && (
          <Button
            variant="outline" 
            size="sm"
            onClick={onDownload}
            className="h-8 px-2 ml-2"
          >
            <Download className="h-4 w-4 mr-1" />
            <span className="hidden sm:inline">Download</span>
          </Button>
        )}
      </div>
      
      {/* Text content container */}
      <div className="flex-1 overflow-auto bg-white dark:bg-gray-950 p-4 border rounded-b-md">
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-4/6" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center text-center p-8 max-w-md mx-auto">
            <div className="text-red-500 mb-4">
              <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <h3 className="text-lg font-medium mb-2">Failed to load content</h3>
            <p className="text-sm text-muted-foreground mb-4">{error}</p>
            {onDownload && (
              <Button onClick={onDownload} className="mt-2">
                <Download className="h-4 w-4 mr-2" />
                Download Instead
              </Button>
            )}
          </div>
        ) : (
          <pre className="whitespace-pre-wrap break-words text-sm font-mono">
            {content}
          </pre>
        )}
      </div>
    </div>
  );
};