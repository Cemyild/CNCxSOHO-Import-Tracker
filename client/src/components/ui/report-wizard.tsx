import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
import { ChevronRight, ChevronLeft, Wand2, FileSpreadsheet, Eye, Settings } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

interface WizardStep {
  id: number;
  title: string;
  description: string;
  icon: any;
}

interface ReportWizardProps {
  onComplete: (config: any) => void;
  onCancel: () => void;
}

const wizardSteps: WizardStep[] = [
  {
    id: 1,
    title: "Report Type",
    description: "Choose the type of report you want to create",
    icon: FileSpreadsheet
  },
  {
    id: 2,
    title: "Data Categories",
    description: "Select which data categories to include",
    icon: Settings
  },
  {
    id: 3,
    title: "Format & Layout",
    description: "Customize the appearance and format",
    icon: Eye
  },
  {
    id: 4,
    title: "Review & Generate",
    description: "Review your selections and create the report",
    icon: Wand2
  }
];

const reportTypes = [
  {
    id: 'import_procedures',
    name: 'Import Procedures Report',
    description: 'Basic procedure information including shipper, invoice details, and import data',
    categories: ['shipper', 'invoice_no', 'invoice_date', 'amount', 'piece', 'package', 'kg', 'arrival_date', 'carrier', 'awb_number', 'import_dec_number', 'customs', 'import_dec_date']
  },
  {
    id: 'import_expenses',
    name: 'Import Expenses Report',
    description: 'Detailed breakdown of all import-related expenses and service invoices',
    categories: ['shipper', 'invoice_no', 'export_registry_fee', 'insurance', 'awb_fee', 'airport_storage_fee', 'bonded_warehouse_storage_fee', 'transportation', 'international_transportation', 'tareks_fee', 'customs_inspection', 'azo_test', 'other', 'service_invoice']
  },
  {
    id: 'tax_details',
    name: 'Tax Details Report',
    description: 'Complete tax information including customs, VAT, and other tax components',
    categories: ['shipper', 'invoice_no', 'customs_tax', 'additional_customs_tax', 'kkdf', 'vat', 'stamp_tax']
  },
  {
    id: 'payment_expense',
    name: 'Payment & Expense Summary',
    description: 'Financial overview with payment distributions and expense summaries',
    categories: ['shipper', 'invoice_no', 'invoice_date', 'amount', 'piece', 'total_expenses', 'payment_distributions', 'remaining_balance']
  },
  {
    id: 'all_details',
    name: 'Comprehensive Report',
    description: 'Complete report with all available data categories',
    categories: ['shipper', 'invoice_no', 'invoice_date', 'amount', 'piece', 'customs_tax', 'vat', 'import_expenses', 'total_payments', 'remaining_balance']
  }
];

const categoryLabels: { [key: string]: string } = {
  // Basic procedure data
  'shipper': 'Shipper',
  'invoice_no': 'Invoice Number',
  'invoice_date': 'Invoice Date',
  'amount': 'Amount',
  'piece': 'Pieces',
  'package': 'Package',
  'kg': 'Weight (KG)',
  'arrival_date': 'Arrival Date',
  'carrier': 'Carrier',
  'awb_number': 'AWB Number',
  'import_dec_number': 'Import Declaration Number',
  'customs': 'Customs',
  'import_dec_date': 'Import Declaration Date',
  
  // Import expenses
  'export_registry_fee': 'Export Registry Fee',
  'insurance': 'Insurance',
  'awb_fee': 'AWB Fee',
  'airport_storage_fee': 'Airport Storage Fee',
  'bonded_warehouse_storage_fee': 'Bonded Warehouse Storage Fee',
  'transportation': 'Transportation',
  'international_transportation': 'International Transportation',
  'tareks_fee': 'Tareks Fee',
  'customs_inspection': 'Customs Inspection',
  'azo_test': 'AZO Test',
  'other': 'Other Expenses',
  'service_invoice': 'Service Invoice',
  
  // Tax data
  'customs_tax': 'Customs Tax',
  'additional_customs_tax': 'Additional Customs Tax',
  'kkdf': 'KKDF',
  'vat': 'VAT',
  'stamp_tax': 'Stamp Tax',
  
  // Payment data
  'total_expenses': 'Total Expenses',
  'total_payments': 'Total Payments',
  'payment_distributions': 'Payment Distributions',
  'payment_status': 'Payment Status',
  'remaining_balance': 'Remaining Balance'
};

export function ReportWizard({ onComplete, onCancel }: ReportWizardProps) {
  const [currentStep, setCurrentStep] = useState(1);
  const [selectedReportType, setSelectedReportType] = useState<string>('');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [includeFilters, setIncludeFilters] = useState(true);
  const [currencyFormat, setCurrencyFormat] = useState('turkish_lira');
  const [dateFormat, setDateFormat] = useState('dd/mm/yyyy');

  // Auto-select categories when report type changes
  useEffect(() => {
    if (selectedReportType) {
      const reportType = reportTypes.find(type => type.id === selectedReportType);
      if (reportType) {
        setSelectedCategories(reportType.categories);
      }
    }
  }, [selectedReportType]);

  const progress = (currentStep / wizardSteps.length) * 100;

  const handleNext = () => {
    if (currentStep < wizardSteps.length) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleComplete = () => {
    const config = {
      reportType: selectedReportType,
      categories: selectedCategories,
      includeFilters,
      currencyFormat,
      dateFormat
    };
    onComplete(config);
  };

  const toggleCategory = (category: string) => {
    setSelectedCategories(prev => 
      prev.includes(category) 
        ? prev.filter(c => c !== category)
        : [...prev, category]
    );
  };

  const isStepValid = () => {
    switch (currentStep) {
      case 1:
        return selectedReportType !== '';
      case 2:
        return selectedCategories.length > 0;
      case 3:
        return true;
      case 4:
        return true;
      default:
        return false;
    }
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case 1:
        return (
          <div className="space-y-4">
            <div className="text-center mb-6">
              <h3 className="text-lg font-semibold mb-2">Select Report Type</h3>
              <p className="text-sm text-muted-foreground">Choose the type of report that best fits your needs</p>
            </div>
            <RadioGroup value={selectedReportType} onValueChange={setSelectedReportType}>
              {reportTypes.map((type) => (
                <div key={type.id} className="flex items-start space-x-3 p-4 border rounded-lg hover:bg-accent/50 transition-colors">
                  <RadioGroupItem value={type.id} id={type.id} className="mt-1" />
                  <div className="flex-1">
                    <Label htmlFor={type.id} className="font-medium cursor-pointer">{type.name}</Label>
                    <p className="text-sm text-muted-foreground mt-1">{type.description}</p>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {type.categories.slice(0, 4).map((category) => (
                        <Badge key={category} variant="secondary" className="text-xs">
                          {categoryLabels[category] || category}
                        </Badge>
                      ))}
                      {type.categories.length > 4 && (
                        <Badge variant="outline" className="text-xs">
                          +{type.categories.length - 4} more
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </RadioGroup>
          </div>
        );

      case 2:
        return (
          <div className="space-y-4">
            <div className="text-center mb-6">
              <h3 className="text-lg font-semibold mb-2">Select Data Categories</h3>
              <p className="text-sm text-muted-foreground">Choose which data fields to include in your report</p>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {Object.entries(categoryLabels).map(([key, label]) => (
                <div key={key} className="flex items-center space-x-2 p-2 border rounded hover:bg-accent/50">
                  <Checkbox
                    id={key}
                    checked={selectedCategories.includes(key)}
                    onCheckedChange={() => toggleCategory(key)}
                  />
                  <Label htmlFor={key} className="text-sm cursor-pointer flex-1">{label}</Label>
                </div>
              ))}
            </div>
            
            <div className="mt-4 p-3 bg-blue-50 rounded-lg">
              <p className="text-sm text-blue-800">
                <strong>Selected:</strong> {selectedCategories.length} categories
              </p>
            </div>
          </div>
        );

      case 3:
        return (
          <div className="space-y-6">
            <div className="text-center mb-6">
              <h3 className="text-lg font-semibold mb-2">Format & Layout Options</h3>
              <p className="text-sm text-muted-foreground">Customize how your report will be formatted</p>
            </div>

            <div className="space-y-4">
              <div>
                <Label className="text-sm font-medium">Currency Format</Label>
                <RadioGroup value={currencyFormat} onValueChange={setCurrencyFormat} className="mt-2">
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="turkish_lira" id="turkish_lira" />
                    <Label htmlFor="turkish_lira">Turkish Lira (₺1.234,56)</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="us_dollar" id="us_dollar" />
                    <Label htmlFor="us_dollar">US Dollar ($1,234.56)</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="euro" id="euro" />
                    <Label htmlFor="euro">Euro (€1.234,56)</Label>
                  </div>
                </RadioGroup>
              </div>

              <Separator />

              <div>
                <Label className="text-sm font-medium">Date Format</Label>
                <RadioGroup value={dateFormat} onValueChange={setDateFormat} className="mt-2">
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="dd/mm/yyyy" id="dd_mm_yyyy" />
                    <Label htmlFor="dd_mm_yyyy">DD/MM/YYYY (31/05/2025)</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="mm/dd/yyyy" id="mm_dd_yyyy" />
                    <Label htmlFor="mm_dd_yyyy">MM/DD/YYYY (05/31/2025)</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="yyyy-mm-dd" id="yyyy_mm_dd" />
                    <Label htmlFor="yyyy_mm_dd">YYYY-MM-DD (2025-05-31)</Label>
                  </div>
                </RadioGroup>
              </div>

              <Separator />

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="include_filters"
                  checked={includeFilters}
                  onCheckedChange={(checked) => setIncludeFilters(checked === true)}
                />
                <Label htmlFor="include_filters" className="text-sm">Include date range and shipper filters</Label>
              </div>
            </div>
          </div>
        );

      case 4:
        return (
          <div className="space-y-6">
            <div className="text-center mb-6">
              <h3 className="text-lg font-semibold mb-2">Review Your Report Configuration</h3>
              <p className="text-sm text-muted-foreground">Please review your selections before generating the report</p>
            </div>

            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Report Type</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="font-medium">{reportTypes.find(t => t.id === selectedReportType)?.name}</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {reportTypes.find(t => t.id === selectedReportType)?.description}
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Selected Categories ({selectedCategories.length})</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {selectedCategories.map((category) => (
                      <Badge key={category} variant="secondary">
                        {categoryLabels[category] || category}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Format Options</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Currency Format:</span>
                    <span className="text-sm font-medium">
                      {currencyFormat === 'turkish_lira' ? 'Turkish Lira (₺)' : 
                       currencyFormat === 'us_dollar' ? 'US Dollar ($)' : 'Euro (€)'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Date Format:</span>
                    <span className="text-sm font-medium">{dateFormat.toUpperCase()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Include Filters:</span>
                    <span className="text-sm font-medium">{includeFilters ? 'Yes' : 'No'}</span>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold">Smart Report Customization Wizard</h2>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
        </div>
        
        <Progress value={progress} className="mb-4" />
        
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>Step {currentStep} of {wizardSteps.length}</span>
          <span>{Math.round(progress)}% Complete</span>
        </div>
      </div>

      <div className="flex gap-8">
        {/* Steps sidebar */}
        <div className="w-64 space-y-2">
          {wizardSteps.map((step) => {
            const Icon = step.icon;
            const isActive = step.id === currentStep;
            const isCompleted = step.id < currentStep;
            
            return (
              <div
                key={step.id}
                className={`flex items-center space-x-3 p-3 rounded-lg transition-colors ${
                  isActive ? 'bg-primary text-primary-foreground' : 
                  isCompleted ? 'bg-green-50 text-green-700' : 'bg-muted'
                }`}
              >
                <Icon className="h-5 w-5" />
                <div>
                  <p className="font-medium text-sm">{step.title}</p>
                  <p className={`text-xs ${
                    isActive ? 'text-primary-foreground/80' : 'text-muted-foreground'
                  }`}>
                    {step.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Main content */}
        <div className="flex-1">
          <Card>
            <CardContent className="p-6">
              {renderStepContent()}
            </CardContent>
          </Card>

          {/* Navigation buttons */}
          <div className="flex justify-between mt-6">
            <Button
              variant="outline"
              onClick={handleBack}
              disabled={currentStep === 1}
            >
              <ChevronLeft className="h-4 w-4 mr-2" />
              Back
            </Button>

            {currentStep < wizardSteps.length ? (
              <Button
                onClick={handleNext}
                disabled={!isStepValid()}
              >
                Next
                <ChevronRight className="h-4 w-4 ml-2" />
              </Button>
            ) : (
              <Button
                onClick={handleComplete}
                disabled={!isStepValid()}
                className="bg-green-600 hover:bg-green-700"
              >
                <Wand2 className="h-4 w-4 mr-2" />
                Generate Report
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}