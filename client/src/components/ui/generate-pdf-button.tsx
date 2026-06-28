import React, { useState } from "react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();

  const handleGetPdf = async (viewMode: 'download' | 'view') => {
    if (!procedureReference) {
      toast({
        title: t('common.error'),
        description: t('generatePdf.toast.referenceRequired'),
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
          title: t('generatePdf.toast.reportTitle'),
          description: t('generatePdf.toast.openingNewTab'),
        });
      } else {
        // For downloading, fetch and process
        const response = await fetch(url, {
          method: 'GET',
        });

        if (!response.ok) {
          let errorMessage = t('generatePdf.errors.generateFailed');
          try {
            const errorData = await response.json();
            errorMessage = errorData.message || errorMessage;
          } catch (e) {
            // If response is not JSON, use status text
            errorMessage = t('generatePdf.errors.serverError', { status: response.status, statusText: response.statusText });
          }
          throw new Error(errorMessage);
        }

        // Get the content type to validate what we received
        const contentType = response.headers.get('Content-Type');
        
        // If received content is not PDF, this is an error
        if (contentType && !contentType.includes('application/pdf')) {
          console.error('Received non-PDF content. Content type:', contentType);
          throw new Error(t('generatePdf.errors.notPdf'));
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
                  title: t('generatePdf.toast.invalidFormatTitle'),
                  description: t('generatePdf.toast.invalidFormatDesc'),
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
          title: t('generatePdf.toast.generatedTitle'),
          description: t('generatePdf.toast.generatedDesc'),
        });
      }
    } catch (error) {
      console.error('Error generating PDF:', error);
      
      // Store error details for dialog
      setErrorDetails(error instanceof Error ?
        `${error.message}\n${error.stack || ''}` :
        t('generatePdf.errors.unknown')
      );
      setShowErrorDialog(true);
      
      toast({
        title: t('generatePdf.toast.failedTitle'),
        description: t('generatePdf.toast.failedDesc'),
        variant: "destructive",
        action: (
          <Button variant="outline" size="sm" onClick={() => setShowErrorDialog(true)}>
            <AlertCircle className="h-4 w-4 mr-1" />
            {t('generatePdf.details')}
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
                {t('generatePdf.generating')}
              </>
            ) : (
              <>
                <FileText className="mr-2 h-4 w-4" />
                {t('generatePdf.generate')}
              </>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>{t('generatePdf.reportOptions')}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => handleGetPdf('view')} disabled={isGenerating}>
            <Eye className="mr-2 h-4 w-4" />
            {t('generatePdf.viewInBrowser')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleGetPdf('download')} disabled={isGenerating}>
            <Download className="mr-2 h-4 w-4" />
            {t('generatePdf.downloadFile')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={showErrorDialog} onOpenChange={setShowErrorDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('generatePdf.errorDialog.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              <p className="mb-4">
                {t('generatePdf.errorDialog.intro')}
              </p>
              <ul className="list-disc pl-6 mb-4 space-y-2">
                <li>{t('generatePdf.errorDialog.reasonMissingData')}</li>
                <li>{t('generatePdf.errorDialog.reasonServerError')}</li>
                <li>{t('generatePdf.errorDialog.reasonNetwork')}</li>
              </ul>
              {errorDetails && (
                <div className="bg-muted p-2 rounded text-sm mt-4 font-mono overflow-auto max-h-40">
                  {errorDetails}
                </div>
              )}
              <p className="mt-4">
                {t('generatePdf.errorDialog.footerNote')}
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('generatePdf.close')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => retryGeneration('download')}>
              {t('generatePdf.tryAgain')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}