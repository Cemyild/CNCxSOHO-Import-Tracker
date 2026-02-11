import { 
  Calendar,
  Home,
  Inbox,
  Search,
  Settings,
  BarChart2,
  Calculator,
  FileText,
  Download
} from "lucide-react";
import { useState } from "react";
import { PageLayout } from "@/components/layout/PageLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useParams, useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import type { TaxCalculation, TaxCalculationItem } from "@shared/schema";
import { CalculationSummary } from "@/components/tax-calculation/CalculationSummary";
import { ResultsTable } from "@/components/tax-calculation/ResultsTable";
import { AdvTaxletterModal } from "@/components/tax-calculation/AdvTaxletterModal";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
];

export default function TaxCalculationResultsPage() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isExportingAdvTaxletter, setIsExportingAdvTaxletter] = useState(false);
  const [isAdvTaxletterModalOpen, setIsAdvTaxletterModalOpen] = useState(false);
  const [isCountryCodeModalOpen, setIsCountryCodeModalOpen] = useState(false);
  const [missingCountryCodes, setMissingCountryCodes] = useState<string[]>([]);
  const [countryCodeMappings, setCountryCodeMappings] = useState<Record<string, string>>({});

  const { data, isLoading } = useQuery<{ calculation: TaxCalculation; items: TaxCalculationItem[] }>({
    queryKey: [`/api/tax-calculation/calculations/${id}`],
  });

  const createProcedureMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/tax-calculation/calculations/${id}/create-procedure`, {
        userId: 3,
      });
      if (!response.ok) throw new Error("Failed to create procedure");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/tax-calculation/calculations/${id}`] });
      toast({
        title: "Success",
        description: "Procedure created successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to create procedure",
        variant: "destructive",
      });
    },
  });

  const handleBeyannameExport = async () => {
    try {
      // First check for missing country codes
      const checkResponse = await fetch(`/api/tax-calculation/calculations/${id}/check-country-codes`);
      if (!checkResponse.ok) {
        throw new Error('Failed to check country codes');
      }
      
      const { missingCodes } = await checkResponse.json();
      
      if (missingCodes && missingCodes.length > 0) {
        // Show modal to enter missing codes
        setMissingCountryCodes(missingCodes);
        setCountryCodeMappings({});
        setIsCountryCodeModalOpen(true);
        return;
      }
      
      // No missing codes, proceed with export
      await performBeyannameExport({});
    } catch (error) {
      toast({
        title: "Error",
        description: `Failed to export: ${error instanceof Error ? error.message : String(error)}`,
        variant: "destructive",
      });
    }
  };

  const performBeyannameExport = async (customMappings: Record<string, string>) => {
    try {
      const response = await fetch(`/api/tax-calculation/calculations/${id}/export/beyanname`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customMappings }),
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.details || error.error || 'Export failed');
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `BEYANNAME_${id}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      toast({
        title: "Success",
        description: "Excel template exported successfully",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: `Failed to export: ${error instanceof Error ? error.message : String(error)}`,
        variant: "destructive",
      });
    }
  };

  const handleCountryCodeSubmit = () => {
    // Validate all codes are filled
    const allFilled = missingCountryCodes.every(code => 
      countryCodeMappings[code] && countryCodeMappings[code].trim() !== ''
    );
    
    if (!allFilled) {
      toast({
        title: "Error",
        description: "Please enter 3-digit codes for all countries",
        variant: "destructive",
      });
      return;
    }
    
    setIsCountryCodeModalOpen(false);
    performBeyannameExport(countryCodeMappings);
  };

  const handleExportPdf = async () => {
    setIsExportingPdf(true);
    try {
      const response = await fetch(`/api/tax-calculation/calculations/${id}/export/pdf`);
      
      if (!response.ok) {
        throw new Error('PDF export failed');
      }
      
      const contentDisposition = response.headers.get('Content-Disposition');
      const filenameMatch = contentDisposition?.match(/filename="(.+)"/);
      const filename = filenameMatch ? filenameMatch[1] : `calculation_${id}.pdf`;
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      toast({
        title: "Success",
        description: "PDF downloaded successfully"
      });
      
    } catch (error) {
      console.error('PDF export error:', error);
      toast({
        title: "Error",
        description: "Failed to export PDF",
        variant: "destructive"
      });
    } finally {
      setIsExportingPdf(false);
    }
  };

  const handleAdvTaxletterClick = () => {
    setIsAdvTaxletterModalOpen(true);
  };

  const handleAdvTaxletterGenerate = async (modalData: any) => {
    setIsExportingAdvTaxletter(true);
    try {
      const response = await fetch(`/api/tax-calculation/calculations/${id}/export/adv-taxletter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(modalData),
      });
      
      if (!response.ok) {
        throw new Error('Adv. Taxletter PDF export failed');
      }
      
      const contentDisposition = response.headers.get('Content-Disposition');
      const filenameMatch = contentDisposition?.match(/filename="(.+)"/);
      const filename = filenameMatch ? filenameMatch[1] : `AdvTaxletter_${data?.calculation?.reference || id}.pdf`;
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      toast({
        title: "Success",
        description: "Adv. Taxletter PDF exported successfully"
      });
      
      setIsAdvTaxletterModalOpen(false);
      
    } catch (error) {
      console.error('Adv. Taxletter PDF export error:', error);
      toast({
        title: "Error",
        description: "Failed to export Adv. Taxletter PDF",
        variant: "destructive"
      });
    } finally {
      setIsExportingAdvTaxletter(false);
    }
  };

  if (isLoading) {
    return (
      <PageLayout title="Tax Calculation Results" navItems={items}>
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-muted-foreground">Loading calculation results...</div>
        </div>
      </PageLayout>
    );
  }

  if (!data) {
    return (
      <PageLayout title="Tax Calculation Results" navItems={items}>
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-muted-foreground">Calculation not found</div>
        </div>
      </PageLayout>
    );
  }

  const { calculation, items: calcItems } = data;

  const totalCustomsTax = calcItems.reduce((sum, item) => 
    sum + parseFloat(item.customs_tax || "0"), 0
  );
  
  const totalAdditionalTax = calcItems.reduce((sum, item) => 
    sum + parseFloat(item.additional_customs_tax || "0"), 0
  );
  
  const totalKkdf = calcItems.reduce((sum, item) => 
    sum + parseFloat(item.kkdf || "0"), 0
  );
  
  const totalVat = calcItems.reduce((sum, item) => 
    sum + parseFloat(item.vat || "0"), 0
  );
  
  const totalTaxUSD = calcItems.reduce((sum, item) => 
    sum + parseFloat(item.total_tax_usd || "0"), 0
  );
  
  const totalTaxTL = calcItems.reduce((sum, item) => 
    sum + parseFloat(item.total_tax_tl || "0"), 0
  );

  const calculatedTaxData = {
    customsTax: totalCustomsTax,
    additionalTax: totalAdditionalTax,
    kkdf: totalKkdf,
    vat: totalVat,
    stampTax: 0,
    totalTaxUsd: totalTaxUSD,
    totalTaxTl: totalTaxTL,
    currencyRate: parseFloat(calculation?.currency_rate || '1'),
  };

  return (
    <PageLayout title="Tax Calculation Results" navItems={items}>
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold">Calculation: {calculation.reference}</h1>
            <p className="text-muted-foreground">
              Invoice: {calculation.invoice_no || "N/A"} | 
              Date: {calculation.invoice_date ? new Date(calculation.invoice_date).toLocaleDateString() : "N/A"}
            </p>
          </div>
          <div className="flex gap-2">
            <Button 
              variant="outline" 
              data-testid="button-export-excel"
              onClick={() => {
                window.location.href = `/api/tax-calculation/calculations/${id}/export/excel`;
              }}
            >
              <Download className="mr-2 h-4 w-4" />
              Export Excel
            </Button>
            <Button 
              variant="outline" 
              data-testid="button-export-beyanname"
              onClick={handleBeyannameExport}
            >
              <Download className="mr-2 h-4 w-4" />
              Export Template
            </Button>
            <Button 
              variant="outline" 
              data-testid="button-export-pdf"
              onClick={handleExportPdf}
              disabled={isExportingPdf}
            >
              <FileText className="mr-2 h-4 w-4" />
              {isExportingPdf ? "Generating PDF..." : "Export PDF"}
            </Button>
            <Button 
              variant="outline" 
              data-testid="button-export-adv-taxletter"
              onClick={handleAdvTaxletterClick}
            >
              <FileText className="mr-2 h-4 w-4" />
              Adv. Taxletter
            </Button>
            {calculation.status === "calculated" && (
              <Button 
                onClick={() => createProcedureMutation.mutate()}
                disabled={createProcedureMutation.isPending}
                data-testid="button-create-procedure"
              >
                Create Procedure
              </Button>
            )}
          </div>
        </div>

        <CalculationSummary
          totalValue={parseFloat(calculation.total_value || "0")}
          totalPieces={calculation.total_quantity || 0}
          totalCustomsTax={totalCustomsTax}
          totalAdditionalTax={totalAdditionalTax}
          totalKkdf={totalKkdf}
          totalVat={totalVat}
          totalTaxUSD={totalTaxUSD}
          totalTaxTL={totalTaxTL}
        />

        <Card>
          <CardHeader>
            <CardTitle>📦 Detailed Results</CardTitle>
          </CardHeader>
          <CardContent>
            <ResultsTable items={calcItems} />
          </CardContent>
        </Card>
      </div>

      <AdvTaxletterModal
        isOpen={isAdvTaxletterModalOpen}
        onClose={() => setIsAdvTaxletterModalOpen(false)}
        onGenerate={handleAdvTaxletterGenerate}
        calculatedData={calculatedTaxData}
        reference={calculation?.reference || ''}
        isLoading={isExportingAdvTaxletter}
      />

      <Dialog open={isCountryCodeModalOpen} onOpenChange={setIsCountryCodeModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Missing Country Codes</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className="text-sm text-muted-foreground">
              The following country codes don't have 3-digit numeric mappings. Please enter them:
            </p>
            {missingCountryCodes.map((code) => (
              <div key={code} className="flex items-center gap-4">
                <Label className="w-20 font-medium">{code}</Label>
                <Input
                  placeholder="3-digit code (e.g. 720)"
                  value={countryCodeMappings[code] || ''}
                  onChange={(e) => setCountryCodeMappings(prev => ({
                    ...prev,
                    [code]: e.target.value
                  }))}
                  maxLength={3}
                  data-testid={`input-country-code-${code}`}
                />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCountryCodeModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCountryCodeSubmit} data-testid="button-submit-country-codes">
              Export
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageLayout>
  );
}
