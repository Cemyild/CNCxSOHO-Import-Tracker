import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DollarSign, Package, TrendingUp, Receipt, FileText, Landmark, Calculator } from "lucide-react";
import { useTranslation } from "react-i18next";

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
  currencyRate?: number;
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
  currencyRate,
}: CalculationSummaryProps) {
  const { t } = useTranslation();
  const hasRate = typeof currencyRate === "number" && isFinite(currencyRate) && currencyRate > 0;

  const TryValue = ({ usd, testId }: { usd: number; testId: string }) =>
    hasRate ? (
      <div className="text-sm font-medium text-muted-foreground mt-1" data-testid={testId}>
        ₺{formatCurrency(usd * (currencyRate as number))}
      </div>
    ) : null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-muted-foreground" />
            {t('taxCalcComp.summary.totalValue')}
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
            {t('taxCalcComp.summary.totalPieces')}
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
            {t('taxCalcComp.summary.totalCustomsTax')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-orange-600" data-testid="text-total-customs-tax">
            ${formatCurrency(totalCustomsTax)}
          </div>
          <TryValue usd={totalCustomsTax} testId="text-total-customs-tax-tl" />
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            {t('taxCalcComp.summary.totalAdditionalTax')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-red-600" data-testid="text-total-additional-tax">
            ${formatCurrency(totalAdditionalTax)}
          </div>
          <TryValue usd={totalAdditionalTax} testId="text-total-additional-tax-tl" />
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Landmark className="h-4 w-4 text-muted-foreground" />
            {t('taxCalcComp.summary.totalKkdf')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-purple-600" data-testid="text-total-kkdf">
            ${formatCurrency(totalKkdf)}
          </div>
          <TryValue usd={totalKkdf} testId="text-total-kkdf-tl" />
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Calculator className="h-4 w-4 text-muted-foreground" />
            {t('taxCalcComp.summary.totalVat')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-green-600" data-testid="text-total-vat">
            ${formatCurrency(totalVat)}
          </div>
          <TryValue usd={totalVat} testId="text-total-vat-tl" />
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            {t('taxCalcComp.summary.totalTaxUsd')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-blue-600" data-testid="text-total-tax-usd">
            ${formatCurrency(totalTaxUSD)}
          </div>
          <TryValue usd={totalTaxUSD} testId="text-total-tax-usd-tl" />
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            {t('taxCalcComp.summary.totalTaxTl')}
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
