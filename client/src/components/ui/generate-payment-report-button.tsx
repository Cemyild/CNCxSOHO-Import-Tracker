import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { 
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { 
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { FileText, Download, Eye, Loader2, FileDown } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

type GeneratePaymentReportButtonProps = {
  variant?: 'default' | 'outline' | 'secondary';
  size?: 'default' | 'sm' | 'lg';
  disabled?: boolean;
};

export function GeneratePaymentReportButton({ 
  variant = 'default', 
  size = 'default',
  disabled = false 
}: GeneratePaymentReportButtonProps) {
  const [showDropdown, setShowDropdown] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showErrorDialog, setShowErrorDialog] = useState(false);
  const [errorDetails, setErrorDetails] = useState<string | null>(null);
  
  const { toast } = useToast();
  
  // No longer need PDF generation methods as we're using Excel reports exclusively
  
  return (
    <>
      <DropdownMenu open={showDropdown} onOpenChange={setShowDropdown}>
        <DropdownMenuTrigger asChild>
          <Button
            onClick={() => setShowDropdown(true)}
            disabled={disabled || isGenerating}
            variant={variant}
            size={size}
            className="ml-2"
          >
            {isGenerating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <FileText className="mr-2 h-4 w-4" />
                Payment Report
              </>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Report Options</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem 
            onClick={() => {
              window.open('/api/direct-report/html-report', '_blank');
              toast({
                title: 'Success',
                description: 'Report opened in new tab.',
              });
            }} 
            disabled={isGenerating}
          >
            <Eye className="mr-2 h-4 w-4" />
            View in Browser
          </DropdownMenuItem>
          
          <DropdownMenuSeparator />
          
          <DropdownMenuLabel>Excel Downloads</DropdownMenuLabel>
          <DropdownMenuSeparator />
          
          <DropdownMenuItem 
            onClick={() => {
              setIsGenerating(true);
              window.open('/api/template-excel-report/download', '_blank');
              toast({
                title: 'Success',
                description: 'Excel report download started.',
              });
              setTimeout(() => setIsGenerating(false), 1000);
            }} 
            disabled={isGenerating}
          >
            <FileDown className="mr-2 h-4 w-4" />
            Excel Report
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      
      <AlertDialog open={showErrorDialog} onOpenChange={setShowErrorDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excel Report Generation Error</AlertDialogTitle>
            <AlertDialogDescription>
              <p className="mb-4">
                There was a problem generating your Excel report. This may be due to:
              </p>
              <ul className="list-disc pl-6 mb-4 space-y-2">
                <li>Missing payment data</li>
                <li>Server processing error</li>
                <li>Network connectivity problem</li>
              </ul>
              {errorDetails && (
                <div className="bg-muted p-2 rounded text-sm mt-4 font-mono overflow-auto max-h-40">
                  {errorDetails}
                </div>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Close</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}