import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

// Form schema validation
const formSchema = z.object({
  paymentId: z.string().min(1, { message: 'Payment ID is required' }),
  dateReceived: z.string().min(1, { message: 'Date received is required' }),
  payerInfo: z.string().min(1, { message: 'Payer information is required' }),
  totalAmount: z.string()
    .min(1, { message: 'Total amount is required' })
    .refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0, {
      message: 'Amount must be a positive number',
    }),
  currency: z.literal('TL').default('TL'), // Only allow TL as currency
  notes: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

interface CreateIncomingPaymentFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function CreateIncomingPaymentForm({ isOpen, onClose, onSuccess }: CreateIncomingPaymentFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();

  // Get today's date formatted as YYYY-MM-DD for the date input
  const today = new Date().toISOString().split('T')[0];

  // Initialize the form with default values
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      paymentId: '',
      dateReceived: today,
      payerInfo: '',
      totalAmount: '',
      currency: 'TL', // Default to Turkish Lira
      notes: '',
    },
  });

  // Create payment mutation
  const createPaymentMutation = useMutation({
    mutationFn: async (data: FormValues) => {
      return apiRequest('POST', '/api/incoming-payments', data);
    },
    onSuccess: () => {
      setIsSubmitting(false);
      onSuccess();
    },
    onError: (error) => {
      setIsSubmitting(false);
      console.error('Error creating payment:', error);
      toast({
        title: 'Error',
        description: `Failed to create payment: ${error instanceof Error ? error.message : 'Unknown error'}`,
        variant: 'destructive',
      });
    },
  });

  // Handle form submission
  const onSubmit = (data: FormValues) => {
    setIsSubmitting(true);
    console.log('Submitting payment form with data:', data);
    createPaymentMutation.mutate(data);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Create New Incoming Payment</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="paymentId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Payment ID</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., INV-2023-001" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="dateReceived"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Date Received</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="payerInfo"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Payer Information</FormLabel>
                  <FormControl>
                    <Input placeholder="Company name or payer details" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="totalAmount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Total Amount (₺)</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <span className="absolute left-3 top-2.5">₺</span>
                        <Input
                          type="number"
                          step="0.01"
                          min="0.01"
                          placeholder="0.00"
                          className="pl-7"
                          {...field}
                        />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="currency"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Currency</FormLabel>
                    <FormControl>
                      <Input value="TL" disabled className="bg-gray-100" />
                    </FormControl>
                    <p className="text-sm text-muted-foreground">All payments are recorded in Turkish Lira (₺)</p>
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes (Optional)</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Any additional information about this payment"
                      className="resize-none"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Creating...' : 'Create Payment'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}