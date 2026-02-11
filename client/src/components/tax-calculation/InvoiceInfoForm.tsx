import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";

interface InvoiceData {
  reference: string | null;
  invoice_no: string | null;
  invoice_date: string | null | Date;
  transport_cost: string | null;
  insurance_cost: string | null;
  storage_cost: string | null;
  currency_rate: string | null;
  is_prepaid: boolean | null;
  is_atr: boolean | null;
}

interface InvoiceInfoFormProps {
  data: Partial<InvoiceData>;
  onChange: (field: keyof InvoiceData, value: any) => void;
}

export function InvoiceInfoForm({ data, onChange }: InvoiceInfoFormProps) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <Label htmlFor="reference">Reference *</Label>
          <Input
            id="reference"
            value={data.reference ?? ""}
            onChange={(e) => onChange("reference", e.target.value)}
            placeholder="CNCALO-X"
            data-testid="input-reference"
          />
        </div>
        <div>
          <Label htmlFor="invoice_no">Invoice No</Label>
          <Input
            id="invoice_no"
            value={data.invoice_no ?? ""}
            onChange={(e) => onChange("invoice_no", e.target.value)}
            placeholder="HK12345"
            data-testid="input-invoice-no"
          />
        </div>
        <div>
          <Label htmlFor="invoice_date">Invoice Date</Label>
          <Input
            id="invoice_date"
            type="date"
            value={data.invoice_date instanceof Date ? data.invoice_date.toISOString().split('T')[0] : (data.invoice_date || "")}
            onChange={(e) => onChange("invoice_date", e.target.value || null)}
            data-testid="input-invoice-date"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div>
          <Label htmlFor="transport_cost">Transport Cost ($)</Label>
          <Input
            id="transport_cost"
            type="number"
            step="0.01"
            value={data.transport_cost ?? "0"}
            onChange={(e) => onChange("transport_cost", e.target.value)}
            data-testid="input-transport-cost"
          />
        </div>
        <div>
          <Label htmlFor="insurance_cost">Insurance Cost ($)</Label>
          <Input
            id="insurance_cost"
            type="number"
            step="0.01"
            value={data.insurance_cost ?? "0"}
            onChange={(e) => onChange("insurance_cost", e.target.value)}
            data-testid="input-insurance-cost"
          />
        </div>
        <div>
          <Label htmlFor="storage_cost">Storage Cost ($)</Label>
          <Input
            id="storage_cost"
            type="number"
            step="0.01"
            value={data.storage_cost ?? "0"}
            onChange={(e) => onChange("storage_cost", e.target.value)}
            data-testid="input-storage-cost"
          />
        </div>
        <div>
          <Label htmlFor="currency_rate">Currency Rate (TL/USD)</Label>
          <Input
            id="currency_rate"
            type="number"
            step="0.0001"
            value={data.currency_rate ?? "0"}
            onChange={(e) => onChange("currency_rate", e.target.value)}
            data-testid="input-currency-rate"
          />
        </div>
      </div>

      <div className="flex items-center space-x-6">
        <div className="flex items-center space-x-2">
          <Checkbox
            id="is_prepaid"
            checked={data.is_prepaid ?? false}
            onCheckedChange={(checked) => onChange("is_prepaid", checked as boolean)}
            data-testid="checkbox-prepaid"
          />
          <Label htmlFor="is_prepaid">Peşin Ödeme (Prepaid Payment)</Label>
        </div>
        <div className="flex items-center space-x-2">
          <Checkbox
            id="is_atr"
            checked={data.is_atr ?? false}
            onCheckedChange={(checked) => onChange("is_atr", checked as boolean)}
            data-testid="checkbox-atr"
          />
          <Label htmlFor="is_atr">ATR</Label>
        </div>
      </div>
    </div>
  );
}
