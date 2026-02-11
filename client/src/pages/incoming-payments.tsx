import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { formatCurrency, formatDate } from '@/lib/formatters';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { PlusCircle, Eye, Database, Trash2, MoreHorizontal } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { PaymentDistributionModal } from '@/components/payment-distribution-modal';
import { ViewDistributionModal } from '@/components/view-distribution-modal';
import { 
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { CreateIncomingPaymentForm } from '@/components/create-incoming-payment-form';

// Distribution status badge component
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

export default function IncomingPaymentsPage() {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState<any>(null);
  const [showDistributeModal, setShowDistributeModal] = useState(false);
  const [showViewDistributionsModal, setShowViewDistributionsModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [paymentToDelete, setPaymentToDelete] = useState<any>(null);
  
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
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
  
  // Fetch all incoming payments
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['/api/incoming-payments'],
    queryFn: async () => {
      const response = await apiRequest('GET', '/api/incoming-payments');
      return response;
    },
  });

  // Delete payment mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest('DELETE', `/api/incoming-payments/${id}`);
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
      return apiRequest('DELETE', '/api/all-payment-distributions/reset');
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

  const handleCreateSuccess = () => {
    // Hide the create form
    setShowCreateForm(false);
    
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

  const handleDeletePayment = (payment: any) => {
    setPaymentToDelete(payment);
    setShowDeleteConfirm(true);
  };

  const confirmDelete = () => {
    if (paymentToDelete) {
      deleteMutation.mutate(paymentToDelete.id);
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

  if (isError) {
    return (
      <div className="container mx-auto p-4">
        <h1 className="text-2xl font-bold mb-4">Incoming Payments</h1>
        <div className="bg-red-50 border border-red-200 text-red-800 p-4 rounded-md">
          <p>Error loading payments: {error instanceof Error ? error.message : 'Unknown error'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Incoming Payments</h1>
        <div className="flex gap-2">
          {isAdmin && (
            <Button onClick={() => setShowCreateForm(true)}>
              <PlusCircle className="h-4 w-4 mr-2" />
              New Payment
            </Button>
          )}
          {/* Admin actions dropdown */}
          {isAdmin && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">
                  <Database className="h-4 w-4 mr-2" />
                  Admin Actions
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>System Operations</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-red-600 focus:text-red-600"
                  onClick={handleResetAllDistributions}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Reset All Distributions
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* Loading state */}
      {isLoading ? (
        <div className="flex items-center justify-center p-8">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
        </div>
      ) : (
        // Payments table
        <div className="bg-white rounded-lg shadow overflow-x-auto">
          {data?.payments?.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <p>No incoming payments found. Create your first payment to get started.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Payment ID</TableHead>
                  <TableHead>Date Received</TableHead>
                  <TableHead>Payer</TableHead>
                  <TableHead>Total Amount</TableHead>
                  <TableHead>Distributed</TableHead>
                  <TableHead>Remaining</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.payments?.map((payment: any) => (
                  <TableRow key={payment.id}>
                    <TableCell className="font-medium">{payment.paymentId}</TableCell>
                    <TableCell>{formatDate(new Date(payment.dateReceived))}</TableCell>
                    <TableCell>{payment.payerInfo}</TableCell>
                    <TableCell>{formatCurrency(parseFloat(payment.totalAmount), payment.currency)}</TableCell>
                    <TableCell>{formatCurrency(parseFloat(payment.amountDistributed), payment.currency)}</TableCell>
                    <TableCell>{formatCurrency(parseFloat(payment.remainingBalance), payment.currency)}</TableCell>
                    <TableCell>
                      <DistributionStatusBadge status={payment.distributionStatus} />
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel>Actions</DropdownMenuLabel>
                          <DropdownMenuSeparator />
                          
                          {payment.distributionStatus !== 'fully_distributed' && (
                            <DropdownMenuItem onClick={() => handleDistribute(payment)}>
                              <PlusCircle className="h-4 w-4 mr-2" />
                              Distribute Payment
                            </DropdownMenuItem>
                          )}
                          
                          <DropdownMenuItem onClick={() => handleViewDistributions(payment)}>
                            <Eye className="h-4 w-4 mr-2" />
                            View Distributions
                          </DropdownMenuItem>
                          
                          {payment.distributionStatus === 'pending_distribution' && (
                            <DropdownMenuItem 
                              onClick={() => handleDeletePayment(payment)}
                              className="text-red-600 focus:text-red-600"
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Delete Payment
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      )}

      {/* Create Payment Form Modal */}
      {showCreateForm && (
        <CreateIncomingPaymentForm
          isOpen={showCreateForm}
          onClose={() => setShowCreateForm(false)}
          onSuccess={handleCreateSuccess}
        />
      )}

      {/* Distribution Modal */}
      {showDistributeModal && selectedPayment && (
        <PaymentDistributionModal
          isOpen={showDistributeModal}
          onClose={() => setShowDistributeModal(false)}
          paymentId={selectedPayment.id}
          paymentData={selectedPayment}
          onDistributionComplete={handleDistributionChange}
        />
      )}

      {/* View Distributions Modal */}
      {showViewDistributionsModal && selectedPayment && (
        <ViewDistributionModal
          isOpen={showViewDistributionsModal}
          onClose={() => setShowViewDistributionsModal(false)}
          paymentId={selectedPayment.id}
          paymentData={selectedPayment}
          onDistributionChange={handleDistributionChange}
          viewMode="payment"
        />
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the payment with ID: {paymentToDelete?.paymentId}.
              {paymentToDelete?.distributionStatus !== 'pending_distribution' && (
                <p className="text-red-600 mt-2">
                  Warning: This payment has distributions. You cannot delete it until all distributions are removed.
                </p>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={(e) => {
                e.preventDefault();
                confirmDelete();
              }}
              className="bg-red-600 hover:bg-red-700"
              disabled={paymentToDelete?.distributionStatus !== 'pending_distribution'}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}