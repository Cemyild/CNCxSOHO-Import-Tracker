import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DollarSign, Package, TrendingUp, Receipt, FileText, Landmark, Calculator } from "lucide-react";

function formatCurrency(value: number): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface CalculationSummaryProps {
  totalValue: number;
  totalPieces: number;
  totalCustomsTax: number;
  totalAdditionalTax: number;
  totalKkdf: number;
  totalVat: number;
  totalTaxUSD: number;
  totalTaxTL: number;
}

export function CalculationSummary({
  totalValue,
  totalPieces,
  totalCustomsTax,
  totalAdditionalTax,
  totalKkdf,
  totalVat,
  totalTaxUSD,
  totalTaxTL,
}: CalculationSummaryProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-muted-foreground" />
            Total Value
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold" data-testid="text-total-value">
            ${formatCurrency(totalValue)}
          </div>
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Package className="h-4 w-4 text-muted-foreground" />
            Total Pieces
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold" data-testid="text-total-pieces">
            {totalPieces.toLocaleString('en-US')}
          </div>
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Receipt className="h-4 w-4 text-muted-foreground" />
            Total Customs Tax
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-orange-600" data-testid="text-total-customs-tax">
            ${formatCurrency(totalCustomsTax)}
          </div>
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            Total Add. Customs Tax
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-red-600" data-testid="text-total-additional-tax">
            ${formatCurrency(totalAdditionalTax)}
          </div>
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Landmark className="h-4 w-4 text-muted-foreground" />
            Total KKDF
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-purple-600" data-testid="text-total-kkdf">
            ${formatCurrency(totalKkdf)}
          </div>
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Calculator className="h-4 w-4 text-muted-foreground" />
            Total VAT
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-green-600" data-testid="text-total-vat">
            ${formatCurrency(totalVat)}
          </div>
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            Total Tax (USD)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-blue-600" data-testid="text-total-tax-usd">
            ${formatCurrency(totalTaxUSD)}
          </div>
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            Total Tax (TL)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-blue-600" data-testid="text-total-tax-tl">
            ₺{formatCurrency(totalTaxTL)}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
