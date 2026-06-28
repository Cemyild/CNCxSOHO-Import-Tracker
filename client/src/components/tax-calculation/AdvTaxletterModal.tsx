import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const EXPENSE_TYPES = [
  'Export Registry Fee',
  'Insurance',
  'Awb Fee',
  'Airport Storage Fee',
  'Bonded Warehouse Storage Fee',
  'Transportation',
  'International Transportation',
  'Tareks Fee',
  'Customs Inspection',
  'Azo Test',
  'Service Invoice',
  'Other',
];

interface ExpenseItem {
  id: string;
  type: string;
  amount: number;
}

interface TaxCalculationData {
  customsTax: number;
  additionalTax: number;
  kkdf: number;
  vat: number;
  stampTax: number;
  totalTaxUsd: number;
  totalTaxTl: number;
  currencyRate: number;
}

interface AdvTaxletterModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGenerate: (data: any) => void;
  calculatedData: TaxCalculationData;
  reference: string;
  calculationId?: number;
  isLoading?: boolean;
}

export function AdvTaxletterModal({
  isOpen,
  onClose,
  onGenerate,
  calculatedData,
  reference,
  calculationId,
  isLoading = false,
}: AdvTaxletterModalProps) {
  const { t } = useTranslation();

  const expenseTypeLabels: Record<string, string> = {
    'Export Registry Fee': t('taxCalcComp.expenseTypes.exportRegistryFee'),
    'Insurance': t('taxCalcComp.expenseTypes.insurance'),
    'Awb Fee': t('taxCalcComp.expenseTypes.awbFee'),
    'Airport Storage Fee': t('taxCalcComp.expenseTypes.airportStorageFee'),
    'Bonded Warehouse Storage Fee': t('taxCalcComp.expenseTypes.bondedWarehouseStorageFee'),
    'Transportation': t('taxCalcComp.expenseTypes.transportation'),
    'International Transportation': t('taxCalcComp.expenseTypes.internationalTransportation'),
    'Tareks Fee': t('taxCalcComp.expenseTypes.tareksFee'),
    'Customs Inspection': t('taxCalcComp.expenseTypes.customsInspection'),
    'Azo Test': t('taxCalcComp.expenseTypes.azoTest'),
    'Service Invoice': t('taxCalcComp.expenseTypes.serviceInvoice'),
    'Other': t('taxCalcComp.expenseTypes.other'),
  };

  const [taxInputs, setTaxInputs] = useState({
    customsTax: '',
    additionalTax: '',
    kkdf: '',
    vat: '',
    stampTax: '',
  });

  const [selectedExpenseType, setSelectedExpenseType] = useState('');
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expensesList, setExpensesList] = useState<ExpenseItem[]>([]);

  // Right-column "Calculated Reference (TL)" — exact USD × rate, no rounding.
  // This is the source of truth shown to the user.
  const referenceValues = {
    customsTax: (calculatedData.customsTax * calculatedData.currencyRate).toFixed(2),
    additionalTax: (calculatedData.additionalTax * calculatedData.currencyRate).toFixed(2),
    kkdf: (calculatedData.kkdf * calculatedData.currencyRate).toFixed(2),
    vat: (calculatedData.vat * calculatedData.currencyRate).toFixed(2),
    stampTax: '0.00',
  };

  // Left-column "Enter Amount (TL)" pre-fill — rounded UP to next 5,000 TL per
  // CNCxSOHO convention. Stamp tax fixed at 5,000 TL. User can still edit.
  const ceil5k = (n: number) => (n > 0 ? Math.ceil(n / 5000) * 5000 : 0);
  const ceiledTaxDefaults = {
    customsTax: ceil5k(calculatedData.customsTax * calculatedData.currencyRate).toFixed(2),
    additionalTax: ceil5k(calculatedData.additionalTax * calculatedData.currencyRate).toFixed(2),
    kkdf: ceil5k(calculatedData.kkdf * calculatedData.currencyRate).toFixed(2),
    vat: ceil5k(calculatedData.vat * calculatedData.currencyRate).toFixed(2),
    stampTax: '5000.00',
  };

  useEffect(() => {
    if (isOpen) {
      setTaxInputs({
        customsTax: ceiledTaxDefaults.customsTax,
        additionalTax: ceiledTaxDefaults.additionalTax,
        kkdf: ceiledTaxDefaults.kkdf,
        vat: ceiledTaxDefaults.vat,
        stampTax: ceiledTaxDefaults.stampTax,
      });
      setExpensesList([]);
      setSelectedExpenseType('');
      setExpenseAmount('');

      // Pre-fill expenses with CNCxSOHO standard defaults.
      // The server applies: 4 fixed values, insurance computed (ceil to 500 TL),
      // 3 historical-rate-based (ceil to 5000 TL). User can still edit / remove.
      if (calculationId) {
        fetch(`/api/tax-calculation/calculations/${calculationId}/default-expenses`)
          .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
          .then((data: any) => {
            const items: ExpenseItem[] = (data?.expenses ?? [])
              .filter((e: any) => e.amount > 0)
              .map((e: any, idx: number) => ({
                id: `default-${idx + 1}-${Date.now()}`,
                type: String(e.type),
                amount: Number(e.amount),
              }));
            setExpensesList(items);
          })
          .catch(err => {
            console.warn('[AdvTaxletterModal] default-expenses fetch failed:', err);
          });
      }
    }
  }, [isOpen, calculationId]);

  const handleTaxInputChange = (field: string, value: string) => {
    const sanitized = value.replace(/[^0-9.]/g, '');
    setTaxInputs(prev => ({ ...prev, [field]: sanitized }));
  };

  const handleAddExpense = () => {
    if (!selectedExpenseType || !expenseAmount) return;
    
    const newExpense: ExpenseItem = {
      id: Date.now().toString(),
      type: selectedExpenseType,
      amount: parseFloat(expenseAmount) || 0,
    };
    
    setExpensesList(prev => [...prev, newExpense]);
    setSelectedExpenseType('');
    setExpenseAmount('');
  };

  const handleRemoveExpense = (id: string) => {
    setExpensesList(prev => prev.filter(item => item.id !== id));
  };

  const totalTaxTl = Object.values(taxInputs).reduce((sum, val) => sum + (parseFloat(val) || 0), 0);
  const totalExpensesTl = expensesList.reduce((sum, item) => sum + item.amount, 0);
  const grandTotalTl = totalTaxTl + totalExpensesTl;

  const handleGenerate = () => {
    const data = {
      taxes: {
        customsTax: parseFloat(taxInputs.customsTax) || 0,
        additionalTax: parseFloat(taxInputs.additionalTax) || 0,
        kkdf: parseFloat(taxInputs.kkdf) || 0,
        vat: parseFloat(taxInputs.vat) || 0,
        stampTax: parseFloat(taxInputs.stampTax) || 0,
        totalTax: totalTaxTl,
      },
      expenses: expensesList.map(item => ({
        type: item.type,
        amount: item.amount,
      })),
      totalExpenses: totalExpensesTl,
      grandTotal: grandTotalTl,
    };
    onGenerate(data);
  };

  const taxFields = [
    { key: 'customsTax', label: t('taxCalcComp.advTaxletter.customsTax'), ref: referenceValues.customsTax },
    { key: 'additionalTax', label: t('taxCalcComp.advTaxletter.additionalCustomsTax'), ref: referenceValues.additionalTax },
    { key: 'kkdf', label: t('taxCalcComp.advTaxletter.kkdf'), ref: referenceValues.kkdf },
    { key: 'vat', label: t('taxCalcComp.advTaxletter.vat'), ref: referenceValues.vat },
    { key: 'stampTax', label: t('taxCalcComp.advTaxletter.stampTax'), ref: referenceValues.stampTax },
  ];

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('taxCalcComp.advTaxletter.title', { reference })}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <div className="space-y-4">
            <h3 className="text-lg font-semibold border-b pb-2">{t('taxCalcComp.advTaxletter.taxSection')}</h3>

            <div className="grid gap-3">
              <div className="grid grid-cols-3 gap-4 text-sm font-medium text-muted-foreground">
                <div>{t('taxCalcComp.advTaxletter.taxType')}</div>
                <div>{t('taxCalcComp.advTaxletter.enterAmountTl')}</div>
                <div>{t('taxCalcComp.advTaxletter.calculatedReferenceTl')}</div>
              </div>

              {taxFields.map(({ key, label, ref }) => (
                <div key={key} className="grid grid-cols-3 gap-4 items-center">
                  <Label className="text-sm">{label}</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">₺</span>
                    <Input
                      type="text"
                      value={taxInputs[key as keyof typeof taxInputs]}
                      onChange={(e) => handleTaxInputChange(key, e.target.value)}
                      className="pl-7"
                      placeholder="0.00"
                      data-testid={`input-tax-${key}`}
                    />
                  </div>
                  <div className="text-sm text-muted-foreground bg-muted px-3 py-2 rounded">
                    ₺{parseFloat(ref).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                  </div>
                </div>
              ))}

              <div className="grid grid-cols-3 gap-4 items-center pt-2 border-t">
                <Label className="text-sm font-bold">{t('taxCalcComp.advTaxletter.totalTax')}</Label>
                <div className="text-lg font-bold text-primary" data-testid="text-total-tax">
                  ₺{totalTaxTl.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                </div>
                <div className="text-sm text-muted-foreground bg-muted px-3 py-2 rounded font-medium">
                  ₺{calculatedData.totalTaxTl.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-lg font-semibold border-b pb-2">{t('taxCalcComp.advTaxletter.expensesSection')}</h3>

            <div className="flex gap-3 items-end">
              <div className="flex-1">
                <Label className="text-sm mb-1 block">{t('taxCalcComp.advTaxletter.expenseType')}</Label>
                <Select value={selectedExpenseType} onValueChange={setSelectedExpenseType}>
                  <SelectTrigger data-testid="select-expense-type">
                    <SelectValue placeholder={t('taxCalcComp.advTaxletter.selectExpenseType')} />
                  </SelectTrigger>
                  <SelectContent>
                    {EXPENSE_TYPES.map(type => (
                      <SelectItem key={type} value={type}>
                        {expenseTypeLabels[type] ?? type}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="w-40">
                <Label className="text-sm mb-1 block">{t('taxCalcComp.advTaxletter.amountTl')}</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">₺</span>
                  <Input
                    type="text"
                    value={expenseAmount}
                    onChange={(e) => setExpenseAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                    className="pl-7"
                    placeholder="0.00"
                    data-testid="input-expense-amount"
                  />
                </div>
              </div>
              
              <Button 
                onClick={handleAddExpense} 
                disabled={!selectedExpenseType || !expenseAmount}
                size="icon"
                className="shrink-0"
                data-testid="button-add-expense"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>

            {expensesList.length > 0 ? (
              <div className="border rounded-lg divide-y">
                {expensesList.map((expense) => (
                  <div key={expense.id} className="flex items-center justify-between px-4 py-2" data-testid={`expense-item-${expense.id}`}>
                    <span className="text-sm">{expenseTypeLabels[expense.type] ?? expense.type}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium">
                        ₺{expense.amount.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-red-500 hover:text-red-700 hover:bg-red-50"
                        onClick={() => handleRemoveExpense(expense.id)}
                        data-testid={`button-remove-expense-${expense.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
                
                <div className="flex items-center justify-between px-4 py-3 bg-muted font-medium">
                  <span>{t('taxCalcComp.advTaxletter.totalExpenses')}</span>
                  <span data-testid="text-total-expenses">₺{totalExpensesTl.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</span>
                </div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground italic text-center py-4 border rounded-lg bg-muted">
                {t('taxCalcComp.advTaxletter.noExpensesYet')}
              </div>
            )}
          </div>

          <div className="bg-primary/10 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <span className="text-lg font-bold">{t('taxCalcComp.advTaxletter.grandTotal')}</span>
              <span className="text-xl font-bold text-primary" data-testid="text-grand-total">
                ₺{grandTotalTl.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
              </span>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="button-cancel-taxletter">
            {t('taxCalcComp.advTaxletter.cancel')}
          </Button>
          <Button onClick={handleGenerate} disabled={isLoading} data-testid="button-generate-taxletter">
            {isLoading ? t('taxCalcComp.advTaxletter.generating') : t('taxCalcComp.advTaxletter.generatePdf')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
