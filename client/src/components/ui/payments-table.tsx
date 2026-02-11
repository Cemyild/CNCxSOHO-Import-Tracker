import React, { useState, useMemo, useRef, useId } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import { 
  Card, 
  CardContent, 
  CardDescription, 
  CardFooter, 
  CardHeader, 
  CardTitle 
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { PaymentTableSkeleton } from "@/components/ui/branded-skeleton-loader";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
} from "@/components/ui/pagination";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { 
  ChevronDown, 
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  ChevronFirst,
  ChevronLast,
  Filter, 
  Plus, 
  MoreVertical, 
  Trash2, 
  Search, 
  Edit, 
  Eye, 
  ListFilter,
  CircleX,
  Columns3 
} from "lucide-react";
import AddPaymentModal from "./fixed-add-payment-modal";

// Interface for individual payment records
interface Payment {
  id: number;
  procedureReference: string;
  paymentType: string;
  amount: number;
  paymentDate: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

// Interface for aggregated payment summary by procedure
interface AggregatedPayment {
  procedureReference: string;
  procedureTitle?: string; // Added to store procedure title if available
  advancePaymentTotal: number;
  balancePaymentTotal: number;
  totalExpenses: number; // Total expenses for this procedure
  totalPayment: number;
  remainingBalance: number; // Added to store remaining balance
  paymentStatus?: string; // Added to store payment status from procedure
  paymentIds: number[]; // Store all payment IDs for this procedure for deletion
  payments: Payment[]; // Store all original payment records
}

interface PaymentsTableProps {
  onAddPayment?: () => void;
  onDeletePayment?: (paymentId: number) => void;
  procedureReference?: string | null;
}

export function PaymentsTable({ onAddPayment, onDeletePayment, procedureReference }: PaymentsTableProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [isAddPaymentModalOpen, setIsAddPaymentModalOpen] = useState(false);
  const [selectedPaymentForEdit, setSelectedPaymentForEdit] = useState<Payment | null>(null);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
  const [selectedProcedureForDetails, setSelectedProcedureForDetails] = useState<string | null>(null);
  const [pagination, setPagination] = useState({
    pageIndex: 0,
    pageSize: 10,
  });
  const [columnVisibility, setColumnVisibility] = useState({});
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  // Fetch all payments
  const { data: paymentsData, isLoading: isPaymentsLoading, error: paymentsError, refetch: refetchPayments } = useQuery({
    queryKey: ["/api/payments"],
    queryFn: async () => {
      try {
        const response = await fetch("/api/payments");
        if (!response.ok) {
          throw new Error("Network response was not ok");
        }
        const data = await response.json();
        console.log("Payments data:", data);
        return data;
      } catch (error) {
        console.error("Error fetching payments:", error);
        throw error;
      }
    },
  });

  // Fetch procedure data for titles
  const { data: proceduresData, isLoading: isProceduresLoading } = useQuery({
    queryKey: ["/api/procedures"],
    queryFn: async () => {
      try {
        const response = await fetch("/api/procedures");
        if (!response.ok) {
          throw new Error("Failed to fetch procedures");
        }
        const data = await response.json();
        console.log("Procedures data:", data);
        return data;
      } catch (error) {
        console.error("Error fetching procedures:", error);
        throw error;
      }
    },
  });
  
  // Fetch financial summary data to get the total expenses
  const { data: financialSummaryData, isLoading: isFinancialSummaryLoading } = useQuery({
    queryKey: ["/api/financial-summary"],
    queryFn: async () => {
      try {
        const response = await fetch("/api/financial-summary");
        if (!response.ok) {
          console.error("Financial summary API returned error:", response.status);
          return { financialSummaries: [] };
        }
        const data = await response.json();
        console.log("Financial summary data:", data);
        return data;
      } catch (error) {
        console.error("Error fetching financial summary:", error);
        return { financialSummaries: [] };
      }
    },
  });

  // Fetch incoming payments data
  const { data: incomingPaymentsData, isLoading: isIncomingPaymentsLoading } = useQuery({
    queryKey: ["/api/incoming-payments"],
    queryFn: async () => {
      try {
        const response = await fetch("/api/incoming-payments");
        if (!response.ok) {
          console.error("Incoming payments API returned error:", response.status);
          return { incomingPayments: [] };
        }
        const data = await response.json();
        console.log("Incoming payments data:", data);
        return data;
      } catch (error) {
        console.error("Error fetching incoming payments:", error);
        return { incomingPayments: [] };
      }
    },
  });

  // Format currency with safe handling of null/undefined/NaN values
  const formatCurrency = (amount: number | undefined | null) => {
    // Ensure we're dealing with a number, default to 0 if undefined, null, or NaN
    const safeAmount = typeof amount === 'number' && !isNaN(amount) ? amount : 0;
    
    return new Intl.NumberFormat("tr-TR", {
      style: "currency",
      currency: "TRY",
    }).format(safeAmount);
  };

  // Aggregate payments by procedure reference
  const aggregatedPayments = useMemo(() => {
    if (!paymentsData?.payments) return [];

    console.log("Starting payment aggregation with payments:", paymentsData.payments.length);
    
    const paymentsByReference: { [key: string]: AggregatedPayment } = {};
    
    // Group payments by procedure reference
    paymentsData.payments.forEach((payment: Payment) => {
      const ref = payment.procedureReference;
      
      if (!paymentsByReference[ref]) {
        // Find procedure title if available
        const procedure = proceduresData?.procedures?.find(
          (p: any) => p.reference === ref
        );
        
        // Find total expenses from financial summary if available
        let totalExpensesAmount = 0;
        let advancePaymentsAmount = 0;
        let balancePaymentsAmount = 0;
        
        if (financialSummaryData?.financialSummaries) {
          const summary = financialSummaryData.financialSummaries.find(
            (s: any) => s.procedureReference === ref
          );
          
          if (summary) {
            console.log(`Found financial summary for ${ref}:`, summary);
            
            // Safely extract and parse financial values
            totalExpensesAmount = parseFloat(summary.totalExpenses?.toString() || '0') || 0;
            advancePaymentsAmount = parseFloat(summary.advancePayments?.toString() || '0') || 0;
            balancePaymentsAmount = parseFloat(summary.balancePayments?.toString() || '0') || 0;
            
            console.log(`Financial data for ${ref}:`, {
              totalExpenses: totalExpensesAmount,
              advancePayments: advancePaymentsAmount,
              balancePayments: balancePaymentsAmount
            });
          }
        }
        
        paymentsByReference[ref] = {
          procedureReference: ref,
          procedureTitle: procedure?.title || "",
          advancePaymentTotal: 0,
          balancePaymentTotal: 0,
          totalExpenses: totalExpensesAmount,
          totalPayment: 0,
          remainingBalance: totalExpensesAmount, // Initialize with total expenses (will be updated later)
          paymentStatus: procedure?.payment_status || "", // Get payment status from procedure - empty if not set
          paymentIds: [],
          payments: []
        };
      }
      
      // Safely parse amount to ensure it's a number
      const paymentAmount = parseFloat(payment.amount as any) || 0;
      
      // Normalize payment type for consistent comparison
      const paymentType = payment.paymentType ? payment.paymentType.toLowerCase() : '';
      console.log(`Payment ${payment.id} type: "${paymentType}", amount: ${paymentAmount}`);
      
      // Add payment amounts to the appropriate totals
      if (paymentType === "advance" || paymentType === "advance payment") {
        paymentsByReference[ref].advancePaymentTotal += paymentAmount;
      } else if (paymentType === "balance" || paymentType === "balance payment") {
        paymentsByReference[ref].balancePaymentTotal += paymentAmount;
      } else {
        console.log(`Unknown payment type: ${paymentType}`);
      }
      
      // Add payment ID to the list
      paymentsByReference[ref].paymentIds.push(payment.id);
      
      // Add full payment record
      paymentsByReference[ref].payments.push(payment);
      
      // Update total payment (regardless of type)
      paymentsByReference[ref].totalPayment += paymentAmount;
      
      // Update remaining balance (Total Expenses - Total Payments)
      paymentsByReference[ref].remainingBalance = 
        parseFloat(paymentsByReference[ref].totalExpenses as any) - 
        parseFloat(paymentsByReference[ref].totalPayment as any);
    });
    
    // Add procedures that have no payments but have expenses or prepaid payments
    if (financialSummaryData?.financialSummaries) {
      financialSummaryData.financialSummaries.forEach((summary: any) => {
        const ref = summary.procedureReference;
        
        // If we don't have this procedure in our map yet or it has expenses
        if (!paymentsByReference[ref] && (
            parseFloat(summary.totalExpenses?.toString() || '0') > 0 ||
            parseFloat(summary.advancePayments?.toString() || '0') > 0 ||
            parseFloat(summary.balancePayments?.toString() || '0') > 0
        )) {
          // Find procedure title if available
          const procedure = proceduresData?.procedures?.find(
            (p: any) => p.reference === ref
          );
          
          // Safely extract and parse financial values
          const totalExpensesAmount = parseFloat(summary.totalExpenses?.toString() || '0') || 0;
          const advancePaymentsAmount = parseFloat(summary.advancePayments?.toString() || '0') || 0;
          const balancePaymentsAmount = parseFloat(summary.balancePayments?.toString() || '0') || 0;
          const totalPaymentsAmount = advancePaymentsAmount + balancePaymentsAmount;
          const remainingBalanceAmount = totalExpensesAmount - totalPaymentsAmount;
          
          console.log(`Adding procedure ${ref} from financial summary data:`, {
            totalExpenses: totalExpensesAmount,
            advancePayments: advancePaymentsAmount,
            balancePayments: balancePaymentsAmount,
            totalPayments: totalPaymentsAmount,
            remainingBalance: remainingBalanceAmount
          });
          
          // Create entry using calculated values from financial summary
          paymentsByReference[ref] = {
            procedureReference: ref,
            procedureTitle: procedure?.title || "",
            advancePaymentTotal: advancePaymentsAmount,
            balancePaymentTotal: balancePaymentsAmount,
            totalExpenses: totalExpensesAmount,
            totalPayment: totalPaymentsAmount,
            remainingBalance: remainingBalanceAmount,
            paymentStatus: procedure?.payment_status || "", // Get payment status from procedure - empty if not set
            paymentIds: [],
            payments: []
          };
        }
      });
    }
    
    // Log the final aggregated data for debugging
    console.log("Final aggregated payment data:", paymentsByReference);
    
    // Convert the object to an array
    return Object.values(paymentsByReference)
      // Filter by search query if present
      .filter(aggregated => 
        aggregated.procedureReference.toLowerCase().includes(searchQuery.toLowerCase()) ||
        aggregated.procedureTitle?.toLowerCase().includes(searchQuery.toLowerCase())
      )
      // Filter by procedure reference if specified
      .filter(aggregated => 
        procedureReference ? aggregated.procedureReference === procedureReference : true
      )
      // Sort by payment status and remaining balance
      .sort((a, b) => {
        // First sort by payment status: non-"closed" status first
        const aIsClosed = (a.paymentStatus || '').toLowerCase() === 'closed';
        const bIsClosed = (b.paymentStatus || '').toLowerCase() === 'closed';
        
        if (aIsClosed !== bIsClosed) {
          return aIsClosed ? 1 : -1; // Non-closed items come first
        }
        
        // Within same payment status group, sort by remaining balance (highest to lowest)
        const aBalance = parseFloat(a.remainingBalance as any) || 0;
        const bBalance = parseFloat(b.remainingBalance as any) || 0;
        return bBalance - aBalance; // Descending order (highest first)
      });
  }, [paymentsData?.payments, proceduresData?.procedures, financialSummaryData?.financialSummaries, searchQuery, procedureReference]);

  // Handle delete payment (now deletes all payments for a procedure)
  const handleDeletePayment = async (paymentId: number) => {
    try {
      const response = await fetch(`/api/payments/${paymentId}`, {
        method: "DELETE",
      });
      
      if (!response.ok) {
        throw new Error("Failed to delete payment");
      }
      
      // Refetch payments after deletion
      refetchPayments();
      
      if (onDeletePayment) {
        onDeletePayment(paymentId);
      }
    } catch (error) {
      console.error("Error deleting payment:", error);
    }
  };

  // Handle adding a new payment
  const handleAddPayment = () => {
    if (onAddPayment) {
      onAddPayment();
    } else {
      setSelectedPaymentForEdit(null); // Clear any selected payment for edit
      setIsAddPaymentModalOpen(true);
    }
  };

  // Handle editing a payment
  const handleEditPayment = (payment: Payment) => {
    setSelectedPaymentForEdit(payment);
    setIsAddPaymentModalOpen(true);
  };

  // Handle viewing payment details
  const handleViewPaymentDetails = (procedureRef: string) => {
    setSelectedProcedureForDetails(procedureRef);
    setIsDetailsModalOpen(true);
  };

  // Handle payment creation success
  const handlePaymentCreated = () => {
    refetchPayments();
    setIsAddPaymentModalOpen(false);
    setSelectedPaymentForEdit(null);
  };

  if (isPaymentsLoading || isProceduresLoading || isFinancialSummaryLoading || isIncomingPaymentsLoading) {
    return <PaymentTableSkeleton />;
  }

  if (paymentsError) {
    return <div className="p-4 text-red-500">Error loading payments: {String(paymentsError)}</div>;
  }

  return (
    <div className="w-full space-y-4">
      {/* Filters and Actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {/* Search Filter */}
          <div className="relative">
            <Input
              id={`${id}-input`}
              ref={inputRef}
              className={cn(
                "peer min-w-60 ps-9",
                Boolean(searchQuery) && "pe-9",
              )}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter by reference..."
              type="text"
              aria-label="Filter by reference"
            />
            <div className="pointer-events-none absolute inset-y-0 start-0 flex items-center justify-center ps-3 text-muted-foreground/80 peer-disabled:opacity-50">
              <ListFilter size={16} strokeWidth={2} aria-hidden="true" />
            </div>
            {Boolean(searchQuery) && (
              <button
                className="absolute inset-y-0 end-0 flex h-full w-9 items-center justify-center rounded-e-lg text-muted-foreground/80 outline-offset-2 transition-colors hover:text-foreground focus:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring/70 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Clear filter"
                onClick={() => {
                  setSearchQuery("");
                  if (inputRef.current) {
                    inputRef.current.focus();
                  }
                }}
              >
                <CircleX size={16} strokeWidth={2} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
        
        {/* Actions */}
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" size="sm" className="h-8 gap-1">
            <Columns3 className="h-3.5 w-3.5" />
            <span className="sr-only sm:not-sr-only sm:whitespace-nowrap">Columns</span>
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader className="bg-muted/30">
            <TableRow>
              <TableHead className="whitespace-nowrap py-3 font-medium">Reference</TableHead>
              <TableHead className="whitespace-nowrap py-3 font-medium">Advance Payment</TableHead>
              <TableHead className="whitespace-nowrap py-3 font-medium">Balance Payment</TableHead>
              <TableHead className="whitespace-nowrap py-3 font-medium">Total Expenses</TableHead>
              <TableHead className="whitespace-nowrap py-3 font-medium">Total Payment</TableHead>
              <TableHead className="whitespace-nowrap py-3 font-medium">Remaining Balance</TableHead>
              <TableHead className="whitespace-nowrap py-3 font-medium">Payment Status</TableHead>
              <TableHead className="whitespace-nowrap py-3 font-medium text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {aggregatedPayments.length > 0 ? (
              aggregatedPayments
                .slice(
                  pagination.pageIndex * pagination.pageSize,
                  (pagination.pageIndex + 1) * pagination.pageSize
                )
                .map((aggregated) => (
                <TableRow key={aggregated.procedureReference} className="group">
                  <TableCell className="font-medium">
                    <div className="flex flex-col">
                      <span>{aggregated.procedureReference}</span>
                      {aggregated.procedureTitle && (
                        <span className="text-xs text-muted-foreground">{aggregated.procedureTitle}</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {formatCurrency(aggregated.advancePaymentTotal)}
                  </TableCell>
                  <TableCell>
                    {formatCurrency(aggregated.balancePaymentTotal)}
                  </TableCell>
                  <TableCell>
                    <div className="font-medium text-red-600">
                      {formatCurrency(aggregated.totalExpenses)}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="font-semibold text-green-600">
                      {formatCurrency(aggregated.totalPayment)}
                    </div>
                  </TableCell>
                  <TableCell>
                    {/* Check if remaining balance is very close to zero (accounting for floating point imprecision) */}
                    {Math.abs(aggregated.remainingBalance) < 0.01 ? (
                      <div className="font-medium text-gray-500">
                        {formatCurrency(0)} Paid
                      </div>
                    ) : aggregated.remainingBalance > 0 ? (
                      <div className="font-medium text-red-600">
                        {formatCurrency(aggregated.remainingBalance)} Balance
                      </div>
                    ) : (
                      <div className="font-medium text-green-600">
                        {formatCurrency(Math.abs(aggregated.remainingBalance))} Overpaid
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    {(() => {
                      const status = aggregated.paymentStatus;
                      if (!status) {
                        return (
                          <Badge variant="outline" className="border-gray-500 text-gray-500">
                            None
                          </Badge>
                        );
                      }

                      let formattedStatus = "";
                      let badgeClass = "";
                      
                      // Format specific payment statuses with proper spacing and color coding
                      switch(status.toLowerCase()) {
                        case "taxletter_sent":
                          formattedStatus = "Taxletter Sent";
                          badgeClass = "bg-yellow-500 text-white";
                          break;
                        case "waiting_adv_payment":
                          formattedStatus = "Waiting Adv. Payment";
                          badgeClass = "bg-orange-500 text-white";
                          break;
                        case "advance_payment_received":
                          formattedStatus = "Advance Payment Received";
                          badgeClass = "bg-green-600 text-white";
                          break;
                        case "final_balance_letter_sent":
                          formattedStatus = "Final Balance Letter Sent";
                          badgeClass = "bg-red-600 text-white";
                          break;
                        case "balance_received":
                          formattedStatus = "Balance Received";
                          badgeClass = "bg-green-600 text-white";
                          break;
                        case "closed":
                          formattedStatus = "Closed";
                          badgeClass = "bg-muted-foreground/60 text-primary-foreground";
                          break;
                        default:
                          // Handle any other statuses by replacing underscores with spaces and capitalize
                          formattedStatus = status.split('_')
                            .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
                            .join(' ');
                          badgeClass = "bg-yellow-500 text-white"; // Default to yellow
                      }
                      
                      return (
                        <Badge className={cn(badgeClass)}>
                          {formattedStatus}
                        </Badge>
                      );
                    })()}
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                        >
                          <MoreVertical className="h-4 w-4" />
                          <span className="sr-only">Actions</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem 
                          onClick={() => handleViewPaymentDetails(aggregated.procedureReference)}
                        >
                          <Eye className="h-4 w-4 mr-2" /> View Details
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {aggregated.payments.map(payment => (
                          <DropdownMenuItem
                            key={payment.id}
                            onClick={() => handleDeletePayment(payment.id)}
                            className="text-red-600"
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete {payment.paymentType === 'advance' ? 'Advance' : 'Balance'} Payment 
                            ({formatCurrency(payment.amount)})
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={8} className="h-24 text-center">
                  No payments found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      
      {/* Pagination */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          Showing{" "}
          <span className="font-medium">
            {pagination.pageIndex * pagination.pageSize + 1}
          </span>{" "}
          to{" "}
          <span className="font-medium">
            {Math.min(
              (pagination.pageIndex + 1) * pagination.pageSize,
              aggregatedPayments.length
            )}
          </span>{" "}
          of <span className="font-medium">{aggregatedPayments.length}</span> results
        </div>
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setPagination({...pagination, pageIndex: 0})}
                disabled={pagination.pageIndex === 0}
                className="hidden h-8 w-8 sm:flex"
              >
                <span className="sr-only">Go to first page</span>
                <ChevronFirst size={16} strokeWidth={2} />
              </Button>
            </PaginationItem>
            <PaginationItem>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setPagination({...pagination, pageIndex: pagination.pageIndex - 1})}
                disabled={pagination.pageIndex === 0}
                className="h-8 w-8"
              >
                <span className="sr-only">Go to previous page</span>
                <ChevronLeft size={16} strokeWidth={2} />
              </Button>
            </PaginationItem>
            <PaginationItem>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setPagination({...pagination, pageIndex: pagination.pageIndex + 1})}
                disabled={(pagination.pageIndex + 1) * pagination.pageSize >= aggregatedPayments.length}
                className="h-8 w-8"
              >
                <span className="sr-only">Go to next page</span>
                <ChevronRight size={16} strokeWidth={2} />
              </Button>
            </PaginationItem>
            <PaginationItem>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setPagination({
                  ...pagination, 
                  pageIndex: Math.ceil(aggregatedPayments.length / pagination.pageSize) - 1
                })}
                disabled={(pagination.pageIndex + 1) * pagination.pageSize >= aggregatedPayments.length}
                className="hidden h-8 w-8 sm:flex"
              >
                <span className="sr-only">Go to last page</span>
                <ChevronLast size={16} strokeWidth={2} />
              </Button>
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      </div>
      
      {/* Add Payment Modal */}
      <AddPaymentModal
        isOpen={isAddPaymentModalOpen}
        onClose={() => {
          setIsAddPaymentModalOpen(false);
          setSelectedPaymentForEdit(null);
        }}
        onPaymentCreated={handlePaymentCreated}
        initialProcedureReference={procedureReference || undefined}
      />

      {/* Procedure Details Modal */}
      <Dialog open={isDetailsModalOpen} onOpenChange={setIsDetailsModalOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Procedure Payment Details</DialogTitle>
            <DialogDescription>
              {selectedProcedureForDetails && `Payment details and financial summary for procedure ${selectedProcedureForDetails}`}
            </DialogDescription>
          </DialogHeader>
          
          {selectedProcedureForDetails && (() => {
            // Find the procedure data
            const procedure = proceduresData?.procedures?.find((p: any) => p.reference === selectedProcedureForDetails);
            
            // Find the aggregated payment data
            const aggregatedData = aggregatedPayments.find(ap => ap.procedureReference === selectedProcedureForDetails);
            
            // Get financial summary data
            const financialSummary = financialSummaryData?.financialSummaries?.find(
              (s: any) => s.procedureReference === selectedProcedureForDetails
            );

            const formatCurrency = (amount: number) => {
              return `₺${new Intl.NumberFormat("en-US", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              }).format(amount)}`;
            };

            const formatDate = (dateString: string) => {
              if (!dateString) return "N/A";
              const date = new Date(dateString);
              if (isNaN(date.getTime())) return "N/A";
              
              const day = date.getUTCDate().toString().padStart(2, '0');
              const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
              const year = date.getUTCFullYear();
              
              return `${day}.${month}.${year}`;
            };

            return (
              <div className="space-y-6">
                {/* Procedure Information */}
                <Card>
                  <CardHeader>
                    <CardTitle>Procedure Information</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      <div>
                        <div className="text-sm font-medium text-muted-foreground">Reference</div>
                        <div className="font-medium">{procedure?.reference || selectedProcedureForDetails}</div>
                      </div>
                      <div>
                        <div className="text-sm font-medium text-muted-foreground">Shipper</div>
                        <div className="font-medium">{procedure?.shipper || "N/A"}</div>
                      </div>
                      <div>
                        <div className="text-sm font-medium text-muted-foreground">Invoice No</div>
                        <div className="font-medium">{procedure?.invoice_no || "N/A"}</div>
                      </div>
                      <div>
                        <div className="text-sm font-medium text-muted-foreground">Invoice Date</div>
                        <div className="font-medium">{formatDate(procedure?.invoice_date)}</div>
                      </div>
                      <div>
                        <div className="text-sm font-medium text-muted-foreground">Amount</div>
                        <div className="font-medium">{procedure?.amount ? formatCurrency(parseFloat(procedure.amount)) : "N/A"}</div>
                      </div>
                      <div>
                        <div className="text-sm font-medium text-muted-foreground">Pieces</div>
                        <div className="font-medium">{procedure?.piece || "N/A"}</div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Financial Summary */}
                <Card>
                  <CardHeader>
                    <CardTitle>Financial Summary</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div>
                        <div className="text-sm font-medium text-muted-foreground">Total Expenses</div>
                        <div className="text-lg font-bold text-red-600">
                          {aggregatedData ? formatCurrency(aggregatedData.totalExpenses) : "Loading..."}
                        </div>
                      </div>
                      <div>
                        <div className="text-sm font-medium text-muted-foreground">Total Payments</div>
                        <div className="text-lg font-bold text-green-600">
                          {aggregatedData ? formatCurrency(aggregatedData.totalPayment) : "Loading..."}
                        </div>
                      </div>
                      <div>
                        <div className="text-sm font-medium text-muted-foreground">Remaining Balance</div>
                        <div className={`text-lg font-bold ${
                          aggregatedData && Math.abs(aggregatedData.remainingBalance) < 0.01 
                            ? "text-gray-500" 
                            : aggregatedData && aggregatedData.remainingBalance > 0 
                              ? "text-red-600" 
                              : "text-green-600"
                        }`}>
                          {aggregatedData ? (
                            Math.abs(aggregatedData.remainingBalance) < 0.01 ? 
                              formatCurrency(0) + " (Paid)" :
                              aggregatedData.remainingBalance > 0 ?
                                formatCurrency(aggregatedData.remainingBalance) + " (Balance)" :
                                formatCurrency(Math.abs(aggregatedData.remainingBalance)) + " (Overpaid)"
                          ) : "Loading..."}
                        </div>
                      </div>
                      <div>
                        <div className="text-sm font-medium text-muted-foreground">Payment Status</div>
                        <div className="font-medium">
                          {(() => {
                            const status = aggregatedData?.paymentStatus;
                            if (!status) return "None";
                            
                            switch(status.toLowerCase()) {
                              case "taxletter_sent": return "Taxletter Sent";
                              case "waiting_adv_payment": return "Waiting Adv. Payment";
                              case "advance_payment_received": return "Advance Payment Received";
                              case "final_balance_letter_sent": return "Final Balance Letter Sent";
                              case "balance_received": return "Balance Received";
                              case "closed": return "Closed";
                              default: return status.split('_').map(word => 
                                word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
                              ).join(' ');
                            }
                          })()}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Payments Distributed to This Procedure */}
                <Card>
                  <CardHeader>
                    <CardTitle>Payments Distributed to This Procedure</CardTitle>
                    <CardDescription>
                      {(() => {
                        const hasPayments = aggregatedData && (aggregatedData.advancePaymentTotal > 0 || aggregatedData.balancePaymentTotal > 0);
                        const totalPayments = aggregatedData ? aggregatedData.advancePaymentTotal + aggregatedData.balancePaymentTotal : 0;
                        
                        if (hasPayments) {
                          return `Total distributed payments: ${formatCurrency(totalPayments)}`;
                        } else {
                          return "No payments have been distributed to this procedure";
                        }
                      })()}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {(() => {
                      const hasPayments = aggregatedData && (aggregatedData.advancePaymentTotal > 0 || aggregatedData.balancePaymentTotal > 0);
                      
                      if (hasPayments) {
                        return (
                          <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4 mb-4">
                              <div>
                                <div className="text-sm font-medium text-muted-foreground">Advance Payments</div>
                                <div className="text-lg font-semibold text-black">
                                  {formatCurrency(aggregatedData.advancePaymentTotal)}
                                </div>
                                <div className="text-xs text-muted-foreground mt-1">
                                  Payments distributed as advance to cover initial expenses
                                </div>
                              </div>
                              <div>
                                <div className="text-sm font-medium text-muted-foreground">Balance Payments</div>
                                <div className="text-lg font-semibold text-black">
                                  {formatCurrency(aggregatedData.balancePaymentTotal)}
                                </div>
                                <div className="text-xs text-muted-foreground mt-1">
                                  Final balance payments to complete the procedure
                                </div>
                              </div>
                            </div>
                            
                            <div className="border rounded-lg p-4 bg-muted/30">
                              <h4 className="font-medium mb-3">Payment Distribution Summary</h4>
                              <div className="space-y-2">
                                {aggregatedData.advancePaymentTotal > 0 && (
                                  <div className="flex justify-between items-center">
                                    <span className="text-sm text-muted-foreground">Advance Payment Distribution:</span>
                                    <span className="font-medium text-black">
                                      {formatCurrency(aggregatedData.advancePaymentTotal)}
                                    </span>
                                  </div>
                                )}
                                {aggregatedData.balancePaymentTotal > 0 && (
                                  <div className="flex justify-between items-center">
                                    <span className="text-sm text-muted-foreground">Balance Payment Distribution:</span>
                                    <span className="font-medium text-black">
                                      {formatCurrency(aggregatedData.balancePaymentTotal)}
                                    </span>
                                  </div>
                                )}
                                <div className="border-t pt-2 mt-2">
                                  <div className="flex justify-between items-center font-medium">
                                    <span>Total Distributed:</span>
                                    <span className="text-green-600">
                                      {formatCurrency(aggregatedData.advancePaymentTotal + aggregatedData.balancePaymentTotal)}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            </div>

                            {/* Incoming Payments for this Procedure */}
                            {(() => {
                              // Find incoming payments that have distributions to this procedure
                              const payments = incomingPaymentsData?.payments || [];
                              const relatedPayments = payments.filter((payment: any) => {
                                return payment.distributions?.some((dist: any) => 
                                  dist.procedureReference === selectedProcedureForDetails
                                );
                              });

                              if (relatedPayments.length > 0) {
                                return (
                                  <div className="mt-6">
                                    <h4 className="font-medium mb-3">Incoming Payment Records</h4>
                                    <div className="text-sm text-muted-foreground mb-3">
                                      {relatedPayments.length} incoming payment(s) distributed to this procedure
                                    </div>
                                    <Table>
                                      <TableHeader>
                                        <TableRow>
                                          <TableHead>Payment ID</TableHead>
                                          <TableHead>Date</TableHead>
                                          <TableHead>Total Payment</TableHead>
                                          <TableHead>Distributed to This Procedure</TableHead>
                                        </TableRow>
                                      </TableHeader>
                                      <TableBody>
                                        {relatedPayments.map((payment: any) => {
                                          // Find all distributions for this specific procedure from this payment
                                          const procedureDistributions = payment.distributions?.filter((dist: any) => 
                                            dist.procedureReference === selectedProcedureForDetails
                                          ) || [];
                                          
                                          // Calculate totals by type
                                          let advanceTotal = 0;
                                          let balanceTotal = 0;
                                          
                                          procedureDistributions.forEach((dist: any) => {
                                            const amount = parseFloat(dist.distributedAmount || 0);
                                            if (dist.paymentType === 'advance') {
                                              advanceTotal += amount;
                                            } else if (dist.paymentType === 'balance') {
                                              balanceTotal += amount;
                                            }
                                          });
                                          
                                          const grandTotal = advanceTotal + balanceTotal;
                                          
                                          return (
                                            <TableRow key={payment.id}>
                                              <TableCell className="font-medium">
                                                {payment.paymentId}
                                              </TableCell>
                                              <TableCell>
                                                {formatDate(payment.dateReceived)}
                                              </TableCell>
                                              <TableCell className="font-medium">
                                                {formatCurrency(parseFloat(payment.totalAmount))}
                                              </TableCell>
                                              <TableCell>
                                                <div className="space-y-1">
                                                  {advanceTotal > 0 && (
                                                    <div className="text-sm">
                                                      <span className="text-muted-foreground">Advance:</span> {formatCurrency(advanceTotal)}
                                                    </div>
                                                  )}
                                                  {balanceTotal > 0 && (
                                                    <div className="text-sm">
                                                      <span className="text-muted-foreground">Balance:</span> {formatCurrency(balanceTotal)}
                                                    </div>
                                                  )}
                                                  <div className="text-sm font-medium">
                                                    Total: {formatCurrency(grandTotal)}
                                                  </div>
                                                </div>
                                              </TableCell>
                                            </TableRow>
                                          );
                                        })}
                                      </TableBody>
                                    </Table>
                                  </div>
                                );
                              }
                              return null;
                            })()}
                          </div>
                        );
                      } else {
                        return (
                          <div className="text-center py-8 text-muted-foreground">
                            <p className="mb-2">No payments have been distributed to this procedure yet.</p>
                            <p className="text-sm">Payments are distributed from the Incoming Payments section.</p>
                          </div>
                        );
                      }
                    })()}
                  </CardContent>
                </Card>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}