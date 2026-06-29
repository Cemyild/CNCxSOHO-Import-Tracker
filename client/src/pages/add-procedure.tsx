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
  XCircle,
  Sparkles
} from "lucide-react";
import { format } from "date-fns";
import { useTranslation } from "react-i18next";

import { PdfUploadDropzone } from "@/components/ui/pdf-upload-dropzone";
import type { AnalyzeDocumentResult } from "@/components/procedure-import/types";
import { DocumentImportReview } from "@/components/procedure-import/DocumentImportReview";

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

// Define the validation schema for the form
const procedureFormSchema = z.object({
  reference: z.string().min(1, { message: "validation.referenceRequired" }),
  shipper: z.string().optional(),
  invoice_no: z.string().optional(),
  invoice_date: z.date().optional().nullable(),
  amount: z.string().optional()
    .refine(val => !val || !isNaN(parseFloat(val)), { message: "validation.amountValidNumber" }),
  currency: z.string().default("TRY"),
  piece: z.string().optional()
    .refine(val => !val || !isNaN(parseInt(val)), { message: "validation.pieceValidInteger" }),
  package: z.string().optional(),
  kg: z.string().optional()
    .refine(val => !val || !isNaN(parseFloat(val)), { message: "validation.kgValidNumber" }),
  awb_number: z.string().optional(),
  arrival_date: z.date().optional().nullable(),
  import_dec_date: z.date().optional().nullable(),
  import_dec_number: z.string().optional(),
  carrier: z.string().optional(),
  customs: z.string().optional(),
  usdtl_rate: z.string().optional()
    .refine(val => !val || !isNaN(parseFloat(val)), { message: "validation.usdTlRateValidNumber" }),
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
  const { t } = useTranslation();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzeResult, setAnalyzeResult] = useState<AnalyzeDocumentResult | null>(null);

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

  // PDF upload + auto-fill handler
  const handleDocumentUpload = async (file: File) => {
    setIsAnalyzing(true);
    try {
      const formData = new FormData();
      formData.append("pdf", file);
      const res = await apiRequest("POST", "/api/procedures/analyze-document", formData);
      const { result } = await res.json();
      setAnalyzeResult(result as AnalyzeDocumentResult);

      // Prefill header form fields
      const h = result.header;
      form.setValue("shipper", h.shipper || "");
      form.setValue("invoice_no", h.invoice_no || "");
      // invoice_date is z.date() — parse the string into a Date
      if (h.invoice_date) {
        const parsed = new Date(h.invoice_date);
        if (!isNaN(parsed.getTime())) form.setValue("invoice_date", parsed);
      }
      form.setValue("amount", h.amount ? String(h.amount) : "");
      form.setValue("currency", h.currency || "USD");
      form.setValue("piece", h.piece ? String(h.piece) : "");
      form.setValue("package", h.package ? String(h.package) : "");
      form.setValue("kg", h.kg ? String(h.kg) : "");
      form.setValue("awb_number", h.awbNumber || "");
      form.setValue("customs", h.customs || "");
      form.setValue("import_dec_number", h.importDeclarationNumber || "");
      // import_dec_date is z.date() — parse the string into a Date
      if (h.importDeclarationDate) {
        const parsed = new Date(h.importDeclarationDate);
        if (!isNaN(parsed.getTime())) form.setValue("import_dec_date", parsed);
      }
      form.setValue("usdtl_rate", h.usdTlRate ? String(h.usdTlRate) : "");

      toast({ title: t("procedureImport.toastAnalyzedTitle"), description: t("procedureImport.toastAnalyzedDesc") });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      toast({ title: t("procedureImport.toastAnalyzeFailedTitle"), description: message, variant: "destructive" });
    } finally {
      setIsAnalyzing(false);
    }
  };

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
          title: t("common.success"),
          description: t("procedurePages.add.createSuccess"),
        });
        // Redirect to procedures list page
        setLocation("/procedures");
      } else {
        throw new Error(data.message || "Failed to create procedure");
      }
    } catch (error) {
      toast({
        title: t("common.error"),
        description: t("procedurePages.add.createError", {
          error: error instanceof Error ? error.message : t("procedurePages.unknownError"),
        }),
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
    <PageLayout title={t("procedurePages.add.title")} navItems={items}>
      <div className="container mx-auto p-6">
        <div className="mb-6 flex items-center">
          <Button variant="outline" size="sm" onClick={handleCancel}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t("procedurePages.backToProcedures")}
          </Button>
        </div>

        <Card className="mb-4">
          <CardHeader>
            <CardTitle>{t("procedureImport.uploadTitle")}</CardTitle>
            <CardDescription>{t("procedureImport.uploadDescription")}</CardDescription>
          </CardHeader>
          <CardContent>
            <PdfUploadDropzone
              title={t("procedureImport.uploadTitle")}
              onFileSelect={handleDocumentUpload}
              isAnalyzing={isAnalyzing}
            />
          </CardContent>
        </Card>

        {analyzeResult && (
          <DocumentImportReview
            result={analyzeResult}
            getReference={() => form.getValues("reference") || ""}
            getHeader={() => {
              const toYmd = (d: unknown): string => {
                if (d instanceof Date && !isNaN(d.getTime())) {
                  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
                }
                return typeof d === "string" ? d : "";
              };
              return {
                shipper: form.getValues("shipper") || "",
                package: Number(form.getValues("package")) || 0,
                kg: Number(form.getValues("kg")) || 0,
                piece: Number(form.getValues("piece")) || 0,
                awbNumber: form.getValues("awb_number") || "",
                customs: form.getValues("customs") || "",
                importDeclarationNumber: form.getValues("import_dec_number") || "",
                importDeclarationDate: toYmd(form.getValues("import_dec_date")),
                usdTlRate: Number(form.getValues("usdtl_rate")) || 0,
                invoice_no: form.getValues("invoice_no") || "",
                invoice_date: toYmd(form.getValues("invoice_date")),
                amount: Number(form.getValues("amount")) || 0,
                currency: form.getValues("currency") || "USD",
              };
            }}
            onCreated={(reference) => setLocation(`/procedure-details?reference=${encodeURIComponent(reference)}`)}
          />
        )}

        <Card>
          <CardHeader>
            <CardTitle>{t("procedurePages.add.cardTitle")}</CardTitle>
            <CardDescription>
              {t("procedurePages.form.requiredHint")}
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
                          <Input placeholder={t("procedurePages.form.referencePlaceholder")} {...field} />
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
                            <Select onValueChange={field.onChange} defaultValue={field.value}>
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
                    onClick={handleCancel}
                    disabled={isSubmitting}
                  >
                    <XCircle className="mr-2 h-4 w-4" />
                    {t("procedurePages.form.cancel")}
                  </Button>
                  <Button type="submit" disabled={isSubmitting}>
                    <Save className="mr-2 h-4 w-4" />
                    {t("procedurePages.form.saveProcedure")}
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