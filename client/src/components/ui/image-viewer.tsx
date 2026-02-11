import React, { useState, useEffect } from 'react';
import { ZoomIn, ZoomOut, RotateCcw, RotateCw, Download } from 'lucide-react';
import { Button } from './button';
import { Skeleton } from './skeleton';

interface ImageViewerProps {
  url: string;
  alt: string;
  onDownload?: () => void;
}

export const ImageViewer: React.FC<ImageViewerProps> = ({ url, alt, onDownload }) => {
  const [scale, setScale] = useState<number>(1);
  const [rotation, setRotation] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Reset state when URL changes
  useEffect(() => {
    setScale(1);
    setRotation(0);
    setIsLoading(true);
    setError(null);
    
    // Log URL for debugging
    console.log('Loading image from URL:', url);
  }, [url]);

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

  const handleImageLoad = () => {
    setIsLoading(false);
    console.log('Image loaded successfully');
  };

  const handleImageError = (e: React.SyntheticEvent<HTMLImageElement, Event>) => {
    console.error('Error loading image:', e);
    setIsLoading(false);
    setError('Failed to load image. The image might be corrupted or inaccessible.');
  };

  return (
    <div className="flex flex-col h-full">
      {/* Image viewer controls */}
      <div className="flex justify-between items-center p-2 bg-gray-100 dark:bg-gray-800 rounded-t-md">
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
      
      {/* Image container */}
      <div className="flex-1 overflow-auto bg-gray-50 dark:bg-gray-900 p-4 flex justify-center items-center">
        {error ? (
          <div className="flex flex-col items-center justify-center text-center p-8 max-w-md">
            <div className="text-red-500 mb-4">
              <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <h3 className="text-lg font-medium mb-2">Failed to load image</h3>
            <p className="text-sm text-muted-foreground mb-4">{error}</p>
            {onDownload && (
              <Button onClick={onDownload} className="mt-2">
                <Download className="h-4 w-4 mr-2" />
                Download Instead
              </Button>
            )}
          </div>
        ) : (
          <>
            {isLoading && (
              <Skeleton className="h-[500px] w-[400px] bg-gray-200 dark:bg-gray-700" />
            )}
            <img
              src={`${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`} // Add cache busting
              alt={alt}
              style={{
                transform: `scale(${scale}) rotate(${rotation}deg)`,
                display: isLoading ? 'none' : 'block',
                maxHeight: '100%',
                maxWidth: '100%',
                transition: 'transform 0.3s ease'
              }}
              className="object-contain shadow-lg rounded"
              onLoad={handleImageLoad}
              onError={handleImageError}
              crossOrigin="anonymous"
            />
          </>
        )}
      </div>
    </div>
  );
};