import * as React from "react";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { 
  Calendar,
  Home,
  Inbox,
  Settings,
  BarChart2,
  CreditCard,
  ArrowLeft,
  DollarSign,
  Receipt,
  FileText,
  ShoppingCart,
  Calculator,
  BarChart,
  Save,
  X
} from "lucide-react";
import InvoiceLineItemsTable from "@/components/ui/invoice-line-items-table";
import ExpenseTrendsChart from "@/components/ui/expense-trends-chart";

import { PageLayout } from "@/components/layout/PageLayout";
import { Button } from "@/components/ui/button";
import { GeneratePdfButton } from "@/components/ui/generate-pdf-button";
import { 
  Card, 
  CardContent, 
  CardDescription, 
  CardHeader, 
  CardTitle 
} from "@/components/ui/card";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";

import type { Procedure } from "@shared/schema";

// Interface for the batch financial summaries response
interface BatchFinancialSummary {
  totalTax: number;
  importExpenses: number;
  serviceInvoices: number;
  totalExpenses: number;
  advancePayments: number;
  balancePayments: number;
  remainingBalance: number;
}

interface FinancialSummariesResponse {
  financialSummaries: {
    [key: string]: BatchFinancialSummary;
  };
}

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
    icon: CreditCard,
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

export default function ExpenseDetailsPage() {
  const [, setLocation] = useLocation();
  const [showFreightModal, setShowFreightModal] = useState(false);
  const [freightAmount, setFreightAmount] = useState("");
  const [isUpdatingFreight, setIsUpdatingFreight] = useState(false);
  const [freightUpdateError, setFreightUpdateError] = useState<string | null>(null);

  // Get reference from URL parameters
  const urlParams = new URLSearchParams(window.location.search);
  const reference = urlParams.get('reference');

  // Format currency with the specified currency
  const formatCurrency = (amount: number, currency: string = "TRY") => {
    // Format with commas for thousands but without the currency symbol
    const formattedNumber = new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
    
    // Add the appropriate currency symbol based on the currency code
    const currencySymbol = currency === "TRY" ? "₺" : "$";
    
    // Return the formatted amount with the currency symbol after the number
    return `${formattedNumber} ${currencySymbol}`;
  };
  
  // Calculate USD value from TL using the exchange rate
  const convertToUSD = (tlAmount: number, exchangeRate?: number | null) => {
    if (!exchangeRate || exchangeRate <= 0) return null;
    return tlAmount / exchangeRate;
  };

  // Fetch procedure data to get basic information about the expense
  const { data: procedure, isLoading: isLoadingProcedure, error: procedureError } = useQuery<Procedure>({
    queryKey: ['/api/procedures/reference', reference],
    queryFn: async () => {
      if (!reference) throw new Error("No reference provided");
      const res = await fetch(`/api/procedures/reference/${encodeURIComponent(reference)}`);
      if (!res.ok) throw new Error("Failed to fetch procedure details");
      const data = await res.json();
      return data.procedure;
    },
    enabled: !!reference,
  });

  // Fetch financial summary data 
  const { data: financialData, isLoading: isLoadingFinancial, error: financialError } = useQuery<FinancialSummariesResponse>({
    queryKey: ['/api/financial-summaries/batch'],
    queryFn: async () => {
      const res = await fetch('/api/financial-summaries/batch');
      if (!res.ok) throw new Error("Failed to fetch financial data");
      return res.json();
    },
  });

  // Effect to initialize freight amount from procedure data
  useEffect(() => {
    if (procedure && procedure.freight_amount && procedure.usdtl_rate) {
      // Convert TL to USD for the form input
      const usdAmount = convertToUSD(
        parseFloat(procedure.freight_amount), 
        parseFloat(procedure.usdtl_rate.toString())
      );
      
      // Format to 2 decimal places but don't include the currency symbol
      setFreightAmount(usdAmount ? usdAmount.toFixed(2) : "0.00");
    }
  }, [procedure]);

  // Handle submitting the freight amount update
  const handleUpdateFreightAmount = async () => {
    if (!procedure || !procedure.reference || !procedure.usdtl_rate) return;
    
    try {
      setIsUpdatingFreight(true);
      setFreightUpdateError(null);
      
      // Convert USD amount to TL for storage
      const usdAmount = parseFloat(freightAmount) || 0;
      const tlAmount = usdAmount * parseFloat(procedure.usdtl_rate.toString());
      
      console.log(`Converting ${usdAmount} USD to ${tlAmount} TL using rate ${procedure.usdtl_rate}`);
      
      const response = await fetch(`/api/procedures/${procedure.reference}/freight`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          freightAmount: tlAmount
        }),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to update freight amount');
      }
      
      // Close modal and show success message
      setShowFreightModal(false);
      toast({
        title: "Success",
        description: "Freight amount updated successfully",
        variant: "default",
      });
      
      // Refresh procedure data
      window.location.reload();
    } catch (error) {
      console.error('Error updating freight amount:', error);
      setFreightUpdateError(error instanceof Error ? error.message : 'An unknown error occurred');
    } finally {
      setIsUpdatingFreight(false);
    }
  };

  // Loading state for procedure data
  const isLoading = isLoadingProcedure || isLoadingFinancial;
  
  if (isLoadingProcedure) {
    return (
      <PageLayout title="Expense Details" navItems={items}>
        <div className="container mx-auto p-6">
          <div className="mb-6 flex items-center justify-between">
            <Button variant="outline" size="sm" onClick={() => setLocation('/expenses')}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Expenses
            </Button>
            
            <div className="flex items-center gap-2">
              {reference && (
                <GeneratePdfButton procedureReference={reference} disabled={true} />
              )}
            </div>
          </div>

          <Card className="mb-6">
            <CardHeader>
              <Skeleton className="h-8 w-64 mb-2" />
              <Skeleton className="h-4 w-48" />
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-6">
                {[...Array(6)].map((_, index) => (
                  <div key={index} className="space-y-2 flex flex-col items-center">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-6 w-20" />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-6 mt-8">
            {[...Array(6)].map((_, index) => (
              <Card key={index} className="p-4">
                <div className="flex flex-col items-center">
                  <Skeleton className="h-4 w-24 mb-3" />
                  <Skeleton className="h-10 w-24 mb-2" />
                </div>
              </Card>
            ))}
          </div>
        </div>
      </PageLayout>
    );
  }

  // Error state
  const error = procedureError || financialError;
  if (error) {
    return (
      <PageLayout title="Expense Details" navItems={items}>
        <div className="container mx-auto p-6">
          <div className="mb-6 flex items-center justify-between">
            <Button variant="outline" size="sm" onClick={() => setLocation('/expenses')}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Expenses
            </Button>
            
            <div className="flex items-center gap-2">
              {reference && (
                <GeneratePdfButton procedureReference={reference} disabled={true} />
              )}
            </div>
          </div>

          <Alert variant="destructive" className="mb-6">
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error instanceof Error ? error.message : "An unknown error occurred"}</AlertDescription>
          </Alert>
        </div>
      </PageLayout>
    );
  }

  // Not found state
  if (!procedure) {
    return (
      <PageLayout title="Expense Details" navItems={items}>
        <div className="container mx-auto p-6">
          <div className="mb-6 flex items-center justify-between">
            <Button variant="outline" size="sm" onClick={() => setLocation('/expenses')}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Expenses
            </Button>
            
            <div className="flex items-center gap-2">
              {reference && (
                <GeneratePdfButton procedureReference={reference} disabled={true} />
              )}
            </div>
          </div>

          <Alert variant="destructive" className="mb-6">
            <AlertTitle>Not Found</AlertTitle>
            <AlertDescription>No expense details available for the provided reference.</AlertDescription>
          </Alert>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout title="Expense Details" navItems={items}>
      <div className="container mx-auto p-6">
        {/* Breadcrumb navigation */}
        <div className="mb-4 flex text-sm text-muted-foreground">
          <span onClick={() => setLocation('/dashboard')} className="cursor-pointer hover:text-primary">Home</span>
          <span className="mx-2">/</span>
          <span onClick={() => setLocation('/expenses')} className="cursor-pointer hover:text-primary">Expenses</span>
          <span className="mx-2">/</span>
          <span>Expense Details</span>
        </div>

        {/* Back button and actions */}
        <div className="mb-6 flex items-center justify-between">
          <Button variant="outline" size="sm" onClick={() => setLocation('/expenses')}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Expenses
          </Button>
          
          <div className="flex items-center gap-2">
            {procedure && procedure.reference && (
              <GeneratePdfButton procedureReference={procedure.reference} />
            )}
          </div>
        </div>

        {/* Expense Header Card */}
        <Card className="mb-8">
          <CardHeader>
            <div className="space-y-2">
              <CardTitle className="text-2xl">{procedure.reference}</CardTitle>
              <CardDescription>
                Overview of expense details for this procedure
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-6 text-center">
              <div className="flex flex-col items-center">
                <h4 className="text-sm font-medium text-muted-foreground mb-1">Reference</h4>
                <p className="font-medium">{procedure.reference}</p>
              </div>
              <div className="flex flex-col items-center">
                <h4 className="text-sm font-medium text-muted-foreground mb-1">Shipper</h4>
                <p className="font-medium">{procedure.shipper}</p>
              </div>
              <div className="flex flex-col items-center">
                <h4 className="text-sm font-medium text-muted-foreground mb-1">Invoice No</h4>
                <p className="font-medium">{procedure.invoice_no || "N/A"}</p>
              </div>
              <div className="flex flex-col items-center">
                <h4 className="text-sm font-medium text-muted-foreground mb-1">Invoice Date</h4>
                <p className="font-medium">
                  {procedure.invoice_date 
                    ? new Date(procedure.invoice_date).toLocaleDateString()
                    : "N/A"
                  }
                </p>
              </div>
              <div className="flex flex-col items-center">
                <h4 className="text-sm font-medium text-muted-foreground mb-1">Amount</h4>
                <p className="font-medium">
                  {procedure.amount
                    ? formatCurrency(parseFloat(procedure.amount), procedure.currency || "TRY")
                    : "N/A"
                  }
                </p>
              </div>
              <div className="flex flex-col items-center">
                <h4 className="text-sm font-medium text-muted-foreground mb-1">Piece</h4>
                <p className="font-medium">{procedure.piece || "N/A"}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Financial Information Cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-6">
          {/* Card 1 - Invoice Value */}
          <Card className="p-4">
            <div className="flex flex-col items-center h-full">
              <h3 className="text-sm font-medium text-muted-foreground mb-2">Invoice Value</h3>
              {isLoadingFinancial || !procedure ? (
                <>
                  <Skeleton className="h-8 w-32 mb-2" />
                  <div className="w-full border-t border-gray-200 my-2"></div>
                  <Skeleton className="h-6 w-24" />
                </>
              ) : (
                <>
                  <p className="text-2xl font-bold mb-2">
                    {procedure.amount && procedure.currency === "USD" && procedure.usdtl_rate
                      ? formatCurrency(
                          parseFloat(procedure.amount) * parseFloat(procedure.usdtl_rate.toString()),
                          "TRY"
                        )
                      : procedure.amount && procedure.currency !== "USD"
                        ? formatCurrency(parseFloat(procedure.amount), procedure.currency || "TRY")
                        : "N/A"}
                  </p>
                  <div className="w-full border-t border-gray-200 my-2"></div>
                  <p className="text-2xl font-bold">
                    {procedure.amount && procedure.currency === "USD"
                      ? formatCurrency(parseFloat(procedure.amount), "USD")
                      : procedure.amount && procedure.usdtl_rate
                        ? formatCurrency(
                            convertToUSD(parseFloat(procedure.amount), parseFloat(procedure.usdtl_rate.toString())) || 0,
                            "USD"
                          )
                        : "N/A"}
                  </p>
                </>
              )}
            </div>
          </Card>

          {/* Card 2 - Total Tax */}
          <Card className="p-4">
            <div className="flex flex-col items-center h-full">
              <h3 className="text-sm font-medium text-muted-foreground mb-2">Total Tax</h3>
              {isLoadingFinancial || !financialData || !procedure ? (
                <>
                  <Skeleton className="h-8 w-32 mb-2" />
                  <div className="w-full border-t border-gray-200 my-2"></div>
                  <Skeleton className="h-6 w-24" />
                </>
              ) : (
                <>
                  <p className="text-2xl font-bold mb-2">
                    {financialData.financialSummaries && 
                     procedure.reference && 
                     financialData.financialSummaries[procedure.reference]
                      ? formatCurrency(financialData.financialSummaries[procedure.reference].totalTax)
                      : "N/A"}
                  </p>
                  <div className="w-full border-t border-gray-200 my-2"></div>
                  <p className="text-2xl font-bold">
                    {financialData.financialSummaries && 
                     procedure.reference && 
                     procedure.usdtl_rate &&
                     financialData.financialSummaries[procedure.reference]
                      ? formatCurrency(
                          convertToUSD(
                            financialData.financialSummaries[procedure.reference].totalTax, 
                            parseFloat(procedure.usdtl_rate.toString())
                          ) || 0,
                          "USD"
                        )
                      : "N/A"}
                  </p>
                </>
              )}
            </div>
          </Card>

          {/* Card 3 - Total Import Expense */}
          <Card className="p-4">
            <div className="flex flex-col items-center h-full">
              <h3 className="text-sm font-medium text-muted-foreground mb-2">Total Import Expense</h3>
              {isLoadingFinancial || !financialData || !procedure ? (
                <>
                  <Skeleton className="h-8 w-32 mb-2" />
                  <div className="w-full border-t border-gray-200 my-2"></div>
                  <Skeleton className="h-6 w-24" />
                </>
              ) : (
                <>
                  <p className="text-2xl font-bold mb-2">
                    {financialData.financialSummaries && 
                     procedure.reference && 
                     financialData.financialSummaries[procedure.reference]
                      ? formatCurrency(financialData.financialSummaries[procedure.reference].importExpenses)
                      : "N/A"}
                  </p>
                  <div className="w-full border-t border-gray-200 my-2"></div>
                  <p className="text-2xl font-bold">
                    {financialData.financialSummaries && 
                     procedure.reference && 
                     procedure.usdtl_rate &&
                     financialData.financialSummaries[procedure.reference]
                      ? formatCurrency(
                          convertToUSD(
                            financialData.financialSummaries[procedure.reference].importExpenses, 
                            parseFloat(procedure.usdtl_rate.toString())
                          ) || 0,
                          "USD"
                        )
                      : "N/A"}
                  </p>
                </>
              )}
            </div>
          </Card>

          {/* Card 4 - Total Service Invoice */}
          <Card className="p-4">
            <div className="flex flex-col items-center h-full">
              <h3 className="text-sm font-medium text-muted-foreground mb-2">Total Service Invoice</h3>
              {isLoadingFinancial || !financialData || !procedure ? (
                <>
                  <Skeleton className="h-8 w-32 mb-2" />
                  <div className="w-full border-t border-gray-200 my-2"></div>
                  <Skeleton className="h-6 w-24" />
                </>
              ) : (
                <>
                  <p className="text-2xl font-bold mb-2">
                    {financialData.financialSummaries && 
                     procedure.reference && 
                     financialData.financialSummaries[procedure.reference]
                      ? formatCurrency(financialData.financialSummaries[procedure.reference].serviceInvoices)
                      : "N/A"}
                  </p>
                  <div className="w-full border-t border-gray-200 my-2"></div>
                  <p className="text-2xl font-bold">
                    {financialData.financialSummaries && 
                     procedure.reference && 
                     procedure.usdtl_rate &&
                     financialData.financialSummaries[procedure.reference]
                      ? formatCurrency(
                          convertToUSD(
                            financialData.financialSummaries[procedure.reference].serviceInvoices, 
                            parseFloat(procedure.usdtl_rate.toString())
                          ) || 0,
                          "USD"
                        )
                      : "N/A"}
                  </p>
                </>
              )}
            </div>
          </Card>

          {/* Card 5 - Total Expenses */}
          <Card className="p-4">
            <div className="flex flex-col items-center h-full">
              <h3 className="text-sm font-medium text-muted-foreground mb-2">Total Expenses</h3>
              {isLoadingFinancial || !financialData || !procedure ? (
                <>
                  <Skeleton className="h-8 w-32 mb-2" />
                  <div className="w-full border-t border-gray-200 my-2"></div>
                  <Skeleton className="h-6 w-24" />
                </>
              ) : (
                <>
                  <p className="text-2xl font-bold mb-2">
                    {financialData.financialSummaries && 
                     procedure.reference && 
                     financialData.financialSummaries[procedure.reference]
                      ? formatCurrency(financialData.financialSummaries[procedure.reference].totalExpenses)
                      : "N/A"}
                  </p>
                  <div className="w-full border-t border-gray-200 my-2"></div>
                  <p className="text-2xl font-bold">
                    {financialData.financialSummaries && 
                     procedure.reference && 
                     procedure.usdtl_rate &&
                     financialData.financialSummaries[procedure.reference]
                      ? formatCurrency(
                          convertToUSD(
                            financialData.financialSummaries[procedure.reference].totalExpenses, 
                            parseFloat(procedure.usdtl_rate.toString())
                          ) || 0,
                          "USD"
                        )
                      : "N/A"}
                  </p>
                </>
              )}
            </div>
          </Card>

          {/* Card 5.5 - Freight Invoice */}
          <Card className="p-4">
            <div className="flex flex-col items-center h-full">
              <div className="flex justify-between items-center w-full mb-2">
                <h3 className="text-sm font-medium text-muted-foreground">Freight Invoice</h3>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="h-6 w-6 p-0" 
                  onClick={() => setShowFreightModal(true)}
                >
                  <Settings className="h-3.5 w-3.5" />
                </Button>
              </div>
              {isLoadingFinancial || !procedure ? (
                <>
                  <Skeleton className="h-8 w-32 mb-2" />
                  <div className="w-full border-t border-gray-200 my-2"></div>
                  <Skeleton className="h-6 w-24" />
                </>
              ) : (
                <>
                  <p className="text-2xl font-bold mb-2">
                    {procedure.freight_amount 
                      ? formatCurrency(parseFloat(procedure.freight_amount), "TRY")
                      : "0.00 ₺"}
                  </p>
                  <div className="w-full border-t border-gray-200 my-2"></div>
                  <p className="text-2xl font-bold">
                    {procedure.freight_amount && procedure.usdtl_rate
                      ? formatCurrency(
                          convertToUSD(
                            parseFloat(procedure.freight_amount), 
                            parseFloat(procedure.usdtl_rate.toString())
                          ) || 0,
                          "USD"
                        )
                      : "0.00 $"}
                  </p>
                </>
              )}
            </div>
          </Card>

          {/* Card 6 - Total Cost */}
          <Card className="p-4">
            <div className="flex flex-col items-center h-full">
              <h3 className="text-sm font-medium text-muted-foreground mb-2">Total Cost</h3>
              {isLoadingFinancial || !financialData || !procedure ? (
                <>
                  <Skeleton className="h-8 w-32 mb-2" />
                  <div className="w-full border-t border-gray-200 my-2"></div>
                  <Skeleton className="h-6 w-24" />
                </>
              ) : (
                <>
                  <p className="text-2xl font-bold mb-2">
                    {procedure.amount && 
                     financialData.financialSummaries && 
                     procedure.reference && 
                     financialData.financialSummaries[procedure.reference]
                      ? (() => {
                          // Calculate TL value of invoice based on currency
                          let invoiceValueTL = 0;
                          if (procedure.currency === "USD" && procedure.usdtl_rate) {
                            // If USD, convert to TL using exchange rate
                            invoiceValueTL = parseFloat(procedure.amount) * parseFloat(procedure.usdtl_rate.toString());
                          } else {
                            // If already TL, use as is
                            invoiceValueTL = parseFloat(procedure.amount);
                          }
                          
                          // Add freight amount (if exists)
                          const freightAmountTL = procedure.freight_amount ? parseFloat(procedure.freight_amount) : 0;
                          
                          // Add total expenses in TL + freight amount
                          const totalCostTL = invoiceValueTL + 
                                            financialData.financialSummaries[procedure.reference].totalExpenses + 
                                            freightAmountTL;
                          
                          // Format with TL symbol
                          return formatCurrency(totalCostTL, "TRY");
                        })()
                      : "N/A"}
                  </p>
                  <div className="w-full border-t border-gray-200 my-2"></div>
                  <p className="text-2xl font-bold">
                    {procedure.amount && 
                     financialData.financialSummaries && 
                     procedure.reference && 
                     procedure.usdtl_rate &&
                     financialData.financialSummaries[procedure.reference]
                      ? (() => {
                          // Calculate TL value of invoice based on currency
                          let invoiceValueTL = 0;
                          if (procedure.currency === "USD" && procedure.usdtl_rate) {
                            // If USD, convert to TL using exchange rate
                            invoiceValueTL = parseFloat(procedure.amount) * parseFloat(procedure.usdtl_rate.toString());
                          } else {
                            // If already TL, use as is
                            invoiceValueTL = parseFloat(procedure.amount);
                          }
                          
                          // Add freight amount (if exists)
                          const freightAmountTL = procedure.freight_amount ? parseFloat(procedure.freight_amount) : 0;
                          
                          // Add total expenses in TL + freight amount
                          const totalCostTL = invoiceValueTL + 
                                            financialData.financialSummaries[procedure.reference].totalExpenses + 
                                            freightAmountTL;
                          
                          // Convert total from TL to USD
                          const totalCostUSD = convertToUSD(totalCostTL, parseFloat(procedure.usdtl_rate.toString())) || 0;
                          
                          // Format with USD symbol
                          return formatCurrency(totalCostUSD, "USD");
                        })()
                      : "N/A"}
                  </p>
                </>
              )}
            </div>
          </Card>
        </div>

        {/* Expense Trends Chart Section */}
        {procedure && (
          <ExpenseTrendsChart 
            procedureReference={procedure.reference}
            currency={procedure.currency || 'TRY'}
            exchangeRate={procedure.currency === 'USD' && procedure.usdtl_rate ? parseFloat(procedure.usdtl_rate.toString()) : 1}
          />
        )}

        {/* Invoice Line Items Section */}
        {procedure && (
          <div className="mt-8">
            <InvoiceLineItemsTable 
              procedureReference={procedure.reference}
              currency={procedure.currency || 'TRY'}
              exchangeRate={procedure.currency === 'USD' && procedure.usdtl_rate ? procedure.usdtl_rate : 1}
            />
          </div>
        )}

        {/* Freight Amount Edit Modal */}
        <Dialog open={showFreightModal} onOpenChange={setShowFreightModal}>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>Edit Freight Invoice</DialogTitle>
              <DialogDescription>
                Update the freight amount for this procedure.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="freightAmount" className="text-right">
                  Amount ($)
                </Label>
                <Input
                  id="freightAmount"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="Enter freight amount in USD"
                  value={freightAmount}
                  onChange={(e) => setFreightAmount(e.target.value)}
                  className="col-span-3"
                />
              </div>
              {freightUpdateError && (
                <div className="text-sm text-red-500 mt-2">
                  {freightUpdateError}
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowFreightModal(false)}>
                <X className="w-4 h-4 mr-2" />
                Cancel
              </Button>
              <Button onClick={handleUpdateFreightAmount} disabled={isUpdatingFreight}>
                {isUpdatingFreight ? (
                  <div className="flex items-center">
                    <span className="loading loading-spinner loading-xs mr-2"></span>
                    Updating...
                  </div>
                ) : (
                  <>
                    <Save className="w-4 h-4 mr-2" />
                    Update
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </PageLayout>
  );
}