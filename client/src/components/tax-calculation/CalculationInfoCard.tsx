import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Pencil, Save, X, Loader2 } from "lucide-react";
import type { TaxCalculation } from "@shared/schema";
import { useTranslation } from "react-i18next";

interface FormState {
  reference: string;
  invoice_no: string;
  invoice_date: string; // yyyy-mm-dd or ""
  transport_cost: string;
  insurance_cost: string;
  storage_cost: string;
  currency_rate: string;
  is_prepaid: boolean;
  is_atr: boolean;
}

function formatNumber(value: any, decimals: number = 2): string {
  const n = typeof value === "number" ? value : parseFloat(String(value ?? ""));
  if (!isFinite(n)) return "";
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function formatUsd(value: any): string {
  const s = formatNumber(value, 2);
  return s ? `$${s}` : "";
}

function formatTry(value: any): string {
  const s = formatNumber(value, 4);
  return s ? `₺${s}` : "";
}

function isoDateInput(d: any): string {
  if (!d) return "";
  if (typeof d === "string") {
    // Already YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
    // ISO timestamp → trim
    const m = d.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
    return "";
  }
  if (d instanceof Date && !isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10);
  }
  return "";
}

function fromCalculation(c: TaxCalculation): FormState {
  return {
    reference: c.reference || "",
    invoice_no: c.invoice_no || "",
    invoice_date: isoDateInput((c as any).invoice_date),
    transport_cost: c.transport_cost ?? "0",
    insurance_cost: c.insurance_cost ?? "0",
    storage_cost: c.storage_cost ?? "0",
    currency_rate: c.currency_rate ?? "0",
    is_prepaid: !!c.is_prepaid,
    is_atr: !!c.is_atr,
  };
}

interface Props {
  calculation: TaxCalculation;
  calculationQueryKey: readonly unknown[];
}

export function CalculationInfoCard({ calculation, calculationQueryKey }: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [editMode, setEditMode] = useState(false);
  const [form, setForm] = useState<FormState>(() => fromCalculation(calculation));

  // Re-sync when calculation refreshes from server
  useEffect(() => {
    if (!editMode) setForm(fromCalculation(calculation));
  }, [calculation, editMode]);

  const saveMutation = useMutation({
    mutationFn: async (payload: FormState) => {
      const body: Record<string, any> = {
        reference: payload.reference || null,
        invoice_no: payload.invoice_no || null,
        invoice_date: payload.invoice_date || null,
        transport_cost: payload.transport_cost,
        insurance_cost: payload.insurance_cost,
        storage_cost: payload.storage_cost,
        currency_rate: payload.currency_rate,
        is_prepaid: payload.is_prepaid,
        is_atr: payload.is_atr,
      };
      const putRes = await apiRequest("PUT", `/api/tax-calculation/calculations/${calculation.id}`, body);
      if (!putRes.ok) {
        const txt = await putRes.text();
        let msg = t('taxCalcComp.calcInfo.updateFailed');
        try { msg = JSON.parse(txt).error ?? JSON.parse(txt).message ?? msg; } catch {}
        throw new Error(msg);
      }
      const calcRes = await apiRequest("POST", `/api/tax-calculation/calculations/${calculation.id}/calculate`, {});
      if (!calcRes.ok) {
        const txt = await calcRes.text();
        let msg = t('taxCalcComp.calcInfo.recalcFailed');
        try { msg = JSON.parse(txt).error ?? JSON.parse(txt).message ?? msg; } catch {}
        throw new Error(msg);
      }
      return calcRes.json();
    },
    onSuccess: (data: { procedureSynced?: boolean; [key: string]: unknown }) => {
      queryClient.invalidateQueries({ queryKey: calculationQueryKey });
      if (data?.procedureSynced) {
        queryClient.invalidateQueries({ queryKey: ["/api/procedures"] });
      }
      toast({ title: t('taxCalcComp.calcInfo.savedTitle'), description: t('taxCalcComp.calcInfo.savedDesc') });
      setEditMode(false);
    },
    onError: (err: any) => {
      toast({
        title: t('common.error'),
        description: err?.message ?? t('taxCalcComp.calcInfo.failedToSave'),
        variant: "destructive",
      });
    },
  });

  const onChangeText = (field: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
  };
  const onChangeBool = (field: keyof FormState) => (checked: boolean | "indeterminate") => {
    setForm((prev) => ({ ...prev, [field]: !!checked }));
  };

  const renderRead = (label: string, value: React.ReactNode, testId?: string) => (
    <div className="space-y-1">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm font-medium" data-testid={testId}>{value || <span className="text-muted-foreground">—</span>}</div>
    </div>
  );

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>{t('taxCalcComp.calcInfo.title')}</CardTitle>
        {!editMode ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditMode(true)}
            data-testid="button-edit-calc-info"
          >
            <Pencil className="mr-2 h-4 w-4" /> {t('taxCalcComp.calcInfo.edit')}
          </Button>
        ) : (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setForm(fromCalculation(calculation)); setEditMode(false); }}
              disabled={saveMutation.isPending}
              data-testid="button-cancel-calc-info"
            >
              <X className="mr-2 h-4 w-4" /> {t('taxCalcComp.calcInfo.cancel')}
            </Button>
            <Button
              size="sm"
              onClick={() => saveMutation.mutate(form)}
              disabled={saveMutation.isPending}
              data-testid="button-save-calc-info"
            >
              {saveMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              {t('taxCalcComp.calcInfo.saveRecalculate')}
            </Button>
          </div>
        )}
      </CardHeader>

      <CardContent>
        {!editMode ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {renderRead(t('taxCalcComp.calcInfo.reference'), calculation.reference, "calc-info-reference")}
            {renderRead(t('taxCalcComp.calcInfo.invoiceNo'), calculation.invoice_no || "", "calc-info-invoice-no")}
            {renderRead(
              t('taxCalcComp.calcInfo.invoiceDate'),
              isoDateInput((calculation as any).invoice_date)
                ? new Date(isoDateInput((calculation as any).invoice_date)).toLocaleDateString()
                : "",
              "calc-info-invoice-date"
            )}
            {renderRead(t('taxCalcComp.calcInfo.currencyRate'), formatTry(calculation.currency_rate), "calc-info-currency-rate")}
            {renderRead(t('taxCalcComp.calcInfo.transportCost'), formatUsd(calculation.transport_cost), "calc-info-transport-cost")}
            {renderRead(t('taxCalcComp.calcInfo.insuranceCost'), formatUsd(calculation.insurance_cost), "calc-info-insurance-cost")}
            {renderRead(t('taxCalcComp.calcInfo.storageCost'), formatUsd(calculation.storage_cost), "calc-info-storage-cost")}
            {renderRead(
              t('taxCalcComp.calcInfo.flags'),
              [
                calculation.is_prepaid ? t('taxCalcComp.calcInfo.prepaid') : null,
                calculation.is_atr ? t('taxCalcComp.calcInfo.atr') : null,
              ].filter(Boolean).join(", ") || "",
              "calc-info-flags"
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <Label htmlFor="reference">{t('taxCalcComp.calcInfo.reference')}</Label>
              <Input id="reference" value={form.reference} onChange={onChangeText("reference")} data-testid="input-reference" />
            </div>
            <div>
              <Label htmlFor="invoice_no">{t('taxCalcComp.calcInfo.invoiceNo')}</Label>
              <Input id="invoice_no" value={form.invoice_no} onChange={onChangeText("invoice_no")} data-testid="input-invoice-no" />
            </div>
            <div>
              <Label htmlFor="invoice_date">{t('taxCalcComp.calcInfo.invoiceDate')}</Label>
              <Input id="invoice_date" type="date" value={form.invoice_date} onChange={onChangeText("invoice_date")} data-testid="input-invoice-date" />
            </div>
            <div>
              <Label htmlFor="currency_rate">{t('taxCalcComp.calcInfo.currencyRate')}</Label>
              <Input id="currency_rate" type="number" step="0.0001" value={form.currency_rate} onChange={onChangeText("currency_rate")} data-testid="input-currency-rate" />
            </div>
            <div>
              <Label htmlFor="transport_cost">{t('taxCalcComp.calcInfo.transportCost')}</Label>
              <Input id="transport_cost" type="number" step="0.01" value={form.transport_cost} onChange={onChangeText("transport_cost")} data-testid="input-transport-cost" />
            </div>
            <div>
              <Label htmlFor="insurance_cost">{t('taxCalcComp.calcInfo.insuranceCost')}</Label>
              <Input id="insurance_cost" type="number" step="0.01" value={form.insurance_cost} onChange={onChangeText("insurance_cost")} data-testid="input-insurance-cost" />
            </div>
            <div>
              <Label htmlFor="storage_cost">{t('taxCalcComp.calcInfo.storageCost')}</Label>
              <Input id="storage_cost" type="number" step="0.01" value={form.storage_cost} onChange={onChangeText("storage_cost")} data-testid="input-storage-cost" />
            </div>
            <div className="flex items-end gap-6 pb-2">
              <div className="flex items-center gap-2">
                <Checkbox id="is_prepaid" checked={form.is_prepaid} onCheckedChange={onChangeBool("is_prepaid")} data-testid="checkbox-is-prepaid" />
                <Label htmlFor="is_prepaid" className="cursor-pointer">{t('taxCalcComp.calcInfo.prepaid')}</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="is_atr" checked={form.is_atr} onCheckedChange={onChangeBool("is_atr")} data-testid="checkbox-is-atr" />
                <Label htmlFor="is_atr" className="cursor-pointer">{t('taxCalcComp.calcInfo.atr')}</Label>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
