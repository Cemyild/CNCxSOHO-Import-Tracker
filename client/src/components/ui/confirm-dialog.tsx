import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './button';

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  isLoading?: boolean;
}

// Create a portal-based confirmation dialog that renders directly in the document body
// to avoid nesting and z-index issues
export function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  isLoading = false
}: ConfirmDialogProps) {
  // Handle ESC key press to close
  useEffect(() => {
    if (!isOpen) return;
    
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('keydown', handleEsc);
    };
  }, [isOpen, onClose]);

  // Prevent scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);
  
  if (!isOpen) return null;
  
  // The content to be portaled
  const content = (
    <div 
      className="fixed inset-0 overflow-hidden" 
      style={{ 
        zIndex: 100000,
        backdropFilter: 'blur(2px)',
      }}
    >
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/50" 
        onClick={onClose}
        style={{ zIndex: -1 }}
      />
      
      {/* Dialog container */}
      <div className="flex min-h-screen items-center justify-center p-4">
        <div 
          className="bg-background rounded-lg max-w-md w-full shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Dialog content */}
          <div className="p-6">
            <h3 className="text-lg font-bold mb-2">{title}</h3>
            <p className="text-muted-foreground mb-6">{message}</p>
            
            <div className="flex justify-end space-x-2">
              <Button
                variant="outline"
                onClick={onClose}
                disabled={isLoading}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={(e) => {
                  e.stopPropagation();
                  console.log('Confirm Delete button clicked in dialog');
                  if (typeof onConfirm === 'function') {
                    onConfirm();
                  } else {
                    console.error('onConfirm is not a function:', onConfirm);
                  }
                }}
                disabled={isLoading}
              >
                {isLoading ? (
                  <div className="flex items-center justify-center">
                    <span className="h-4 w-4 mr-2 animate-spin rounded-full border-2 border-white border-t-transparent"></span>
                    Deleting...
                  </div>
                ) : (
                  'Delete'
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
  
  // Portal the dialog to the document body
  return createPortal(content, document.body);
}