import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { queryClient, apiRequest } from "@/lib/queryClient";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Calendar as CalendarIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";

// Schema for payment creation
const paymentSchema = z.object({
  procedureReference: z.string().min(1, "validation.procedureReferenceRequired"),
  paymentType: z.enum(["advance", "balance"], {
    required_error: "validation.paymentTypeRequired",
  }),
  amount: z.coerce.number().positive("validation.amountPositive"),
  paymentDate: z.date({
    required_error: "validation.paymentDateRequired",
  }),
  description: z.string().optional(),
});

type PaymentFormValues = z.infer<typeof paymentSchema>;

interface AddPaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPaymentCreated?: () => void;
  initialProcedureReference?: string;
}

export default function AddPaymentModal({
  isOpen,
  onClose,
  onPaymentCreated,
  initialProcedureReference,
}: AddPaymentModalProps) {
  const { toast } = useToast();
  const { t } = useTranslation();
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fetch procedures for reference dropdown
  const { data: proceduresData, isLoading: isProceduresLoading } = useQuery({
    queryKey: ["/api/procedures"],
    queryFn: async () => {
      console.log("Fetching procedures data...");
      const response = await fetch("/api/procedures");
      if (!response.ok) {
        throw new Error("Network response was not ok");
      }
      const data = await response.json();
      console.log("Procedures data:", data);
      return data;
    },
  });

  // Form setup
  const form = useForm<PaymentFormValues>({
    resolver: zodResolver(paymentSchema),
    defaultValues: {
      procedureReference: initialProcedureReference || "",
      paymentType: "advance",
      amount: undefined,
      description: "",
      paymentDate: new Date(),
    },
  });
  
  // Update form when initialProcedureReference changes or modal opens
  useEffect(() => {
    if (isOpen) {
      console.log("Modal opened, resetting form with initialProcedureReference:", initialProcedureReference);
      // Reset form to default values
      form.reset({
        procedureReference: initialProcedureReference || "",
        paymentType: "advance",
        amount: undefined,
        description: "",
        paymentDate: new Date(),
      });
      
      // Force the form to update with these values after reset
      setTimeout(() => {
        // This helps ensure the form values are properly applied after reset
        if (initialProcedureReference) {
          form.setValue("procedureReference", initialProcedureReference);
        }
        form.setValue("paymentType", "advance");
      }, 100);
    }
  }, [initialProcedureReference, form, isOpen]);

  // Handle form submission
  const onSubmit = async (values: PaymentFormValues) => {
    setIsSubmitting(true);
    try {
      const response = await apiRequest("POST", "/api/payments", values);

      if (!response.ok) {
        throw new Error("Failed to create payment");
      }

      toast({
        title: t('common.success'),
        description: t('addPaymentModal.createdSuccess'),
      });

      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/financial-summary"] });

      // Call the callback if provided
      if (onPaymentCreated) {
        onPaymentCreated();
      }

      // Reset form and close modal
      form.reset();
      onClose();
    } catch (error) {
      console.error("Error creating payment:", error);
      toast({
        title: t('common.error'),
        description: t('addPaymentModal.createError'),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle closing the dialog
  const handleDialogChange = (open: boolean) => {
    if (!open) {
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleDialogChange} modal={true}>
      <DialogContent className="sm:max-w-[550px] z-50 payment-distribution-modal">
        <DialogHeader>
          <DialogTitle>{t('addPaymentModal.title')}</DialogTitle>
          <DialogDescription>
            {t('addPaymentModal.description')}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {/* Procedure Reference Selection */}
            <FormField
              control={form.control}
              name="procedureReference"
              render={({ field }) => {
                console.log("Procedure field value:", field.value);
                return (
                <FormItem>
                  <FormLabel>{t('addPaymentModal.procedureReference')}</FormLabel>
                  <Select
                    onValueChange={(value) => {
                      console.log("Selecting procedure:", value);
                      field.onChange(value);
                    }}
                    defaultValue={field.value}
                    value={field.value}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full" onClick={() => console.log("Trigger clicked")}>
                        <SelectValue placeholder={t('addPaymentModal.selectProcedure')} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent
                      position="popper"
                      sideOffset={5}
                      className="z-[9999]"
                    >
                      {isProceduresLoading ? (
                        <SelectItem value="loading" disabled>
                          {t('addPaymentModal.loadingProcedures')}
                        </SelectItem>
                      ) : proceduresData?.procedures?.length > 0 ? (
                        proceduresData.procedures.map((procedure: any) => (
                          <SelectItem
                            key={procedure.reference}
                            value={procedure.reference}
                            className="cursor-pointer"
                          >
                            {procedure.reference} - {procedure.title}
                          </SelectItem>
                        ))
                      ) : (
                        <SelectItem value="no-procedures" disabled>
                          {t('addPaymentModal.noProcedures')}
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}}
            />

            {/* Payment Type */}
            <FormField
              control={form.control}
              name="paymentType"
              render={({ field }) => {
                console.log("Payment type field value:", field.value);
                return (
                <FormItem>
                  <FormLabel>{t('addPaymentModal.paymentType')}</FormLabel>
                  <Select
                    onValueChange={(value) => {
                      console.log("Selecting payment type:", value);
                      field.onChange(value);
                    }}
                    defaultValue={field.value}
                    value={field.value}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full" onClick={() => console.log("Payment type trigger clicked")}>
                        <SelectValue placeholder={t('addPaymentModal.selectPaymentType')} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent
                      position="popper"
                      sideOffset={5}
                      className="z-[9999]"
                    >
                      <SelectItem value="advance" className="cursor-pointer">{t('addPaymentModal.advancePayment')}</SelectItem>
                      <SelectItem value="balance" className="cursor-pointer">{t('addPaymentModal.balancePayment')}</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}}
            />

            {/* Amount */}
            <FormField
              control={form.control}
              name="amount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('addPaymentModal.amountTry')}</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="0.01"
                      placeholder={t('addPaymentModal.enterAmount')}
                      {...field}
                      onChange={(e) => {
                        const value = e.target.value ? parseFloat(e.target.value) : undefined;
                        field.onChange(value);
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Payment Date */}
            <FormField
              control={form.control}
              name="paymentDate"
              render={({ field }) => (
                <FormItem className="flex flex-col">
                  <FormLabel>{t('addPaymentModal.paymentDate')}</FormLabel>
                  <Popover>
                    <PopoverTrigger asChild>
                      <FormControl>
                        <Button
                          variant={"outline"}
                          className={cn(
                            "w-full pl-3 text-left font-normal",
                            !field.value && "text-muted-foreground"
                          )}
                          onClick={() => console.log("Date picker button clicked")}
                        >
                          {field.value ? (
                            format(field.value, "PPP")
                          ) : (
                            <span>{t('addPaymentModal.pickDate')}</span>
                          )}
                          <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                        </Button>
                      </FormControl>
                    </PopoverTrigger>
                    <PopoverContent 
                      className="w-auto p-0 z-[9999]" 
                      align="start"
                      sideOffset={5}
                    >
                      <Calendar
                        mode="single"
                        selected={field.value}
                        onSelect={(date) => {
                          console.log("Date selected:", date);
                          field.onChange(date);
                        }}
                        initialFocus
                        className="rounded-md border shadow-md"
                      />
                    </PopoverContent>
                  </Popover>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Description */}
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('addPaymentModal.descriptionOptional')}</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder={t('addPaymentModal.enterDescription')}
                      className="resize-none"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                disabled={isSubmitting}
              >
                {t('addPaymentModal.cancel')}
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? t('addPaymentModal.adding') : t('addPaymentModal.addPayment')}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}