import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { useLocation } from "wouter";
import { 
  Calendar,
  Home,
  Inbox,
  Search,
  Settings,
  BarChart2,
  CalendarIcon,
  ArrowLeft,
  Save,
  XCircle
} from "lucide-react";
import { format } from "date-fns";

import { PageLayout } from "@/components/layout/PageLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { 
  Form, 
  FormControl, 
  FormDescription, 
  FormField, 
  FormItem, 
  FormLabel, 
  FormMessage 
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

// Menu items (consistent with other pages)
const items = [
  {
    title: "Dashboard",
    url: "/dashboard",
    icon: Home,
  },
  {
    title: "Procedures",
    url: "/procedures",
    icon: Inbox,
  },
  {
    title: "Expenses",
    url: "/expenses",
    icon: Calendar,
  },
  {
    title: "Payments",
    url: "/payments",
    icon: Search,
  },
  {
    title: "Reports",
    url: "/reports",
    icon: BarChart2,
  },
  {
    title: "Settings",
    url: "/settings",
    icon: Settings,
  },
];

// Define the validation schema for the form
const procedureFormSchema = z.object({
  reference: z.string().min(1, { message: "Reference is required" }),
  shipper: z.string().optional(),
  invoice_no: z.string().optional(),
  invoice_date: z.date().optional().nullable(),
  amount: z.string().optional()
    .refine(val => !val || !isNaN(parseFloat(val)), { message: "Amount must be a valid number" }),
  currency: z.string().default("TRY"),
  piece: z.string().optional()
    .refine(val => !val || !isNaN(parseInt(val)), { message: "Piece must be a valid integer" }),
  package: z.string().optional(),
  kg: z.string().optional()
    .refine(val => !val || !isNaN(parseFloat(val)), { message: "KG must be a valid number" }),
  awb_number: z.string().optional(),
  arrival_date: z.date().optional().nullable(),
  import_dec_date: z.date().optional().nullable(),
  import_dec_number: z.string().optional(),
  carrier: z.string().optional(),
  customs: z.string().optional(),
  usdtl_rate: z.string().optional()
    .refine(val => !val || !isNaN(parseFloat(val)), { message: "USD/TL rate must be a valid number" }),
});

// Create a type based on the schema
type ProcedureFormValues = z.infer<typeof procedureFormSchema>;

// Available currencies
const currencies = [
  { value: "TRY", label: "TRY - Turkish Lira" },
  { value: "USD", label: "USD - US Dollar" },
  { value: "EUR", label: "EUR - Euro" },
  { value: "GBP", label: "GBP - British Pound" },
  { value: "CNY", label: "CNY - Chinese Yuan" },
  { value: "JPY", label: "JPY - Japanese Yen" },
];

export default function AddProcedurePage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Initialize the form with default values
  const form = useForm<ProcedureFormValues>({
    resolver: zodResolver(procedureFormSchema),
    defaultValues: {
      reference: "",
      shipper: "",
      invoice_no: "",
      invoice_date: null,
      amount: "",
      currency: "TRY",
      piece: "",
      package: "",
      kg: "",
      awb_number: "",
      arrival_date: null,
      import_dec_date: null,
      import_dec_number: "",
      carrier: "",
      customs: "",
      usdtl_rate: "",
    },
  });

  // Form submission handler
  const onSubmit = async (values: ProcedureFormValues) => {
    setIsSubmitting(true);
    
    try {
      // Safe date processing function - returns YYYY-MM-DD string to avoid timezone conversion
      const safeProcessDate = (date: Date | null | undefined) => {
        if (!date) return null;
        if (date instanceof Date && !isNaN(date.getTime())) {
          // Return as YYYY-MM-DD string (no timezone conversion)
          const year = date.getFullYear();
          const month = String(date.getMonth() + 1).padStart(2, '0');
          const day = String(date.getDate()).padStart(2, '0');
          return `${year}-${month}-${day}`;
        }
        console.log('Invalid date encountered:', date);
        return null;
      };
      
      // Convert form values to the structure expected by the API
      const procedureData = {
        ...values,
        // Convert string values to appropriate types
        amount: values.amount ? parseFloat(values.amount) : null,
        piece: values.piece ? parseInt(values.piece) : null,
        kg: values.kg ? parseFloat(values.kg) : null,
        usdtl_rate: values.usdtl_rate ? parseFloat(values.usdtl_rate) : null,
        // Apply safe date processing
        invoice_date: safeProcessDate(values.invoice_date),
        arrival_date: safeProcessDate(values.arrival_date),
        import_dec_date: safeProcessDate(values.import_dec_date),
        // Include userId for creation
        createdBy: 3, // Using same default as server
      };

      // Send the data to the API
      const response = await apiRequest("POST", "/api/procedures", procedureData);
      const data = await response.json();

      if (response.ok) {
        toast({
          title: "Success",
          description: "The procedure was created successfully",
        });
        // Redirect to procedures list page
        setLocation("/procedures");
      } else {
        throw new Error(data.message || "Failed to create procedure");
      }
    } catch (error) {
      toast({
        title: "Error",
        description: `Failed to create procedure: ${error instanceof Error ? error.message : "Unknown error"}`,
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Cancel handler
  const handleCancel = () => {
    setLocation("/procedures");
  };

  return (
    <PageLayout title="Add Procedure" navItems={items}>
      <div className="container mx-auto p-6">
        <div className="mb-6 flex items-center">
          <Button variant="outline" size="sm" onClick={handleCancel}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Procedures
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Add New Procedure</CardTitle>
            <CardDescription>
              Enter procedure details below. Fields marked with * are required.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {/* Reference - Required */}
                  <FormField
                    control={form.control}
                    name="reference"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="required">Reference</FormLabel>
                        <FormControl>
                          <Input placeholder="Enter procedure reference" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Shipper */}
                  <FormField
                    control={form.control}
                    name="shipper"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Shipper</FormLabel>
                        <FormControl>
                          <Input placeholder="Enter shipper name" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Invoice No */}
                  <FormField
                    control={form.control}
                    name="invoice_no"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Invoice No</FormLabel>
                        <FormControl>
                          <Input placeholder="Enter invoice number" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Invoice Date */}
                  <FormField
                    control={form.control}
                    name="invoice_date"
                    render={({ field }) => (
                      <FormItem className="flex flex-col">
                        <FormLabel>Invoice Date</FormLabel>
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
                                  <span>Select date</span>
                                )}
                                <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                              </Button>
                            </FormControl>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="start">
                            <CalendarComponent
                              mode="single"
                              selected={field.value || undefined}
                              onSelect={field.onChange}
                              initialFocus
                            />
                          </PopoverContent>
                        </Popover>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Amount & Currency (in one row) */}
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <FormField
                        control={form.control}
                        name="amount"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Invoice Amount</FormLabel>
                            <FormControl>
                              <Input placeholder="0.00" type="number" step="0.01" min="0" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    <div className="w-32">
                      <FormField
                        control={form.control}
                        name="currency"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Currency</FormLabel>
                            <Select onValueChange={field.onChange} defaultValue={field.value}>
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Select currency" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {currencies.map((currency) => (
                                  <SelectItem key={currency.value} value={currency.value}>
                                    {currency.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>

                  {/* Piece */}
                  <FormField
                    control={form.control}
                    name="piece"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Piece</FormLabel>
                        <FormControl>
                          <Input placeholder="0" type="number" min="0" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Package */}
                  <FormField
                    control={form.control}
                    name="package"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Package</FormLabel>
                        <FormControl>
                          <Input placeholder="Enter package details" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* KG */}
                  <FormField
                    control={form.control}
                    name="kg"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>KG</FormLabel>
                        <FormControl>
                          <Input placeholder="0.00" type="number" step="0.01" min="0" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* AWB # */}
                  <FormField
                    control={form.control}
                    name="awb_number"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>AWB #</FormLabel>
                        <FormControl>
                          <Input placeholder="Enter AWB number" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Arrival Date */}
                  <FormField
                    control={form.control}
                    name="arrival_date"
                    render={({ field }) => (
                      <FormItem className="flex flex-col">
                        <FormLabel>Arrival Date</FormLabel>
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
                                  <span>Select date</span>
                                )}
                                <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                              </Button>
                            </FormControl>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="start">
                            <CalendarComponent
                              mode="single"
                              selected={field.value || undefined}
                              onSelect={field.onChange}
                              initialFocus
                            />
                          </PopoverContent>
                        </Popover>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Carrier */}
                  <FormField
                    control={form.control}
                    name="carrier"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Carrier</FormLabel>
                        <FormControl>
                          <Input placeholder="Enter carrier name" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Import Declaration Number */}
                  <FormField
                    control={form.control}
                    name="import_dec_number"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Import Declaration #</FormLabel>
                        <FormControl>
                          <Input placeholder="Enter import declaration number" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Import Declaration Date */}
                  <FormField
                    control={form.control}
                    name="import_dec_date"
                    render={({ field }) => (
                      <FormItem className="flex flex-col">
                        <FormLabel>Import Declaration Date</FormLabel>
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
                                  <span>Select date</span>
                                )}
                                <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                              </Button>
                            </FormControl>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="start">
                            <CalendarComponent
                              mode="single"
                              selected={field.value || undefined}
                              onSelect={field.onChange}
                              initialFocus
                            />
                          </PopoverContent>
                        </Popover>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Customs */}
                  <FormField
                    control={form.control}
                    name="customs"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Customs</FormLabel>
                        <FormControl>
                          <Input placeholder="Enter customs information" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* USD/TL Exchange Rate */}
                  <FormField
                    control={form.control}
                    name="usdtl_rate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>USD/TL Exchange Rate</FormLabel>
                        <FormControl>
                          <Input 
                            placeholder="0.0000" 
                            type="number" 
                            step="0.0001" 
                            min="0" 
                            {...field} 
                          />
                        </FormControl>
                        <FormDescription>
                          Current USD to TL exchange rate (up to 4 decimal places)
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="flex justify-end gap-2">
                  <Button 
                    type="button" 
                    variant="outline" 
                    onClick={handleCancel}
                    disabled={isSubmitting}
                  >
                    <XCircle className="mr-2 h-4 w-4" />
                    Cancel
                  </Button>
                  <Button type="submit" disabled={isSubmitting}>
                    <Save className="mr-2 h-4 w-4" />
                    Save Procedure
                  </Button>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>
    </PageLayout>
  );
}

// Add CSS for required field labels
// (Add a global style in index.css if it doesn't exist)