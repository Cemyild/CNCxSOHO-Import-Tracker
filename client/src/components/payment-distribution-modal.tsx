import React, { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from 'react-i18next';
import { apiRequest } from '@/lib/queryClient';
import { formatCurrency } from '../lib/formatters';

// Define the form schema for payment distribution
const paymentDistributionSchema = z.object({
  procedureReference: z.string().min(1, { message: 'Procedure reference is required' }),
  distributedAmount: z
    .string()
    .min(1, { message: 'Amount is required' })
    .refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0, {
      message: 'Amount must be a positive number',
    }),
  paymentType: z.enum(['advance', 'balance'], {
    required_error: 'Payment type is required',
  }),
});

type PaymentDistributionFormValues = z.infer<typeof paymentDistributionSchema>;

interface PaymentDistributionModalProps {
  isOpen: boolean;
  onClose: () => void;
  paymentId: number | null;
  paymentData: {
    id: number;
    paymentId: string;
    payerInfo: string;
    totalAmount: string;
    amountDistributed: string;
    remainingBalance: string;
    currency: string;
  } | null;
  onDistributionComplete: () => void;
}

export function PaymentDistributionModal({
  isOpen,
  onClose,
  paymentId,
  paymentData,
  onDistributionComplete,
}: PaymentDistributionModalProps) {
  const [availableProcedures, setAvailableProcedures] = useState<{ reference: string; clientName: string }[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();
  const { t } = useTranslation();

  // Initialize form with default values
  const form = useForm<PaymentDistributionFormValues>({
    resolver: zodResolver(paymentDistributionSchema),
    defaultValues: {
      procedureReference: '',
      distributedAmount: '',
      paymentType: 'advance',
    },
  });

  // Fetch available procedures when modal opens
  useEffect(() => {
    if (isOpen && paymentId) {
      // Fetch procedures for dropdown
      fetchProcedures();
    }
  }, [isOpen, paymentId]);

  // Function to fetch available procedures
  const fetchProcedures = async () => {
    try {
      setIsLoading(true);
      const response = await apiRequest('GET', '/api/procedures');
      const jsonData = await response.json();
      if (jsonData.procedures) {
        // Extract just what we need for the dropdown
        const procedureOptions = jsonData.procedures.map((proc: any) => ({
          reference: proc.reference,
          clientName: proc.clientName,
        }));
        setAvailableProcedures(procedureOptions);
      }
    } catch (error) {
      console.error('Error fetching procedures:', error);
      toast({
        title: t('payments.toast.error'),
        description: t('payments.distribute.failLoadProcedures'),
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Handle form submission
  const onSubmit = async (data: PaymentDistributionFormValues) => {
    if (!paymentId) {
      toast({
        title: t('payments.toast.error'),
        description: t('payments.distribute.noPaymentSelected'),
        variant: 'destructive',
      });
      return;
    }

    // Parse the amount to ensure it's a number
    const amount = parseFloat(data.distributedAmount);
    const remainingBalance = paymentData ? parseFloat(paymentData.remainingBalance) : 0;

    // Check if the amount is greater than the remaining balance
    if (amount > remainingBalance) {
      toast({
        title: t('payments.toast.error'),
        description: t('payments.distribute.exceedsBalance', { amount: formatCurrency(amount), balance: formatCurrency(remainingBalance) }),
        variant: 'destructive',
      });
      return;
    }

    try {
      setIsLoading(true);
      const response = await apiRequest('POST', '/api/payment-distributions', {
        incomingPaymentId: paymentId,
        procedureReference: data.procedureReference,
        distributedAmount: data.distributedAmount,
        paymentType: data.paymentType,
      });
      
      const jsonData = await response.json();

      if (jsonData.distribution) {
        toast({
          title: t('payments.toast.success'),
          description: t('payments.distribute.distributeSuccess', { amount: formatCurrency(parseFloat(data.distributedAmount)), ref: data.procedureReference }),
        });
        
        // Reset form and close modal
        form.reset();
        onDistributionComplete();
        onClose();
      }
    } catch (error) {
      console.error('Error creating payment distribution:', error);
      toast({
        title: t('payments.toast.error'),
        description: t('payments.distribute.failDistribute', { msg: error instanceof Error ? error.message : 'Unknown error' }),
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Render the procedure options
  const renderProcedureOptions = () => {
    return availableProcedures.map((proc) => (
      <SelectItem key={proc.reference} value={proc.reference}>
        {proc.reference} - {proc.clientName}
      </SelectItem>
    ));
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px] payment-distribution-modal">
        <DialogHeader>
          <DialogTitle>{t('payments.distribute.title')}</DialogTitle>
          <DialogDescription>
            {paymentData ? (
              <div className="mt-2 space-y-2">
                <div><strong>{t('payments.distribute.paymentId')}</strong> {paymentData.paymentId}</div>
                <div><strong>{t('payments.distribute.payer')}</strong> {paymentData.payerInfo}</div>
                <div><strong>{t('payments.distribute.totalAmount')}</strong> {formatCurrency(parseFloat(paymentData.totalAmount), paymentData.currency)}</div>
                <div><strong>{t('payments.distribute.amountDistributed')}</strong> {formatCurrency(parseFloat(paymentData.amountDistributed), paymentData.currency)}</div>
                <div><strong>{t('payments.distribute.remainingBalance')}</strong> {formatCurrency(parseFloat(paymentData.remainingBalance), paymentData.currency)}</div>
              </div>
            ) : (
              <div>{t('payments.distribute.loadingDetails')}</div>
            )}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="procedureReference"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('payments.distribute.procedure')}</FormLabel>
                  <Select
                    disabled={isLoading}
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={t('payments.distribute.selectProcedure')} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent position="popper" sideOffset={5} className="z-[9999]">
                      {renderProcedureOptions()}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="distributedAmount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('payments.distribute.amountToDistribute')}</FormLabel>
                  <FormControl>
                    <Input
                      placeholder={t('payments.distribute.amountPlaceholder')}
                      {...field}
                      type="number"
                      step="0.01"
                      min="0.01"
                      max={paymentData?.remainingBalance}
                      disabled={isLoading}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="paymentType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('payments.distribute.paymentType')}</FormLabel>
                  <Select
                    disabled={isLoading}
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={t('payments.distribute.selectPaymentType')} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent position="popper" sideOffset={5} className="z-[9999]">
                      <SelectItem value="advance">{t('payments.distribute.advance')}</SelectItem>
                      <SelectItem value="balance">{t('payments.distribute.balance')}</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={isLoading}>
                {t('payments.distribute.cancel')}
              </Button>
              <Button type="submit" disabled={isLoading}>
                {isLoading ? t('payments.distribute.processing') : t('payments.distribute.distribute')}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}