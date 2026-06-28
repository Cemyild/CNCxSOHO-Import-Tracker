import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useTranslation } from "react-i18next";

interface MissingAtrRate {
  tr_hs_code: string;
  country_of_origin: string;
}

interface AtrRatesModalProps {
  open: boolean;
  missingAtrRates: MissingAtrRate[];
  onComplete: () => void;
  onCancel: () => void;
}

export function AtrRatesModal({
  open,
  missingAtrRates,
  onComplete,
  onCancel,
}: AtrRatesModalProps) {
  const { t } = useTranslation();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [customsTaxPercent, setCustomsTaxPercent] = useState("");

  const currentRate = missingAtrRates[currentIndex];

  useEffect(() => {
    if (open) {
      setCurrentIndex(0);
      setCustomsTaxPercent("");
    }
  }, [open]);

  useEffect(() => {
    if (currentRate) {
      setCustomsTaxPercent("");
    }
  }, [currentIndex]);

  const handleSave = async () => {
    if (isSaving || !currentRate) return;

    if (!customsTaxPercent) {
      toast({
        title: t('taxCalcComp.atrRates.validationErrorTitle'),
        description: t('taxCalcComp.atrRates.customsTaxRequired'),
        variant: "destructive",
      });
      return;
    }

    setIsSaving(true);

    try {
      await apiRequest("POST", "/api/tax-calculation/atr-rates", {
        tr_hs_code: currentRate.tr_hs_code,
        customs_tax_percent: customsTaxPercent,
      });

      toast({
        title: t('common.success'),
        description: t('taxCalcComp.atrRates.rateSaved', { code: currentRate.tr_hs_code }),
      });

      if (currentIndex >= missingAtrRates.length - 1) {
        setTimeout(() => onComplete(), 100);
      } else {
        setCurrentIndex(currentIndex + 1);
      }
    } catch (error) {
      toast({
        title: t('common.error'),
        description: t('taxCalcComp.atrRates.saveFailed', { error: error instanceof Error ? error.message : t('taxCalcComp.atrRates.unknownError') }),
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (!currentRate) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onCancel}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('taxCalcComp.atrRates.title')}</DialogTitle>
          <DialogDescription>
            {t('taxCalcComp.atrRates.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h3 className="font-semibold mb-2">
              {t('taxCalcComp.atrRates.hsCodeProgress', { current: currentIndex + 1, total: missingAtrRates.length })}
            </h3>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <span className="text-gray-500">{t('taxCalcComp.atrRates.trHsCodeLabel')}</span>
                <span className="ml-2 font-mono font-medium">{currentRate.tr_hs_code}</span>
              </div>
              <div>
                <span className="text-gray-500">{t('taxCalcComp.atrRates.originLabel')}</span>
                <span className="ml-2 font-medium">{currentRate.country_of_origin}</span>
              </div>
            </div>
            <p className="text-sm text-gray-600 mt-2">
              {t('taxCalcComp.atrRates.exemptNote')}
            </p>
          </div>

          <div>
            <Label>
              {t('taxCalcComp.atrRates.customsTaxPercent')}{" "}
              <span className="text-xs text-gray-500">{t('taxCalcComp.atrRates.customsTaxHint')}</span>
            </Label>
            <Input
              type="number"
              step="0.0001"
              value={customsTaxPercent}
              onChange={(e) => setCustomsTaxPercent(e.target.value)}
              placeholder="0.0300"
              data-testid="input-atr-customs-tax"
              required
            />
          </div>

          <div className="flex justify-end space-x-2 pt-4 border-t">
            <Button
              variant="outline"
              onClick={onCancel}
              disabled={isSaving}
              data-testid="button-cancel-atr"
            >
              {t('taxCalcComp.atrRates.cancel')}
            </Button>
            <Button
              onClick={handleSave}
              disabled={isSaving}
              data-testid="button-save-atr-rate"
            >
              {isSaving ? t('taxCalcComp.atrRates.saving') : currentIndex < missingAtrRates.length - 1 ? t('taxCalcComp.atrRates.saveNext') : t('taxCalcComp.atrRates.saveCalculate')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
