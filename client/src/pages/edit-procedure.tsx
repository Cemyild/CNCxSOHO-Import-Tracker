import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { format } from "date-fns";
import { useTranslation } from "react-i18next";
import {
  CalendarIcon,
  ArrowLeft,
  Save, 
  XCircle,
  Home,
  Inbox,
  Calendar,
  Search,
  BarChart2,
  Settings,
  Sparkles
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { PageLayout } from "@/components/layout/PageLayout";

// Navigation items - same structure as other pages
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
    title: "Ask CNC?",
    url: "/ask",
    icon: Sparkles,
  },
  {
    title: "Settings",
    url: "/settings",
    icon: Settings,
  },
];

// Currency options
const currencies = [
  { value: "USD", label: "USD - US Dollar" },
  { value: "EUR", label: "EUR - Euro" },
  { value: "TRY", label: "TRY - Turkish Lira" },
  { value: "GBP", label: "GBP - British Pound" },
];

// Form schema - exactly the same as add procedure
const procedureSchema = z.object({
  reference: z.string().min(1, "Reference is required"),
  shipper: z.string().optional(),
  invoice_no: z.string().optional(),
  invoice_date: z.date().nullable(),
  amount: z.string().default("0"),
  currency: z.string().default("TRY"),
  piece: z.string().default("0"),
  package: z.string().optional(),
  kg: z.string().default("0"),
  awb_number: z.string().optional(),
  arrival_date: z.date().nullable(),
  carrier: z.string().optional(),
  import_dec_number: z.string().optional(),
  import_dec_date: z.date().nullable(),
  customs: z.string().optional(),
  usdtl_rate: z.string().default("0"),
});

type ProcedureFormData = z.infer<typeof procedureSchema>;

export default function EditProcedurePage() {
  const { t } = useTranslation();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  // Get procedure reference from URL params
  const urlParams = new URLSearchParams(window.location.search);
  const procedureReference = urlParams.get('reference');

  const form = useForm<ProcedureFormData>({
    resolver: zodResolver(procedureSchema),
    defaultValues: {
      reference: "",
      shipper: "",
      invoice_no: "",
      invoice_date: null,
      amount: "0",
      currency: "TRY",
      piece: "0",
      package: "",
      kg: "0",
      awb_number: "",
      arrival_date: null,
      carrier: "",
      import_dec_number: "",
      import_dec_date: null,
      customs: "",
      usdtl_rate: "0",
    },
  });

  // Fetch current procedure data
  const { data: procedureData, isLoading } = useQuery({
    queryKey: [`/api/procedures/reference/${procedureReference}`],
    enabled: !!procedureReference,
    queryFn: async () => {
      const response = await apiRequest('GET', `/api/procedures/reference/${encodeURIComponent(procedureReference!)}`);
      return await response.json();
    },
  });

  const procedure = procedureData?.procedure;

  // Update form when procedure data is loaded
  useEffect(() => {
    if (procedure) {
      form.reset({
        reference: procedure.reference || "",
        shipper: procedure.shipper || "",
        invoice_no: procedure.invoice_no || "",
        invoice_date: procedure.invoice_date ? new Date(procedure.invoice_date) : null,
        amount: procedure.amount ? procedure.amount.toString() : "0",
        currency: procedure.currency || "TRY",
        piece: procedure.piece ? procedure.piece.toString() : "0",
        package: procedure.package || "",
        kg: procedure.kg ? procedure.kg.toString() : "0",
        awb_number: procedure.awb_number || "",
        arrival_date: procedure.arrival_date ? new Date(procedure.arrival_date) : null,
        carrier: procedure.carrier || "",
        import_dec_number: procedure.import_dec_number || "",
        import_dec_date: procedure.import_dec_date ? new Date(procedure.import_dec_date) : null,
        customs: procedure.customs || "",
        usdtl_rate: procedure.usdtl_rate ? procedure.usdtl_rate.toString() : "0",
      });
    }
  }, [procedure, form]);

  const updateMutation = useMutation({
    mutationFn: async (data: ProcedureFormData) => {
      // Safely convert dates to YYYY-MM-DD strings to avoid timezone conversion
      const safeToDateString = (date: Date | null | undefined) => {
        if (!date) return null;
        try {
          if (date instanceof Date && !isNaN(date.getTime())) {
            // Return as YYYY-MM-DD string (no timezone conversion)
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
          }
          return null;
        } catch (e) {
          console.error('Error converting date to string:', e);
          return null;
        }
      };

      const requestData = {
        ...data,
        invoice_date: safeToDateString(data.invoice_date),
        arrival_date: safeToDateString(data.arrival_date),
        import_dec_date: safeToDateString(data.import_dec_date),
      };

      console.log('Sending update request with data:', requestData);
      
      const response = await apiRequest('PUT', `/api/procedures/${encodeURIComponent(procedureReference!)}`, requestData);
      return await response.json();
    },
    onSuccess: () => {
      toast({
        title: t("common.success"),
        description: t("procedurePages.edit.updateSuccess"),
      });
      queryClient.invalidateQueries({ queryKey: ['/api/procedures'] });
      queryClient.invalidateQueries({ queryKey: [`/api/procedures/reference/${procedureReference}`] });
      setLocation('/procedures');
    },
    onError: (error) => {
      toast({
        title: t("common.error"),
        description: error.message || t("procedurePages.edit.updateError"),
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: ProcedureFormData) => {
    updateMutation.mutate(data);
  };

  if (!procedureReference) {
    return (
      <PageLayout title={t("procedurePages.edit.title")} navItems={items}>
        <div className="container mx-auto p-6">
          <Card>
            <CardHeader>
              <CardTitle>{t("common.error")}</CardTitle>
              <CardDescription>{t("procedurePages.edit.noReference")}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" onClick={() => setLocation('/procedures')}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                {t("procedurePages.backToProcedures")}
              </Button>
            </CardContent>
          </Card>
        </div>
      </PageLayout>
    );
  }

  if (isLoading) {
    return (
      <PageLayout title={t("procedurePages.edit.title")} navItems={items}>
        <div className="container mx-auto p-6">
          <Card>
            <CardHeader>
              <CardTitle>{t("common.loading")}</CardTitle>
              <CardDescription>{t("procedurePages.edit.fetchingDetails")}</CardDescription>
            </CardHeader>
          </Card>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout title={t("procedurePages.edit.title")} navItems={items}>
      <div className="container mx-auto p-6">
        <div className="mb-6 flex items-center">
          <Button variant="outline" size="sm" onClick={() => setLocation('/procedures')}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t("procedurePages.backToProcedures")}
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{t("procedurePages.edit.cardTitle")}</CardTitle>
            <CardDescription>
              {t("procedurePages.edit.cardDescription")}
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
                        <FormLabel className="required">{t("procedurePages.form.reference")}</FormLabel>
                        <FormControl>
                          <Input placeholder={t("procedurePages.form.referencePlaceholder")} {...field} disabled />
                        </FormControl>
                        <FormDescription>{t("procedurePages.edit.referenceLocked")}</FormDescription>
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
                        <FormLabel>{t("procedurePages.form.shipper")}</FormLabel>
                        <FormControl>
                          <Input placeholder={t("procedurePages.form.shipperPlaceholder")} {...field} />
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
                        <FormLabel>{t("procedurePages.form.invoiceNo")}</FormLabel>
                        <FormControl>
                          <Input placeholder={t("procedurePages.form.invoiceNoPlaceholder")} {...field} />
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
                        <FormLabel>{t("procedurePages.form.invoiceDate")}</FormLabel>
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
                                  <span>{t("procedurePages.form.selectDate")}</span>
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
                            <FormLabel>{t("procedurePages.form.invoiceAmount")}</FormLabel>
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
                            <FormLabel>{t("procedurePages.form.currency")}</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder={t("procedurePages.form.currencyPlaceholder")} />
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
                        <FormLabel>{t("procedurePages.form.piece")}</FormLabel>
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
                        <FormLabel>{t("procedurePages.form.package")}</FormLabel>
                        <FormControl>
                          <Input placeholder={t("procedurePages.form.packagePlaceholder")} {...field} />
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
                        <FormLabel>{t("procedurePages.form.kg")}</FormLabel>
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
                        <FormLabel>{t("procedurePages.form.awbNumber")}</FormLabel>
                        <FormControl>
                          <Input placeholder={t("procedurePages.form.awbNumberPlaceholder")} {...field} />
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
                        <FormLabel>{t("procedurePages.form.arrivalDate")}</FormLabel>
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
                                  <span>{t("procedurePages.form.selectDate")}</span>
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
                        <FormLabel>{t("procedurePages.form.carrier")}</FormLabel>
                        <FormControl>
                          <Input placeholder={t("procedurePages.form.carrierPlaceholder")} {...field} />
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
                        <FormLabel>{t("procedurePages.form.importDecNumber")}</FormLabel>
                        <FormControl>
                          <Input placeholder={t("procedurePages.form.importDecNumberPlaceholder")} {...field} />
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
                        <FormLabel>{t("procedurePages.form.importDecDate")}</FormLabel>
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
                                  <span>{t("procedurePages.form.selectDate")}</span>
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
                        <FormLabel>{t("procedurePages.form.customs")}</FormLabel>
                        <FormControl>
                          <Input placeholder={t("procedurePages.form.customsPlaceholder")} {...field} />
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
                        <FormLabel>{t("procedurePages.form.usdtlRate")}</FormLabel>
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
                          {t("procedurePages.form.usdtlRateHint")}
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
                    onClick={() => setLocation('/procedures')}
                    disabled={updateMutation.isPending}
                  >
                    <XCircle className="mr-2 h-4 w-4" />
                    {t("procedurePages.form.cancel")}
                  </Button>
                  <Button type="submit" disabled={updateMutation.isPending}>
                    <Save className="mr-2 h-4 w-4" />
                    {updateMutation.isPending ? t("procedurePages.edit.updating") : t("procedurePages.form.saveProcedure")}
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