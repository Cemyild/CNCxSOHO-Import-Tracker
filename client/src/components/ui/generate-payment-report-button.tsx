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
import { useTranslation } from 'react-i18next';

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
  const { t } = useTranslation();

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
                {t('payments.report.generating')}
              </>
            ) : (
              <>
                <FileText className="mr-2 h-4 w-4" />
                {t('payments.report.paymentReport')}
              </>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>{t('payments.report.reportOptions')}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => {
              window.open('/api/direct-report/html-report', '_blank');
              toast({
                title: t('payments.toast.success'),
                description: t('payments.report.reportOpenedTab'),
              });
            }}
            disabled={isGenerating}
          >
            <Eye className="mr-2 h-4 w-4" />
            {t('payments.report.viewInBrowser')}
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuLabel>{t('payments.report.excelDownloads')}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          
          <DropdownMenuItem 
            onClick={() => {
              setIsGenerating(true);
              window.open('/api/template-excel-report/download', '_blank');
              toast({
                title: t('payments.toast.success'),
                description: t('payments.report.excelStarted'),
              });
              setTimeout(() => setIsGenerating(false), 1000);
            }}
            disabled={isGenerating}
          >
            <FileDown className="mr-2 h-4 w-4" />
            {t('payments.report.excelReport')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      
      <AlertDialog open={showErrorDialog} onOpenChange={setShowErrorDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('payments.report.errorTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              <p className="mb-4">
                {t('payments.report.errorIntro')}
              </p>
              <ul className="list-disc pl-6 mb-4 space-y-2">
                <li>{t('payments.report.errorMissingData')}</li>
                <li>{t('payments.report.errorServer')}</li>
                <li>{t('payments.report.errorNetwork')}</li>
              </ul>
              {errorDetails && (
                <div className="bg-muted p-2 rounded text-sm mt-4 font-mono overflow-auto max-h-40">
                  {errorDetails}
                </div>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('payments.report.close')}</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}