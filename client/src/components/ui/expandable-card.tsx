"use client";

import React, { useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown } from "lucide-react";
import { useLocation } from "wouter";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useExpandable } from "@/components/hooks/use-expandable";
import { useCardsContext } from "@/components/hooks/use-cards-context";
import { cn } from "@/lib/utils";

interface Procedure {
  reference: string;
  shipment_status?: string;
  document_status?: string;
  payment_status?: string;
  created_at?: string;
}

type CardType = 'import' | 'document' | 'payment';

interface StatusBadgeProps {
  status?: string;
  type: CardType;
}

// Status Badge component for displaying user-friendly status labels
function StatusBadge({ status, type }: StatusBadgeProps) {
  const getStatusLabel = (rawStatus?: string, statusType?: CardType) => {
    if (!rawStatus) return 'Unknown';
    if (!statusType) return rawStatus;
    
    const statusMappings: Record<CardType, Record<string, string>> = {
      import: {
        'created': 'Created',
        'tax_calc_insurance_sent': 'Tax Calc & Insurance Sent',
        'arrived': 'Arrived',
        'tareks_application': 'Tareks Application',
        'tareks_approved': 'Tareks Approved',
        'import_started': 'Import Started',
        'import_finished': 'Import Finished',
        'delivered': 'Delivered',
        'closed': 'Closed'
      },
      document: {
        'import_doc_pending': 'Import Doc. Pending',
        'import_doc_received': 'Import Doc. Received',
        'pod_sent': 'POD Sent',
        'expense_documents_sent': 'Expense & Documents Sent',
        'closed': 'Closed'
      },
      payment: {
        'tarietter_sent': 'Tarietter Sent',
        'waiting_adv_payment': 'Waiting Adv. Payment',
        'advance_payment_received': 'Advance Payment Received',
        'final_balance_letter_sent': 'Final Balance Letter Sent',
        'balance_received': 'Balance Received',
        'closed': 'Closed'
      }
    };
    
    return statusMappings[statusType][rawStatus] || rawStatus;
  };
  
  const getBadgeColor = (rawStatus?: string, statusType?: CardType) => {
    if (!rawStatus) return 'bg-gray-100 text-gray-800 border-gray-200';
    
    // Use exact colors from the Procedure details page
    const colorMap: Record<string, string> = {
      // Shipment/Import Status colors (Active Procedures)
      'created': 'bg-yellow-100 text-yellow-800 border-yellow-200',
      'tax_calc_insurance_sent': 'bg-orange-100 text-orange-800 border-orange-200',
      'arrived': 'bg-green-100 text-green-800 border-green-200',
      'tareks_application': 'bg-yellow-100 text-yellow-800 border-yellow-200',
      'tareks_approved': 'bg-green-100 text-green-800 border-green-200',
      'import_started': 'bg-yellow-100 text-yellow-800 border-yellow-200',
      'import_finished': 'bg-green-100 text-green-800 border-green-200',
      'delivered': 'bg-green-100 text-green-800 border-green-200',
      
      // Payment Status colors (Awaiting Payment)
      'tarietter_sent': 'bg-orange-100 text-orange-800 border-orange-200',
      'waiting_adv_payment': 'bg-orange-100 text-orange-800 border-orange-200',
      'advance_payment_received': 'bg-green-100 text-green-800 border-green-200',
      'final_balance_letter_sent': 'bg-orange-100 text-orange-800 border-orange-200',
      'balance_received': 'bg-green-100 text-green-800 border-green-200',
      
      // Document Status colors (Pending Documents)
      'import_doc_pending': 'bg-red-100 text-red-800 border-red-200',
      'import_doc_received': 'bg-green-100 text-green-800 border-green-200',
      'pod_sent': 'bg-green-100 text-green-800 border-green-200',
      'expense_documents_sent': 'bg-green-100 text-green-800 border-green-200',
      
      // Common status - Closed (all types)
      'closed': 'bg-gray-100 text-gray-800 border-gray-200',
      
      // Default for unknown statuses
      'default': 'bg-gray-100 text-gray-600 border-gray-200'
    };
    
    return colorMap[rawStatus] || colorMap['default'];
  };
  
  const label = getStatusLabel(status, type);
  const colorClass = getBadgeColor(status, type);
  
  return (
    <span className={cn(
      "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border",
      colorClass
    )}>
      {label}
    </span>
  );
}

interface DashboardCardProps {
  title: "Active Procedures" | "Pending Documents" | "Awaiting Payment";
  procedures: Procedure[];
  count: number;
  isLoading?: boolean;
}

export function DashboardCard({
  title,
  procedures,
  count,
  isLoading = false,
}: DashboardCardProps) {
  const { animatedHeight } = useExpandable();
  const { isAllExpanded, toggleAllExpanded } = useCardsContext();
  const contentRef = useRef<HTMLDivElement>(null);
  const [, setLocation] = useLocation();

  // Use the shared expansion state
  useEffect(() => {
    if (contentRef.current) {
      animatedHeight.set(isAllExpanded ? contentRef.current.scrollHeight : 0);
    }
  }, [isAllExpanded, animatedHeight]);

  const handleCardClick = () => {
    // When any card is clicked, toggle the shared expansion state
    toggleAllExpanded();
  };

  // Function to get the card type for proper status badge rendering
  const getCardType = (cardTitle: string): CardType => {
    if (cardTitle === 'Active Procedures') return 'import';
    if (cardTitle === 'Pending Documents') return 'document';
    if (cardTitle === 'Awaiting Payment') return 'payment';
    return 'import'; // Default fallback
  };
  
  // Function to get status color based on status value (for status indicator dot)
  const getStatusColor = (status?: string) => {
    if (!status) {
      return 'bg-gray-500'; // No status
    }
    
    // Yellow for in-progress statuses
    if (status === 'import_doc_pending' || 
        status === 'import_started' || 
        status === 'waiting_adv_payment' ||
        status === 'final_balance_letter_sent') {
      return 'bg-yellow-500';
    }
    
    // Green for completed/closed statuses
    if (status === 'closed') {
      return 'bg-green-500';
    }
    
    // Blue for received/in-process statuses
    if (status === 'import_doc_received') {
      return 'bg-blue-500';
    }
    
    // Default color for any other status
    return 'bg-purple-500';
  };
  
  // Function to get the relevant status based on card type
  const getRelevantStatus = (procedure: Procedure) => {
    if (title === 'Active Procedures') return procedure.shipment_status;
    if (title === 'Pending Documents') return procedure.document_status;
    if (title === 'Awaiting Payment') return procedure.payment_status;
    return undefined;
  };

  // Function to handle procedure click navigation
  const handleProcedureClick = (reference: string) => {
    setLocation(`/procedure-details?reference=${encodeURIComponent(reference)}`);
  };

  return (
    <Card
      className="bg-white rounded-lg shadow-sm border p-6 w-full transition-all duration-300 hover:shadow-lg"
      style={{ height: 'auto', maxHeight: 'none', overflow: 'visible' }}
    >
      <CardHeader className="p-0 mb-6">
        <div className="flex flex-col items-center w-full">
          <h3 className="text-2xl font-bold text-gray-800 text-center mb-3">{title}</h3>
          <Button 
            onClick={handleCardClick}
            variant="ghost" 
            size="sm"
            className="flex items-center text-sm text-gray-600 hover:text-gray-800 transition-colors"
          >
            {isAllExpanded ? 'Collapse' : 'Expand'}
            <ChevronDown className={`ml-1 h-4 w-4 transform transition-transform ${isAllExpanded ? 'rotate-180' : ''}`} />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        <div className="flex justify-center mb-4">
          <span className="text-base font-medium text-gray-700 bg-gray-50 px-3 py-1 rounded-full">
            {count} {count === 1 ? 'procedure' : 'procedures'}
          </span>
        </div>

        <motion.div
          style={{ 
            height: isAllExpanded ? 'auto' : '0px',
            overflow: isAllExpanded ? 'visible' : 'hidden'
          }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
        >
          <div ref={contentRef}>
            <AnimatePresence>
              {isAllExpanded && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="mt-4 pt-4 border-t border-gray-200"
                  style={{ overflow: 'visible' }}
                >
                  <h4 className="text-sm font-medium text-gray-700 mb-4">References</h4>
                  <div 
                    className="space-y-3 pb-2"
                    style={{ height: 'auto', maxHeight: 'none', overflow: 'visible' }}
                  >
                    {isLoading ? (
                      <div className="animate-pulse space-y-3">
                        {[1, 2, 3].map((i) => (
                          <div key={i} className="flex items-center justify-between p-3 border border-gray-100 rounded-lg">
                            <div className="h-5 bg-gray-200 rounded w-40"></div>
                            <div className="w-4 h-4 rounded-full bg-gray-200"></div>
                          </div>
                        ))}
                      </div>
                    ) : procedures.length > 0 ? (
                      procedures.map((procedure, index) => (
                        <div
                          key={index}
                          className="flex items-center justify-between p-3 rounded-lg hover:bg-gray-50 border border-gray-100 transition-colors"
                          style={{ minHeight: '60px' }} // Ensure minimum height for content
                        >
                          <div className="flex flex-col flex-1 min-w-0 mr-4">
                            <button
                              onClick={() => handleProcedureClick(procedure.reference)}
                              className="text-sm font-medium text-gray-800 hover:text-gray-900 hover:underline leading-relaxed break-words whitespace-normal text-left transition-colors cursor-pointer"
                            >
                              {procedure.reference}
                            </button>
                          </div>
                          {/* Status badge positioned on the right side */}
                          <div className="flex-shrink-0">
                            <StatusBadge 
                              status={getRelevantStatus(procedure)} 
                              type={getCardType(title)}
                            />
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="text-sm text-gray-500 p-4 text-center">No procedures to display</div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      </CardContent>
    </Card>
  );
}