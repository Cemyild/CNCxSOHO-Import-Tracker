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
  Calculator
} from "lucide-react"
import { useState, useEffect } from "react"
import { useQuery } from "@tanstack/react-query"
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
        title: "No Data to Export",
        description: "Please generate a report first before exporting to Excel.",
        variant: "destructive",
      })
      return
    }

    setIsExporting(true)
    
    try {
      // Extract the exact table structure from the DOM (same as Report Preview)
      const tableElement = document.querySelector('.report-preview-table table');
      if (!tableElement) {
        throw new Error('Report table not found. Please ensure the report is displayed first.');
      }
      
      // Get headers from the table
      const headerElements = tableElement.querySelectorAll('thead th');
      const headers = Array.from(headerElements).map(th => th.textContent?.trim() || '');
      
      // Get data rows from the table
      const rowElements = tableElement.querySelectorAll('tbody tr');
      const excelData = [headers];
      
      Array.from(rowElements).forEach(tr => {
        const cellElements = tr.querySelectorAll('td');
        const rowData = Array.from(cellElements).map(td => td.textContent?.trim() || '');
        excelData.push(rowData);
      });
      
      // Create Excel workbook
      const response = await fetch('/api/custom-report/export-excel', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          data: excelData,
          reportType: selectedReportType,
          dateRange: dateRange ? {
            from: format(dateRange.from!, 'yyyy-MM-dd'),
            to: format(dateRange.to!, 'yyyy-MM-dd')
          } : undefined,
          totalRows: reportData.length
        })
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
        title: "Excel Export Successful",
        description: `Successfully exported ${reportData.length} rows to Excel.`,
      })
    } catch (error) {
      console.error('Error exporting to Excel:', error)
      toast({
        title: "Export Failed",
        description: error instanceof Error ? error.message : "Failed to export to Excel. Please try again.",
        variant: "destructive",
      })
    } finally {
      setIsExporting(false)
    }
  }

  const generateReport = async () => {
    if (!selectedReportType) {
      toast({
        title: "Report Type Required",
        description: "Please select a report type to generate the report.",
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

      const response = await fetch('/api/custom-report/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(filters)
      })

      if (!response.ok) {
        throw new Error('Failed to generate report')
      }

      const result = await response.json()

      if (result.success) {
        setReportData(result.data)
        toast({
          title: "Report Generated",
          description: `Successfully generated ${result.totalRows} rows of data.`,
        })
      } else {
        throw new Error(result.error || 'Failed to generate report')
      }
    } catch (error) {
      console.error('Error generating report:', error)
      toast({
        title: "Generation Failed",
        description: error instanceof Error ? error.message : "Failed to generate report. Please try again.",
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
      title: "Report Configuration Applied",
      description: "Your custom report configuration has been set up successfully.",
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
    return `${value.length} shippers selected`
  }

  const renderSelectedCategories = (value: string[]) => {
    if (value.length === 0) return ""
    if (value.length === 1) {
      return currentCategoryOptions.find((c: BaseOption) => c.value === value[0])?.label
    }
    return `${value.length} columns selected`
  }
  return (
    <PageLayout title="Custom Reports" navItems={items}>
      <div className="container mx-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Custom Reports</h1>
            <p className="text-muted-foreground mt-2">
              Build and save custom reports with specific metrics and filters
            </p>
          </div>
          <div className="flex gap-2">
            <Button 
              onClick={() => setShowWizard(true)}
              className="flex items-center gap-2"
              variant="outline"
            >
              <Wand2 className="h-4 w-4" />
              Smart Wizard
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
                  Report Builder
                </CardTitle>
                <CardDescription>
                  Configure your custom report parameters and filters
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Report Type Selection */}
                <div>
                  <h3 className="text-lg font-semibold mb-3">Report Type</h3>
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
                          <h4 className="font-medium">Import Procedures Summary</h4>
                          <p className="text-sm text-muted-foreground">
                            Overview of all import procedure details
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
                          <h4 className="font-medium">Tax Details Summary</h4>
                          <p className="text-sm text-muted-foreground">
                            Comprehensive tax breakdown and analysis
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
                          <h4 className="font-medium">Import Expenses Summary</h4>
                          <p className="text-sm text-muted-foreground">
                            Detailed breakdown of import-related expenses
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
                          <h4 className="font-medium">Payment and Expense Summary</h4>
                          <p className="text-sm text-muted-foreground">
                            Combined view of payments and expenses
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
                          <h4 className="font-medium">All Details Summary</h4>
                          <p className="text-sm text-muted-foreground">
                            Comprehensive report with all available data
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
                    Filters
                  </h3>
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="text-sm font-medium mb-2 block">Date Range (Import Declaration Date)</label>
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
                                <span>Pick a date range</span>
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
                        <label className="text-sm font-medium mb-2 block">Shipper</label>
                        <MultiSelectCombobox
                          label="Shipper"
                          options={shipperOptions}
                          value={selectedShippers}
                          onChange={setSelectedShippers}
                          renderItem={renderShipperItem}
                          renderSelectedItem={renderSelectedShippers}
                          placeholder="Search shippers..."
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="text-sm font-medium mb-2 block">Category</label>
                        <MultiSelectCombobox
                          label="Category"
                          options={currentCategoryOptions}
                          value={selectedCategories}
                          onChange={setSelectedCategories}
                          renderItem={renderCategoryItem}
                          renderSelectedItem={renderSelectedCategories}
                          placeholder={selectedReportType ? "Search categories..." : "Select a report type first"}
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
              <CardTitle>Report Preview</CardTitle>
              <CardDescription>
                Preview your report before generating the final version
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!reportData ? (
                <div className="border-2 border-dashed border-muted rounded-lg p-8 text-center">
                  <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-muted-foreground mb-2">
                    No Report Generated
                  </h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Configure your report settings above and click "Generate Report" to see the preview
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
                          Generating...
                        </>
                      ) : (
                        <>
                          <BarChart2 className="h-4 w-4" />
                          Generate Report
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
                          Exporting...
                        </>
                      ) : (
                        <>
                          <Download className="h-4 w-4" />
                          Export Excel
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <div>
                      <h3 className="text-lg font-medium">Report Generated Successfully</h3>
                      <p className="text-sm text-muted-foreground">
                        {reportData.length} rows of data generated
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
                            Regenerating...
                          </>
                        ) : (
                          <>
                            <BarChart2 className="h-4 w-4" />
                            Regenerate
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
                            Exporting...
                          </>
                        ) : (
                          <>
                            <Download className="h-4 w-4" />
                            Export Excel
                          </>
                        )}
                      </Button>
                    </div>
                  </div>

                  <div className="border rounded-lg p-4 bg-muted/20">
                    <h4 className="font-medium mb-2">Report Summary</h4>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <div>
                        <span className="text-muted-foreground">Report Type:</span>
                        <p className="font-medium capitalize">{selectedReportType?.replace('_', ' ')}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Total Rows:</span>
                        <p className="font-medium">{reportData.length}</p>
                      </div>
                      {selectedShippers.length > 0 && (
                        <div>
                          <span className="text-muted-foreground">Shippers:</span>
                          <p className="font-medium">{selectedShippers.length} selected</p>
                        </div>
                      )}
                      {dateRange && (
                        <div>
                          <span className="text-muted-foreground">Date Range:</span>
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
                          {reportData[0] && Object.keys(reportData[0]).map((key) => {
                            // Check if this is an expense category that might have multiple entries
                            const isExpenseCategory = [
                              'export_registry_fee', 'insurance', 'awb_fee', 'airport_storage_fee',
                              'bonded_warehouse_storage_fee', 'transportation', 'international_transportation',
                              'tareks_fee', 'customs_inspection', 'azo_test', 'other', 'service_invoice'
                            ].includes(key);

                            if (isExpenseCategory) {
                              // Find the maximum number of entries for this category across all rows
                              const maxEntries = Math.max(1, ...reportData.map(row => {
                                const value = row[key];
                                if (!value || value === '' || value === '-') return 1;
                                // Count semicolon separators + 1 to get number of entries
                                return (value.match(/;/g) || []).length + 1;
                              }));

                              // Create multiple column headers if more than 1 entry
                              if (maxEntries > 1) {
                                return Array.from({ length: maxEntries }, (_, index) => (
                                  <th key={`${key}_${index}`} className="text-left p-2 border-b font-medium capitalize min-w-[200px]">
                                    {key.replace(/_/g, ' ')} {index + 1}
                                  </th>
                                ));
                              }
                            }

                            return (
                              <th key={key} className="text-left p-2 border-b font-medium capitalize">
                                {key.replace(/_/g, ' ')}
                              </th>
                            );
                          }).flat()}
                        </tr>
                      </thead>
                      <tbody>
                        {reportData.slice(0, 10).map((row, index) => (
                          <tr key={index} className="border-b hover:bg-muted/20">
                            {Object.entries(row).map(([key, value], cellIndex) => {
                              // Check if this is an expense category that might have multiple entries
                              const isExpenseCategory = [
                                'export_registry_fee', 'insurance', 'awb_fee', 'airport_storage_fee',
                                'bonded_warehouse_storage_fee', 'transportation', 'international_transportation',
                                'tareks_fee', 'customs_inspection', 'azo_test', 'other', 'service_invoice'
                              ].includes(key);

                              // Check if this column contains expense-related data for formatting
                              const isExpenseColumn = key.includes('export_registry_fee') || 
                                                     key.includes('insurance') || 
                                                     key.includes('awb_fee') || 
                                                     key.includes('airport_storage_fee') || 
                                                     key.includes('bonded_warehouse_storage_fee') || 
                                                     key.includes('transportation') || 
                                                     key.includes('international_transportation') || 
                                                     key.includes('tareks_fee') || 
                                                     key.includes('customs_inspection') || 
                                                     key.includes('azo_test') || 
                                                     key.includes('other') ||
                                                     key.includes('import_expenses') ||
                                                     key.includes('total_expenses') ||
                                                     key.includes('total_payments') ||
                                                     key.includes('remaining_balance') ||
                                                     key.includes('payment_distributions') ||
                                                     key.includes('service_invoice') ||
                                                     key.includes('customs_tax') ||
                                                     key.includes('additional_customs_tax') ||
                                                     key.includes('kkdf') ||
                                                     key.includes('vat') ||
                                                     key.includes('stamp_tax') ||
                                                     key.includes('total_tax');

                              // Check if this is the Amount column (invoice value)
                              const isAmountColumn = key.toLowerCase() === 'amount';

                              // Get currency from the same row if available
                              const currency = row.currency || row.Currency;

                              if (isExpenseCategory) {
                                // Split multiple expenses into separate columns
                                const expenseEntries = value && value !== '' && value !== '-' 
                                  ? String(value).split(';').map(entry => entry.trim()).filter(entry => entry)
                                  : [];

                                // Find the maximum number of entries for this category across all rows
                                const maxEntries = Math.max(1, ...reportData.map(r => {
                                  const v = r[key];
                                  if (!v || v === '' || v === '-') return 1;
                                  return (String(v).match(/;/g) || []).length + 1;
                                }));

                                // Create cells for each entry
                                if (maxEntries > 1) {
                                  return Array.from({ length: maxEntries }, (_, entryIndex) => {
                                    const entryValue = expenseEntries[entryIndex] || '-';
                                    let displayValue = entryValue;

                                    // Apply Turkish Lira formatting if it's an expense
                                    if (entryValue !== '-' && isExpenseColumn) {
                                      displayValue = formatTurkishLira(entryValue);
                                    }

                                    return (
                                      <td key={`${cellIndex}_${entryIndex}`} className="p-2 text-xs min-w-[200px]">
                                        {displayValue}
                                      </td>
                                    );
                                  });
                                }
                              }

                              // Handle regular columns
                              let displayValue = String(value) || '-';

                              if (isExpenseColumn) {
                                displayValue = formatTurkishLira(value);
                              } else if (isAmountColumn && value && value !== '-' && value !== '' && value !== 0) {
                                // Format amount with currency symbol and decimal separators
                                const numValue = parseFloat(String(value));
                                if (!isNaN(numValue) && numValue !== 0) {
                                  const formattedAmount = numValue.toLocaleString('en-US', { 
                                    minimumFractionDigits: 2, 
                                    maximumFractionDigits: 2 
                                  });

                                  // Add currency symbol based on currency type
                                  if (currency === 'USD') {
                                    displayValue = `$${formattedAmount}`;
                                  } else if (currency === 'EUR') {
                                    displayValue = `€${formattedAmount}`;
                                  } else if (currency === 'TRY' || currency === 'TL') {
                                    displayValue = `₺${formattedAmount}`;
                                  } else if (currency) {
                                    displayValue = `${currency} ${formattedAmount}`;
                                  } else {
                                    // Default to USD if no currency is specified
                                    displayValue = `$${formattedAmount}`;
                                  }
                                }
                              }

                              return (
                                <td key={cellIndex} className="p-2 text-xs">
                                  {displayValue}
                                </td>
                              );
                            }).flat()}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {reportData.length > 10 && (
                      <div className="p-2 text-center text-sm text-muted-foreground bg-muted/20">
                        Showing first 10 rows of {reportData.length} total rows
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