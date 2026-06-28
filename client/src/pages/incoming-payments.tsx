import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
  let bgColor = '';
  let textColor = 'text-white';
  let label = status.replace(/_/g, ' ');

  switch(status) {
    case 'pending_distribution':
      bgColor = 'bg-yellow-500';
      label = t('incomingPayments.status.pendingDistribution');
      break;
    case 'partially_distributed':
      bgColor = 'bg-blue-500';
      label = t('incomingPayments.status.partiallyDistributed');
      break;
    case 'fully_distributed':
      bgColor = 'bg-green-500';
      label = t('incomingPayments.status.fullyDistributed');
      break;
    default:
      bgColor = 'bg-gray-500';
  }

  return (
    <span className={`${bgColor} ${textColor} px-2 py-1 rounded-full text-xs font-medium capitalize`}>
      {label}
    </span>
  );
};

export default function IncomingPaymentsPage() {
  const { t } = useTranslation();
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
        title: t('common.success'),
        description: t('incomingPayments.toast.deleteSuccess'),
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
        title: t('common.error'),
        description: t('incomingPayments.toast.deleteError', { error: error instanceof Error ? error.message : t('incomingPayments.unknownError') }),
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
        title: t('common.success'),
        description: t('incomingPayments.toast.resetSuccess', { count: data.count }),
      });

      // Invalidate the payments query to refresh the list
      queryClient.invalidateQueries({ queryKey: ['/api/incoming-payments'] });
    },
    onError: (error) => {
      console.error('Error resetting payment distributions:', error);
      toast({
        title: t('common.error'),
        description: t('incomingPayments.toast.resetError', { error: error instanceof Error ? error.message : t('incomingPayments.unknownError') }),
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
      title: t('common.success'),
      description: t('incomingPayments.toast.createSuccess'),
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
    if (window.confirm(t('incomingPayments.resetConfirm'))) {
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
        <h1 className="text-2xl font-bold mb-4">{t('incomingPayments.title')}</h1>
        <div className="bg-red-50 border border-red-200 text-red-800 p-4 rounded-md">
          <p>{t('incomingPayments.loadError', { error: error instanceof Error ? error.message : t('incomingPayments.unknownError') })}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">{t('incomingPayments.title')}</h1>
        <div className="flex gap-2">
          {isAdmin && (
            <Button onClick={() => setShowCreateForm(true)}>
              <PlusCircle className="h-4 w-4 mr-2" />
              {t('incomingPayments.newPayment')}
            </Button>
          )}
          {/* Admin actions dropdown */}
          {isAdmin && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">
                  <Database className="h-4 w-4 mr-2" />
                  {t('incomingPayments.adminActions')}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>{t('incomingPayments.systemOperations')}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-red-600 focus:text-red-600"
                  onClick={handleResetAllDistributions}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  {t('incomingPayments.resetAllDistributions')}
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
              <p>{t('incomingPayments.empty')}</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('incomingPayments.columns.paymentId')}</TableHead>
                  <TableHead>{t('incomingPayments.columns.dateReceived')}</TableHead>
                  <TableHead>{t('incomingPayments.columns.payer')}</TableHead>
                  <TableHead>{t('incomingPayments.columns.totalAmount')}</TableHead>
                  <TableHead>{t('incomingPayments.columns.distributed')}</TableHead>
                  <TableHead>{t('incomingPayments.columns.remaining')}</TableHead>
                  <TableHead>{t('incomingPayments.columns.status')}</TableHead>
                  <TableHead className="text-right">{t('incomingPayments.columns.actions')}</TableHead>
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
                          <DropdownMenuLabel>{t('incomingPayments.columns.actions')}</DropdownMenuLabel>
                          <DropdownMenuSeparator />

                          {payment.distributionStatus !== 'fully_distributed' && (
                            <DropdownMenuItem onClick={() => handleDistribute(payment)}>
                              <PlusCircle className="h-4 w-4 mr-2" />
                              {t('incomingPayments.distributePayment')}
                            </DropdownMenuItem>
                          )}

                          <DropdownMenuItem onClick={() => handleViewDistributions(payment)}>
                            <Eye className="h-4 w-4 mr-2" />
                            {t('incomingPayments.viewDistributions')}
                          </DropdownMenuItem>

                          {payment.distributionStatus === 'pending_distribution' && (
                            <DropdownMenuItem
                              onClick={() => handleDeletePayment(payment)}
                              className="text-red-600 focus:text-red-600"
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              {t('incomingPayments.deletePayment')}
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
            <AlertDialogTitle>{t('incomingPayments.deleteDialog.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('incomingPayments.deleteDialog.description', { id: paymentToDelete?.paymentId })}
              {paymentToDelete?.distributionStatus !== 'pending_distribution' && (
                <p className="text-red-600 mt-2">
                  {t('incomingPayments.deleteDialog.warning')}
                </p>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('incomingPayments.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                confirmDelete();
              }}
              className="bg-red-600 hover:bg-red-700"
              disabled={paymentToDelete?.distributionStatus !== 'pending_distribution'}
            >
              {t('incomingPayments.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}