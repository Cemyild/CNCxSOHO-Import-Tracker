import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
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
  icon: any;
}

interface ReportWizardProps {
  onComplete: (config: any) => void;
  onCancel: () => void;
}

const wizardSteps: WizardStep[] = [
  { id: 1, icon: FileSpreadsheet },
  { id: 2, icon: Settings },
  { id: 3, icon: Eye },
  { id: 4, icon: Wand2 }
];

const reportTypes = [
  {
    id: 'import_procedures',
    categories: ['shipper', 'invoice_no', 'invoice_date', 'amount', 'piece', 'package', 'kg', 'arrival_date', 'carrier', 'awb_number', 'import_dec_number', 'customs', 'import_dec_date']
  },
  {
    id: 'import_expenses',
    categories: ['shipper', 'invoice_no', 'export_registry_fee', 'insurance', 'awb_fee', 'airport_storage_fee', 'bonded_warehouse_storage_fee', 'transportation', 'international_transportation', 'tareks_fee', 'customs_inspection', 'azo_test', 'other', 'service_invoice']
  },
  {
    id: 'tax_details',
    categories: ['shipper', 'invoice_no', 'customs_tax', 'additional_customs_tax', 'kkdf', 'vat', 'stamp_tax']
  },
  {
    id: 'payment_expense',
    categories: ['shipper', 'invoice_no', 'invoice_date', 'amount', 'piece', 'total_expenses', 'payment_distributions', 'remaining_balance']
  },
  {
    id: 'all_details',
    categories: ['shipper', 'invoice_no', 'invoice_date', 'amount', 'piece', 'customs_tax', 'vat', 'import_expenses', 'total_payments', 'remaining_balance']
  }
];

// Map report type id (snake_case) to translation key (camelCase)
const reportTypeKeyMap: { [key: string]: string } = {
  'import_procedures': 'importProcedures',
  'import_expenses': 'importExpenses',
  'tax_details': 'taxDetails',
  'payment_expense': 'paymentExpense',
  'all_details': 'allDetails'
};

// Ordered list of category keys for the "Select Data Categories" grid
const categoryKeys: string[] = [
  // Basic procedure data
  'shipper', 'invoice_no', 'invoice_date', 'amount', 'piece', 'package', 'kg',
  'arrival_date', 'carrier', 'awb_number', 'import_dec_number', 'customs', 'import_dec_date',
  // Import expenses
  'export_registry_fee', 'insurance', 'awb_fee', 'airport_storage_fee',
  'bonded_warehouse_storage_fee', 'transportation', 'international_transportation',
  'tareks_fee', 'customs_inspection', 'azo_test', 'other', 'service_invoice',
  // Tax data
  'customs_tax', 'additional_customs_tax', 'kkdf', 'vat', 'stamp_tax',
  // Payment data
  'total_expenses', 'total_payments', 'payment_distributions', 'payment_status', 'remaining_balance'
];

export function ReportWizard({ onComplete, onCancel }: ReportWizardProps) {
  const { t } = useTranslation();
  // Localized labels for category keys
  const categoryLabels: { [key: string]: string } = {
    'shipper': t('reportWizard.categories.shipper'),
    'invoice_no': t('reportWizard.categories.invoiceNo'),
    'invoice_date': t('reportWizard.categories.invoiceDate'),
    'amount': t('reportWizard.categories.amount'),
    'piece': t('reportWizard.categories.piece'),
    'package': t('reportWizard.categories.package'),
    'kg': t('reportWizard.categories.kg'),
    'arrival_date': t('reportWizard.categories.arrivalDate'),
    'carrier': t('reportWizard.categories.carrier'),
    'awb_number': t('reportWizard.categories.awbNumber'),
    'import_dec_number': t('reportWizard.categories.importDecNumber'),
    'customs': t('reportWizard.categories.customs'),
    'import_dec_date': t('reportWizard.categories.importDecDate'),
    'export_registry_fee': t('reportWizard.categories.exportRegistryFee'),
    'insurance': t('reportWizard.categories.insurance'),
    'awb_fee': t('reportWizard.categories.awbFee'),
    'airport_storage_fee': t('reportWizard.categories.airportStorageFee'),
    'bonded_warehouse_storage_fee': t('reportWizard.categories.bondedWarehouseStorageFee'),
    'transportation': t('reportWizard.categories.transportation'),
    'international_transportation': t('reportWizard.categories.internationalTransportation'),
    'tareks_fee': t('reportWizard.categories.tareksFee'),
    'customs_inspection': t('reportWizard.categories.customsInspection'),
    'azo_test': t('reportWizard.categories.azoTest'),
    'other': t('reportWizard.categories.other'),
    'service_invoice': t('reportWizard.categories.serviceInvoice'),
    'customs_tax': t('reportWizard.categories.customsTax'),
    'additional_customs_tax': t('reportWizard.categories.additionalCustomsTax'),
    'kkdf': t('reportWizard.categories.kkdf'),
    'vat': t('reportWizard.categories.vat'),
    'stamp_tax': t('reportWizard.categories.stampTax'),
    'total_expenses': t('reportWizard.categories.totalExpenses'),
    'total_payments': t('reportWizard.categories.totalPayments'),
    'payment_distributions': t('reportWizard.categories.paymentDistributions'),
    'payment_status': t('reportWizard.categories.paymentStatus'),
    'remaining_balance': t('reportWizard.categories.remainingBalance')
  };
  // Localized report type name + description
  const getReportTypeName = (id: string) => t(`reportWizard.reportTypes.${reportTypeKeyMap[id]}.name`);
  const getReportTypeDescription = (id: string) => t(`reportWizard.reportTypes.${reportTypeKeyMap[id]}.description`);
  const getStepTitle = (id: number) => t(`reportWizard.steps.step${id}.title`);
  const getStepDescription = (id: number) => t(`reportWizard.steps.step${id}.description`);

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
              <h3 className="text-lg font-semibold mb-2">{t('reportWizard.step1.heading')}</h3>
              <p className="text-sm text-muted-foreground">{t('reportWizard.step1.subheading')}</p>
            </div>
            <RadioGroup value={selectedReportType} onValueChange={setSelectedReportType}>
              {reportTypes.map((type) => (
                <div key={type.id} className="flex items-start space-x-3 p-4 border rounded-lg hover:bg-accent/50 transition-colors">
                  <RadioGroupItem value={type.id} id={type.id} className="mt-1" />
                  <div className="flex-1">
                    <Label htmlFor={type.id} className="font-medium cursor-pointer">{getReportTypeName(type.id)}</Label>
                    <p className="text-sm text-muted-foreground mt-1">{getReportTypeDescription(type.id)}</p>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {type.categories.slice(0, 4).map((category) => (
                        <Badge key={category} variant="secondary" className="text-xs">
                          {categoryLabels[category] || category}
                        </Badge>
                      ))}
                      {type.categories.length > 4 && (
                        <Badge variant="outline" className="text-xs">
                          {t('reportWizard.moreCount', { count: type.categories.length - 4 })}
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
              <h3 className="text-lg font-semibold mb-2">{t('reportWizard.step2.heading')}</h3>
              <p className="text-sm text-muted-foreground">{t('reportWizard.step2.subheading')}</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {categoryKeys.map((key) => (
                <div key={key} className="flex items-center space-x-2 p-2 border rounded hover:bg-accent/50">
                  <Checkbox
                    id={key}
                    checked={selectedCategories.includes(key)}
                    onCheckedChange={() => toggleCategory(key)}
                  />
                  <Label htmlFor={key} className="text-sm cursor-pointer flex-1">{categoryLabels[key] || key}</Label>
                </div>
              ))}
            </div>

            <div className="mt-4 p-3 bg-blue-50 rounded-lg">
              <p className="text-sm text-blue-800">
                <strong>{t('reportWizard.selectedLabel')}</strong> {t('reportWizard.selectedCount', { count: selectedCategories.length })}
              </p>
            </div>
          </div>
        );

      case 3:
        return (
          <div className="space-y-6">
            <div className="text-center mb-6">
              <h3 className="text-lg font-semibold mb-2">{t('reportWizard.step3.heading')}</h3>
              <p className="text-sm text-muted-foreground">{t('reportWizard.step3.subheading')}</p>
            </div>

            <div className="space-y-4">
              <div>
                <Label className="text-sm font-medium">{t('reportWizard.currencyFormat')}</Label>
                <RadioGroup value={currencyFormat} onValueChange={setCurrencyFormat} className="mt-2">
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="turkish_lira" id="turkish_lira" />
                    <Label htmlFor="turkish_lira">{t('reportWizard.currency.turkishLira')} (₺1.234,56)</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="us_dollar" id="us_dollar" />
                    <Label htmlFor="us_dollar">{t('reportWizard.currency.usDollar')} ($1,234.56)</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="euro" id="euro" />
                    <Label htmlFor="euro">{t('reportWizard.currency.euro')} (€1.234,56)</Label>
                  </div>
                </RadioGroup>
              </div>

              <Separator />

              <div>
                <Label className="text-sm font-medium">{t('reportWizard.dateFormat')}</Label>
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
                <Label htmlFor="include_filters" className="text-sm">{t('reportWizard.includeFilters')}</Label>
              </div>
            </div>
          </div>
        );

      case 4:
        return (
          <div className="space-y-6">
            <div className="text-center mb-6">
              <h3 className="text-lg font-semibold mb-2">{t('reportWizard.step4.heading')}</h3>
              <p className="text-sm text-muted-foreground">{t('reportWizard.step4.subheading')}</p>
            </div>

            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">{t('reportWizard.reportTypeLabel')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="font-medium">{selectedReportType ? getReportTypeName(selectedReportType) : ''}</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {selectedReportType ? getReportTypeDescription(selectedReportType) : ''}
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">{t('reportWizard.selectedCategoriesTitle', { count: selectedCategories.length })}</CardTitle>
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
                  <CardTitle className="text-base">{t('reportWizard.formatOptions')}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">{t('reportWizard.currencyFormatLabel')}</span>
                    <span className="text-sm font-medium">
                      {currencyFormat === 'turkish_lira' ? `${t('reportWizard.currency.turkishLira')} (₺)` :
                       currencyFormat === 'us_dollar' ? `${t('reportWizard.currency.usDollar')} ($)` : `${t('reportWizard.currency.euro')} (€)`}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">{t('reportWizard.dateFormatLabel')}</span>
                    <span className="text-sm font-medium">{dateFormat.toUpperCase()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">{t('reportWizard.includeFiltersLabel')}</span>
                    <span className="text-sm font-medium">{includeFilters ? t('reportWizard.yes') : t('reportWizard.no')}</span>
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
          <h2 className="text-2xl font-bold">{t('reportWizard.title')}</h2>
          <Button variant="outline" onClick={onCancel}>{t('reportWizard.cancel')}</Button>
        </div>

        <Progress value={progress} className="mb-4" />

        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{t('reportWizard.stepOf', { current: currentStep, total: wizardSteps.length })}</span>
          <span>{t('reportWizard.percentComplete', { percent: Math.round(progress) })}</span>
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
                  <p className="font-medium text-sm">{getStepTitle(step.id)}</p>
                  <p className={`text-xs ${
                    isActive ? 'text-primary-foreground/80' : 'text-muted-foreground'
                  }`}>
                    {getStepDescription(step.id)}
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
              {t('reportWizard.back')}
            </Button>

            {currentStep < wizardSteps.length ? (
              <Button
                onClick={handleNext}
                disabled={!isStepValid()}
              >
                {t('reportWizard.next')}
                <ChevronRight className="h-4 w-4 ml-2" />
              </Button>
            ) : (
              <Button
                onClick={handleComplete}
                disabled={!isStepValid()}
                className="bg-green-600 hover:bg-green-700"
              >
                <Wand2 className="h-4 w-4 mr-2" />
                {t('reportWizard.generateReport')}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}