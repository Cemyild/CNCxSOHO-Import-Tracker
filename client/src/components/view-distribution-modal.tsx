import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { formatCurrency, formatDate } from '../lib/formatters';

interface ViewDistributionModalProps {
  isOpen: boolean;
  onClose: () => void;
  paymentId: number | null;
  paymentData: {
    id: number;
    paymentId: string;
    payerInfo: string;
    totalAmount: string;
    amountDistributed: string;
    remainingBalance: string;
  } | null;
  procedureReference?: string;
  viewMode: 'payment' | 'procedure';
  onDistributionChange: () => void;
}

interface Distribution {
  id: number;
  incomingPaymentId: number;
  procedureReference: string;
  distributedAmount: string;
  paymentType: string;
  distributionDate: string;
  paymentId?: string;
  payerInfo?: string;
  totalPaymentAmount?: string;
}

// Portal-based confirmation modal that renders directly in document.body
const ConfirmationDialog = ({ 
  distribution, 
  onCancel, 
  onConfirm, 
  isDeleting 
}: { 
  distribution: Distribution; 
  onCancel: () => void; 
  onConfirm: (id: number) => void; 
  isDeleting: boolean;
}) => {
  // Safety check - only create the portal if document exists (e.g., during SSR or tests)
  if (typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div 
      className="fixed inset-0 flex items-center justify-center bg-black/50" 
      style={{ 
        zIndex: 99999,
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div 
        className="bg-white dark:bg-gray-800 p-6 rounded-md w-full max-w-sm shadow-xl" 
        style={{ 
          position: 'relative', 
          zIndex: 99999,
          margin: '1.5rem'
        }}
      >
        <h3 className="text-lg font-bold mb-2">Confirm Deletion</h3>
        <div className="mb-4 text-gray-600 dark:text-gray-300">
          This will permanently remove this distribution from the system. This action cannot be undone.
        </div>
        <div className="flex justify-end space-x-3">
          <Button 
            variant="outline" 
            onClick={(e) => {
              e.stopPropagation();
              onCancel();
            }}
            className="w-24"
            disabled={isDeleting}
          >
            Cancel
          </Button>
          <Button 
            variant="destructive" 
            onClick={(e) => {
              e.stopPropagation();
              console.log(`Confirming deletion of distribution ID: ${distribution.id}`);
              onConfirm(distribution.id);
            }}
            className="w-24"
            disabled={isDeleting}
          >
            {isDeleting ? (
              <span className="flex items-center">
                <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Deleting
              </span>
            ) : (
              "Delete"
            )}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export function ViewDistributionModal({
  isOpen,
  onClose,
  paymentId,
  paymentData,
  procedureReference,
  viewMode,
  onDistributionChange,
}: ViewDistributionModalProps) {
  const [distributions, setDistributions] = useState<Distribution[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Distribution | null>(null);
  const { toast } = useToast();

  // Fetch distributions when modal opens
  useEffect(() => {
    if (isOpen) {
      fetchDistributions();
    }
  }, [isOpen, paymentId, procedureReference]);

  // Function to fetch distributions
  const fetchDistributions = async () => {
    if ((!paymentId && !procedureReference) || (viewMode === 'payment' && !paymentId) || (viewMode === 'procedure' && !procedureReference)) {
      return;
    }

    try {
      setIsLoading(true);
      let endpoint = '';
      
      if (viewMode === 'payment' && paymentId) {
        endpoint = `/api/payment-distributions/payment/${paymentId}`;
      } else if (viewMode === 'procedure' && procedureReference) {
        endpoint = `/api/payment-distributions/procedure/${encodeURIComponent(procedureReference)}`;
      }

      console.log(`Fetching distributions from endpoint: ${endpoint}`);
      
      // Add timeout handling to prevent UI freeze
      const timeoutPromise = new Promise<Response>((_, reject) => 
        setTimeout(() => reject(new Error('Request timeout after 10 seconds')), 10000)
      );
      
      // Race the actual fetch request against a timeout
      try {
        const fetchPromise = fetch(endpoint, {
          method: 'GET',
          credentials: 'include'
        });
        
        const response = await Promise.race([fetchPromise, timeoutPromise]) as Response;
        console.log('Fetch distributions response status:', response.status);
        
        if (!response.ok) {
          throw new Error(`Server responded with status: ${response.status}`);
        }
        
        const jsonData = await response.json();
        console.log('Fetch distributions response data received');
        
        if (jsonData.distributions) {
          console.log(`Found ${jsonData.distributions.length} distributions`);
          setDistributions(jsonData.distributions);
        } else {
          console.log('No distributions found in response');
          setDistributions([]);
        }
      } catch (error) {
        const fetchError = error as Error;
        console.error('Fetch error during GET operation:', fetchError);
        if (fetchError.message && fetchError.message.includes('timeout')) {
          toast({
            title: 'Request Timeout',
            description: 'The server took too long to respond when loading distributions. Please try again.',
            variant: 'destructive',
          });
        } else {
          toast({
            title: 'Error',
            description: `Network error: ${fetchError.message || 'Unknown error'}`,
            variant: 'destructive',
          });
        }
        // Return empty distributions on error to prevent UI from waiting indefinitely
        setDistributions([]);
      }
    } catch (error) {
      console.error('Exception during fetching distributions:', error);
      toast({
        title: 'Error',
        description: 'Failed to load payment distributions.',
        variant: 'destructive',
      });
      // Return empty distributions on error to prevent UI from waiting indefinitely
      setDistributions([]);
    } finally {
      setIsLoading(false);
    }
  };

  // For payment view mode, we'll show the payment details at the top
  const renderPaymentDetails = () => {
    if (viewMode === 'payment' && paymentData) {
      return (
        <div className="mb-6 bg-muted/30 p-4 rounded-md space-y-2">
          <div><strong>Payment ID:</strong> {paymentData.paymentId}</div>
          <div><strong>Payer:</strong> {paymentData.payerInfo}</div>
          <div><strong>Total Amount:</strong> {formatCurrency(parseFloat(paymentData.totalAmount))}</div>
          <div><strong>Amount Distributed:</strong> {formatCurrency(parseFloat(paymentData.amountDistributed))}</div>
          <div><strong>Remaining Balance:</strong> {formatCurrency(parseFloat(paymentData.remainingBalance))}</div>
        </div>
      );
    }
    return null;
  };

  // Function to safely remove a distribution
  const removeDistribution = async (distributionId: number) => {
    try {
      console.log('Starting removal of distribution:', distributionId);
      // Set loading state for this specific distribution
      setDeletingId(distributionId);
      
      // Make the API call with explicit timeout using AbortController
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch(`/api/payment-distributions/${distributionId}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        },
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      console.log('Remove API response status:', response.status);
      
      if (!response.ok) {
        throw new Error(`Failed to remove distribution: ${response.status}`);
      }
      
      const jsonData = await response.json();
      console.log('Delete response data:', jsonData);
      
      // If we get here, removal was successful
      console.log('Distribution removed successfully');
      
      toast({
        title: 'Success',
        description: 'Distribution has been deleted successfully.',
      });
      
      // Close the confirm dialog
      setConfirmDelete(null);
      
      // Refresh the data separately to prevent UI freezing
      setTimeout(() => {
        console.log('Refreshing distribution data after deletion');
        fetchDistributions();
        // Notify parent component about the change
        onDistributionChange();
      }, 100);
      
    } catch (error) {
      console.error('Error in distribution removal:', error);
      
      // Show toast with error message (non-blocking)
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to remove distribution. Please try again.',
        variant: 'destructive',
      });
    } finally {
      // Clear the deleting state
      setDeletingId(null);
    }
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="sm:max-w-[700px] view-distribution-modal">
          <DialogHeader>
            <DialogTitle>
              {viewMode === 'payment' 
                ? 'Payment Distributions' 
                : `Distributions for Procedure ${procedureReference}`}
            </DialogTitle>
            <DialogDescription>
              {viewMode === 'payment'
                ? 'View all distributions for this payment'
                : 'View all payments distributed to this procedure'}
            </DialogDescription>
          </DialogHeader>

          {renderPaymentDetails()}

          {isLoading ? (
            <div className="flex items-center justify-center p-6">
              <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
            </div>
          ) : distributions.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground">
              No distributions found.
            </div>
          ) : (
            <div className="max-h-[400px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {viewMode === 'procedure' && (
                      <>
                        <TableHead>Payment ID</TableHead>
                        <TableHead>Total Payment</TableHead>
                        <TableHead>Payer</TableHead>
                      </>
                    )}
                    {viewMode === 'payment' && (
                      <TableHead>Procedure Ref</TableHead>
                    )}
                    <TableHead>Amount</TableHead>
                    <TableHead>Payment Type</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {distributions.map((distribution) => (
                    <TableRow key={distribution.id}>
                      {viewMode === 'procedure' && (
                        <>
                          <TableCell className="font-medium">{distribution.paymentId}</TableCell>
                          <TableCell>{formatCurrency(parseFloat(distribution.totalPaymentAmount || '0'))}</TableCell>
                          <TableCell>{distribution.payerInfo}</TableCell>
                        </>
                      )}
                      {viewMode === 'payment' && (
                        <TableCell className="font-medium">{distribution.procedureReference}</TableCell>
                      )}
                      <TableCell>{formatCurrency(parseFloat(distribution.distributedAmount))}</TableCell>
                      <TableCell>
                        <span className="capitalize">{distribution.paymentType}</span>
                      </TableCell>
                      <TableCell>{formatDate(new Date(distribution.distributionDate))}</TableCell>
                      <TableCell className="text-right">
                        <Button 
                          variant="destructive" 
                          size="sm"
                          onClick={() => {
                            console.log(`Remove button clicked for distribution ID: ${distribution.id}`);
                            setConfirmDelete(distribution);
                          }}
                          className="font-semibold"
                          disabled={deletingId === distribution.id}
                        >
                          {deletingId === distribution.id ? (
                            <div className="flex items-center justify-center">
                              <span className="h-4 w-4 mr-2 animate-spin rounded-full border-2 border-white border-t-transparent"></span>
                              Removing...
                            </div>
                          ) : (
                            "Remove"
                          )}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <DialogFooter className="flex justify-between">
            <div>
              <Button 
                variant="outline" 
                onClick={() => fetchDistributions()} 
                disabled={isLoading}
                className="mr-2"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-refresh-cw mr-1"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/></svg>
                Refresh
              </Button>
            </div>
            <Button onClick={onClose} className="ml-auto">Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Portal-based confirmation dialog */}
      {confirmDelete && (
        <ConfirmationDialog
          distribution={confirmDelete}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={removeDistribution}
          isDeleting={deletingId === confirmDelete.id}
        />
      )}
    </>
  );
}