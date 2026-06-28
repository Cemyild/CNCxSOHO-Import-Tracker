import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import {
  Calendar,
  Home,
  Inbox,
  Search,
  Settings,
  BarChart2,
  ArrowLeft,
  FileText,
  Download,
  ExternalLink,
  UploadCloud,
  Eye,
  Share2,
  Receipt,
  Loader2,
  Sparkles
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PageLayout } from "@/components/layout/PageLayout";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { 
  Card, 
  CardContent, 
  CardDescription, 
  CardFooter, 
  CardHeader, 
  CardTitle 
} from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { 
  Table, 
  TableBody, 
  TableCaption, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { apiRequest } from "@/lib/queryClient";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { formatCurrency, formatNumber, formatDate, formatCategoryName, formatTaxAmount } from "@/utils/formatters";
import { GeneratePdfButton } from "@/components/ui/generate-pdf-button";
import { ViewDistributionModal } from "@/components/view-distribution-modal";
import { AddToMasterExcelButton } from "@/components/procedure/AddToMasterExcelButton";
import { useQuery } from "@tanstack/react-query";


import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";

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
    icon: Search,
  },
  {
    title: "Reports",
    url: "/reports",
    icon: BarChart2,
  },
  {
    title: "Ask CNC?",
    url: "/ask",
    icon: Sparkles,
  },
  {
    title: "Settings",
    url: "/settings",
    icon: Settings,
  },
];

// Interfaces
interface Procedure {
  id: number;
  reference: string;
  shipper: string;
  invoice_no: string;
  invoice_date: string | null;
  amount: string;
  currency: string;
  package: string;
  kg: string;
  piece: number;
  arrival_date: string | null;
  awb_number: string;
  carrier: string;
  customs: string;
  import_dec_number: string;
  import_dec_date: string | null;
  payment_status: string;
  document_status: string;
  shipment_status: string;
  assignedTo: number;
  createdBy: number;
  createdAt: string;
  updatedAt: string;
  usdtl_rate?: number;
}

interface TaxData {
  id: number;
  procedureReference: string;
  customsTax: string;
  additionalCustomsTax: string;
  kkdf: string;
  vat: string;
  stampTax: string;
  createdBy: number;
  createdAt: string;
  updatedAt: string;
}

interface ImportExpense {
  id: number;
  procedureReference: string;
  category: string;
  amount: string;
  currency: string;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  documentNumber: string | null;
  policyNumber: string | null;
  issuer: string | null;
  notes: string | null;
  createdBy: number;
  createdAt: string;
  updatedAt: string;
}

interface ServiceInvoice {
  id: number;
  procedureReference: string;
  amount: string;
  currency: string;
  invoiceNumber: string;
  date: string;
  notes: string | null;
  createdBy: number;
  createdAt: string;
  updatedAt: string;
}

interface Payment {
  id: number;
  procedureReference: string;
  paymentType: string;
  amount: number;
  paymentDate: string;
  description?: string;
  createdBy: number;
  createdAt: string;
  updatedAt: string;
}

interface PaymentDistribution {
  id: number;
  incomingPaymentId: number;
  procedureReference: string;
  distributedAmount: string;
  paymentType: 'advance' | 'balance';
  distributionDate: string;
  createdBy: number;
  createdAt: string;
}

interface Document {
  id: number;
  expenseType: string;
  expenseId: number;
  originalFilename: string;
  storedFilename: string | null;
  filePath: string | null;
  fileSize: number;
  fileType: string;
  uploadedBy: number;
  procedureReference: string;
  createdAt: string;
  updatedAt: string;
  objectKey?: string; // S3 object storage key
  importDocumentType?: string; // Added for import documents
}

interface StatusDetail {
  id: number;
  procedureReference: string;
  category: string;
  status: string;
  isActive: boolean;
  updatedBy?: number;
  updatedAt?: string;
}

// File icon helper function
function getFileIcon(fileType: string) {
  if (fileType.includes('pdf')) {
    return <FileText className="h-6 w-6 text-red-500" />;
  } else if (fileType.includes('image')) {
    return <FileText className="h-6 w-6 text-blue-500" />;
  } else if (fileType.includes('word') || fileType.includes('document')) {
    return <FileText className="h-6 w-6 text-blue-700" />;
  } else {
    return <FileText className="h-6 w-6 text-gray-500" />;
  }
}

export default function ProcedureDetailsPage() {
  const { t } = useTranslation();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  // Get reference from URL parameters
  const urlParams = new URLSearchParams(window.location.search);
  const reference = urlParams.get('reference');

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

  // State variables
  const [procedure, setProcedure] = useState<Procedure | null>(null);
  const [tax, setTax] = useState<TaxData | null>(null);
  const [importExpenses, setImportExpenses] = useState<ImportExpense[]>([]);
  const [serviceInvoices, setServiceInvoices] = useState<ServiceInvoice[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [paymentDistributions, setPaymentDistributions] = useState<PaymentDistribution[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [statusDetails, setStatusDetails] = useState<StatusDetail[]>([]);
  const [financialSummary, setFinancialSummary] = useState<{
    totalExpenses: number;
    advancePayments: number;
    balancePayments: number;
    totalPayments: number;
    remainingBalance: number;
  }>({
    totalExpenses: 0,
    advancePayments: 0,
    balancePayments: 0,
    totalPayments: 0,
    remainingBalance: 0
  });

  // Loading states
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Financial calculation states
  const [totalValue, setTotalValue] = useState<number>(0);
  const [advancePayment, setAdvancePayment] = useState<number>(0);
  const [balancePayment, setBalancePayment] = useState<number>(0);
  const [totalPayments, setTotalPayments] = useState<number>(0);
  const [remainingBalance, setRemainingBalance] = useState<number>(0);

  // Document preview functionality has been removed as per client requirements

  // Products from tax calculation
  const [taxProducts, setTaxProducts] = useState<{ style: string; cost: string; unit_count: number; tr_hs_code: string | null }[]>([]);

  // View distributions modal state
  const [isViewDistributionsOpen, setIsViewDistributionsOpen] = useState(false);
  
  // Final Balance PDF generation state
  const [isGeneratingFinalBalance, setIsGeneratingFinalBalance] = useState(false);

  // Fetch procedure data
  useEffect(() => {
    if (!reference) {
      setError(t("procedurePages.details.noReferenceProvided"));
      setIsLoading(false);
      return;
    }

    fetchProcedureData(reference);
  }, [reference]);

  // Fetch tax calculation products for this procedure
  useEffect(() => {
    if (!reference) return;
    const encodedReference = encodeURIComponent(reference);
    fetch(`/api/procedures/${encodedReference}/products`)
      .then(res => res.ok ? res.json() : { products: [] })
      .then(data => setTaxProducts(data.products || []))
      .catch(() => setTaxProducts([]));
  }, [reference]);

  // Calculate financial summary
  useEffect(() => {
    const fetchFinancialSummary = async () => {
      if (!reference) return;
      
      try {
        // Encode reference to handle slashes properly
        const encodedReference = encodeURIComponent(reference);
        const response = await fetch(`/api/financial-summary/${encodedReference}`);
        if (!response.ok) {
          console.error("Failed to fetch financial summary:", response.statusText);
          return;
        }
        
        const summaryData = await response.json();
        if (summaryData && summaryData.summary) {
          setTotalValue(summaryData.summary.totalExpenses);
          setAdvancePayment(summaryData.summary.advancePayments);
          setBalancePayment(summaryData.summary.balancePayments);
          setTotalPayments(summaryData.summary.totalPayments);
          setRemainingBalance(summaryData.summary.remainingBalance);
        }
      } catch (error) {
        console.error("Error fetching financial summary:", error);
      }
    };
    
    fetchFinancialSummary();
  }, [reference, tax, importExpenses, serviceInvoices, payments]);

  // Fetch all procedure-related data
  const fetchProcedureData = async (referenceNumber: string) => {
    console.log("[fetchProcedureData] Starting data fetch for reference:", referenceNumber);
    setIsLoading(true);
    setError(null);

    try {
      // Add a timestamp for cache busting
      const timestamp = Date.now();

      // Fetch the procedure details
      console.log("[fetchProcedureData] Fetching main procedure data");
      const procedureResponse = await fetch(`/api/procedures?reference=${referenceNumber}&_=${timestamp}`);
      const procedureData = await procedureResponse.json();

      if (procedureData.procedures && procedureData.procedures.length > 0) {
        console.log("[fetchProcedureData] Retrieved procedure:", procedureData.procedures[0]);
        setProcedure(procedureData.procedures[0]);
      } else {
        setError(t("procedurePages.details.noProcedureFound", { reference: referenceNumber }));
        setIsLoading(false);
        return;
      }

      // Encode reference number to handle slashes properly
      const encodedReference = encodeURIComponent(referenceNumber);
      
      // Fetch tax data
      const taxResponse = await apiRequest("GET", `/api/taxes/procedure/${encodedReference}?_=${timestamp}`);
      const taxData = await taxResponse.json();
      if (taxData.tax) {
        setTax(taxData.tax);
      }

      // Fetch import expenses
      const expensesResponse = await apiRequest("GET", `/api/import-expenses/procedure/${encodedReference}?_=${timestamp}`);
      const expensesData = await expensesResponse.json();
      setImportExpenses(expensesData.expenses || []);

      // Fetch service invoices
      const invoicesResponse = await apiRequest("GET", `/api/service-invoices/procedure/${encodedReference}?_=${timestamp}`);
      const invoicesData = await invoicesResponse.json();
      setServiceInvoices(invoicesData.invoices || []);
      
      // Fetch payments
      const paymentsResponse = await apiRequest("GET", `/api/payments/procedure/${encodedReference}?_=${timestamp}`);
      const paymentsData = await paymentsResponse.json();
      setPayments(paymentsData.payments || []);
      
      // Fetch payment distributions
      const distributionsResponse = await apiRequest("GET", `/api/payment-distributions/procedure/${encodedReference}?_=${timestamp}`);
      const distributionsData = await distributionsResponse.json();
      setPaymentDistributions(distributionsData.distributions || []);

      // Fetch all documents
      const documentsResponse = await apiRequest("GET", `/api/expense-documents/procedure/${encodedReference}?_=${timestamp}`);
      const documentsData = await documentsResponse.json();
      setDocuments(documentsData.documents || []);

      // Status details are now directly read from the procedure object's status columns
      // (shipment_status, payment_status, document_status)
      // No need to fetch from the procedure_status_details table
      console.log("[fetchProcedureData] Using status directly from procedure:", {
        shipment_status: procedureData.procedures[0].shipment_status,
        payment_status: procedureData.procedures[0].payment_status,
        document_status: procedureData.procedures[0].document_status
      });

      console.log("[fetchProcedureData] All data fetched successfully");
      setIsLoading(false);
    } catch (error) {
      console.error("[fetchProcedureData] Error:", error);
      setError(t("procedurePages.details.loadFailed"));
      setIsLoading(false);
    }
  };
  
  // Handle Excel export
  const handleExcelExport = async () => {
    if (!reference) {
      toast({
        title: t("common.error"),
        description: t("procedurePages.details.referenceRequired"),
        variant: "destructive",
      });
      return;
    }

    try {
      const url = `/api/procedures/${encodeURIComponent(reference)}/export/excel`;

      // Create a temporary link to download the file
      const link = document.createElement('a');
      link.href = url;
      link.download = `procedure_${reference}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      toast({
        title: t("procedurePages.details.excelExportTitle"),
        description: t("procedurePages.details.excelExportDownloading"),
      });
    } catch (error) {
      console.error('Error exporting to Excel:', error);
      toast({
        title: t("procedurePages.details.excelExportFailedTitle"),
        description: t("procedurePages.details.excelExportFailedDescription"),
        variant: "destructive",
      });
    }
  };

  // Handle Final Balance PDF generation
  const handleFinalBalancePdf = async () => {
    if (!reference) {
      toast({
        title: t("common.error"),
        description: t("procedurePages.details.referenceRequired"),
        variant: "destructive",
      });
      return;
    }

    setIsGeneratingFinalBalance(true);

    try {
      const url = `/api/procedures/${encodeURIComponent(reference)}/export/final-balance-pdf`;

      // Open in new tab for viewing
      window.open(url, '_blank');

      toast({
        title: t("procedurePages.details.finalBalanceReport"),
        description: t("procedurePages.details.finalBalanceOpening"),
      });
    } catch (error) {
      console.error('Error generating Final Balance PDF:', error);
      toast({
        title: t("procedurePages.details.pdfGenerationFailedTitle"),
        description: t("procedurePages.details.pdfGenerationFailedDescription"),
        variant: "destructive",
      });
    } finally {
      setIsGeneratingFinalBalance(false);
    }
  };

  // Group expenses by category
  const groupedExpenses = importExpenses.reduce((groups: {[key: string]: ImportExpense[]}, expense) => {
    const category = expense.category || 'other';
    if (!groups[category]) {
      groups[category] = [];
    }
    groups[category].push(expense);
    return groups;
  }, {});

  // Group documents by expense
  const groupedDocuments = documents.reduce((groups: {[key: string]: Document[]}, document) => {
    const key = `${document.expenseType}_${document.expenseId}`;
    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(document);
    return groups;
  }, {});

  // Get documents for a specific expense
  const getDocumentsForExpense = (expenseType: string, expenseId: number) => {
    return documents.filter(doc => doc.expenseType === expenseType && doc.expenseId === expenseId);
  };
  
  // Get import documents
  const getImportDocuments = () => {
    return documents.filter(doc => doc.expenseType === 'import_document');
  };
  
  // Group import documents by type
  const groupedImportDocuments = getImportDocuments().reduce((groups: {[key: string]: Document[]}, document) => {
    const type = document.importDocumentType || 'other';
    if (!groups[type]) {
      groups[type] = [];
    }
    groups[type].push(document);
    return groups;
  }, {});

  // Group status details by category
  const statusDetailsByCategory = statusDetails.reduce((groups: {[key: string]: StatusDetail[]}, detail) => {
    const category = detail.category || 'other';
    if (!groups[category]) {
      groups[category] = [];
    }
    groups[category].push(detail);
    return groups;
  }, {});

  // Format status detail badge with active/inactive state
  const formatStatusDetailBadge = (statusDetail: StatusDetail) => {
    let badgeClass = statusDetail.isActive 
      ? "bg-green-100 text-green-800 border border-green-300" 
      : "bg-gray-100 text-gray-500 border border-gray-200";

    let formattedStatus = statusDetail.status.split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');

    return (
      <Badge className={badgeClass} key={statusDetail.id}>
        {formattedStatus}
      </Badge>
    );
  };

  // Handle status detail toggle (legacy method - keeping for reference)
  const handleStatusDetailToggle = async (statusDetail: StatusDetail) => {
    try {
      // Only administrators can change status details
      if (!isAdmin) {
        toast({
          title: t("procedurePages.details.permissionDeniedTitle"),
          description: t("procedurePages.details.permissionDeniedStatusDetails"),
          variant: "destructive",
        });
        return;
      }

      const updatedStatusDetail = {
        ...statusDetail,
        isActive: !statusDetail.isActive,
      };

      const response = await apiRequest(
        'PATCH',
        `/api/procedure-status-details/${statusDetail.id}`, 
        updatedStatusDetail
      );

      if (response) {
        // Update local state
        setStatusDetails(statusDetails.map(detail => 
          detail.id === statusDetail.id ? {...detail, isActive: !detail.isActive} : detail
        ));

        toast({
          title: t("procedurePages.details.statusUpdatedTitle"),
          description: updatedStatusDetail.isActive
            ? t("procedurePages.details.statusDetailActivated")
            : t("procedurePages.details.statusDetailDeactivated"),
        });
      } else {
        throw new Error("Failed to update status");
      }
    } catch (error) {
      console.error("Error updating status detail:", error);
      toast({
        title: t("procedurePages.details.updateFailedTitle"),
        description: t("procedurePages.details.statusDetailUpdateFailed"),
        variant: "destructive",
      });
    }
  };

  // Function to update procedure status (new workflow-based approach)
  const updateProcedureStatus = async (statusType: string, newStatus: string) => {
    console.log("[updateProcedureStatus] Called with:", { statusType, newStatus });

    if (!isAdmin) {
      toast({
        title: t("procedurePages.details.permissionDeniedTitle"),
        description: t("procedurePages.details.permissionDeniedUpdateStatus"),
        variant: "destructive",
      });
      return;
    }

    if (!procedure?.reference) {
      toast({
        title: t("common.error"),
        description: t("procedurePages.details.referenceNotFound"),
        variant: "destructive",
      });
      return;
    }

    toast({
      title: t("procedurePages.details.updatingStatusTitle"),
      description: t("procedurePages.details.updatingStatusDescription"),
    });

    // Prepare update data based on status type
    const updateData: any = {
      reference: procedure.reference
    };
    updateData[statusType] = newStatus;

    console.log("[updateProcedureStatus] Sending data:", updateData);

    try {
      // Send update request to API
      const response = await apiRequest(
        'POST',
        '/api/procedures/update-status',
        updateData
      );

      console.log("[updateProcedureStatus] Response status:", response.status);
      const responseData = await response.clone().json();
      console.log("[updateProcedureStatus] Response data:", responseData);

      toast({
        title: t("procedurePages.details.statusUpdatedTitle"),
        description: t("procedurePages.details.statusUpdatedSuccess"),
        variant: "default",
      });

      // Add a small delay before refreshing to ensure the database update is complete
      console.log("[updateProcedureStatus] Before data refresh. Current procedure:", procedure);
      setTimeout(() => {
        console.log("[updateProcedureStatus] Refreshing procedure data");
        fetchProcedureData(procedure.reference);
      }, 500);
    } catch (error) {
      console.error("[updateProcedureStatus] Error:", error);
      toast({
        title: t("procedurePages.details.updateFailedTitle"),
        description: t("procedurePages.details.statusUpdateProblem"),
        variant: "destructive",
      });
    }
  };

  // Translate a known status enum value to its localized label.
  // Falls back to a title-cased version for any unmapped status.
  const statusLabel = (status: string) => {
    const key = `procedurePages.statusLabels.${status}`;
    const translated = t(key);
    if (translated !== key) return translated;
    return status.split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  };

  // Format status badge
  const formatStatusBadge = (status: string | null | undefined) => {
    if (!status) {
      return (
        <Badge className="bg-gray-500/20 text-gray-700 dark:text-gray-400">
          {t("procedurePages.details.statusUnknown")}
        </Badge>
      );
    }

    let badgeClass = "";
    let formattedStatus = statusLabel(status);

    // Shipment status colors
    if (["created", "import_started", "tareks_application", "tax_calc_insurance_sent", "transit_started", "transit_in_process"].includes(status)) {
      badgeClass = "bg-yellow-500 text-white";
    } 
    else if (["arrived", "tareks_approved", "import_finished", "delivered"].includes(status)) {
      badgeClass = "bg-green-600 text-white";
    }
    // Payment status colors
    else if (["taxletter_sent", "final_balance_letter_sent"].includes(status)) {
      badgeClass = "bg-yellow-500 text-white";
    }
    else if (["waiting_adv_payment"].includes(status)) {
      badgeClass = "bg-orange-500 text-white";
    }
    else if (["advance_payment_received", "balance_received"].includes(status)) {
      badgeClass = "bg-green-600 text-white";
    }
    // Document status colors
    else if (["import_doc_pending"].includes(status)) {
      badgeClass = "bg-red-600 text-white";
    }
    else if (["import_doc_received", "pod_sent", "expense_documents_sent"].includes(status)) {
      badgeClass = "bg-green-600 text-white";
    }
    // Closed status for all categories
    else if (status === "closed") {
      badgeClass = "bg-muted-foreground/60 text-primary-foreground";
    }
    // Default fallback
    else {
      badgeClass = "bg-gray-500/20 text-gray-700 dark:text-gray-400";
    }

    return (
      <Badge className={badgeClass}>
        {formattedStatus}
      </Badge>
    );
  };

  // Format date with optional fallback, handling timezone properly
  const formatDateWithFallback = (dateString: string | null, fallback: string = "N/A") => {
    if (!dateString) return fallback;
    
    // Parse the UTC date from the ISO string
    const date = new Date(dateString);
    
    // Check if date is valid
    if (isNaN(date.getTime())) return fallback;
    
    // Format directly without using formatDate to exactly match database date
    // Extract the date components using UTC methods to avoid timezone issues
    const day = date.getUTCDate().toString().padStart(2, '0');
    const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
    const year = date.getUTCFullYear();
    
    // Return in DD.MM.YYYY format as used throughout the application
    return `${day}.${month}.${year}`;
  };

  // Calculate expense subtotal for a category
  const calculateCategorySubtotal = (expenses: ImportExpense[]) => {
    return expenses.reduce((total, expense) => total + parseFloat(expense.amount || '0'), 0);
  };

  // Handle download document
  const handleDownloadDocument = (document: Document) => {
    if (document.objectKey) {
      // Use the S3 object storage path
      window.open(`/api/expense-documents/file/${encodeURIComponent(document.objectKey)}`, '_blank');
    } else if (document.storedFilename) {
      // Fallback for legacy documents (should not be needed after migration)
      window.open(`/api/expense-documents/${document.id}/download`, '_blank');
    } else {
      // Show error toast if neither method is available
      toast({
        title: t("procedurePages.details.downloadFailedTitle"),
        description: t("procedurePages.details.documentNotFound"),
        variant: "destructive",
      });
    }
  };
  
  // Document preview functionality has been removed as per client requirements
  
  // Document preview functionality has been removed as per client requirements
  
  // Get descriptive display text for document type
  const getDocumentTypeDisplay = (document: Document): string => {
    if (document.fileType.includes('pdf')) {
      return 'PDF Document';
    } else if (document.fileType.includes('image')) {
      return 'Image';
    } else if (document.fileType.includes('text')) {
      return 'Text Document';
    } else if (document.fileType.includes('excel') || document.fileType.includes('spreadsheetml')) {
      return 'Excel Spreadsheet';
    } else if (document.fileType.includes('powerpoint') || document.fileType.includes('presentationml')) {
      return 'PowerPoint Presentation';
    } else if (document.fileType.includes('word') || document.fileType.includes('wordprocessingml')) {
      return 'Word Document';
    } else {
      return 'Document';
    }
  };
  
  // Document preview functionality has been removed as per client requirements

  if (isLoading) {
    return (
      <PageLayout title={t("procedurePages.details.title")} navItems={items}>
        <div className="container mx-auto p-6">
          <div className="mb-6 flex items-center">
            <Button variant="outline" size="sm" onClick={() => setLocation('/procedures')}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              {t("procedurePages.backToProcedures")}
            </Button>
          </div>

          <Card className="mb-6">
            <CardHeader>
              <Skeleton className="h-8 w-64 mb-2" />
              <Skeleton className="h-4 w-48" />
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[...Array(9)].map((_, index) => (
                  <div key={index} className="space-y-2">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-6 w-40" />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {[...Array(5)].map((_, index) => (
            <Card key={index} className="mb-6">
              <CardHeader>
                <Skeleton className="h-8 w-48 mb-2" />
                <Skeleton className="h-4 w-64" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-48 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      </PageLayout>
    );
  }

  if (error) {
    return (
      <PageLayout title={t("procedurePages.details.title")} navItems={items}>
        <div className="container mx-auto p-6">
          <div className="mb-6 flex items-center">
            <Button variant="outline" size="sm" onClick={() => setLocation('/procedures')}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              {t("procedurePages.backToProcedures")}
            </Button>
          </div>

          <Alert variant="destructive" className="mb-6">
            <AlertTitle>{t("common.error")}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </div>
      </PageLayout>
    );
  }

  if (!procedure) {
    return (
      <PageLayout title={t("procedurePages.details.title")} navItems={items}>
        <div className="container mx-auto p-6">
          <div className="mb-6 flex items-center">
            <Button variant="outline" size="sm" onClick={() => setLocation('/procedures')}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              {t("procedurePages.backToProcedures")}
            </Button>
          </div>

          <Alert variant="destructive" className="mb-6">
            <AlertTitle>{t("procedurePages.details.notFoundTitle")}</AlertTitle>
            <AlertDescription>{t("procedurePages.details.notFoundDescription")}</AlertDescription>
          </Alert>
        </div>
      </PageLayout>
    );
  }

  // Function to get company logo based on procedure reference
  const getCompanyLogo = (reference: string) => {
    if (reference.startsWith('CNCALO')) {
      return '/assets/logos/alo-logo.png';
    } else if (reference.startsWith('CNCAMIRI')) {
      return '/assets/logos/amiri-logo.png';
    } else {
      return '/assets/logos/soho-logo.png';
    }
  };

  return (
    <PageLayout title={t("procedurePages.details.title")} navItems={items}>
      <div className="container mx-auto p-6">
        <div className="mb-6 flex items-center justify-between">
          <Button variant="outline" size="sm" onClick={() => setLocation('/procedures')}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t("procedurePages.backToProcedures")}
          </Button>

          <div className="flex items-center gap-2">
            <GeneratePdfButton procedureReference={procedure.reference} />
            
            <Button
              onClick={handleExcelExport}
              variant="outline"
              data-testid="button-export-excel"
            >
              <Download className="mr-2 h-4 w-4" />
              {t("procedurePages.details.exportToExcel")}
            </Button>

            <AddToMasterExcelButton procedureReference={procedure.reference} />

            <Button
              onClick={handleFinalBalancePdf}
              disabled={isGeneratingFinalBalance}
              variant="default"
              data-testid="button-final-balance-report"
            >
              {isGeneratingFinalBalance ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t("procedurePages.details.generating")}
                </>
              ) : (
                <>
                  <Receipt className="mr-2 h-4 w-4" />
                  {t("procedurePages.details.finalBalanceReport")}
                </>
              )}
            </Button>

            {isAdmin && (
              <Link href={`/expense-entry?reference=${procedure.reference}`}>
                <Button>
                  {t("procedurePages.details.addOrEditExpenses")}
                </Button>
              </Link>
            )}
          </div>
        </div>

        {/* Procedure Details Section */}
        <Card className="mb-6">
          <CardHeader>
            <div className="space-y-4">
              {/* Header with Logo and Title */}
              <div className="p-4 md:p-6 rounded-lg flex flex-col sm:flex-row items-center space-y-3 sm:space-y-0 sm:space-x-6">
                {/* Logo Section */}
                <div className="flex-shrink-0">
                  <img
                    src={getCompanyLogo(procedure.reference)}
                    alt={t("procedurePages.details.companyLogoAlt")}
                    className="h-20 w-20 md:h-24 md:w-24 object-contain"
                  />
                </div>
                
                {/* Text Section */}
                <div className="flex-grow text-center sm:text-left">
                  <h1 className="text-2xl font-bold">{procedure.reference}</h1>
                  <p className="text-muted-foreground mt-1">{t("procedurePages.details.overviewSubtitle")}</p>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium whitespace-nowrap">{t("procedurePages.details.shipmentStatusLabel")}</span>
                  {formatStatusBadge(procedure.shipment_status)}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium whitespace-nowrap">{t("procedurePages.details.paymentStatusLabel")}</span>
                  {formatStatusBadge(procedure.payment_status)}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium whitespace-nowrap">{t("procedurePages.details.documentStatusLabel")}</span>
                  {formatStatusBadge(procedure.document_status)}
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6"> {/* Increased to 4 columns */}
              <div>
                <h4 className="text-lg font-medium mb-2 underline">{t("procedurePages.details.shipperInformation")}</h4>
                <div className="space-y-2">
                  <div>
                    <span className="text-sm text-muted-foreground">{t("procedurePages.details.shipperField")}</span>
                    <p className="font-medium">{procedure.shipper}</p>
                  </div>
                  <div>
                    <span className="text-sm text-muted-foreground">{t("procedurePages.details.invoiceNumberField")}</span>
                    <p className="font-medium">{procedure.invoice_no}</p>
                  </div>
                  <div>
                    <span className="text-sm text-muted-foreground">{t("procedurePages.details.invoiceDateField")}</span>
                    <p className="font-medium">{formatDateWithFallback(procedure.invoice_date)}</p>
                  </div>
                  <div>
                    <span className="text-sm text-muted-foreground">{t("procedurePages.details.invoiceAmountField")}</span>
                    <p className="font-medium">{formatCurrency(procedure.amount, procedure.currency)}</p>
                  </div>
                </div>
              </div>

              <div>
                <h4 className="text-lg font-medium mb-2 underline">{t("procedurePages.details.shipmentDetails")}</h4>
                <div className="space-y-2">
                  <div>
                    <span className="text-sm text-muted-foreground">{t("procedurePages.details.packageTypeField")}</span>
                    <p className="font-medium">{procedure.package}</p>
                  </div>
                  <div>
                    <span className="text-sm text-muted-foreground">{t("procedurePages.details.weightField")}</span>
                    <p className="font-medium">{procedure.kg} kg</p>
                  </div>
                  <div>
                    <span className="text-sm text-muted-foreground">{t("procedurePages.details.piecesField")}</span>
                    <p className="font-medium">{procedure.piece}</p>
                  </div>
                  <div>
                    <span className="text-sm text-muted-foreground">{t("procedurePages.details.arrivalDateField")}</span>
                    <p className="font-medium">{formatDateWithFallback(procedure.arrival_date)}</p>
                  </div>
                </div>
              </div>

              <div>
                <h4 className="text-lg font-medium mb-2 underline">{t("procedurePages.details.transportationDetails")}</h4>
                <div className="space-y-2">
                  <div>
                    <span className="text-sm text-muted-foreground">{t("procedurePages.details.awbNumberField")}</span>
                    <p className="font-medium">{procedure.awb_number}</p>
                  </div>
                  <div>
                    <span className="text-sm text-muted-foreground">{t("procedurePages.details.carrierField")}</span>
                    <p className="font-medium">{procedure.carrier}</p>
                  </div>
                  <div>
                    <span className="text-sm text-muted-foreground">{t("procedurePages.details.customsOfficeField")}</span>
                    <p className="font-medium">{procedure.customs}</p>
                  </div>
                </div>
              </div>

              <div>
                <h4 className="text-lg font-medium mb-2 underline">{t("procedurePages.details.importDeclaration")}</h4>
                <div className="space-y-2">
                  <div>
                    <span className="text-sm text-muted-foreground">{t("procedurePages.details.declarationNumberField")}</span>
                    <p className="font-medium">{procedure.import_dec_number || t("procedurePages.details.notAvailable")}</p>
                  </div>
                  <div>
                    <span className="text-sm text-muted-foreground">{t("procedurePages.details.declarationDateField")}</span>
                    <p className="font-medium">{formatDateWithFallback(procedure.import_dec_date)}</p>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Status Details Section */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>{t("procedurePages.details.statusDetailsTitle")}</CardTitle>
            <CardDescription>
              {t("procedurePages.details.statusDetailsDescription")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-6"> {/* Aligned horizontally */}
              {/* Shipment Status */}
              <div className="border rounded-lg p-4">
                <h4 className="text-lg font-medium mb-4 text-blue-700 dark:text-blue-300 flex items-center">
                  {t("procedurePages.details.shipmentStatusHeading")}
                </h4>
                <div className="space-y-3">
                  {/* Shipment Status Steps - in sequential order */}
                  {[
                    { status: "created" },
                    { status: "tax_calc_insurance_sent" },
                    { status: "arrived" },
                    { status: "transit_started" },
                    { status: "transit_in_process" },
                    { status: "tareks_application" },
                    { status: "tareks_approved" },
                    { status: "import_started" },
                    { status: "import_finished" },
                    { status: "delivered" },
                    { status: "closed" }
                  ].map((step, index, steps) => {
                    // Find the active status of the procedure
                    const activeStatus = procedure?.shipment_status || "";

                    // Calculate if this step should be active based on the current status
                    const currentStepIndex = steps.findIndex(s => s.status === activeStatus);
                    const isCompleted = currentStepIndex >= index;

                    // Determine badge class based on status
                    let badgeClass = "";
                    if (isCompleted) {
                      switch(step.status) {
                        case "created":
                        case "import_started":
                        case "tareks_application":
                        case "tax_calc_insurance_sent":
                        case "transit_started":
                        case "transit_in_process":
                          badgeClass = "bg-yellow-500 text-white";
                          break;
                        case "arrived":
                        case "tareks_approved":
                        case "import_finished":
                        case "delivered":
                          badgeClass = "bg-green-600 text-white";
                          break;
                        case "closed":
                          badgeClass = "bg-muted-foreground/60 text-primary-foreground";
                          break;
                        default:
                          badgeClass = "bg-gray-500 text-white";
                      }
                    } else {
                      badgeClass = "bg-gray-500/20 text-gray-700 dark:text-gray-400 hover:bg-gray-500/30";
                    }

                    return (
                      <div 
                        key={step.status} 
                        className="flex items-center gap-2 cursor-pointer"
                        onClick={() => {
                          // Clicking any status selects it and all previous statuses
                          updateProcedureStatus("shipment_status", step.status);
                        }}
                      >
                        <div className="flex items-center">
                          <div className={`w-5 h-5 rounded-full flex items-center justify-center border ${
                            isCompleted 
                              ? 'bg-green-100 border-green-500' 
                              : 'bg-white border-gray-300'
                          }`}>
                            {isCompleted && (
                              <div className="w-3 h-3 rounded-full bg-green-500" />
                            )}
                          </div>
                          <div className="ml-2 flex-1">
                            <Badge className={cn(badgeClass, "break-normal w-full text-center")}>
                              {statusLabel(step.status)}
                            </Badge>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Payment Status */}
              <div className="border rounded-lg p-4">
                <h4 className="text-lg font-medium mb-4 text-green-700 dark:text-green-300 flex items-center">
                  {t("procedurePages.details.paymentStatusHeading")}
                </h4>
                <div className="space-y-3">
                  {/* Payment Status Steps - in sequential order */}
                  {[
                    { status: "taxletter_sent" },
                    { status: "waiting_adv_payment" },
                    { status: "advance_payment_received" },
                    { status: "final_balance_letter_sent" },
                    { status: "balance_received" },
                    { status: "closed" }
                  ].map((step, index, steps) => {
                    // Find the active status of the procedure
                    const activeStatus = procedure?.payment_status || "";

                    // Calculate if this step should be active based on the current status
                    const currentStepIndex = steps.findIndex(s => s.status === activeStatus);
                    const isCompleted = currentStepIndex >= index;

                    // Determine badge class based on status
                    let badgeClass = "";
                    if (isCompleted) {
                      switch(step.status) {
                        case "taxletter_sent":
                        case "final_balance_letter_sent":
                          badgeClass = "bg-yellow-500 text-white";
                          break;
                        case "waiting_adv_payment":
                          badgeClass = "bg-orange-500 text-white";
                          break;
                        case "advance_payment_received":
                        case "balance_received":
                          badgeClass = "bg-green-600 text-white";
                          break;
                        case "closed":
                          badgeClass = "bg-muted-foreground/60 text-primary-foreground";
                          break;
                        default:
                          badgeClass = "bg-gray-500 text-white";
                      }
                    } else {
                      badgeClass = "bg-gray-500/20 text-gray-700 dark:text-gray-400 hover:bg-gray-500/30";
                    }

                    return (
                      <div 
                        key={step.status} 
                        className="flex items-center gap-2 cursor-pointer"
                        onClick={() => {
                          // Clicking any status selects it and all previous statuses
                          updateProcedureStatus("payment_status", step.status);
                        }}
                      >
                        <div className="flex items-center">
                          <div className={`w-5 h-5 rounded-full flex items-center justify-center border ${
                            isCompleted 
                              ? 'bg-green-100 border-green-500' 
                              : 'bg-white border-gray-300'
                          }`}>
                            {isCompleted && (
                              <div className="w-3 h-3 rounded-full bg-green-500" />
                            )}
                          </div>
                          <div className="ml-2 flex-1">
                            <Badge className={cn(badgeClass, "break-normal w-full text-center")}>
                              {statusLabel(step.status)}
                            </Badge>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Document Status */}
              <div className="border rounded-lg p-4">
                <h4 className="text-lg font-medium mb-4 text-amber-700 dark:text-amber-300 flex items-center">
                  {t("procedurePages.details.documentStatusHeading")}
                </h4>
                <div className="space-y-3">
                  {/* Document Status Steps - in sequential order */}
                  {[
                    { status: "import_doc_pending" },
                    { status: "import_doc_received" },
                    { status: "pod_sent" },
                    { status: "expense_documents_sent" },
                    { status: "closed" }
                  ].map((step, index, steps) => {
                    // Find the active status of the procedure
                    const activeStatus = procedure?.document_status || "";

                    // Calculate if this step should be active based on the current status
                    const currentStepIndex = steps.findIndex(s => s.status === activeStatus);
                    const isCompleted = currentStepIndex >= index;

                    // Determine badge class based on status
                    let badgeClass = "";
                    if (isCompleted) {
                      switch(step.status) {
                        case "import_doc_pending":
                          badgeClass = "bg-red-600 text-white";
                          break;
                        case "import_doc_received":
                        case "pod_sent":
                        case "expense_documents_sent":
                          badgeClass = "bg-green-600 text-white";
                          break;
                        case "closed":
                          badgeClass = "bg-muted-foreground/60 text-primary-foreground";
                          break;
                        default:
                          badgeClass = "bg-gray-500 text-white";
                      }
                    } else {
                      badgeClass = "bg-gray-500/20 text-gray-700 dark:text-gray-400 hover:bg-gray-500/30";
                    }

                    return (
                      <div 
                        key={step.status} 
                        className="flex items-center gap-2 cursor-pointer"
                        onClick={() => {
                          // Clicking any status selects it and all previous statuses
                          updateProcedureStatus("document_status", step.status);
                        }}
                      >
                        <div className="flex items-center">
                          <div className={`w-5 h-5 rounded-full flex items-center justify-center border ${
                            isCompleted 
                              ? 'bg-green-100 border-green-500' 
                              : 'bg-white border-gray-300'
                          }`}>
                            {isCompleted && (
                              <div className="w-3 h-3 rounded-full bg-green-500" />
                            )}
                          </div>
                          <div className="ml-2 flex-1">
                            <Badge className={cn(badgeClass, "break-normal w-full text-center")}>
                              {statusLabel(step.status)}
                            </Badge>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Import Documents Section */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>{t("procedurePages.details.importDocumentsTitle")}</CardTitle>
            <CardDescription>
              {t("procedurePages.details.importDocumentsDescription")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {getImportDocuments().length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-1/4">{t("procedurePages.details.documentType")}</TableHead>
                    <TableHead className="w-2/5">{t("procedurePages.details.documentName")}</TableHead>
                    <TableHead className="w-1/4">{t("procedurePages.details.detailsColumn")}</TableHead>
                    <TableHead className="w-24 text-center">{t("procedurePages.details.actionsColumn")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {getImportDocuments().map((doc) => {
                    // Format document type for display
                    const formattedType = doc.importDocumentType
                      ? doc.importDocumentType
                          .split('_')
                          .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                          .join(' ')
                      : t("procedurePages.details.otherType");
                      
                    return (
                      <TableRow key={doc.id}>
                        <TableCell className="font-medium">
                          {formattedType}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center">
                            <div className="flex-shrink-0 mr-3">
                              {getFileIcon(doc.fileType)}
                            </div>
                            <span className="truncate max-w-xs">{doc.originalFilename}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {Math.round(doc.fileSize / 1024)} KB • {new Date(doc.createdAt).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="flex justify-center">
                            <Button 
                              variant="outline" 
                              size="sm" 
                              className="bg-green-50 text-green-600 hover:bg-green-100 hover:text-green-700 border-green-200 font-medium"
                              onClick={() => handleDownloadDocument(doc)}
                            >
                              <Download className="h-4 w-4 mr-2" />
                              {t("procedurePages.details.download")}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            ) : (
              <Alert>
                <AlertTitle>{t("procedurePages.details.noImportDocumentsTitle")}</AlertTitle>
                <AlertDescription>
                  {t("procedurePages.details.noImportDocumentsDescription")}
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        {/* Tax Details Section */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>{t("procedurePages.details.taxDetailsTitle")}</CardTitle>
            <CardDescription>
              {t("procedurePages.details.taxDetailsDescription")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {tax ? (
              <div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("procedurePages.details.taxType")}</TableHead>
                      <TableHead className="text-right">{t("procedurePages.details.amount")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell>{t("procedurePages.details.customsTax")}</TableCell>
                      <TableCell className="text-right">{formatTaxAmount(tax.customsTax)}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>{t("procedurePages.details.additionalCustomsTax")}</TableCell>
                      <TableCell className="text-right">{formatTaxAmount(tax.additionalCustomsTax)}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>{t("procedurePages.details.kkdf")}</TableCell>
                      <TableCell className="text-right">{formatTaxAmount(tax.kkdf)}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>{t("procedurePages.details.vat")}</TableCell>
                      <TableCell className="text-right">{formatTaxAmount(tax.vat)}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>{t("procedurePages.details.stampTax")}</TableCell>
                      <TableCell className="text-right">{formatTaxAmount(tax.stampTax)}</TableCell>
                    </TableRow>
                  </TableBody>
                  <TableCaption>
                    <div className="mt-6 flex justify-end text-lg font-semibold text-[#0C0A09]">
                      <span className="mr-4">{t("procedurePages.details.taxTotal")}</span>
                      <span>
                        {formatTaxAmount(
                          (parseFloat(tax.customsTax) || 0) +
                          (parseFloat(tax.additionalCustomsTax) || 0) +
                          (parseFloat(tax.kkdf) || 0) +
                          (parseFloat(tax.vat) || 0) +
                          (parseFloat(tax.stampTax) || 0)
                        )}
                      </span>
                    </div>
                  </TableCaption>
                </Table>

                {/* Tax Documents */}
                {tax.id && getDocumentsForExpense('tax', tax.id).length > 0 && (
                  <div className="mt-6">
                    <h4 className="text-sm font-medium mb-3">{t("procedurePages.details.taxDocuments")}</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {getDocumentsForExpense('tax', tax.id).map((doc) => (
                        <div 
                          key={doc.id} 
                          className="flex items-center justify-between p-3 border rounded-md"
                        >
                          <div className="flex items-center flex-1 min-w-0">
                            <div className="flex-shrink-0 mr-3">
                              {getFileIcon(doc.fileType)}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{doc.originalFilename}</p>
                              <p className="text-xs text-gray-500">
                                {Math.round(doc.fileSize / 1024)} KB • {new Date(doc.createdAt).toLocaleDateString()}
                              </p>
                            </div>
                          </div>
                          <Button 
                            variant="outline" 
                            size="sm" 
                            className="bg-green-50 text-green-600 hover:bg-green-100 hover:text-green-700 border-green-200 font-medium"
                            onClick={() => handleDownloadDocument(doc)}
                          >
                            <Download className="h-4 w-4 mr-2" />
                            {t("procedurePages.details.download")}
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <Alert>
                <AlertTitle>{t("procedurePages.details.noTaxDataTitle")}</AlertTitle>
                <AlertDescription>
                  {t("procedurePages.details.noTaxDataDescription")}
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        {/* Import Expenses Section */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>{t("procedurePages.details.importExpensesTitle")}</CardTitle>
            <CardDescription>
              {t("procedurePages.details.importExpensesDescription")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {importExpenses.length > 0 ? (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("procedurePages.details.category")}</TableHead>
                      <TableHead>{t("procedurePages.details.amount")}</TableHead>
                      <TableHead>{t("procedurePages.details.date")}</TableHead>
                      <TableHead>{t("procedurePages.details.detailsColumn")}</TableHead>
                      <TableHead className="text-center">{t("procedurePages.details.download")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {importExpenses.map((expense) => (
                      <TableRow key={expense.id}>
                        <TableCell className="font-medium">
                          {formatCategoryName(expense.category)}
                        </TableCell>
                        <TableCell>
                          {formatCurrency(expense.amount, expense.currency)}
                        </TableCell>
                        <TableCell>
                          {expense.invoiceDate ? formatDate(expense.invoiceDate) : "—"}
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            {expense.policyNumber && (
                              <p className="text-sm">
                                {t("procedurePages.details.policyLabel")} {expense.policyNumber}
                                {expense.issuer && (
                                  <><br />{t("procedurePages.details.issuerLabel")} {expense.issuer}</>
                                )}
                              </p>
                            )}
                            {expense.invoiceNumber && (
                              <p className="text-sm">
                                {t("procedurePages.details.invoiceLabel")} {expense.invoiceNumber}
                                {expense.issuer && !expense.policyNumber && (
                                  <><br />{t("procedurePages.details.issuerLabel")} {expense.issuer}</>
                                )}
                              </p>
                            )}
                            {expense.documentNumber && (
                              <p className="text-sm">
                                {t("procedurePages.details.docLabel")} {expense.documentNumber}
                              </p>
                            )}
                            {!expense.policyNumber && !expense.invoiceNumber && expense.issuer && (
                              <p className="text-sm">
                                {t("procedurePages.details.issuerLabel")} {expense.issuer}
                              </p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          {getDocumentsForExpense('import_expense', expense.id).length > 0 ? (
                            <div className="flex justify-center gap-2">
                              {getDocumentsForExpense('import_expense', expense.id).map((doc) => (
                                <div key={doc.id}>
                                  <TooltipProvider>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button 
                                          variant="outline" 
                                          size="sm" 
                                          className="bg-green-50 text-green-600 hover:bg-green-100 hover:text-green-700 border-green-200 font-medium"
                                          onClick={() => handleDownloadDocument(doc)}
                                        >
                                          <Download className="h-4 w-4 mr-2" />
                                          {t("procedurePages.details.download")}
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        <p>{t("procedurePages.details.downloadFile", { filename: doc.originalFilename })}</p>
                                      </TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <span className="text-sm text-muted-foreground">{t("procedurePages.details.noDocuments")}</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </>
            ) : (
              <Alert>
                <AlertTitle>{t("procedurePages.details.noImportExpensesTitle")}</AlertTitle>
                <AlertDescription>
                  {t("procedurePages.details.noImportExpensesDescription")}
                </AlertDescription>
              </Alert>
            )}

            {importExpenses.length > 0 && (
              <div className="mt-6 flex justify-end text-lg font-semibold text-[#0C0A09]">
                <span className="mr-4">{t("procedurePages.details.importExpensesTotal")}</span>
                <span>
                  {formatTaxAmount(
                    importExpenses.reduce((total, expense) => total + parseFloat(expense.amount), 0)
                  )}
                </span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Import Service Invoice Section */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>{t("procedurePages.details.serviceInvoicesTitle")}</CardTitle>
            <CardDescription>
              {t("procedurePages.details.serviceInvoicesDescription")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {serviceInvoices.length > 0 ? (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("procedurePages.details.invoiceNumberColumn")}</TableHead>
                      <TableHead>{t("procedurePages.details.date")}</TableHead>
                      <TableHead>{t("procedurePages.details.notes")}</TableHead>
                      <TableHead className="text-right">{t("procedurePages.details.amount")}</TableHead>
                      <TableHead className="text-right">{t("procedurePages.details.documents")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {serviceInvoices.map((invoice) => (
                      <TableRow key={invoice.id}>
                        <TableCell className="font-medium">{invoice.invoiceNumber}</TableCell>
                        <TableCell>{formatDate(invoice.date)}</TableCell>
                        <TableCell>{invoice.notes || "—"}</TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(invoice.amount, invoice.currency)}
                        </TableCell>
                        <TableCell className="text-right">
                          {getDocumentsForExpense('service_invoice', invoice.id).length > 0 ? (
                            <div className="flex justify-end gap-2">
                              {getDocumentsForExpense('service_invoice', invoice.id).map((doc) => (
                                <div key={doc.id}>
                                  <TooltipProvider>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button 
                                          variant="outline" 
                                          size="sm" 
                                          className="bg-green-50 text-green-600 hover:bg-green-100 hover:text-green-700 border-green-200 font-medium"
                                          onClick={() => handleDownloadDocument(doc)}
                                        >
                                          <Download className="h-4 w-4 mr-2" />
                                          {t("procedurePages.details.download")}
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        <p>{t("procedurePages.details.downloadFile", { filename: doc.originalFilename })}</p>
                                      </TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <span className="text-sm text-muted-foreground">{t("procedurePages.details.noDocuments")}</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                <div className="mt-6 flex justify-end text-lg font-semibold text-[#0C0A09]">
                  <span className="mr-4">{t("procedurePages.details.serviceInvoicesTotal")}</span>
                  <span>
                    {formatTaxAmount(
                      serviceInvoices.reduce((total, invoice) => total + parseFloat(invoice.amount), 0)
                    )}
                  </span>
                </div>
              </>
            ) : (
              <Alert>
                <AlertTitle>{t("procedurePages.details.noServiceInvoicesTitle")}</AlertTitle>
                <AlertDescription>
                  {t("procedurePages.details.noServiceInvoicesDescription")}
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>



        {/* Import Documents section is now in a dedicated section instead of "All Documents" */}

        {/* Financial Summary Section */}
        <Card>
          <CardHeader>
            <CardTitle>{t("procedurePages.details.financialSummaryTitle")}</CardTitle>
            <CardDescription>
              {t("procedurePages.details.financialSummaryDescription")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h3 className="text-lg font-semibold mb-4">{t("procedurePages.details.expenseBreakdown")}</h3>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("procedurePages.details.category")}</TableHead>
                      <TableHead className="text-right">{t("procedurePages.details.amount")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tax && (
                      <TableRow>
                        <TableCell>{t("procedurePages.details.taxesRow")}</TableCell>
                        <TableCell className="text-right">
                          {formatTaxAmount(
                            (parseFloat(tax.customsTax) || 0) +
                            (parseFloat(tax.additionalCustomsTax) || 0) +
                            (parseFloat(tax.kkdf) || 0) +
                            (parseFloat(tax.vat) || 0) +
                            (parseFloat(tax.stampTax) || 0)
                          )}
                        </TableCell>
                      </TableRow>
                    )}
                    {importExpenses.length > 0 && (
                      <TableRow>
                        <TableCell>{t("procedurePages.details.importExpensesRow")}</TableCell>
                        <TableCell className="text-right">
                          {formatTaxAmount(
                            importExpenses.reduce((total, expense) => total + parseFloat(expense.amount), 0)
                          )}
                        </TableCell>
                      </TableRow>
                    )}
                    {serviceInvoices.length > 0 && (
                      <TableRow>
                        <TableCell>{t("procedurePages.details.serviceInvoicesRow")}</TableCell>
                        <TableCell className="text-right">
                          {formatTaxAmount(
                            serviceInvoices.reduce((total, invoice) => total + parseFloat(invoice.amount), 0)
                          )}
                        </TableCell>
                      </TableRow>
                    )}
                    <TableRow className="font-bold text-red-600">
                      <TableCell><span className="underline">{t("procedurePages.details.totalExpenses")}</span></TableCell>
                      <TableCell className="text-right underline">{formatTaxAmount(totalValue)}</TableCell>
                    </TableRow>
                    <TableRow className="text-[#0C0A09]">
                      <TableCell>{t("procedurePages.details.advancePayment")}</TableCell>
                      <TableCell className="text-right font-medium">{formatTaxAmount(advancePayment)}</TableCell>
                    </TableRow>
                    <TableRow className="text-[#0C0A09]">
                      <TableCell>{t("procedurePages.details.balancePayment")}</TableCell>
                      <TableCell className="text-right font-medium">{formatTaxAmount(balancePayment)}</TableCell>
                    </TableRow>
                    <TableRow className="font-bold text-green-600">
                      <TableCell><span className="underline">{t("procedurePages.details.totalPayments")}</span></TableCell>
                      <TableCell className="text-right font-bold underline">{formatTaxAmount(totalPayments)}</TableCell>
                    </TableRow>
                    <TableRow className={remainingBalance > 0 ? "text-red-500 font-bold" : "text-green-500 font-bold"}>
                      <TableCell><span className="underline">{remainingBalance > 0 ? t("procedurePages.details.remainingBalance") : t("procedurePages.details.excessPayment")}</span></TableCell>
                      <TableCell className="text-right underline">{formatTaxAmount(Math.abs(remainingBalance))}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>

              <div>
                <div className="flex flex-col h-full">
                  <h3 className="text-lg font-semibold mb-3">{t("procedurePages.details.paymentProgress")}</h3>
                  <div className="mb-4">
                    <div className="flex justify-between mb-1">
                      <span className="text-sm">{t("procedurePages.details.paymentProgress")}</span>
                      <span className="text-sm">
                        {Math.min(100, Math.round((totalPayments / totalValue) * 100))}%
                      </span>
                    </div>
                    <Progress 
                      value={Math.min(100, Math.round((totalPayments / totalValue) * 100))} 
                      className="h-2"
                    />
                  </div>

                  {/* View Payment Distributions Button */}
                  {paymentDistributions.length > 0 ? (
                    <div className="mb-4">
                      <Button 
                        variant="outline" 
                        className="w-full border-blue-300 text-blue-600 hover:bg-blue-50 hover:text-blue-700"
                        onClick={() => setIsViewDistributionsOpen(true)}
                      >
                        <BarChart2 className="h-4 w-4 mr-2" />
                        {t("procedurePages.details.viewPaymentDistributions", { count: paymentDistributions.length })}
                      </Button>
                    </div>
                  ) : null}

                  <div className="grid grid-cols-2 gap-4 mb-6">
                    <div className="border rounded-md p-4 text-center text-red-600">
                      <p className="text-sm underline font-bold">{t("procedurePages.details.totalExpenses")}</p>
                      <p className="text-xl font-bold underline">{formatTaxAmount(totalValue)}</p>
                    </div>
                    <div className="border rounded-md p-4 text-center text-green-600">
                      <p className="text-sm underline font-bold">{t("procedurePages.details.totalPayments")}</p>
                      <p className="text-xl font-bold underline">{formatTaxAmount(totalPayments)}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 mb-6">
                    <div className="border rounded-md p-4 text-center">
                      <p className="text-sm text-[#0C0A09] dark:text-[#0C0A09]">{t("procedurePages.details.advancePayment")}</p>
                      <p className="text-xl font-bold text-[#0C0A09] dark:text-[#0C0A09]">{formatTaxAmount(advancePayment)}</p>
                    </div>
                    <div className="border rounded-md p-4 text-center">
                      <p className="text-sm text-[#0C0A09] dark:text-[#0C0A09]">{t("procedurePages.details.balancePayment")}</p>
                      <p className="text-xl font-bold text-[#0C0A09] dark:text-[#0C0A09]">{formatTaxAmount(balancePayment)}</p>
                    </div>
                  </div>

                  <div className={`border rounded-md p-4 mt-auto ${remainingBalance > 0 ? "bg-red-50 dark:bg-red-950 border-red-200" : "bg-green-50 dark:bg-green-950 border-green-200"}`}>
                    <div className="flex justify-between items-center">
                      <p className="font-medium underline">{remainingBalance > 0 ? t("procedurePages.details.remainingBalance") : t("procedurePages.details.excessPayment")}</p>
                      <p className={`text-2xl font-bold underline ${remainingBalance > 0 ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}>
                        {formatTaxAmount(Math.abs(remainingBalance))}
                      </p>
                    </div>
                    <p className="text-sm mt-2">
                      {remainingBalance > 0
                        ? t("procedurePages.details.additionalPaymentRequired")
                        : t("procedurePages.details.clientOverpaid")}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Products Section */}
        {taxProducts.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>{t("procedurePages.details.productsTitle")}</CardTitle>
              <CardDescription>
                {t("procedurePages.details.productsDescription")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("procedurePages.details.styleNo")}</TableHead>
                    <TableHead className="text-right">{t("procedurePages.details.costUsd")}</TableHead>
                    <TableHead className="text-right">{t("procedurePages.details.unit")}</TableHead>
                    <TableHead className="text-right">{t("procedurePages.details.totalValueUsd")}</TableHead>
                    <TableHead>{t("procedurePages.details.trHsCode")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {taxProducts.map((product, index) => (
                    <TableRow key={index}>
                      <TableCell className="font-medium">{product.style}</TableCell>
                      <TableCell className="text-right">{product.cost}</TableCell>
                      <TableCell className="text-right">{product.unit_count}</TableCell>
                      <TableCell className="text-right">
                        {(parseFloat(product.cost) * product.unit_count).toFixed(2)}
                      </TableCell>
                      <TableCell>{product.tr_hs_code || "-"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

      </div>

      {/* View Payment Distributions Modal */}
      {procedure && (
        <ViewDistributionModal
          isOpen={isViewDistributionsOpen}
          onClose={() => setIsViewDistributionsOpen(false)}
          procedureReference={procedure.reference}
          onDistributionChange={() => {
            // Refresh data when distributions change
            fetchProcedureData(procedure.reference);
          }}
          viewMode="procedure"
          paymentId={null} // Not needed for procedure view mode
          paymentData={null} // Not needed for procedure view mode
        />
      )}
    </PageLayout>
  );
}