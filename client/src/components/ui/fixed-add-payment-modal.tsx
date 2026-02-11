import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogPortal,
  DialogOverlay,
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
import { toast } from "@/hooks/use-toast";
import { CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

// Payment form validation schema
const paymentSchema = z.object({
  procedureReference: z.string().min(1, { message: "Procedure is required" }),
  paymentType: z.string().min(1, { message: "Payment type is required" }),
  amount: z
    .number({ required_error: "Amount is required" })
    .positive({ message: "Amount must be positive" }),
  paymentDate: z.date({
    required_error: "Payment date is required",
  }),
  description: z.string().optional(),
});

// Type for form values
type PaymentFormValues = z.infer<typeof paymentSchema>;

// Main component props
interface AddPaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPaymentCreated?: () => void;
  initialProcedureReference?: string;
}

// Main component
export default function AddPaymentModal({
  isOpen,
  onClose,
  onPaymentCreated,
  initialProcedureReference,
}: AddPaymentModalProps) {
  // Track submission state
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fetch procedures for dropdown
  const { data: proceduresData, isLoading: isProceduresLoading } = useQuery({
    queryKey: ["/api/procedures"],
    enabled: isOpen,
  });

  // Set up form with validation
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
      const response = await fetch("/api/payments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(values),
      });

      if (!response.ok) {
        throw new Error("Failed to create payment");
      }

      toast({
        title: "Success",
        description: "Payment has been created successfully",
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
        title: "Error",
        description: "Failed to create payment. Please try again.",
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

  // Custom styled Dialog with portals to fix z-index stacking
  return (
    <>
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black/40 z-[100]"
          onClick={() => onClose()}
        />
      )}
      <div className={`fixed inset-0 flex items-center justify-center z-[101] ${isOpen ? 'block' : 'hidden'}`}>
        <div 
          className="bg-white rounded-lg shadow-xl w-full max-w-[550px] max-h-[90vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="px-6 py-4 border-b">
            <h2 className="text-lg font-semibold">Add New Payment</h2>
            <p className="text-sm text-gray-500">Create a new payment record for a procedure.</p>
          </div>

          {/* Form */}
          <div className="p-6">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                {/* Procedure Reference Selection */}
                <FormField
                  control={form.control}
                  name="procedureReference"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Procedure Reference</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value}
                        defaultValue={field.value}
                      >
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Select a procedure" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent
                          position="popper"
                          sideOffset={5}
                          className="z-[200]"
                        >
                          {isProceduresLoading ? (
                            <SelectItem value="loading" disabled>
                              Loading procedures...
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
                              No procedures available
                            </SelectItem>
                          )}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Payment Type */}
                <FormField
                  control={form.control}
                  name="paymentType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Payment Type</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value}
                        defaultValue={field.value}
                      >
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Select payment type" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent
                          position="popper"
                          sideOffset={5}
                          className="z-[200]"
                        >
                          <SelectItem value="advance" className="cursor-pointer">Advance Payment</SelectItem>
                          <SelectItem value="balance" className="cursor-pointer">Balance Payment</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Amount */}
                <FormField
                  control={form.control}
                  name="amount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Amount (TRY)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          placeholder="Enter amount"
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
                      <FormLabel>Payment Date</FormLabel>
                      <div className="relative">
                        <Popover>
                          <PopoverTrigger asChild>
                            <FormControl>
                              <Button
                                variant={"outline"}
                                className={cn(
                                  "w-full pl-3 text-left font-normal",
                                  !field.value && "text-muted-foreground"
                                )}
                              >
                                {field.value ? (
                                  format(field.value, "PPP")
                                ) : (
                                  <span>Pick a date</span>
                                )}
                                <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                              </Button>
                            </FormControl>
                          </PopoverTrigger>
                          <PopoverContent 
                            className="w-auto p-0 z-[200]" 
                            align="start"
                            sideOffset={5}
                          >
                            <Calendar
                              mode="single"
                              selected={field.value}
                              onSelect={field.onChange}
                              initialFocus
                              className="rounded-md border shadow-md"
                            />
                          </PopoverContent>
                        </Popover>
                      </div>
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
                      <FormLabel>Description (Optional)</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Enter payment description or notes"
                          className="resize-none"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Footer */}
                <div className="flex justify-end space-x-3 pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={onClose}
                    disabled={isSubmitting}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? "Adding..." : "Add Payment"}
                  </Button>
                </div>
              </form>
            </Form>
          </div>
        </div>
      </div>
    </>
  );
}