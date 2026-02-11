import { 
  Calendar,
  Home,
  Inbox,
  Search,
  Settings,
  BarChart2,
  CreditCard,
  DollarSign,
  AlertTriangle,
  Trash2,
  PlusCircle,
  Eye,
  Database,
  MoreHorizontal,
  Calculator
} from "lucide-react"
import { PageLayout } from "@/components/layout/PageLayout"
import { PaymentsTable } from "@/components/ui/payments-table"
import AddPaymentModal from "@/components/ui/fixed-add-payment-modal"
import { useToast } from "@/hooks/use-toast"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useQuery, useMutation } from "@tanstack/react-query"
import { queryClient, apiRequest } from "@/lib/queryClient"
import { useState, useEffect } from "react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog"
import { formatCurrency, formatDate } from '@/lib/formatters'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { CreateIncomingPaymentForm } from '@/components/create-incoming-payment-form'
import { PaymentDistributionModal } from '@/components/payment-distribution-modal'
import { ViewDistributionModal } from '@/components/view-distribution-modal'
import { GeneratePaymentReportButton } from '@/components/ui/generate-payment-report-button'
import { PaymentSummaryCards } from '@/components/payment-summary-cards'

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

export default function PaymentsPage() {
  const { toast } = useToast();
  const [selectedProcedureRef, setSelectedProcedureRef] = useState<string | null>(null);
  const [isAddPaymentModalOpen, setIsAddPaymentModalOpen] = useState(false);
  const [isDeleteAllConfirmOpen, setIsDeleteAllConfirmOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  
  // Fetch current user data to check role
  const { data: currentUser } = useQuery({
    queryKey: ['/api/auth/me'],
    queryFn: async () => {
      const response = await fetch('/api/auth/me', {
        credentials: 'include',
      });
      if (response.ok) {
        return await response.json();
      }
      return null;
    },
  });

  // Check if current user is admin
  const isAdmin = currentUser?.role === 'admin';
  
  // State for Incoming Payments View
  const [showCreateIncomingForm, setShowCreateIncomingForm] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState<any>(null);
  const [showDistributeModal, setShowDistributeModal] = useState(false);
  const [showViewDistributionsModal, setShowViewDistributionsModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [paymentToDelete, setPaymentToDelete] = useState<any>(null);
  const [activeTab, setActiveTab] = useState(() => {
    // Try to load the saved preference from local storage
    const savedTab = localStorage.getItem('paymentsActiveTab');
    return savedTab || 'procedure-payments';
  });

  // Save tab preference to local storage when changed
  useEffect(() => {
    localStorage.setItem('paymentsActiveTab', activeTab);
  }, [activeTab]);

  // Get reference from URL params if any
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const reference = urlParams.get('reference');
    if (reference) {
      setSelectedProcedureRef(reference);
      // Set tab to procedure payments when reference is in the URL
      setActiveTab('procedure-payments');
    }
  }, []);

  // Fetch all procedures for filtering
  const { data: proceduresData } = useQuery({
    queryKey: ["/api/procedures"],
    queryFn: async () => {
      const response = await fetch("/api/procedures");
      if (!response.ok) {
        throw new Error("Failed to fetch procedures");
      }
      return response.json();
    },
  });

  // Fetch summary data if a procedure is selected
  const { data: summaryData } = useQuery({
    queryKey: ["/api/financial-summary", selectedProcedureRef],
    queryFn: async () => {
      if (!selectedProcedureRef) return null;
      
      const response = await fetch(`/api/financial-summary/${selectedProcedureRef}`);
      if (!response.ok) {
        throw new Error("Failed to fetch financial summary");
      }
      return response.json();
    },
    enabled: !!selectedProcedureRef && activeTab === 'procedure-payments', // Only run query if a procedure is selected and in procedure tab
  });

  // Fetch incoming payments for the incoming payments tab
  const { data: incomingPaymentsData, isLoading: isLoadingIncoming, isError: isIncomingError, error: incomingError } = useQuery({
    queryKey: ['/api/incoming-payments'],
    queryFn: async () => {
      const response = await apiRequest('GET', '/api/incoming-payments');
      const jsonData = await response.json();
      console.log('Fetched incoming payments data:', jsonData);
      return jsonData;
    },
    enabled: activeTab === 'incoming-payments', // Only run when in incoming payments tab
  });

  // Delete incoming payment mutation
  const deleteIncomingMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await apiRequest('DELETE', `/api/incoming-payments/${id}`);
      const jsonData = await response.json();
      return jsonData;
    },
    onSuccess: () => {
      toast({
        title: 'Success',
        description: 'Payment deleted successfully',
      });
      
      // Invalidate the payments query to refresh the list
      queryClient.invalidateQueries({ queryKey: ['/api/incoming-payments'] });
      
      // Close the confirmation dialog
      setShowDeleteConfirm(false);
      setPaymentToDelete(null);
    },
    onError: (error) => {
      console.error('Error deleting payment:', error);
      toast({
        title: 'Error',
        description: `Failed to delete payment: ${error instanceof Error ? error.message : 'Unknown error'}`,
        variant: 'destructive',
      });
    },
  });

  // Reset all distributions mutation
  const resetAllDistributionsMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('DELETE', '/api/all-payment-distributions/reset');
      const jsonData = await response.json();
      return jsonData;
    },
    onSuccess: (data) => {
      toast({
        title: 'Success',
        description: `Successfully reset ${data.count} payment distributions.`,
      });
      
      // Invalidate the payments query to refresh the list
      queryClient.invalidateQueries({ queryKey: ['/api/incoming-payments'] });
    },
    onError: (error) => {
      console.error('Error resetting payment distributions:', error);
      toast({
        title: 'Error',
        description: `Failed to reset payment distributions: ${error instanceof Error ? error.message : 'Unknown error'}`,
        variant: 'destructive',
      });
    },
  });

  // Handle payment deletion (procedure payments)
  const handleDeletePayment = async (paymentId: number) => {
    try {
      const response = await fetch(`/api/payments/${paymentId}`, {
        method: 'DELETE',
      });
      
      if (!response.ok) {
        throw new Error('Failed to delete payment');
      }
      
      toast({
        title: "Payment Deleted",
        description: "The payment has been successfully removed.",
      });
      
      // Invalidate queries to update data
      queryClient.invalidateQueries({ queryKey: ['/api/payments'] });
      if (selectedProcedureRef) {
        queryClient.invalidateQueries({ 
          queryKey: ['/api/financial-summary', selectedProcedureRef] 
        });
      }
    } catch (error) {
      console.error('Error deleting payment:', error);
      toast({
        title: "Error",
        description: "Failed to delete payment. Please try again.",
        variant: "destructive",
      });
    }
  };
  
  // Handle deleting all procedure payments
  const handleDeleteAllPayments = async () => {
    try {
      setIsDeleting(true);
      
      // Use all-payments endpoint to avoid route conflict with :id parameter
      const response = await fetch(`/api/all-payments/reset`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to delete all payments');
      }
      
      const result = await response.json();
      
      toast({
        title: "All Payments Deleted",
        description: `Successfully deleted ${result.count} payment${result.count === 1 ? '' : 's'}.`,
      });
      
      // Invalidate all relevant queries
      queryClient.invalidateQueries({ queryKey: ['/api/payments'] });
      queryClient.invalidateQueries({ queryKey: ['/api/financial-summary'] });
      
      setIsDeleting(false);
      setIsDeleteAllConfirmOpen(false);
    } catch (error) {
      console.error('Error deleting all payments:', error);
      
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to delete all payments. Please try again.",
        variant: "destructive",
      });
      
      setIsDeleting(false);
      setIsDeleteAllConfirmOpen(false);
    }
  };

  // Incoming payments handlers
  const handleCreateIncomingSuccess = () => {
    // Hide the create form
    setShowCreateIncomingForm(false);
    
    // Refresh the payments list
    queryClient.invalidateQueries({ queryKey: ['/api/incoming-payments'] });
    
    toast({
      title: 'Success',
      description: 'New incoming payment created successfully',
    });
  };

  const handleDistribute = (payment: any) => {
    setSelectedPayment(payment);
    setShowDistributeModal(true);
  };

  const handleViewDistributions = (payment: any) => {
    setSelectedPayment(payment);
    setShowViewDistributionsModal(true);
  };

  const handleDeleteIncomingPayment = (payment: any) => {
    setPaymentToDelete(payment);
    setShowDeleteConfirm(true);
  };

  const confirmDeleteIncoming = () => {
    if (paymentToDelete) {
      deleteIncomingMutation.mutate(paymentToDelete.id);
    }
  };

  const handleResetAllDistributions = () => {
    if (window.confirm('Are you sure you want to reset ALL payment distributions? This will remove all distributions and reset all payments to pending status.')) {
      resetAllDistributionsMutation.mutate();
    }
  };

  const handleDistributionChange = () => {
    // Refresh the payments list after a distribution change
    queryClient.invalidateQueries({ queryKey: ['/api/incoming-payments'] });
  };

  // Distribution status badge component (for incoming payments view)
  const DistributionStatusBadge = ({ status }: { status: string }) => {
    let bgColor = '';
    let textColor = 'text-white';
    
    switch(status) {
      case 'pending_distribution':
        bgColor = 'bg-yellow-500';
        break;
      case 'partially_distributed':
        bgColor = 'bg-blue-500';
        break;
      case 'fully_distributed':
        bgColor = 'bg-green-500';
        break;
      default:
        bgColor = 'bg-gray-500';
    }
    
    return (
      <span className={`${bgColor} ${textColor} px-2 py-1 rounded-full text-xs font-medium capitalize`}>
        {status.replace(/_/g, ' ')}
      </span>
    );
  };

  return (
    <PageLayout title="Payments" navItems={items}>
      <div className="space-y-6 p-3 md:p-6">
        {/* Payment View Toggle */}
        <Tabs 
          defaultValue={activeTab} 
          className="w-full"
          onValueChange={(value) => setActiveTab(value)}
        >
          <div className="flex justify-between items-center mb-4">
            <div>
              <h2 className="text-xl font-bold">Payment Management</h2>
              <TabsList className="mt-2">
                <TabsTrigger value="procedure-payments" className="flex items-center">
                  <CreditCard className="h-4 w-4 mr-2" />
                  Procedure Payments
                </TabsTrigger>
                <TabsTrigger value="incoming-payments" className="flex items-center">
                  <DollarSign className="h-4 w-4 mr-2" />
                  Incoming Payments
                </TabsTrigger>
              </TabsList>
            </div>
            
            {/* Conditional Buttons based on active tab */}
            <div className="flex space-x-2">
              {activeTab === 'procedure-payments' && isAdmin && (
                <>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => setIsDeleteAllConfirmOpen(true)}
                    className="flex items-center"
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Reset All Payments
                  </Button>
                  {selectedProcedureRef && (
                    <Button 
                      onClick={() => setIsAddPaymentModalOpen(true)}
                      size="sm"
                      className="flex items-center"
                    >
                      <PlusCircle className="h-4 w-4 mr-2" />
                      Add Payment
                    </Button>
                  )}
                </>
              )}
              
              {activeTab === 'incoming-payments' && (
                <>
                  {isAdmin && (
                    <>
                      <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={handleResetAllDistributions}
                        className="flex items-center"
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Reset All Distributions
                      </Button>
                      <Button 
                        onClick={() => setShowCreateIncomingForm(true)}
                        size="sm"
                        className="flex items-center"
                      >
                        <PlusCircle className="h-4 w-4 mr-2" />
                        Add Incoming Payment
                      </Button>
                    </>
                  )}
                  <GeneratePaymentReportButton
                    variant="secondary"
                    size="sm"
                  />
                </>
              )}
            </div>
          </div>
          
          {/* Procedure Payments Tab Content */}
          <TabsContent value="procedure-payments" className="space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">Filter by Procedure</CardTitle>
              </CardHeader>
              <CardContent>
                <Select 
                  value={selectedProcedureRef || "all_procedures"}
                  onValueChange={(value) => setSelectedProcedureRef(value === "all_procedures" ? null : value)}
                >
                  <SelectTrigger className="w-full md:w-[300px]">
                    <SelectValue placeholder="Select a procedure" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all_procedures">All Procedures</SelectItem>
                    {proceduresData?.procedures?.map((procedure: any) => (
                      <SelectItem key={procedure.reference} value={procedure.reference}>
                        {procedure.reference} - {procedure.shipper}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </CardContent>
            </Card>
            
            {/* Payment Summary Cards */}
            <PaymentSummaryCards />
            
            {/* Always show the payments table */}
            <PaymentsTable 
              onDeletePayment={handleDeletePayment}
              procedureReference={selectedProcedureRef}
            />
          </TabsContent>
          
          {/* Incoming Payments Tab Content */}
          <TabsContent value="incoming-payments" className="space-y-4">
            {/* Summary Cards */}
            {incomingPaymentsData?.payments?.length > 0 && (
              <div className="grid gap-4 md:grid-cols-3">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Total Payments</CardTitle>
                    <DollarSign className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {formatCurrency(
                        incomingPaymentsData.payments.reduce((sum: number, payment: any) => 
                          sum + parseFloat(payment.totalAmount || 0), 0
                        )
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Total amount received
                    </p>
                  </CardContent>
                </Card>
                
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Total Distributed</CardTitle>
                    <CreditCard className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {formatCurrency(
                        incomingPaymentsData.payments.reduce((sum: number, payment: any) => 
                          sum + parseFloat(payment.amountDistributed || 0), 0
                        )
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Amount allocated to procedures
                    </p>
                  </CardContent>
                </Card>
                
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Remaining Payments</CardTitle>
                    <AlertTriangle className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {formatCurrency(
                        incomingPaymentsData.payments.reduce((sum: number, payment: any) => 
                          sum + parseFloat(payment.remainingBalance || 0), 0
                        )
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Amount pending distribution
                    </p>
                  </CardContent>
                </Card>
              </div>
            )}
            
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">Incoming Payments</CardTitle>
              </CardHeader>
              <CardContent>
                {isLoadingIncoming ? (
                  <div className="flex justify-center py-8">
                    <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full"></div>
                  </div>
                ) : isIncomingError ? (
                  <div className="bg-destructive/10 p-4 rounded-md">
                    <AlertTriangle className="h-6 w-6 text-destructive mx-auto mb-2" />
                    <p className="text-center text-destructive">Failed to load incoming payments</p>
                    <p className="text-center text-sm text-destructive/80 mt-1">
                      {incomingError instanceof Error ? incomingError.message : 'Unknown error'}
                    </p>
                  </div>
                ) : incomingPaymentsData?.payments?.length === 0 ? (
                  <div className="bg-muted p-6 text-center rounded-lg">
                    <Database className="h-12 w-12 mx-auto text-muted-foreground mb-2" />
                    <h3 className="text-lg font-medium">No Incoming Payments</h3>
                    <p className="text-muted-foreground mt-2">
                      You haven't recorded any incoming payments yet. Click "Add Incoming Payment" to get started.
                    </p>
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[100px]">Payment ID</TableHead>
                          <TableHead className="w-[120px]">Date Received</TableHead>
                          <TableHead className="w-[180px]">Payer Information</TableHead>
                          <TableHead className="w-[120px]">Total Amount</TableHead>
                          <TableHead className="w-[120px]">Amount Distributed</TableHead>
                          <TableHead className="w-[120px]">Remaining Balance</TableHead>
                          <TableHead className="w-[120px]">Status</TableHead>
                          <TableHead className="text-right w-[100px]">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {incomingPaymentsData?.payments?.map((payment: any) => (
                          <TableRow key={payment.id}>
                            <TableCell className="font-medium">{payment.paymentId}</TableCell>
                            <TableCell>{formatDate(payment.dateReceived)}</TableCell>
                            <TableCell>{payment.payerInfo}</TableCell>
                            <TableCell>{formatCurrency(payment.totalAmount)}</TableCell>
                            <TableCell>{formatCurrency(payment.amountDistributed)}</TableCell>
                            <TableCell>{formatCurrency(payment.remainingBalance)}</TableCell>
                            <TableCell>
                              <DistributionStatusBadge status={payment.distributionStatus} />
                            </TableCell>
                            <TableCell className="text-right">
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" className="h-8 w-8 p-0">
                                    <span className="sr-only">Open menu</span>
                                    <MoreHorizontal className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuLabel>Actions</DropdownMenuLabel>
                                  {payment.distributionStatus !== 'fully_distributed' && (
                                    <DropdownMenuItem 
                                      onClick={() => handleDistribute(payment)}
                                      className="cursor-pointer"
                                    >
                                      <DollarSign className="mr-2 h-4 w-4" />
                                      Distribute Payment
                                    </DropdownMenuItem>
                                  )}
                                  <DropdownMenuItem 
                                    onClick={() => handleViewDistributions(payment)}
                                    className="cursor-pointer"
                                  >
                                    <Eye className="mr-2 h-4 w-4" />
                                    View Distributions
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem 
                                    onClick={() => handleDeleteIncomingPayment(payment)}
                                    className="cursor-pointer text-destructive"
                                  >
                                    <Trash2 className="mr-2 h-4 w-4" />
                                    Delete
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
      
      {/* Modals & Dialogs */}
      {/* Add Payment Modal */}
      {selectedProcedureRef && (
        <AddPaymentModal
          isOpen={isAddPaymentModalOpen}
          onClose={() => setIsAddPaymentModalOpen(false)}
          initialProcedureReference={selectedProcedureRef}
          onPaymentCreated={() => {
            queryClient.invalidateQueries({
              queryKey: ["/api/financial-summary", selectedProcedureRef]
            });
          }}
        />
      )}
      
      {/* Confirm Delete All Payments Dialog */}
      <AlertDialog open={isDeleteAllConfirmOpen} onOpenChange={setIsDeleteAllConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset All Payments?</AlertDialogTitle>
            <AlertDialogDescription>
              This action will permanently delete ALL payments in the system. This is irreversible.
              Any financial calculations that depend on payment records will be reset.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteAllPayments}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isDeleting}
            >
              {isDeleting ? 'Resetting...' : 'Reset All Payments'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      
      {/* Incoming Payments Modals */}
      <CreateIncomingPaymentForm 
        isOpen={showCreateIncomingForm} 
        onClose={() => setShowCreateIncomingForm(false)}
        onSuccess={handleCreateIncomingSuccess}
      />
      
      <PaymentDistributionModal
        isOpen={showDistributeModal}
        onClose={() => setShowDistributeModal(false)}
        paymentId={selectedPayment?.id || null}
        paymentData={selectedPayment}
        onDistributionComplete={() => {
          setShowDistributeModal(false);
          handleDistributionChange();
        }}
      />
      
      <ViewDistributionModal
        isOpen={showViewDistributionsModal}
        onClose={() => setShowViewDistributionsModal(false)}
        paymentId={selectedPayment?.id || null}
        paymentData={selectedPayment}
        viewMode="payment"
        onDistributionChange={handleDistributionChange}
      />
      
      {/* Delete Incoming Payment Confirmation */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Incoming Payment</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the payment record and all its distributions.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteIncoming}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageLayout>
  );
}