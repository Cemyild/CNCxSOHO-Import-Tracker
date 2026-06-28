import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface CalculationLoadingModalProps {
  open: boolean;
  currentStep: string;
  progress?: number;
}

export function CalculationLoadingModal({ 
  open, 
  currentStep,
  progress
}: CalculationLoadingModalProps) {
  const { t } = useTranslation();
  return (
    <Dialog open={open}>
      <DialogContent 
        className="sm:max-w-md"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <div className="flex flex-col items-center justify-center py-8 space-y-6">
          <div className="relative">
            <Loader2 className="w-16 h-16 text-primary animate-spin" />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-12 h-12 rounded-full bg-primary/10 animate-pulse" />
            </div>
          </div>
          
          <div className="text-center space-y-2">
            <h3 className="text-lg font-semibold">
              {t('taxCalcComp.calcLoading.title')}
            </h3>
            <p className="text-sm text-muted-foreground">
              {t('taxCalcComp.calcLoading.pleaseWait')}
            </p>
          </div>

          <div className="w-full space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{t('taxCalcComp.calcLoading.currentStep')}</span>
              <span className="font-medium">{t(`taxCalcComp.calcLoading.steps.${currentStep}`, { defaultValue: currentStep })}</span>
            </div>
            
            {progress !== undefined && (
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div 
                  className="bg-primary h-2 rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            )}
          </div>
          
          <div className="w-full space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs ${
                currentStep === 'Validating' ? 'bg-primary text-white' : 
                currentStep !== 'Validating' ? 'bg-green-500 text-white' : 'bg-gray-200'
              }`}>
                {currentStep !== 'Validating' ? '✓' : '1'}
              </div>
              <span className={currentStep === 'Validating' ? 'font-medium' : 'text-muted-foreground'}>
                {t('taxCalcComp.calcLoading.validatingProducts')}
              </span>
            </div>
            
            <div className="flex items-center gap-2">
              <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs ${
                currentStep === 'Creating calculation' ? 'bg-primary text-white' : 
                currentStep === 'Creating items' || currentStep === 'Calculating' ? 'bg-green-500 text-white' : 'bg-gray-200'
              }`}>
                {currentStep === 'Creating items' || currentStep === 'Calculating' ? '✓' : '2'}
              </div>
              <span className={currentStep === 'Creating calculation' ? 'font-medium' : 'text-muted-foreground'}>
                {t('taxCalcComp.calcLoading.creatingCalculation')}
              </span>
            </div>
            
            <div className="flex items-center gap-2">
              <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs ${
                currentStep === 'Creating items' ? 'bg-primary text-white' : 
                currentStep === 'Calculating' ? 'bg-green-500 text-white' : 'bg-gray-200'
              }`}>
                {currentStep === 'Calculating' ? '✓' : '3'}
              </div>
              <span className={currentStep === 'Creating items' ? 'font-medium' : 'text-muted-foreground'}>
                {t('taxCalcComp.calcLoading.addingProducts')}
              </span>
            </div>
            
            <div className="flex items-center gap-2">
              <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs ${
                currentStep === 'Calculating' ? 'bg-primary text-white animate-pulse' : 'bg-gray-200'
              }`}>
                4
              </div>
              <span className={currentStep === 'Calculating' ? 'font-medium' : 'text-muted-foreground'}>
                {t('taxCalcComp.calcLoading.calculatingTaxes')}
              </span>
            </div>
          </div>

          {currentStep === 'Calculating' && (
            <div className="text-xs text-muted-foreground text-center bg-yellow-50 p-3 rounded-md border border-yellow-200">
              {t('taxCalcComp.calcLoading.largeCalcWarning')}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
