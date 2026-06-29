import { 
  Calendar,
  Home,
  Inbox,
  Search,
  Settings,
  BarChart2,
  FileText,
  Filter,
  Download,
  Plus,
  CalendarIcon,
  Wand2,
  Calculator,
  Sparkles
} from "lucide-react"
import { useState, useEffect, useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { format } from "date-fns"
import { useToast } from "@/hooks/use-toast"
import { apiRequest } from "@/lib/queryClient"
import { DateRange } from "react-day-picker"
import { PageLayout } from "@/components/layout/PageLayout"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { MultiSelectCombobox, BaseOption } from "@/components/ui/multi-select-combobox"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar as CalendarComponent } from "@/components/ui/calendar"
import { cn } from "@/lib/utils"
import { ReportWizard } from "@/components/ui/report-wizard"

// Menu items
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
    title: "Tax Calculation",
    url: "/tax-calculation",
    icon: Calculator,
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
]

// Report types
type ReportType = 'import_procedures' | 'tax_details' | 'import_expenses' | 'payment_expense' | 'all_details' | null;

// Category options for different report types
const categoryOptionsByType: Record<string, BaseOption[]> = {
  import_procedures: [
    { value: "shipper", label: "Shipper" },
    { value: "invoice_no", label: "Invoice Number" },
    { value: "invoice_date", label: "Invoice Date" },
    { value: "amount", label: "Invoice Amount" },
    { value: "piece", label: "Pieces" },
    { value: "package", label: "Package" },
    { value: "kg", label: "Weight" },
    { value: "arrival_date", label: "Arrival Date" },
    { value: "awb_number", label: "AWB Number" },
    { value: "carrier", label: "Carrier" },
    { value: "customs", label: "Customs" },
    { value: "import_dec_number", label: "Import Declaration Number" },
    { value: "import_dec_date", label: "Import Declaration Date" },
  ],
  tax_details: [
    { value: "shipper", label: "Shipper" },
    { value: "invoice_no", label: "Invoice Number" },
    { value: "invoice_date", label: "Invoice Date" },
    { value: "amount", label: "Invoice Amount" },
    { value: "piece", label: "Pieces" },
    { value: "customs_tax", label: "Customs Tax" },
    { value: "additional_customs_tax", label: "Additional Customs Tax" },
    { value: "kkdf", label: "KKDF" },
    { value: "vat", label: "VAT" },
    { value: "stamp_tax", label: "Stamp Tax" },
  ],
  import_expenses: [
    { value: "shipper", label: "Shipper" },
    { value: "invoice_no", label: "Invoice Number" },
    { value: "invoice_date", label: "Invoice Date" },
    { value: "amount", label: "Invoice Amount" },
    { value: "piece", label: "Pieces" },
    { value: "export_registry_fee", label: "Export Registry Fee" },
    { value: "insurance", label: "Insurance" },
    { value: "awb_fee", label: "Awb Fee" },
    { value: "airport_storage_fee", label: "Airport Storage Fee" },
    { value: "bonded_warehouse_storage_fee", label: "Bonded Warehouse Storage Fee" },
    { value: "transportation", label: "Transportation" },
    { value: "international_transportation", label: "International Transportation" },
    { value: "tareks_fee", label: "Tareks Fee" },
    { value: "customs_inspection", label: "Customs Inspection" },
    { value: "azo_test", label: "Azo Test" },
    { value: "other", label: "Other" },
    { value: "service_invoice", label: "Service Invoice" },
  ],
  payment_expense: [
    { value: "shipper", label: "Shipper" },
    { value: "invoice_no", label: "Invoice Number" },
    { value: "invoice_date", label: "Invoice Date" },
    { value: "amount", label: "Invoice Amount" },
    { value: "piece", label: "Pieces" },
    { value: "total_expenses", label: "Total Expenses" },
    { value: "payment_distributions", label: "Payment Distributions" },
    { value: "remaining_balance", label: "Remaining Balance" },
  ],
  all_details: [
    { value: "shipper", label: "Shipper" },
    { value: "invoice_no", label: "Invoice Number" },
    { value: "invoice_date", label: "Invoice Date" },
    { value: "amount", label: "Invoice Amount" },
    { value: "piece", label: "Pieces" },
    { value: "package", label: "Package" },
    { value: "kg", label: "Weight" },
    { value: "arrival_date", label: "Arrival Date" },
    { value: "awb_number", label: "AWB Number" },
    { value: "carrier", label: "Carrier" },
    { value: "customs", label: "Customs" },
    { value: "import_dec_number", label: "Import Declaration Number" },
    { value: "import_dec_date", label: "Import Declaration Date" },
    { value: "customs_tax", label: "Customs Tax" },
    { value: "additional_customs_tax", label: "Additional Customs Tax" },
    { value: "kkdf", label: "KKDF" },
    { value: "vat", label: "VAT" },
    { value: "stamp_tax", label: "Stamp Tax" },
    { value: "export_registry_fee", label: "Export Registry Fee" },
    { value: "insurance", label: "Insurance" },
    { value: "awb_fee", label: "Awb Fee" },
    { value: "airport_storage_fee", label: "Airport Storage Fee" },
    { value: "bonded_warehouse_storage_fee", label: "Bonded Warehouse Storage Fee" },
    { value: "transportation", label: "Transportation" },
    { value: "international_transportation", label: "International Transportation" },
    { value: "tareks_fee", label: "Tareks Fee" },
    { value: "customs_inspection", label: "Customs Inspection" },
    { value: "azo_test", label: "Azo Test" },
    { value: "other", label: "Other" },
    { value: "service_invoice", label: "Service Invoice" },
    { value: "total_expenses", label: "Total Expenses" },
    { value: "payment_distributions", label: "Payment Distributions" },
    { value: "remaining_balance", label: "Remaining Balance" },
  ]
}

// Expense category columns that can hold multiple semicolon-separated entries and need
// to be expanded into N adjacent columns (where N = max entries across all rows).
const EXPENSE_CATEGORIES = new Set([
  'export_registry_fee', 'insurance', 'awb_fee', 'airport_storage_fee',
  'bonded_warehouse_storage_fee', 'transportation', 'international_transportation',
  'tareks_fee', 'customs_inspection', 'azo_test', 'other', 'service_invoice',
]);

// Columns whose values represent Turkish Lira amounts and should be formatted accordingly.
const EXPENSE_COLUMN_KEYWORDS = [
  'export_registry_fee', 'insurance', 'awb_fee', 'airport_storage_fee',
  'bonded_warehouse_storage_fee', 'transportation', 'international_transportation',
  'tareks_fee', 'customs_inspection', 'azo_test', 'other',
  'import_expenses', 'total_expenses', 'total_payments', 'remaining_balance',
  'payment_distributions', 'service_invoice',
  'customs_tax', 'additional_customs_tax', 'kkdf', 'vat', 'stamp_tax', 'total_tax',
];

interface Procedure {
  id: number;
  reference: string;
  shipper: string;
  invoice_no: string;
  invoice_date: string | null;
  amount: string;
  currency: string;
  package: string;
  kg: string;
  piece: number;
  arrival_date: string | null;
  awb_number: string;
  carrier: string;
  customs: string;
  import_dec_number: string;
  import_dec_date: string | null;
  payment_status: string;
  document_status: string;
  shipment_status: string;
  assignedTo: number;
  createdBy: number;
  createdAt: string;
  updatedAt: string;
  usdtl_rate?: number;
}

export default function CustomReportPage() {
  const [selectedShippers, setSelectedShippers] = useState<string[]>([])
  const [selectedCategories, setSelectedCategories] = useState<string[]>([])
  const [shipperOptions, setShipperOptions] = useState<BaseOption[]>([])
  const [dateRange, setDateRange] = useState<DateRange | undefined>()
  const [selectedReportType, setSelectedReportType] = useState<ReportType>(null)
  const [currentCategoryOptions, setCurrentCategoryOptions] = useState<BaseOption[]>([])
  const [isGenerating, setIsGenerating] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [reportData, setReportData] = useState<any[] | null>(null)
  const [showWizard, setShowWizard] = useState(false)
  const { toast } = useToast()
  const { t } = useTranslation()

  // Turkish Lira formatting function
  const formatTurkishLira = (value: any): string => {
    if (!value || value === '' || value === 0 || value === '0') return '-';

    const stringValue = String(value);

    // Check if the value contains "TRY" currency code
    if (stringValue.includes('TRY')) {
      // Replace all occurrences of "TRY" with "₺" and format the numbers
      return stringValue.replace(/(\d+(?:\.\d{2})?)\s*TRY/g, (match, amount) => {
        const numAmount = parseFloat(amount);
        return `₺${numAmount.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      });
    }

    // For numeric values, format as Turkish Lira
    const numValue = parseFloat(stringValue);
    if (!isNaN(numValue) && numValue !== 0) {
      return `₺${numValue.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }

    return stringValue;
  }

  // Format a single cell value the same way the preview JSX does — used by both the
  // preview render and the Excel export, so they stay in sync.
  const formatCellValue = (key: string, value: any, currency?: any): string => {
    const isExpenseColumn = EXPENSE_COLUMN_KEYWORDS.some((kw) => key.includes(kw));
    const isAmountColumn = key.toLowerCase() === 'amount';

    if (isExpenseColumn) {
      return formatTurkishLira(value);
    }
    if (isAmountColumn && value && value !== '-' && value !== '' && value !== 0) {
      const numValue = parseFloat(String(value));
      if (!isNaN(numValue) && numValue !== 0) {
        const formatted = numValue.toLocaleString('en-US', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });
        if (currency === 'USD') return `$${formatted}`;
        if (currency === 'EUR') return `€${formatted}`;
        if (currency === 'TRY' || currency === 'TL') return `₺${formatted}`;
        if (currency) return `${currency} ${formatted}`;
        return `$${formatted}`;
      }
    }
    return String(value ?? '') || '-';
  };

  // Build the full headers + 2-D rows for both preview and Excel export.
  // Memoised so the export reuses the same shape without re-walking on every keystroke.
  const tableData = useMemo<{ headers: string[]; rows: string[][] }>(() => {
    if (!reportData || reportData.length === 0) return { headers: [], rows: [] };

    const keys = Object.keys(reportData[0]);

    // Pass 1: compute how many sub-columns each expense category needs
    const maxEntriesByKey = new Map<string, number>();
    for (const key of keys) {
      if (EXPENSE_CATEGORIES.has(key)) {
        const maxEntries = Math.max(1, ...reportData.map((row) => {
          const v = row[key];
          if (!v || v === '' || v === '-') return 1;
          return (String(v).match(/;/g) || []).length + 1;
        }));
        maxEntriesByKey.set(key, maxEntries);
      } else {
        maxEntriesByKey.set(key, 1);
      }
    }

    // Pass 2: build headers
    const headers: string[] = [];
    for (const key of keys) {
      const maxEntries = maxEntriesByKey.get(key) || 1;
      const label = key.replace(/_/g, ' ');
      if (maxEntries > 1) {
        for (let i = 0; i < maxEntries; i++) headers.push(`${label} ${i + 1}`);
      } else {
        headers.push(label);
      }
    }

    // Pass 3: build rows
    const rows = reportData.map((row) => {
      const cells: string[] = [];
      const currency = row.currency || row.Currency;
      for (const key of keys) {
        const maxEntries = maxEntriesByKey.get(key) || 1;
        const value = row[key];
        if (maxEntries > 1) {
          const entries = value && value !== '' && value !== '-'
            ? String(value).split(';').map((e) => e.trim()).filter(Boolean)
            : [];
          const isExpenseColumn = EXPENSE_COLUMN_KEYWORDS.some((kw) => key.includes(kw));
          for (let i = 0; i < maxEntries; i++) {
            const entryValue = entries[i] || '-';
            cells.push(entryValue !== '-' && isExpenseColumn ? formatTurkishLira(entryValue) : entryValue);
          }
        } else {
          cells.push(formatCellValue(key, value, currency));
        }
      }
      return cells;
    });

    return { headers, rows };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportData]);

  // Fetch procedures data to get real shippers
  const { data: proceduresData, isLoading: isLoadingProcedures } = useQuery({
    queryKey: ["/api/procedures"],
    queryFn: async () => {
      const response = await fetch("/api/procedures");
      if (!response.ok) {
        throw new Error("Failed to fetch procedures");
      }
      return response.json();
    },
  });

  // Extract unique shippers from procedures data
  useEffect(() => {
    if (proceduresData?.procedures) {
      const shippers = proceduresData.procedures
        .map((proc: Procedure) => proc.shipper)
        .filter((shipper: string) => shipper && shipper.trim() !== "");

      const uniqueShipperSet = new Set(shippers);
      const uniqueShippers: BaseOption[] = [];

      for (const shipper of Array.from(uniqueShipperSet)) {
        uniqueShippers.push({
          value: String(shipper),
          label: String(shipper)
        });
      }

      setShipperOptions(uniqueShippers);
    }
  }, [proceduresData]);

  // Handle report type selection
  const handleReportTypeSelect = (reportType: ReportType) => {
    setSelectedReportType(reportType);
    if (reportType && categoryOptionsByType[reportType]) {
      setCurrentCategoryOptions(categoryOptionsByType[reportType]);
      setSelectedCategories([]); // Reset selected categories when changing report type
    }
    setReportData(null); // Clear previous report data
  };

  const exportToExcel = async () => {
    if (!reportData || reportData.length === 0) {
      toast({
        title: t('reportsPages.custom.noDataToExportTitle'),
        description: t('reportsPages.custom.noDataToExportDesc'),
        variant: "destructive",
      })
      return
    }

    setIsExporting(true)

    try {
      // Build the 2-D array directly from the full reportData (NOT from the DOM —
      // the preview only renders the first 10 rows, so DOM scraping was truncating
      // the export to 10 rows). Uses the same formatter the preview uses.
      if (tableData.rows.length === 0) {
        throw new Error('Report data is empty.');
      }
      const excelData: string[][] = [tableData.headers, ...tableData.rows];
      
      // Create Excel workbook
      const response = await apiRequest('POST', '/api/custom-report/export-excel', {
        data: excelData,
        reportType: selectedReportType,
        dateRange: dateRange ? {
          from: format(dateRange.from!, 'yyyy-MM-dd'),
          to: format(dateRange.to!, 'yyyy-MM-dd')
        } : undefined,
        totalRows: reportData.length
      })

      if (!response.ok) {
        throw new Error('Failed to export Excel file')
      }

      // Download the Excel file
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      
      const reportTypeNames = {
        'procedure_details': 'Procedure Details',
        'import_expenses': 'Import Expenses',
        'payment_expense': 'Payment and Expense Summary'
      }
      
      const reportName = reportTypeNames[selectedReportType as keyof typeof reportTypeNames] || 'Custom Report'
      const dateStr = format(new Date(), 'yyyyMMdd_HHmmss')
      link.download = `${reportName.replace(/\s+/g, '_')}_${dateStr}.xlsx`
      
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)

      toast({
        title: t('reportsPages.custom.exportSuccessTitle'),
        description: t('reportsPages.custom.exportSuccessDesc', { count: reportData.length }),
      })
    } catch (error) {
      console.error('Error exporting to Excel:', error)
      toast({
        title: t('reportsPages.custom.exportFailedTitle'),
        description: error instanceof Error ? error.message : t('reportsPages.custom.exportFailedDesc'),
        variant: "destructive",
      })
    } finally {
      setIsExporting(false)
    }
  }

  const generateReport = async () => {
    if (!selectedReportType) {
      toast({
        title: t('reportsPages.custom.reportTypeRequiredTitle'),
        description: t('reportsPages.custom.reportTypeRequiredDesc'),
        variant: "destructive",
      })
      return
    }

    setIsGenerating(true)

    try {
      const filters = {
        reportType: selectedReportType,
        dateRange: dateRange ? {
          from: format(dateRange.from!, 'yyyy-MM-dd'),
          to: format(dateRange.to!, 'yyyy-MM-dd')
        } : undefined,
        shippers: selectedShippers.length > 0 ? selectedShippers : undefined,
        categories: selectedCategories.length > 0 ? selectedCategories : undefined
      }

      const response = await apiRequest('POST', '/api/custom-report/generate', filters)

      if (!response.ok) {
        throw new Error('Failed to generate report')
      }

      const result = await response.json()

      if (result.success) {
        setReportData(result.data)
        toast({
          title: t('reportsPages.custom.reportGeneratedTitle'),
          description: t('reportsPages.custom.reportGeneratedDesc', { count: result.totalRows }),
        })
      } else {
        throw new Error(result.error || 'Failed to generate report')
      }
    } catch (error) {
      console.error('Error generating report:', error)
      toast({
        title: t('reportsPages.custom.generationFailedTitle'),
        description: error instanceof Error ? error.message : t('reportsPages.custom.generationFailedDesc'),
        variant: "destructive",
      })
    } finally {
      setIsGenerating(false)
    }
  }



  // Handle wizard completion
  const handleWizardComplete = (config: any) => {
    setSelectedReportType(config.reportType)
    setSelectedCategories(config.categories)

    // Apply filters if included
    if (config.includeFilters && config.dateRange) {
      setDateRange(config.dateRange)
    }

    setShowWizard(false)

    toast({
      title: t('reportsPages.custom.configAppliedTitle'),
      description: t('reportsPages.custom.configAppliedDesc'),
    })
  }

  // Render functions for multi-select components
  const renderShipperItem = (option: BaseOption) => option.label
  const renderCategoryItem = (option: BaseOption) => option.label

  const renderSelectedShippers = (value: string[]) => {
    if (value.length === 0) return ""
    if (value.length === 1) {
      return shipperOptions.find((s: BaseOption) => s.value === value[0])?.label
    }
    return t('reportsPages.custom.shippersSelected', { count: value.length })
  }

  const renderSelectedCategories = (value: string[]) => {
    if (value.length === 0) return ""
    if (value.length === 1) {
      return currentCategoryOptions.find((c: BaseOption) => c.value === value[0])?.label
    }
    return t('reportsPages.custom.columnsSelected', { count: value.length })
  }
  return (
    <PageLayout title={t('reportsPages.custom.pageTitle')} navItems={items}>
      <div className="container mx-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{t('reportsPages.custom.heading')}</h1>
            <p className="text-muted-foreground mt-2">
              {t('reportsPages.custom.subtitle')}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={() => setShowWizard(true)}
              className="flex items-center gap-2"
              variant="outline"
            >
              <Wand2 className="h-4 w-4" />
              {t('reportsPages.custom.smartWizard')}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6">
          {/* Report Builder */}
          <div>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  {t('reportsPages.custom.reportBuilder')}
                </CardTitle>
                <CardDescription>
                  {t('reportsPages.custom.reportBuilderDesc')}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Report Type Selection */}
                <div>
                  <h3 className="text-lg font-semibold mb-3">{t('reportsPages.custom.reportType')}</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    <div 
                      className={`border rounded-lg p-4 cursor-pointer hover:bg-muted/50 transition-colors ${
                        selectedReportType === 'import_procedures' ? 'border-primary bg-primary/5' : ''
                      }`}
                      onClick={() => handleReportTypeSelect('import_procedures')}
                    >
                      <div className="flex items-center gap-3">
                        <Inbox className="h-6 w-6 text-primary" />
                        <div>
                          <h4 className="font-medium">{t('reportsPages.custom.typeImportProceduresTitle')}</h4>
                          <p className="text-sm text-muted-foreground">
                            {t('reportsPages.custom.typeImportProceduresDesc')}
                          </p>
                        </div>
                      </div>
                    </div>
                    <div 
                      className={`border rounded-lg p-4 cursor-pointer hover:bg-muted/50 transition-colors ${
                        selectedReportType === 'tax_details' ? 'border-primary bg-primary/5' : ''
                      }`}
                      onClick={() => handleReportTypeSelect('tax_details')}
                    >
                      <div className="flex items-center gap-3">
                        <Calendar className="h-6 w-6 text-primary" />
                        <div>
                          <h4 className="font-medium">{t('reportsPages.custom.typeTaxDetailsTitle')}</h4>
                          <p className="text-sm text-muted-foreground">
                            {t('reportsPages.custom.typeTaxDetailsDesc')}
                          </p>
                        </div>
                      </div>
                    </div>
                    <div 
                      className={`border rounded-lg p-4 cursor-pointer hover:bg-muted/50 transition-colors ${
                        selectedReportType === 'import_expenses' ? 'border-primary bg-primary/5' : ''
                      }`}
                      onClick={() => handleReportTypeSelect('import_expenses')}
                    >
                      <div className="flex items-center gap-3">
                        <BarChart2 className="h-6 w-6 text-primary" />
                        <div>
                          <h4 className="font-medium">{t('reportsPages.custom.typeImportExpensesTitle')}</h4>
                          <p className="text-sm text-muted-foreground">
                            {t('reportsPages.custom.typeImportExpensesDesc')}
                          </p>
                        </div>
                      </div>
                    </div>
                    <div 
                      className={`border rounded-lg p-4 cursor-pointer hover:bg-muted/50 transition-colors ${
                        selectedReportType === 'payment_expense' ? 'border-primary bg-primary/5' : ''
                      }`}
                      onClick={() => handleReportTypeSelect('payment_expense')}
                    >
                      <div className="flex items-center gap-3">
                        <Search className="h-6 w-6 text-primary" />
                        <div>
                          <h4 className="font-medium">{t('reportsPages.custom.typePaymentExpenseTitle')}</h4>
                          <p className="text-sm text-muted-foreground">
                            {t('reportsPages.custom.typePaymentExpenseDesc')}
                          </p>
                        </div>
                      </div>
                    </div>
                    <div 
                      className={`border rounded-lg p-4 cursor-pointer hover:bg-muted/50 transition-colors ${
                        selectedReportType === 'all_details' ? 'border-primary bg-primary/5' : ''
                      }`}
                      onClick={() => handleReportTypeSelect('all_details')}
                    >
                      <div className="flex items-center gap-3">
                        <FileText className="h-6 w-6 text-primary" />
                        <div>
                          <h4 className="font-medium">{t('reportsPages.custom.typeAllDetailsTitle')}</h4>
                          <p className="text-sm text-muted-foreground">
                            {t('reportsPages.custom.typeAllDetailsDesc')}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Filters Section */}
                <div>
                  <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                    <Filter className="h-5 w-5" />
                    {t('reportsPages.custom.filters')}
                  </h3>
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="text-sm font-medium mb-2 block">{t('reportsPages.custom.dateRangeLabel')}</label>
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button
                              id="date"
                              variant="outline"
                              className={cn(
                                "w-full justify-start text-left font-normal",
                                !dateRange && "text-muted-foreground"
                              )}
                            >
                              <CalendarIcon className="mr-2 h-4 w-4" />
                              {dateRange?.from ? (
                                dateRange.to ? (
                                  <>
                                    {format(dateRange.from, "LLL dd, y")} -{" "}
                                    {format(dateRange.to, "LLL dd, y")}
                                  </>
                                ) : (
                                  format(dateRange.from, "LLL dd, y")
                                )
                              ) : (
                                <span>{t('reportsPages.custom.pickDateRange')}</span>
                              )}
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="start">
                            <CalendarComponent
                              initialFocus
                              mode="range"
                              defaultMonth={dateRange?.from}
                              selected={dateRange}
                              onSelect={setDateRange}
                              numberOfMonths={2}
                            />
                          </PopoverContent>
                        </Popover>
                      </div>
                      <div>
                        <label className="text-sm font-medium mb-2 block">{t('reportsPages.custom.shipper')}</label>
                        <MultiSelectCombobox
                          label={t('reportsPages.custom.shipper')}
                          options={shipperOptions}
                          value={selectedShippers}
                          onChange={setSelectedShippers}
                          renderItem={renderShipperItem}
                          renderSelectedItem={renderSelectedShippers}
                          placeholder={t('reportsPages.custom.searchShippers')}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="text-sm font-medium mb-2 block">{t('reportsPages.custom.category')}</label>
                        <MultiSelectCombobox
                          label={t('reportsPages.custom.category')}
                          options={currentCategoryOptions}
                          value={selectedCategories}
                          onChange={setSelectedCategories}
                          renderItem={renderCategoryItem}
                          renderSelectedItem={renderSelectedCategories}
                          placeholder={selectedReportType ? t('reportsPages.custom.searchCategories') : t('reportsPages.custom.selectReportTypeFirst')}
                        />
                      </div>
                    </div>
                  </div>
                </div>


              </CardContent>
            </Card>
          </div>

        </div>

        {/* Report Preview Area */}
        <div className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>{t('reportsPages.custom.reportPreview')}</CardTitle>
              <CardDescription>
                {t('reportsPages.custom.reportPreviewDesc')}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!reportData ? (
                <div className="border-2 border-dashed border-muted rounded-lg p-8 text-center">
                  <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-muted-foreground mb-2">
                    {t('reportsPages.custom.noReportGenerated')}
                  </h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    {t('reportsPages.custom.noReportGeneratedHint')}
                  </p>
                  <div className="flex gap-2 justify-center">
                    <Button 
                      onClick={generateReport} 
                      disabled={!selectedReportType || isGenerating}
                      className="flex items-center gap-2"
                    >
                      {isGenerating ? (
                        <>
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                          {t('reportsPages.custom.generating')}
                        </>
                      ) : (
                        <>
                          <BarChart2 className="h-4 w-4" />
                          {t('reportsPages.custom.generateReport')}
                        </>
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={exportToExcel}
                      disabled={!selectedReportType || isExporting}
                      className="flex items-center gap-2"
                    >
                      {isExporting ? (
                        <>
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>
                          {t('reportsPages.custom.exporting')}
                        </>
                      ) : (
                        <>
                          <Download className="h-4 w-4" />
                          {t('reportsPages.custom.exportExcel')}
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <div>
                      <h3 className="text-lg font-medium">{t('reportsPages.custom.reportGeneratedSuccess')}</h3>
                      <p className="text-sm text-muted-foreground">
                        {t('reportsPages.custom.rowsGenerated', { count: reportData.length })}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button 
                        onClick={generateReport} 
                        disabled={isGenerating}
                        variant="outline"
                        size="sm"
                        className="flex items-center gap-2"
                      >
                        {isGenerating ? (
                          <>
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>
                            {t('reportsPages.custom.regenerating')}
                          </>
                        ) : (
                          <>
                            <BarChart2 className="h-4 w-4" />
                            {t('reportsPages.custom.regenerate')}
                          </>
                        )}
                      </Button>
                      <Button
                        onClick={exportToExcel}
                        disabled={isExporting}
                        size="sm"
                        className="flex items-center gap-2"
                      >
                        {isExporting ? (
                          <>
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                            {t('reportsPages.custom.exporting')}
                          </>
                        ) : (
                          <>
                            <Download className="h-4 w-4" />
                            {t('reportsPages.custom.exportExcel')}
                          </>
                        )}
                      </Button>
                    </div>
                  </div>

                  <div className="border rounded-lg p-4 bg-muted/20">
                    <h4 className="font-medium mb-2">{t('reportsPages.custom.reportSummary')}</h4>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <div>
                        <span className="text-muted-foreground">{t('reportsPages.custom.reportTypeLabel')}</span>
                        <p className="font-medium capitalize">{selectedReportType?.replace('_', ' ')}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">{t('reportsPages.custom.totalRowsLabel')}</span>
                        <p className="font-medium">{reportData.length}</p>
                      </div>
                      {selectedShippers.length > 0 && (
                        <div>
                          <span className="text-muted-foreground">{t('reportsPages.custom.shippersLabel')}</span>
                          <p className="font-medium">{t('reportsPages.custom.countSelected', { count: selectedShippers.length })}</p>
                        </div>
                      )}
                      {dateRange && (
                        <div>
                          <span className="text-muted-foreground">{t('reportsPages.custom.dateRangeSummaryLabel')}</span>
                          <p className="font-medium text-xs">
                            {format(dateRange.from!, 'dd/MM/yyyy')} - {format(dateRange.to!, 'dd/MM/yyyy')}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="border rounded-lg max-h-96 overflow-auto report-preview-table">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 sticky top-0">
                        <tr>
                          {tableData.headers.map((header, i) => (
                            <th
                              key={i}
                              className="text-left p-2 border-b font-medium capitalize min-w-[120px]"
                            >
                              {header}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {tableData.rows.slice(0, 10).map((row, rowIndex) => (
                          <tr key={rowIndex} className="border-b hover:bg-muted/20">
                            {row.map((cell, cellIndex) => (
                              <td key={cellIndex} className="p-2 text-xs">
                                {cell}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {tableData.rows.length > 10 && (
                      <div className="p-2 text-center text-sm text-muted-foreground bg-muted/20">
                        {t('reportsPages.custom.showingFirstRows', { total: tableData.rows.length })}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Smart Report Wizard */}
      {showWizard && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-background rounded-lg shadow-lg max-w-6xl w-full max-h-[90vh] overflow-auto m-4">
            <ReportWizard
              onComplete={handleWizardComplete}
              onCancel={() => setShowWizard(false)}
            />
          </div>
        </div>
      )}
    </PageLayout>
  )
}