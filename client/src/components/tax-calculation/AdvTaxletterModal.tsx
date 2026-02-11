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
  isLoading?: boolean;
}

export function AdvTaxletterModal({
  isOpen,
  onClose,
  onGenerate,
  calculatedData,
  reference,
  isLoading = false,
}: AdvTaxletterModalProps) {
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

  const referenceValues = {
    customsTax: (calculatedData.customsTax * calculatedData.currencyRate).toFixed(2),
    additionalTax: (calculatedData.additionalTax * calculatedData.currencyRate).toFixed(2),
    kkdf: (calculatedData.kkdf * calculatedData.currencyRate).toFixed(2),
    vat: (calculatedData.vat * calculatedData.currencyRate).toFixed(2),
    stampTax: '0.00',
  };

  useEffect(() => {
    if (isOpen) {
      setTaxInputs({
        customsTax: referenceValues.customsTax,
        additionalTax: referenceValues.additionalTax,
        kkdf: referenceValues.kkdf,
        vat: referenceValues.vat,
        stampTax: '0.00',
      });
      setExpensesList([]);
      setSelectedExpenseType('');
      setExpenseAmount('');
    }
  }, [isOpen]);

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
    { key: 'customsTax', label: 'Customs Tax', ref: referenceValues.customsTax },
    { key: 'additionalTax', label: 'Additional Customs Tax', ref: referenceValues.additionalTax },
    { key: 'kkdf', label: 'KKDF', ref: referenceValues.kkdf },
    { key: 'vat', label: 'VAT', ref: referenceValues.vat },
    { key: 'stampTax', label: 'Stamp Tax', ref: referenceValues.stampTax },
  ];

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Advance Taxletter - {reference}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <div className="space-y-4">
            <h3 className="text-lg font-semibold border-b pb-2">TAX</h3>
            
            <div className="grid gap-3">
              <div className="grid grid-cols-3 gap-4 text-sm font-medium text-muted-foreground">
                <div>Tax Type</div>
                <div>Enter Amount (TL)</div>
                <div>Calculated Reference (TL)</div>
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
                <Label className="text-sm font-bold">TOTAL TAX</Label>
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
            <h3 className="text-lg font-semibold border-b pb-2">EXPENSES</h3>
            
            <div className="flex gap-3 items-end">
              <div className="flex-1">
                <Label className="text-sm mb-1 block">Expense Type</Label>
                <Select value={selectedExpenseType} onValueChange={setSelectedExpenseType}>
                  <SelectTrigger data-testid="select-expense-type">
                    <SelectValue placeholder="Select expense type..." />
                  </SelectTrigger>
                  <SelectContent>
                    {EXPENSE_TYPES.map(type => (
                      <SelectItem key={type} value={type}>
                        {type}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              <div className="w-40">
                <Label className="text-sm mb-1 block">Amount (TL)</Label>
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
                    <span className="text-sm">{expense.type}</span>
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
                  <span>TOTAL EXPENSES</span>
                  <span data-testid="text-total-expenses">₺{totalExpensesTl.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</span>
                </div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground italic text-center py-4 border rounded-lg bg-muted">
                No expenses added yet. Select a type and enter amount to add.
              </div>
            )}
          </div>

          <div className="bg-primary/10 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <span className="text-lg font-bold">GRAND TOTAL (Tax + Expenses)</span>
              <span className="text-xl font-bold text-primary" data-testid="text-grand-total">
                ₺{grandTotalTl.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
              </span>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="button-cancel-taxletter">
            Cancel
          </Button>
          <Button onClick={handleGenerate} disabled={isLoading} data-testid="button-generate-taxletter">
            {isLoading ? 'Generating...' : 'Generate PDF'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
