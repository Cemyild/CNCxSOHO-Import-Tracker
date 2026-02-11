import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

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
        title: "Validation Error",
        description: "Customs Tax % is required for ATR calculation",
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
        title: "Success",
        description: `ATR rate saved for ${currentRate.tr_hs_code}`,
      });

      if (currentIndex >= missingAtrRates.length - 1) {
        setTimeout(() => onComplete(), 100);
      } else {
        setCurrentIndex(currentIndex + 1);
      }
    } catch (error) {
      toast({
        title: "Error",
        description: `Failed to save: ${error instanceof Error ? error.message : "Unknown error"}`,
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
          <DialogTitle>ATR Customs Rate Required</DialogTitle>
          <DialogDescription>
            Products from non-EU/exempt countries with A.TR certificate require specific customs tax rates.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h3 className="font-semibold mb-2">
              HS Code {currentIndex + 1} of {missingAtrRates.length}
            </h3>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <span className="text-gray-500">TR HS Code:</span>
                <span className="ml-2 font-mono font-medium">{currentRate.tr_hs_code}</span>
              </div>
              <div>
                <span className="text-gray-500">Origin:</span>
                <span className="ml-2 font-medium">{currentRate.country_of_origin}</span>
              </div>
            </div>
            <p className="text-sm text-gray-600 mt-2">
              A.TR certificate exempts additional customs tax, but base customs tax rate is required.
            </p>
          </div>

          <div>
            <Label>
              Customs Tax % *{" "}
              <span className="text-xs text-gray-500">(e.g., 0.03 for 3%)</span>
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
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={isSaving}
              data-testid="button-save-atr-rate"
            >
              {isSaving ? "Saving..." : currentIndex < missingAtrRates.length - 1 ? "Save & Next" : "Save & Calculate"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
