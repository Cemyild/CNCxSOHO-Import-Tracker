import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { FileText, Loader2, Eye, Download, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface GeneratePdfButtonProps {
  procedureReference: string;
  disabled?: boolean;
  variant?: "default" | "outline" | "secondary" | "destructive" | "ghost" | "link";
  size?: "default" | "sm" | "lg" | "icon";
}

export function GeneratePdfButton({ 
  procedureReference,
  disabled = false,
  variant = "outline",
  size = "default"
}: GeneratePdfButtonProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [showErrorDialog, setShowErrorDialog] = useState(false);
  const [errorDetails, setErrorDetails] = useState<string | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const { toast } = useToast();

  const handleGetPdf = async (viewMode: 'download' | 'view') => {
    if (!procedureReference) {
      toast({
        title: "Error",
        description: "Procedure reference is required",
        variant: "destructive",
      });
      return;
    }

    setIsGenerating(true);

    try {
      // Build URL for the new jsPDF endpoint
      let url = `/api/procedures/${encodeURIComponent(procedureReference)}/export/pdf`;
      
      // Add inline parameter for view mode
      if (viewMode === 'view') {
        url += '?inline=true';
      }

      if (viewMode === 'view') {
        // For viewing, open in a new tab with inline display
        window.open(url, '_blank');
        
        toast({
          title: "PDF Report",
          description: "Your PDF report is opening in a new tab.",
        });
      } else {
        // For downloading, fetch and process
        const response = await fetch(url, {
          method: 'GET',
        });

        if (!response.ok) {
          let errorMessage = 'Failed to generate PDF';
          try {
            const errorData = await response.json();
            errorMessage = errorData.message || errorMessage;
          } catch (e) {
            // If response is not JSON, use status text
            errorMessage = `Server error: ${response.status} ${response.statusText}`;
          }
          throw new Error(errorMessage);
        }

        // Get the content type to validate what we received
        const contentType = response.headers.get('Content-Type');
        
        // If received content is not PDF, this is an error
        if (contentType && !contentType.includes('application/pdf')) {
          console.error('Received non-PDF content. Content type:', contentType);
          throw new Error('The server did not return a PDF document. The service may not be functioning correctly.');
        }

        // Get the PDF blob from the response
        const blob = await response.blob();
        
        // Verify the blob type and first bytes to ensure it's really a PDF
        if (blob.type !== 'application/pdf' && blob.size > 4) {
          // Check first few bytes using FileReader
          const reader = new FileReader();
          reader.onload = function(e) {
            if (e.target?.result) {
              const arr = new Uint8Array(e.target.result as ArrayBuffer);
              // Check for PDF signature %PDF
              if (arr[0] !== 0x25 || arr[1] !== 0x50 || arr[2] !== 0x44 || arr[3] !== 0x46) {
                console.warn('File does not have PDF signature bytes.');
                toast({
                  title: "Invalid PDF Format",
                  description: "The generated file does not appear to be a valid PDF. It may be corrupted.",
                  variant: "destructive",
                });
                return;
              }
            }
          };
          reader.readAsArrayBuffer(blob.slice(0, 4));
        }
        
        // Create a URL for the blob
        const blobUrl = window.URL.createObjectURL(blob);
        
        // Create a temporary link element to trigger the download
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = `Procedure-${procedureReference}.pdf`;
        document.body.appendChild(a);
        a.click();
        
        // Clean up
        window.URL.revokeObjectURL(blobUrl);
        document.body.removeChild(a);
        
        toast({
          title: "PDF Generated",
          description: "The PDF report has been generated and downloaded successfully.",
        });
      }
    } catch (error) {
      console.error('Error generating PDF:', error);
      
      // Store error details for dialog
      setErrorDetails(error instanceof Error ? 
        `${error.message}\n${error.stack || ''}` : 
        "An unknown error occurred"
      );
      setShowErrorDialog(true);
      
      toast({
        title: "PDF Generation Failed",
        description: "There was an error generating the PDF. See details for more information.",
        variant: "destructive",
        action: (
          <Button variant="outline" size="sm" onClick={() => setShowErrorDialog(true)}>
            <AlertCircle className="h-4 w-4 mr-1" />
            Details
          </Button>
        ),
      });
    } finally {
      setIsGenerating(false);
      setShowDropdown(false);
    }
  };

  const retryGeneration = (mode: 'download' | 'view') => {
    setShowErrorDialog(false);
    setTimeout(() => handleGetPdf(mode), 100);
  };

  return (
    <>
      <DropdownMenu open={showDropdown} onOpenChange={setShowDropdown}>
        <DropdownMenuTrigger asChild>
          <Button
            onClick={() => setShowDropdown(true)}
            disabled={disabled || isGenerating}
            variant={variant}
            size={size}
          >
            {isGenerating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <FileText className="mr-2 h-4 w-4" />
                Generate PDF
              </>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>PDF Report Options</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => handleGetPdf('view')} disabled={isGenerating}>
            <Eye className="mr-2 h-4 w-4" />
            View in Browser
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleGetPdf('download')} disabled={isGenerating}>
            <Download className="mr-2 h-4 w-4" />
            Download File
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={showErrorDialog} onOpenChange={setShowErrorDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>PDF Generation Error</AlertDialogTitle>
            <AlertDialogDescription>
              <p className="mb-4">
                There was a problem generating your PDF report. This may be due to:
              </p>
              <ul className="list-disc pl-6 mb-4 space-y-2">
                <li>Missing procedure data</li>
                <li>Server error during PDF generation</li>
                <li>Network connectivity problem</li>
              </ul>
              {errorDetails && (
                <div className="bg-muted p-2 rounded text-sm mt-4 font-mono overflow-auto max-h-40">
                  {errorDetails}
                </div>
              )}
              <p className="mt-4">
                The PDF is generated using jsPDF. If the problem persists, please try again or contact support.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Close</AlertDialogCancel>
            <AlertDialogAction onClick={() => retryGeneration('download')}>
              Try Again
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}