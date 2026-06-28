import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useTranslation } from "react-i18next";

export function MissingHsCodesForm({
  hsCodes,
  onComplete,
}: {
  hsCodes: string[];
  onComplete: () => void;
}) {
  const { t } = useTranslation();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isSaving, setIsSaving] = useState(false);

  const currentHsCode = hsCodes[currentIndex];

  const [formData, setFormData] = useState({
    tr_hs_code: "",
    ex_registry_form: false,
    azo_dye_test: false,
    customs_tax_percent: "",
    additional_customs_tax_percent: "",
    kkdf_percent: "",
    vat_percent: "",
    special_custom: false,
    description_tr: "",
    unit: "AD",
  });

  // Update form ONLY when currentIndex changes
  useEffect(() => {
    if (currentHsCode) {
      console.log(
        `[HS FORM] Showing HS code ${currentIndex + 1}/${hsCodes.length}:`,
        currentHsCode,
      );
      setFormData({
        tr_hs_code: currentHsCode,
        ex_registry_form: false,
        azo_dye_test: false,
        customs_tax_percent: "",
        additional_customs_tax_percent: "",
        kkdf_percent: "",
        vat_percent: "",
        special_custom: false,
        description_tr: "",
        unit: "AD",
      });
    }
  }, [currentIndex]);

  const handleSave = async () => {
    if (isSaving || !currentHsCode) return;

    // Validate required fields
    if (!formData.customs_tax_percent || !formData.vat_percent) {
      toast({
        title: t('taxCalcComp.missingHs.validationErrorTitle'),
        description: t('taxCalcComp.missingHs.customsAndVatRequired'),
        variant: "destructive",
      });
      return;
    }

    setIsSaving(true);

    try {
      console.log(
        `[HS FORM] Saving HS code ${currentIndex + 1}/${hsCodes.length}:`,
        currentHsCode,
      );

      await apiRequest("POST", "/api/tax-calculation/hs-codes", {
        ...formData,
        customs_tax_percent: parseFloat(formData.customs_tax_percent) || 0,
        additional_customs_tax_percent:
          parseFloat(formData.additional_customs_tax_percent) || 0,
        kkdf_percent: parseFloat(formData.kkdf_percent) || 0,
        vat_percent: parseFloat(formData.vat_percent) || 0,
      });

      toast({
        title: t('common.success'),
        description: t('taxCalcComp.missingHs.ratesSaved', { code: currentHsCode }),
      });

      console.log(
        `[HS FORM] Save successful. Current index: ${currentIndex}, Total: ${hsCodes.length}`,
      );

      // Check if last HS code
      if (currentIndex >= hsCodes.length - 1) {
        console.log("[HS FORM] Last HS code saved, calling onComplete");
        setTimeout(() => onComplete(), 100);
      } else {
        // Move to next HS code
        const nextIndex = currentIndex + 1;
        console.log(
          `[HS FORM] Moving to next HS code: ${nextIndex + 1}/${hsCodes.length}`,
        );
        setCurrentIndex(nextIndex);
      }
    } catch (error) {
      console.error("[HS FORM] Save error:", error);
      toast({
        title: t('common.error'),
        description: t('taxCalcComp.missingHs.saveFailed', { error: error instanceof Error ? error.message : t('taxCalcComp.missingHs.unknownError') }),
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (!currentHsCode) {
    return null;
  }

  return (
    <div className="space-y-4">
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <h3 className="font-semibold mb-2">
          {t('taxCalcComp.missingHs.hsCodeHeading', { current: currentIndex + 1, total: hsCodes.length, code: currentHsCode })}
        </h3>
        <p className="text-sm text-gray-600">
          {t('taxCalcComp.missingHs.notInDatabase')}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <Label>{t('taxCalcComp.missingHs.trHsCode')}</Label>
          <Input
            value={currentHsCode}
            disabled
            data-testid="input-tr-hs-code"
          />
        </div>

        <div className="col-span-2">
          <Label>{t('taxCalcComp.missingHs.descriptionTurkish')}</Label>
          <Input
            value={formData.description_tr}
            onChange={(e) =>
              setFormData({ ...formData, description_tr: e.target.value })
            }
            placeholder={t('taxCalcComp.missingHs.productDescriptionPlaceholder')}
            data-testid="input-description"
          />
        </div>

        <div>
          <Label>{t('taxCalcComp.missingHs.unit')}</Label>
          <Input
            value={formData.unit}
            onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
            placeholder={t('taxCalcComp.missingHs.unitPlaceholder')}
            data-testid="input-unit"
          />
        </div>

        <div className="col-span-2 space-y-2 border rounded-lg p-3 bg-gray-50">
          <Label className="text-sm font-semibold">{t('taxCalcComp.missingHs.importRequirements')}</Label>
          <div className="flex items-center space-x-2">
            <Checkbox
              id="ex-registry"
              checked={formData.ex_registry_form}
              onCheckedChange={(checked) =>
                setFormData({ ...formData, ex_registry_form: !!checked })
              }
              data-testid="checkbox-ex-registry"
            />
            <Label htmlFor="ex-registry" className="font-normal cursor-pointer">
              {t('taxCalcComp.missingHs.exRegistryRequired')}
            </Label>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox
              id="azo-dye"
              checked={formData.azo_dye_test}
              onCheckedChange={(checked) =>
                setFormData({ ...formData, azo_dye_test: !!checked })
              }
              data-testid="checkbox-azo-dye"
            />
            <Label htmlFor="azo-dye" className="font-normal cursor-pointer">
              {t('taxCalcComp.missingHs.azoDyeRequired')}
            </Label>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox
              id="special-custom"
              checked={formData.special_custom}
              onCheckedChange={(checked) =>
                setFormData({ ...formData, special_custom: !!checked })
              }
              data-testid="checkbox-special-custom"
            />
            <Label
              htmlFor="special-custom"
              className="font-normal cursor-pointer"
            >
              {t('taxCalcComp.missingHs.specialCustomRequired')}
            </Label>
          </div>
        </div>

        <div>
          <Label>
            {t('taxCalcComp.missingHs.customsTaxPercent')}{" "}
            <span className="text-xs text-gray-500">{t('taxCalcComp.missingHs.hint3')}</span>
          </Label>
          <Input
            type="number"
            step="0.0001"
            value={formData.customs_tax_percent}
            onChange={(e) =>
              setFormData({
                ...formData,
                customs_tax_percent: e.target.value,
              })
            }
            placeholder="0.0300"
            data-testid="input-customs-tax"
            required
          />
        </div>

        <div>
          <Label>
            {t('taxCalcComp.missingHs.additionalCustomsTaxPercent')}{" "}
            <span className="text-xs text-gray-500">{t('taxCalcComp.missingHs.hint39')}</span>
          </Label>
          <Input
            type="number"
            step="0.0001"
            value={formData.additional_customs_tax_percent}
            onChange={(e) =>
              setFormData({
                ...formData,
                additional_customs_tax_percent: e.target.value,
              })
            }
            placeholder="0.3900"
            data-testid="input-additional-customs-tax"
          />
        </div>

        <div>
          <Label>
            {t('taxCalcComp.missingHs.kkdfPercent')}{" "}
            <span className="text-xs text-gray-500">{t('taxCalcComp.missingHs.hint6')}</span>
          </Label>
          <Input
            type="number"
            step="0.0001"
            value={formData.kkdf_percent}
            onChange={(e) =>
              setFormData({
                ...formData,
                kkdf_percent: e.target.value,
              })
            }
            placeholder="0.0600"
            data-testid="input-kkdf"
          />
        </div>

        <div>
          <Label>
            {t('taxCalcComp.missingHs.vatPercent')}{" "}
            <span className="text-xs text-gray-500">{t('taxCalcComp.missingHs.hint10')}</span>
          </Label>
          <Input
            type="number"
            step="0.0001"
            value={formData.vat_percent}
            onChange={(e) =>
              setFormData({
                ...formData,
                vat_percent: e.target.value,
              })
            }
            placeholder="0.1000"
            data-testid="input-vat"
            required
          />
        </div>
      </div>

      <div className="flex justify-end space-x-2 pt-4 border-t">
        <Button
          variant="outline"
          onClick={onComplete}
          disabled={isSaving}
          data-testid="button-skip-all-hscodes"
        >
          {t('taxCalcComp.missingHs.skipAll')}
        </Button>
        <Button
          onClick={handleSave}
          disabled={isSaving}
          data-testid="button-save-hscode"
        >
          {isSaving ? t('taxCalcComp.missingHs.saving') : t('taxCalcComp.missingHs.saveNext')}
        </Button>
      </div>
    </div>
  );
}
