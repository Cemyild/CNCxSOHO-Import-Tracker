import React from 'react';
import { Download } from 'lucide-react';
import { Button } from './button';

interface IFramePDFViewerProps {
  url: string;
  filename: string;
  onDownload?: () => void;
}

export const IFramePDFViewer: React.FC<IFramePDFViewerProps> = ({ 
  url, 
  filename,
  onDownload 
}) => {
  // Add a timestamp to the URL to prevent caching
  const timestampedUrl = `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`;
  
  return (
    <div className="flex flex-col h-full rounded-md overflow-hidden border border-gray-200 dark:border-gray-700">
      {/* PDF viewer header with download button */}
      <div className="flex justify-between items-center p-2 bg-gray-100 dark:bg-gray-800">
        <span className="font-medium text-sm truncate max-w-[calc(100%-100px)]" title={filename}>
          {filename}
        </span>
        
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
      
      {/* PDF document container using iframe */}
      <div className="flex-1 bg-gray-50 dark:bg-gray-900 min-h-[500px]">
        <iframe 
          src={timestampedUrl}
          title={`PDF Preview: ${filename}`}
          className="w-full h-full min-h-[500px] border-0" 
          sandbox="allow-scripts allow-same-origin"
        />
      </div>
    </div>
  );
};