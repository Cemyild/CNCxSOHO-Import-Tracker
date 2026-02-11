import { useState, useEffect, useCallback } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { toast as showToast } from "@/hooks/use-toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatNumber, formatCurrency, formatDate, formatCategoryName } from "@/utils/formatters";
import { ExpenseDocumentUpload } from "@/components/ui/expense-document-upload";
import { ImportDocumentUpload } from "@/components/ui/import-document-upload";
import { PdfUploadDropzone } from "@/components/ui/pdf-upload-dropzone";
import {
  Calendar,
  Home,
  Inbox,
  Search,
  Settings,
  BarChart2,
  Loader2,
  Plus,
  Trash2,
  Edit,
  Save,
  X as CloseIcon,
  RefreshCw,
  FileText,
  Upload,
  Check,
  Eye,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { PageLayout } from "@/components/layout/PageLayout";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

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
    title: "Settings",
    url: "/settings",
    icon: Settings,
  },
];

// Form validation schemas
const shipmentDetailsSchema = z.object({
  reference: z.string().min(1, "Reference is required"),
});

const shipmentDetailsEditSchema = z.object({
  shipper: z.string(),
  package: z.number(),
  weight: z.number(),
  pieces: z.number(),
  awbNumber: z.string(),
  customs: z.string(),
  importDeclarationNumber: z.string(),
  importDeclarationDate: z.string(),
  usdTlRate: z.number(),
});

const taxSchema = z.object({
  customsTax: z.string().optional().transform(val => val === "" ? "0" : val),
  additionalCustomsTax: z.string().optional().transform(val => val === "" ? "0" : val),
  kkdf: z.string().optional().transform(val => val === "" ? "0" : val),
  vat: z.string().optional().transform(val => val === "" ? "0" : val),
  stampTax: z.string().optional().transform(val => val === "" ? "0" : val),
});

const importExpenseSchema = z.object({
  category: z.string().min(1, "Category is required"),
  amount: z.string().min(1, "Amount is required"),
  currency: z.string().default("TRY"),
  invoiceNumber: z.string().optional(),
  invoiceDate: z.string().optional(),
  documentNumber: z.string().optional(),
  policyNumber: z.string().optional(),
  issuer: z.string().optional(),
  notes: z.string().optional(),
});

const serviceInvoiceSchema = z.object({
  amount: z.string().min(1, "Amount is required"),
  currency: z.string().default("TRY"),
  invoiceNumber: z.string().min(1, "Invoice number is required"),
  date: z.string().min(1, "Date is required"),
  notes: z.string().optional(),
});

// Interface for procedure data
interface Procedure {
  id: number;
  reference: string;
  shipper: string;
  invoice_no: string;
  invoice_date: string;
  amount: string;
  currency: string;
  package: string;
  kg: string;
  piece: number;
  arrival_date: string;
  awb_number: string;
  carrier: string;
  customs: string;
  import_dec_number: string;
  import_dec_date: string;
  payment_status: string;
  document_status: string;
  shipment_status: string;
  assignedTo: number;
  createdBy: number;
}

// Interface for different expense types
interface TaxData {
  id?: number;
  procedureReference: string;
  customsTax?: string;
  additionalCustomsTax?: string;
  kkdf?: string;
  vat?: string;
  stampTax?: string;
}

interface ImportExpense {
  id?: number;
  procedureReference: string;
  category: string;
  amount: string;
  currency: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  documentNumber?: string;
  policyNumber?: string;
  issuer?: string;
  notes?: string;
}

interface ServiceInvoice {
  id?: number;
  procedureReference: string;
  amount: string;
  currency: string;
  invoiceNumber: string;
  date: string;
  notes?: string;
}

// Expense categories
const expenseCategories = [
  "export_registry_fee",
  "insurance",
  "awb_fee",
  "airport_storage_fee", 
  "bonded_warehouse_storage_fee",
  "transportation",
  "international_transportation",
  "tareks_fee",
  "customs_inspection",
  "azo_test",
  "other"
];

// Define which fields are required for each expense category
const categoryRequiredFields = {
  export_registry_fee: ["documentNumber", "invoiceDate"], // Added Date
  insurance: ["policyNumber", "issuer", "invoiceDate"], // Added Date
  awb_fee: ["invoiceNumber", "issuer", "invoiceDate"], // Added Issuer and Date
  airport_storage_fee: ["invoiceNumber", "invoiceDate", "issuer"], // Added Issuer
  bonded_warehouse_storage_fee: ["invoiceNumber", "invoiceDate", "issuer"], // Added Issuer
  transportation: ["invoiceNumber", "issuer", "invoiceDate"], // Added Issuer and Date
  international_transportation: ["invoiceNumber", "issuer", "invoiceDate"], // Added Issuer and Date
  tareks_fee: ["invoiceNumber", "invoiceDate"], // Changed from documentNumber to invoiceNumber, added Date
  customs_inspection: ["documentNumber", "invoiceDate"], // Changed from invoiceNumber to documentNumber, added Date
  azo_test: ["invoiceNumber", "issuer", "invoiceDate"], // Added Issuer and Date
  other: []
};

// These functions have been moved to utils/formatters.ts

// Main component
export default function ExpenseEntryPage() {
  // State for the current procedure
  const [procedure, setProcedure] = useState<Procedure | null>(null);
  const [isReadOnly, setIsReadOnly] = useState(false);
  const [activeTab, setActiveTab] = useState("tax");
  const [procedures, setProcedures] = useState<Procedure[]>([]);
  
  // State for expense lists
  const [taxData, setTaxData] = useState<TaxData | null>(null);
  const [importExpenses, setImportExpenses] = useState<ImportExpense[]>([]);
  const [serviceInvoices, setServiceInvoices] = useState<ServiceInvoice[]>([]);
  
  // State for document upload management
  const [selectedTax, setSelectedTax] = useState<TaxData | null>(null);
  const [selectedExpense, setSelectedExpense] = useState<ImportExpense | null>(null);
  const [selectedServiceInvoice, setSelectedServiceInvoice] = useState<ServiceInvoice | null>(null);
  
  // Edit state for import expenses
  const [editingExpenseIndex, setEditingExpenseIndex] = useState<number | null>(null);
  
  // Loading states
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingProcedure, setIsLoadingProcedure] = useState(false);
  
  // PDF Analysis states
  const [isAnalyzingTaxPdf, setIsAnalyzingTaxPdf] = useState(false);
  const [isAnalyzingExpensePdf, setIsAnalyzingExpensePdf] = useState(false);
  const [isAnalyzingServicePdf, setIsAnalyzingServicePdf] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [taxDeclarationInfo, setTaxDeclarationInfo] = useState<string | null>(null);
  const [isShipmentFormManuallyEdited, setIsShipmentFormManuallyEdited] = useState(false);
  
  // Analyzed PDF file references for auto-attachment
  interface AnalyzedPdfFile {
    objectKey: string;
    originalFilename: string;
    fileSize: number;
    fileType: string;
  }
  const [analyzedExpensePdf, setAnalyzedExpensePdf] = useState<AnalyzedPdfFile | null>(null);
  const [analyzedServicePdf, setAnalyzedServicePdf] = useState<AnalyzedPdfFile | null>(null);
  
  // Shipment details editing state
  const [isSubmittingShipment, setIsSubmittingShipment] = useState(false);
  
  // Dialog control
  const [isConfirmDialogOpen, setIsConfirmDialogOpen] = useState(false);
  
  // Expense Receipt Modal state
  interface RecognizedItem {
    id: string;
    description: string;
    amount: number;
    currency: string;
    suggestedCategory: string;
    selectedCategory: string;
    type: 'tax' | 'expense' | 'service_invoice';
    invoiceNumber: string;
    invoiceDate: string;
    receiptNumber: string;
    issuer: string;
    selected: boolean;
    sourceFile?: string;
    pageNumber?: number | null;
    pdfObjectKey?: string;
  }
  interface RecognizedTaxes {
    customsTax: number;
    additionalCustomsTax: number;
    kkdf: number;
    vat: number;
    stampTax: number;
  }
  interface UploadedPdfFile {
    objectKey: string;
    originalFilename: string;
    fileSize: number;
    fileType: string;
    pageCount: number;
  }
  const [isExpenseReceiptModalOpen, setIsExpenseReceiptModalOpen] = useState(false);
  const [isAnalyzingExpenseReceipt, setIsAnalyzingExpenseReceipt] = useState(false);
  const [recognizedItems, setRecognizedItems] = useState<RecognizedItem[]>([]);
  const [recognizedTaxes, setRecognizedTaxes] = useState<RecognizedTaxes | null>(null);
  const [expenseReceiptError, setExpenseReceiptError] = useState<string | null>(null);
  const [uploadedPdfFile, setUploadedPdfFile] = useState<UploadedPdfFile | null>(null);
  const [previewPageNumber, setPreviewPageNumber] = useState<number | null>(null);
  const [isPdfPreviewOpen, setIsPdfPreviewOpen] = useState(false);
  const [addMissingPageNumber, setAddMissingPageNumber] = useState<number>(1);
  const [isAnalyzingMissingPage, setIsAnalyzingMissingPage] = useState(false);
  
  // Tax categories for display
  const taxCategories = ['customs_tax', 'additional_customs_tax', 'kkdf', 'vat', 'stamp_tax'];
  const allCategories = [...taxCategories, ...expenseCategories];
  
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  // Get current user for admin check
  const { data: currentUser } = useQuery({
    queryKey: ["/api/auth/me"],
    retry: false,
  });
  
  // Form setup for shipment details (procedure reference search)
  const shipmentForm = useForm({
    resolver: zodResolver(shipmentDetailsSchema),
    defaultValues: {
      reference: "",
    },
  });
  
  // Form setup for shipment details editing
  const shipmentDetailsEditForm = useForm({
    resolver: zodResolver(shipmentDetailsEditSchema),
    defaultValues: {
      shipper: "",
      package: 0,
      weight: 0,
      pieces: 0,
      awbNumber: "",
      customs: "",
      importDeclarationNumber: "",
      importDeclarationDate: "",
      usdTlRate: 0,
    },
  });
  
  // Form setup for tax entry
  const taxForm = useForm({
    resolver: zodResolver(taxSchema),
    defaultValues: {
      customsTax: "0",
      additionalCustomsTax: "0",
      kkdf: "0",
      vat: "0",
      stampTax: "0",
    },
  });
  
  // Form setup for import expense entry
  const importExpenseForm = useForm({
    resolver: zodResolver(importExpenseSchema),
    defaultValues: {
      category: "",
      amount: "",
      currency: "TRY",
      invoiceNumber: "",
      invoiceDate: "",
      documentNumber: "",
      policyNumber: "",
      issuer: "",
      notes: "",
    },
  });
  
  // Form setup for service invoice entry
  const serviceInvoiceForm = useForm({
    resolver: zodResolver(serviceInvoiceSchema),
    defaultValues: {
      amount: "",
      currency: "TRY",
      invoiceNumber: "",
      date: "",
      notes: "",
    },
  });
  
  // Function to load procedure data
  const loadProcedureData = async (reference: string) => {
    try {
      // Add a timestamp as a cache-busting query parameter
      const timestamp = Date.now();
      
      // Encode reference to handle forward slashes properly
      const encodedReference = encodeURIComponent(reference);
      
      // Load tax data
      const taxResponse = await apiRequest("GET", `/api/taxes/procedure/${encodedReference}?_=${timestamp}`);
      const taxData = await taxResponse.json();
      if (taxData.tax) {
        setTaxData(taxData.tax);
        // Update tax form with existing values
        taxForm.reset({
          customsTax: taxData.tax.customsTax || "0",
          additionalCustomsTax: taxData.tax.additionalCustomsTax || "0",
          kkdf: taxData.tax.kkdf || "0",
          vat: taxData.tax.vat || "0",
          stampTax: taxData.tax.stampTax || "0",
        });
      } else {
        setTaxData(null);
        taxForm.reset({
          customsTax: "0",
          additionalCustomsTax: "0",
          kkdf: "0",
          vat: "0",
          stampTax: "0",
        });
      }
      
      // Load import expenses with cache busting
      const expensesResponse = await apiRequest("GET", `/api/import-expenses/procedure/${encodedReference}?_=${timestamp}`);
      const expensesData = await expensesResponse.json();
      setImportExpenses(expensesData.expenses || []);
      
      // Load service invoices with cache busting
      const invoicesResponse = await apiRequest("GET", `/api/service-invoices/procedure/${encodedReference}?_=${timestamp}`);
      const invoicesData = await invoicesResponse.json();
      setServiceInvoices(invoicesData.invoices || []);
    } catch (error) {
      console.error("Error loading procedure data:", error);
      showToast({
        title: "Error",
        description: "Failed to load procedure data",
        variant: "destructive",
      });
    }
  };
  
  // Function to search procedure by reference
  const searchProcedureByReference = async (reference: string) => {
    setIsLoadingProcedure(true);
    try {
      // Add a timestamp as a cache-busting query parameter
      const timestamp = Date.now();
      
      // First, check if there are any procedures with this reference
      const response = await apiRequest("GET", `/api/procedures?_=${timestamp}`);
      const responseData = await response.json();
      const procedures = responseData.procedures || [];
      const foundProcedure = procedures.find((p: Procedure) => p.reference === reference);
      
      if (!foundProcedure) {
        showToast({
          title: "Procedure not found",
          description: `No procedure found with reference ${reference}`,
          variant: "destructive",
        });
        setProcedure(null);
        return;
      }
      
      setProcedure(foundProcedure);
      setIsReadOnly(true);
      
      // Now load associated data
      await loadProcedureData(reference);
      
      showToast({
        title: "Procedure found",
        description: `Loaded procedure with reference ${reference}`,
      });
    } catch (error) {
      console.error("Error searching for procedure:", error);
      showToast({
        title: "Error",
        description: "Failed to search for procedure",
        variant: "destructive",
      });
    } finally {
      setIsLoadingProcedure(false);
    }
  };
  
  // Handle shipment form submission
  const onSubmitShipmentForm = (data: any) => {
    searchProcedureByReference(data.reference);
  };
  
  // Handle tax form submission
  const onSubmitTaxForm = async (data: any) => {
    if (!procedure) {
      showToast({
        title: "Error",
        description: "No procedure selected",
        variant: "destructive",
      });
      return;
    }
    
    setIsSubmitting(true);
    try {
      // Check if we're updating or creating
      if (taxData?.id) {
        // Update existing tax record
        await apiRequest("PUT", `/api/taxes/${taxData.id}`, data);
        showToast({
          title: "Success",
          description: "Tax information updated successfully",
        });
      } else {
        // Create new tax record
        const response = await apiRequest("POST", '/api/taxes', {
          ...data,
          procedureReference: procedure.reference,
        });
        const responseData = await response.json();
        setTaxData(responseData.tax);
        showToast({
          title: "Success",
          description: "Tax information saved successfully",
        });
      }
      
      // Reload procedure data
      await loadProcedureData(procedure.reference);
    } catch (error) {
      console.error("Error saving tax information:", error);
      showToast({
        title: "Error",
        description: "Failed to save tax information",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };
  
  // Handle expense form submission
  const onSubmitExpenseForm = async (data: any) => {
    console.log('Add expense clicked:', data);
    if (!procedure) {
      showToast({
        title: "Error",
        description: "No procedure selected",
        variant: "destructive",
      });
      return;
    }
    
    // Check for required fields based on category
    const requiredFields = categoryRequiredFields[data.category as keyof typeof categoryRequiredFields] || [];
    let missingFields = [];
    
    for (const field of requiredFields) {
      if (!data[field]) {
        missingFields.push(field);
      }
    }
    
    if (missingFields.length > 0) {
      showToast({
        title: "Missing fields",
        description: `Required fields for this category: ${missingFields.join(", ")}`,
        variant: "destructive",
      });
      return;
    }
    
    // Check if we're editing or adding
    if (editingExpenseIndex !== null) {
      // We're editing an existing expense
      await updateExpense(data);
      return;
    }
    
    // Save to database first
    setIsSubmitting(true);
    try {
      // Clean the data before sending to API
      const cleanedData = {
        ...data,
        procedureReference: procedure.reference,
        // Ensure all values are strings or proper types
        amount: String(data.amount || ""),
        currency: String(data.currency || "TRY"),
        category: String(data.category || ""),
        invoiceNumber: data.invoiceNumber ? String(data.invoiceNumber) : null,
        invoiceDate: data.invoiceDate || null, // Keep as YYYY-MM-DD string to avoid timezone issues
        documentNumber: data.documentNumber ? String(data.documentNumber) : null,
        policyNumber: data.policyNumber ? String(data.policyNumber) : null,
        issuer: data.issuer ? String(data.issuer) : null,
        notes: data.notes ? String(data.notes) : null,
      };
      
      console.log('Sending cleaned data to API:', cleanedData);
      const response = await apiRequest("POST", '/api/import-expenses', cleanedData);
      const responseData = await response.json();
      
      // Add to current expenses list with the ID from database
      const newExpense: ImportExpense = {
        ...responseData.expense,
      };
      
      setImportExpenses(prev => [...prev, newExpense]);
      
      // Auto-attach the analyzed PDF if available
      if (analyzedExpensePdf && responseData.expense?.id) {
        try {
          console.log('[Auto-attach] Attaching PDF to expense:', {
            expenseId: responseData.expense.id,
            pdfObjectKey: analyzedExpensePdf.objectKey
          });
          
          // Create expense document record linking the PDF to the expense
          const formData = new FormData();
          formData.append('procedureReference', procedure.reference);
          formData.append('expenseType', 'import_expense');
          formData.append('expenseId', responseData.expense.id.toString());
          formData.append('objectKey', analyzedExpensePdf.objectKey);
          formData.append('originalFilename', analyzedExpensePdf.originalFilename);
          formData.append('fileSize', analyzedExpensePdf.fileSize.toString());
          formData.append('fileType', analyzedExpensePdf.fileType);
          
          const attachResponse = await fetch('/api/expense-documents/attach', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              procedureReference: procedure.reference,
              expenseType: 'import_expense',
              expenseId: responseData.expense.id,
              objectKey: analyzedExpensePdf.objectKey,
              originalFilename: analyzedExpensePdf.originalFilename,
              fileSize: analyzedExpensePdf.fileSize,
              fileType: analyzedExpensePdf.fileType
            }),
            credentials: 'include'
          });
          
          if (attachResponse.ok) {
            console.log('[Auto-attach] PDF attached successfully');
            showToast({
              title: "Document attached",
              description: "The analyzed PDF has been automatically attached to the expense",
            });
          } else {
            console.error('[Auto-attach] Failed to attach PDF:', await attachResponse.text());
          }
          
          // Clear the analyzed PDF reference
          setAnalyzedExpensePdf(null);
        } catch (attachError) {
          console.error('[Auto-attach] Error attaching PDF:', attachError);
          // Don't fail the expense creation, just log the error
        }
      }
      
      // Reset form
      importExpenseForm.reset({
        category: "",
        amount: "",
        currency: "TRY",
        invoiceNumber: "",
        invoiceDate: "",
        documentNumber: "",
        policyNumber: "",
        issuer: "",
        notes: "",
      });
      
      showToast({
        title: "Expense added",
        description: analyzedExpensePdf ? "Expense saved with attached PDF" : "Expense saved successfully to database",
      });
      
      // Reload procedure data to ensure UI is in sync
      await loadProcedureData(procedure.reference);
    } catch (error) {
      console.error("Error saving expense:", error);
      showToast({
        title: "Error",
        description: "Failed to save expense to database",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };
  
  // Record All function - saves all unsaved expenses and service invoices
  const saveAllExpenses = async () => {
    console.log('Record all clicked');
    if (!procedure) {
      showToast({
        title: "Error",
        description: "No procedure selected",
        variant: "destructive",
      });
      return;
    }
    
    setIsSubmitting(true);
    let successCount = 0;
    let errorCount = 0;
    
    try {
      // Save all unsaved import expenses (those without IDs)
      const unsavedExpenses = importExpenses.filter(expense => !expense.id);
      console.log('Unsaved expenses to save:', unsavedExpenses);
      
      for (const expense of unsavedExpenses) {
        try {
          await apiRequest("POST", '/api/import-expenses', expense);
          successCount++;
        } catch (error) {
          console.error("Error saving expense:", error);
          errorCount++;
        }
      }
      
      // Save all unsaved service invoices (those without IDs)
      const unsavedInvoices = serviceInvoices.filter(invoice => !invoice.id);
      console.log('Unsaved service invoices to save:', unsavedInvoices);
      
      for (const invoice of unsavedInvoices) {
        try {
          await apiRequest("POST", '/api/service-invoices', invoice);
          successCount++;
        } catch (error) {
          console.error("Error saving service invoice:", error);
          errorCount++;
        }
      }
      
      // Reload all procedure data to ensure UI is in sync
      await loadProcedureData(procedure.reference);
      
      if (errorCount === 0) {
        showToast({
          title: "Success",
          description: `All ${successCount} items saved successfully`,
        });
      } else {
        showToast({
          title: "Partial Success",
          description: `${successCount} items saved, ${errorCount} failed`,
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Error in Record All operation:", error);
      showToast({
        title: "Error",
        description: "Failed to save all expenses",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };
  
  // PDF Upload Handlers
  const handleTaxPdfUpload = async (file: File) => {
    // Check if user is authenticated
    if (!currentUser) {
      toast({
        title: "Authentication required",
        description: "Please log in to upload documents",
        variant: "destructive",
      });
      return;
    }

    setPdfError(null);
    setTaxDeclarationInfo(null);
    setIsAnalyzingTaxPdf(true);

    try {
      const formData = new FormData();
      formData.append('pdf', file);

      // Get auth token from localStorage
      const authToken = localStorage.getItem('authToken');
      const headers: Record<string, string> = {};
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }

      const response = await fetch('/api/expenses/analyze-pdf/tax', {
        method: 'POST',
        headers,
        body: formData,
        credentials: 'include'
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to analyze PDF');
      }

      const result = await response.json();
      const data = result.data;

      // Auto-fill tax form with extracted data
      taxForm.setValue('customsTax', data.customsTax.toString());
      taxForm.setValue('additionalCustomsTax', data.additionalCustomsTax.toString());
      taxForm.setValue('kkdf', data.kkdf.toString());
      taxForm.setValue('vat', data.vat.toString());
      taxForm.setValue('stampTax', data.stampTax.toString());

      // Show declaration info if available
      if (data.declarationNumber || data.declarationDate || data.currency) {
        const parts = [];
        if (data.declarationNumber) parts.push(`Declaration: ${data.declarationNumber}`);
        if (data.declarationDate) parts.push(`Date: ${data.declarationDate}`);
        if (data.currency) parts.push(`Currency: ${data.currency}`);
        setTaxDeclarationInfo(parts.join(', '));
      }

      toast({
        title: "Tax data extracted successfully",
        description: "Please review the values and click 'Save Tax Information'",
      });

    } catch (error: any) {
      console.error('Tax PDF analysis error:', error);
      setPdfError(error.message || 'Failed to analyze PDF - please try again');
      toast({
        title: "Analysis failed",
        description: error.message || 'Failed to analyze PDF - please try again',
        variant: "destructive",
      });
    } finally {
      setIsAnalyzingTaxPdf(false);
    }
  };

  const handleExpensePdfUpload = async (file: File) => {
    // Check if user is authenticated
    if (!currentUser) {
      toast({
        title: "Authentication required",
        description: "Please log in to upload documents",
        variant: "destructive",
      });
      return;
    }

    setPdfError(null);
    setIsAnalyzingExpensePdf(true);

    try {
      const formData = new FormData();
      formData.append('pdf', file);

      // Get auth token from localStorage
      const authToken = localStorage.getItem('authToken');
      const headers: Record<string, string> = {};
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }

      const response = await fetch('/api/expenses/analyze-pdf/import-expense', {
        method: 'POST',
        headers,
        body: formData,
        credentials: 'include'
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to analyze PDF');
      }

      const result = await response.json();
      const data = result.data;

      // Auto-fill expense form with extracted data
      importExpenseForm.setValue('category', data.category);
      importExpenseForm.setValue('amount', data.amount.toString());
      importExpenseForm.setValue('currency', data.currency);
      importExpenseForm.setValue('invoiceNumber', data.invoiceNumber || '');
      importExpenseForm.setValue('invoiceDate', data.invoiceDate || '');
      importExpenseForm.setValue('documentNumber', data.documentNumber || '');
      importExpenseForm.setValue('policyNumber', data.policyNumber || '');
      importExpenseForm.setValue('issuer', data.issuer || '');
      importExpenseForm.setValue('notes', data.notes || '');

      // Store PDF file reference for auto-attachment when expense is created
      if (result.pdfFile) {
        setAnalyzedExpensePdf(result.pdfFile);
        console.log('[PDF Upload] Stored PDF reference for auto-attachment:', result.pdfFile.objectKey);
      }

      toast({
        title: "Expense data extracted successfully",
        description: "Please review the values and click 'Add Expense'",
      });

    } catch (error: any) {
      console.error('Expense PDF analysis error:', error);
      setPdfError(error.message || 'Failed to analyze PDF - please try again');
      setAnalyzedExpensePdf(null); // Clear any previous PDF reference on error
      toast({
        title: "Analysis failed",
        description: error.message || 'Failed to analyze PDF - please try again',
        variant: "destructive",
      });
    } finally {
      setIsAnalyzingExpensePdf(false);
    }
  };

  const handleServicePdfUpload = async (file: File) => {
    // Check if user is authenticated
    if (!currentUser) {
      toast({
        title: "Authentication required",
        description: "Please log in to upload documents",
        variant: "destructive",
      });
      return;
    }

    setPdfError(null);
    setIsAnalyzingServicePdf(true);

    try {
      const formData = new FormData();
      formData.append('pdf', file);

      // Get auth token from localStorage
      const authToken = localStorage.getItem('authToken');
      const headers: Record<string, string> = {};
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }

      const response = await fetch('/api/expenses/analyze-pdf/service-invoice', {
        method: 'POST',
        headers,
        body: formData,
        credentials: 'include'
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to analyze PDF');
      }

      const result = await response.json();
      const data = result.data;

      // Auto-fill service invoice form with extracted data
      serviceInvoiceForm.setValue('amount', data.amount.toString());
      serviceInvoiceForm.setValue('currency', data.currency);
      serviceInvoiceForm.setValue('invoiceNumber', data.invoiceNumber || '');
      serviceInvoiceForm.setValue('date', data.date || '');
      serviceInvoiceForm.setValue('notes', data.notes || '');

      // Store PDF file reference for auto-attachment when service invoice is created
      if (result.pdfFile) {
        setAnalyzedServicePdf(result.pdfFile);
        console.log('[PDF Upload] Stored service invoice PDF reference for auto-attachment:', result.pdfFile.objectKey);
      }

      toast({
        title: "Invoice data extracted successfully",
        description: "Please review the values and click 'Add Invoice'",
      });

    } catch (error: any) {
      console.error('Service PDF analysis error:', error);
      setPdfError(error.message || 'Failed to analyze PDF - please try again');
      setAnalyzedServicePdf(null); // Clear any previous PDF reference on error
      toast({
        title: "Analysis failed",
        description: error.message || 'Failed to analyze PDF - please try again',
        variant: "destructive",
      });
    } finally {
      setIsAnalyzingServicePdf(false);
    }
  };
  
  // Handle multiple Expense Receipt PDF uploads
  const handleExpenseReceiptPdfUpload = async (files: FileList | File[]) => {
    if (!currentUser) {
      toast({
        title: "Authentication required",
        description: "Please log in to upload documents",
        variant: "destructive",
      });
      return;
    }

    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;

    setExpenseReceiptError(null);
    setIsAnalyzingExpenseReceipt(true);
    setRecognizedItems([]);
    setRecognizedTaxes(null);
    setUploadedPdfFile(null);

    const authToken = localStorage.getItem('authToken');
    const headers: Record<string, string> = {};
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    let allItems: RecognizedItem[] = [];
    let combinedTaxes = {
      customsTax: 0,
      additionalCustomsTax: 0,
      kkdf: 0,
      vat: 0,
      stampTax: 0
    };
    let successCount = 0;
    let errorMessages: string[] = [];
    let lastPdfFile: UploadedPdfFile | null = null;

    try {
      // Process all PDFs
      for (let i = 0; i < fileArray.length; i++) {
        const file = fileArray[i];
        
        toast({
          title: `Analyzing PDF ${i + 1} of ${fileArray.length}`,
          description: file.name,
        });

        try {
          const formData = new FormData();
          formData.append('pdf', file);

          const response = await fetch('/api/expenses/analyze-pdf/expense-receipt', {
            method: 'POST',
            headers,
            body: formData,
            credentials: 'include'
          });

          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `Failed to analyze ${file.name}`);
          }

          const result = await response.json();
          const data = result.data;

          // Store the PDF file reference for page extraction
          if (result.pdfFile) {
            lastPdfFile = result.pdfFile;
            console.log('[Expense Receipt] PDF stored in object storage:', result.pdfFile.objectKey);
          }

          // Handle items from this PDF
          const items = data.items || data.expenses || [];
          
          // Convert date from DD.MM.YYYY to YYYY-MM-DD for HTML date input
          const convertDateToISO = (dateStr: string | undefined): string => {
            if (!dateStr) return '';
            // Try DD.MM.YYYY or DD/MM/YYYY format
            const match = dateStr.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
            if (match) {
              const [, day, month, year] = match;
              return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
            }
            // Try DD.MM.YY format
            const shortMatch = dateStr.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2})$/);
            if (shortMatch) {
              const [, day, month, shortYear] = shortMatch;
              const year = parseInt(shortYear) > 50 ? `19${shortYear}` : `20${shortYear}`;
              return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
            }
            // Already in YYYY-MM-DD format or unknown
            return dateStr;
          };
          
          if (items.length > 0) {
            const processedItems = items.map((item: any, index: number) => ({
              ...item,
              id: `${file.name}-${index}-${Date.now()}`, // Unique ID per file
              selectedCategory: item.suggestedCategory || 'other',
              type: item.type || (taxCategories.includes(item.suggestedCategory) ? 'tax' : 'expense'),
              selected: true,
              sourceFile: file.name, // Track which file this came from
              pageNumber: item.pageNumber || null, // Page number from PDF analysis
              pdfObjectKey: result.pdfFile?.objectKey || null, // Reference to the PDF in storage
              invoiceDate: convertDateToISO(item.invoiceDate) // Convert date format for HTML date input
            }));
            allItems = [...allItems, ...processedItems];
            
            // Accumulate taxes
            if (data.taxes) {
              combinedTaxes.customsTax += data.taxes.customsTax || 0;
              combinedTaxes.additionalCustomsTax += data.taxes.additionalCustomsTax || 0;
              combinedTaxes.kkdf += data.taxes.kkdf || 0;
              combinedTaxes.vat += data.taxes.vat || 0;
              combinedTaxes.stampTax += data.taxes.stampTax || 0;
            }
            
            successCount++;
          }
        } catch (fileError: any) {
          console.error(`Error processing ${file.name}:`, fileError);
          errorMessages.push(`${file.name}: ${fileError.message}`);
        }
      }
      
      // Store the last uploaded PDF file reference
      if (lastPdfFile) {
        setUploadedPdfFile(lastPdfFile);
      }

      // Set combined results
      if (allItems.length > 0) {
        setRecognizedItems(allItems);
        setRecognizedTaxes(combinedTaxes);
        
        const taxCount = allItems.filter((i: RecognizedItem) => i.type === 'tax').length;
        const expenseCount = allItems.filter((i: RecognizedItem) => i.type === 'expense').length;
        const serviceInvoiceCount = allItems.filter((i: RecognizedItem) => i.type === 'service_invoice').length;
        
        const parts = [];
        if (taxCount > 0) parts.push(`${taxCount} tax(es)`);
        if (expenseCount > 0) parts.push(`${expenseCount} expense(s)`);
        if (serviceInvoiceCount > 0) parts.push(`${serviceInvoiceCount} service invoice(s)`);
        
        toast({
          title: `Analyzed ${successCount} PDF(s)`,
          description: `Found ${parts.join(', ')} total. Please review and categorize.`,
        });
      } else {
        toast({
          title: "No items found",
          description: "Could not find any taxes or expenses in the uploaded documents.",
          variant: "destructive",
        });
      }

      if (errorMessages.length > 0) {
        setExpenseReceiptError(`Some files had errors:\n${errorMessages.join('\n')}`);
      }
    } catch (error: any) {
      console.error('Expense Receipt PDF analysis error:', error);
      setExpenseReceiptError(error.message || 'Failed to analyze PDFs - please try again');
      toast({
        title: "Analysis failed",
        description: error.message || 'Failed to analyze expense receipts',
        variant: "destructive",
      });
    } finally {
      setIsAnalyzingExpenseReceipt(false);
    }
  };

  // Update category for a recognized item
  const updateRecognizedItemCategory = (itemId: string, category: string) => {
    const isTaxCategory = taxCategories.includes(category);
    const isServiceInvoice = category === 'service_invoice';
    setRecognizedItems(prev => prev.map(item => 
      item.id === itemId ? { 
        ...item, 
        selectedCategory: category,
        type: isServiceInvoice ? 'service_invoice' : (isTaxCategory ? 'tax' : 'expense')
      } : item
    ));
  };

  // Toggle item selection
  const toggleItemSelection = (itemId: string) => {
    setRecognizedItems(prev => prev.map(item => 
      item.id === itemId ? { ...item, selected: !item.selected } : item
    ));
  };

  // Update invoice fields for a recognized item
  const updateRecognizedItemField = (itemId: string, field: 'invoiceNumber' | 'invoiceDate' | 'issuer' | 'pageNumber' | 'receiptNumber', value: string | number) => {
    setRecognizedItems(prev => prev.map(item => 
      item.id === itemId ? { ...item, [field]: value } : item
    ));
  };

  // Analyze a single page to add missing expense
  const handleAnalyzeMissingPage = async () => {
    if (!uploadedPdfFile?.objectKey || !addMissingPageNumber) return;
    
    setIsAnalyzingMissingPage(true);
    
    const authToken = localStorage.getItem('authToken');
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }
    
    try {
      const response = await fetch('/api/expenses/analyze-pdf/single-page', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          objectKey: uploadedPdfFile.objectKey,
          pageNumber: addMissingPageNumber
        }),
        credentials: 'include'
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to analyze page');
      }
      
      const result = await response.json();
      
      if (result.data?.items && result.data.items.length > 0) {
        // Convert date format for HTML date input
        const convertDateToISO = (dateStr: string | undefined): string => {
          if (!dateStr) return '';
          const match = dateStr.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
          if (match) {
            const [, day, month, year] = match;
            return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
          }
          const shortMatch = dateStr.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2})$/);
          if (shortMatch) {
            const [, day, month, shortYear] = shortMatch;
            const year = parseInt(shortYear) > 50 ? `19${shortYear}` : `20${shortYear}`;
            return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
          }
          return dateStr;
        };
        
        const newItems = result.data.items.map((item: any, index: number) => ({
          ...item,
          id: `missing-page-${addMissingPageNumber}-${index}-${Date.now()}`,
          selectedCategory: item.suggestedCategory || 'other',
          type: item.type || (taxCategories.includes(item.suggestedCategory) ? 'tax' : 'expense'),
          selected: true,
          sourceFile: uploadedPdfFile.originalFilename,
          pageNumber: addMissingPageNumber,
          pdfObjectKey: uploadedPdfFile.objectKey,
          invoiceDate: convertDateToISO(item.invoiceDate)
        }));
        
        setRecognizedItems(prev => [...prev, ...newItems]);
        
        toast({
          title: `Found ${newItems.length} item(s)`,
          description: `Added ${newItems.length} expense(s) from page ${addMissingPageNumber}`,
        });
      } else {
        toast({
          title: "No items found",
          description: `Could not find any expenses on page ${addMissingPageNumber}`,
          variant: "destructive",
        });
      }
    } catch (error: any) {
      console.error('Single page analysis error:', error);
      toast({
        title: "Analysis failed",
        description: error.message || 'Failed to analyze page',
        variant: "destructive",
      });
    } finally {
      setIsAnalyzingMissingPage(false);
    }
  };

  // Format category name including tax categories
  const formatAllCategoryName = (category: string): string => {
    const categoryNames: Record<string, string> = {
      customs_tax: 'Customs Tax (Gümrük Vergisi)',
      additional_customs_tax: 'Additional Customs Tax',
      kkdf: 'KKDF',
      vat: 'VAT (KDV)',
      stamp_tax: 'Stamp Tax (Damga Vergisi)',
      export_registry_fee: 'Export Registry Fee',
      insurance: 'Insurance',
      awb_fee: 'AWB Fee',
      airport_storage_fee: 'Airport Storage Fee',
      bonded_warehouse_storage_fee: 'Bonded Warehouse Storage',
      transportation: 'Transportation',
      international_transportation: 'International Transportation',
      tareks_fee: 'TAREKS Fee',
      customs_inspection: 'Customs Inspection',
      azo_test: 'AZO Test',
      service_invoice: 'Service Invoice',
      other: 'Other'
    };
    return categoryNames[category] || formatCategoryName(category);
  };

  // Add selected items (both taxes and expenses) from the modal
  const addSelectedItems = async () => {
    if (!procedure) {
      toast({
        title: "Error",
        description: "Please select a procedure first",
        variant: "destructive",
      });
      return;
    }

    const selectedItems = recognizedItems.filter(item => item.selected);
    
    if (selectedItems.length === 0) {
      toast({
        title: "No items selected",
        description: "Please select at least one item to add",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    let taxSuccess = false;
    let expenseSuccessCount = 0;
    let errorCount = 0;

    // Group taxes and expenses
    const taxItems = selectedItems.filter(item => item.type === 'tax');
    const expenseItems = selectedItems.filter(item => item.type === 'expense');

    // Handle taxes - update the tax form with recognized values
    if (taxItems.length > 0) {
      try {
        // Start with existing tax values if they exist (for cumulative calculation)
        const existingCustomsTax = taxData ? parseFloat(taxData.customsTax || "0") : 0;
        const existingAdditionalCustomsTax = taxData ? parseFloat(taxData.additionalCustomsTax || "0") : 0;
        const existingKkdf = taxData ? parseFloat(taxData.kkdf || "0") : 0;
        const existingVat = taxData ? parseFloat(taxData.vat || "0") : 0;
        const existingStampTax = taxData ? parseFloat(taxData.stampTax || "0") : 0;

        const taxAmounts: Record<string, number> = {
          customsTax: existingCustomsTax,
          additionalCustomsTax: existingAdditionalCustomsTax,
          kkdf: existingKkdf,
          vat: existingVat,
          stampTax: existingStampTax
        };

        // Add new tax values from uploaded receipt
        taxItems.forEach(item => {
          switch (item.selectedCategory) {
            case 'customs_tax':
              taxAmounts.customsTax += item.amount;
              break;
            case 'additional_customs_tax':
              taxAmounts.additionalCustomsTax += item.amount;
              break;
            case 'kkdf':
              taxAmounts.kkdf += item.amount;
              break;
            case 'vat':
              taxAmounts.vat += item.amount;
              break;
            case 'stamp_tax':
              taxAmounts.stampTax += item.amount;
              break;
          }
        });

        // Save cumulative taxes to database
        const taxPayload = {
          procedureReference: procedure.reference,
          customsTax: String(taxAmounts.customsTax),
          additionalCustomsTax: String(taxAmounts.additionalCustomsTax),
          kkdf: String(taxAmounts.kkdf),
          vat: String(taxAmounts.vat),
          stampTax: String(taxAmounts.stampTax)
        };

        // Check if tax record exists (taxData is the component state holding existing tax)
        if (taxData && taxData.id) {
          // Update existing tax record with cumulative values
          await apiRequest("PUT", `/api/taxes/${taxData.id}`, taxPayload);
        } else {
          // Create new tax record
          await apiRequest("POST", '/api/taxes', taxPayload);
        }
        taxSuccess = true;
        
        // Update the tax form with the cumulative values
        taxForm.setValue('customsTax', String(taxAmounts.customsTax));
        taxForm.setValue('additionalCustomsTax', String(taxAmounts.additionalCustomsTax));
        taxForm.setValue('kkdf', String(taxAmounts.kkdf));
        taxForm.setValue('vat', String(taxAmounts.vat));
        taxForm.setValue('stampTax', String(taxAmounts.stampTax));
      } catch (error) {
        console.error("Error saving taxes:", error);
        errorCount++;
      }
    }

    // Handle expenses - save each one individually and attach PDF pages
    let documentsAttached = 0;
    for (const expense of expenseItems) {
      try {
        const cleanedData = {
          procedureReference: procedure.reference,
          amount: String(expense.amount || "0"),
          currency: expense.currency || "TRY",
          category: expense.selectedCategory,
          invoiceNumber: expense.invoiceNumber || null,
          invoiceDate: expense.invoiceDate || null,
          documentNumber: expense.receiptNumber || null,
          policyNumber: null,
          issuer: expense.issuer || null,
          notes: expense.description || null,
        };

        const response = await apiRequest("POST", '/api/import-expenses', cleanedData);
        const responseData = await response.json();
        expenseSuccessCount++;

        // If this expense has a page number and PDF object key, extract and attach the page
        if (expense.pageNumber && expense.pdfObjectKey && responseData.expense?.id) {
          try {
            console.log(`[PDF Attach] Extracting page ${expense.pageNumber} for expense ${responseData.expense.id}`);
            const extractResponse = await fetch('/api/expense-documents/extract-page', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                sourceObjectKey: expense.pdfObjectKey,
                pageNumber: expense.pageNumber,
                procedureReference: procedure.reference,
                expenseType: 'import_expense',
                expenseId: responseData.expense.id
              }),
              credentials: 'include'
            });

            if (extractResponse.ok) {
              documentsAttached++;
              console.log(`[PDF Attach] Successfully attached page ${expense.pageNumber} to expense ${responseData.expense.id}`);
            } else {
              console.error(`[PDF Attach] Failed to extract page:`, await extractResponse.text());
            }
          } catch (attachError) {
            console.error('[PDF Attach] Error attaching page:', attachError);
          }
        }
      } catch (error) {
        console.error("Error saving expense:", error);
        errorCount++;
      }
    }

    // Handle service invoices - save each one individually and attach PDF pages
    const serviceInvoiceItems = selectedItems.filter(item => item.type === 'service_invoice');
    let serviceInvoiceSuccessCount = 0;
    
    for (const serviceInvoice of serviceInvoiceItems) {
      try {
        const cleanedData = {
          procedureReference: procedure.reference,
          amount: String(serviceInvoice.amount || "0"),
          currency: serviceInvoice.currency || "TRY",
          invoiceNumber: serviceInvoice.invoiceNumber || null,
          date: serviceInvoice.invoiceDate || null,
          notes: serviceInvoice.description || null,
        };

        const response = await apiRequest("POST", '/api/service-invoices', cleanedData);
        const responseData = await response.json();
        serviceInvoiceSuccessCount++;

        // If this service invoice has a page number and PDF object key, extract and attach the page
        if (serviceInvoice.pageNumber && serviceInvoice.pdfObjectKey && responseData.invoice?.id) {
          try {
            console.log(`[PDF Attach] Extracting page ${serviceInvoice.pageNumber} for service invoice ${responseData.invoice.id}`);
            const extractResponse = await fetch('/api/expense-documents/extract-page', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                sourceObjectKey: serviceInvoice.pdfObjectKey,
                pageNumber: serviceInvoice.pageNumber,
                procedureReference: procedure.reference,
                expenseType: 'service_invoice',
                expenseId: responseData.invoice.id
              }),
              credentials: 'include'
            });

            if (extractResponse.ok) {
              documentsAttached++;
              console.log(`[PDF Attach] Successfully attached page ${serviceInvoice.pageNumber} to service invoice ${responseData.invoice.id}`);
            } else {
              console.error(`[PDF Attach] Failed to extract page:`, await extractResponse.text());
            }
          } catch (attachError) {
            console.error('[PDF Attach] Error attaching page:', attachError);
          }
        }
      } catch (error) {
        console.error("Error saving service invoice:", error);
        errorCount++;
      }
    }

    // Show result messages
    const messages: string[] = [];
    if (taxSuccess) messages.push('Taxes saved');
    if (expenseSuccessCount > 0) messages.push(`${expenseSuccessCount} expense(s) added`);
    if (serviceInvoiceSuccessCount > 0) messages.push(`${serviceInvoiceSuccessCount} service invoice(s) added`);
    if (documentsAttached > 0) messages.push(`${documentsAttached} document(s) attached`);
    if (errorCount > 0) messages.push(`${errorCount} failed`);

    if (taxSuccess || expenseSuccessCount > 0 || serviceInvoiceSuccessCount > 0) {
      toast({
        title: "Items saved",
        description: messages.join(', '),
      });
      await loadProcedureData(procedure.reference);
    }

    if (errorCount > 0 && !taxSuccess && expenseSuccessCount === 0 && serviceInvoiceSuccessCount === 0) {
      toast({
        title: "Error",
        description: "Failed to save items",
        variant: "destructive",
      });
    }

    setIsSubmitting(false);
    setIsExpenseReceiptModalOpen(false);
    setRecognizedItems([]);
    setRecognizedTaxes(null);
    setUploadedPdfFile(null);
  };
  
  // Handle shipment details form submission
  const onShipmentSubmit = async (data: any) => {
    if (!procedure) {
      toast({
        title: "Error",
        description: "No procedure selected",
        variant: "destructive",
      });
      return;
    }

    setIsSubmittingShipment(true);

    try {
      // Update procedure with new shipment details
      const updatePayload = {
        shipper: data.shipper,
        package: data.package.toString(),
        kg: data.weight.toString(),
        piece: data.pieces,
        awb_number: data.awbNumber,
        customs: data.customs,
        import_dec_number: data.importDeclarationNumber,
        import_dec_date: data.importDeclarationDate,
        usdtl_rate: data.usdTlRate.toString(),
      };

      const response = await apiRequest("PUT", `/api/procedures/${procedure.reference}`, updatePayload);

      if (!response.ok) {
        throw new Error('Failed to update shipment details');
      }

      // Refresh the procedure data
      await searchProcedureByReference(procedure.reference);

      // Reset the flag so future procedure loads work normally
      setIsShipmentFormManuallyEdited(false);

      toast({
        title: "Success",
        description: "Shipment details updated successfully",
      });

    } catch (error: any) {
      console.error('Error updating shipment details:', error);
      toast({
        title: "Error",
        description: error.message || 'Failed to update shipment details',
        variant: "destructive",
      });
    } finally {
      setIsSubmittingShipment(false);
    }
  };

  // Fetch all procedures on component mount
  useEffect(() => {
    async function fetchProcedures() {
      try {
        const timestamp = Date.now();
        const response = await apiRequest("GET", `/api/procedures?_=${timestamp}`);
        const responseData = await response.json();
        setProcedures(responseData.procedures || []);
      } catch (error) {
        console.error("Error fetching procedures:", error);
        showToast({
          title: "Error",
          description: "Failed to fetch procedures list",
          variant: "destructive",
        });
      }
    }
    
    fetchProcedures();
  }, []);
  
  // Check URL parameters for procedure reference and automatically load it
  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const referenceFromUrl = searchParams.get('reference');
    
    if (referenceFromUrl && procedures.length > 0) {
      // Set the form value
      shipmentForm.setValue('reference', referenceFromUrl);
      
      // Search for the procedure
      searchProcedureByReference(referenceFromUrl);
    }
  }, [procedures, shipmentForm]); // searchProcedureByReference is defined outside useEffect and doesn't need to be in deps
  
  // Handle procedure selection from dropdown
  const handleProcedureSelect = (reference: string) => {
    // Reset flag when user manually selects a new procedure
    setIsShipmentFormManuallyEdited(false);
    searchProcedureByReference(reference);
  };
  
  // Initialize shipment details edit form with procedure data
  // Only reset form if it hasn't been manually edited (e.g., via PDF upload)
  useEffect(() => {
    if (procedure && !isShipmentFormManuallyEdited) {
      shipmentDetailsEditForm.reset({
        shipper: procedure.shipper || '',
        package: parseInt(procedure.package) || 0,
        weight: parseFloat(procedure.kg) || 0,
        pieces: procedure.piece || 0,
        awbNumber: procedure.awb_number || '',
        customs: procedure.customs || '',
        importDeclarationNumber: procedure.import_dec_number || '',
        importDeclarationDate: procedure.import_dec_date || '',
        usdTlRate: parseFloat(procedure.usdtl_rate) || 0,
      });
    }
  }, [procedure, shipmentDetailsEditForm, isShipmentFormManuallyEdited]);

  // Handle service invoice form submission
  const onSubmitServiceInvoiceForm = async (data: any) => {
    if (!procedure) {
      showToast({
        title: "Error",
        description: "No procedure selected",
        variant: "destructive",
      });
      return;
    }
    
    setIsSubmitting(true);
    try {
      // Clean the data before sending to API
      const cleanedData = {
        ...data,
        procedureReference: procedure.reference,
        amount: String(data.amount || ""),
        currency: String(data.currency || "TRY"),
        invoiceNumber: data.invoiceNumber ? String(data.invoiceNumber) : null,
        date: data.date || null,
        notes: data.notes ? String(data.notes) : null,
      };
      
      console.log('Sending service invoice to API:', cleanedData);
      const response = await apiRequest("POST", '/api/service-invoices', cleanedData);
      const responseData = await response.json();
      
      // Add to current invoices list with the ID from database
      const newInvoice: ServiceInvoice = {
        ...responseData.invoice || responseData,
      };
      
      setServiceInvoices(prev => [...prev, newInvoice]);
      
      // Auto-attach the analyzed PDF if available
      const invoiceId = responseData.invoice?.id || responseData.id;
      if (analyzedServicePdf && invoiceId) {
        try {
          console.log('[Auto-attach] Attaching PDF to service invoice:', {
            invoiceId,
            pdfObjectKey: analyzedServicePdf.objectKey
          });
          
          const attachResponse = await fetch('/api/expense-documents/attach', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              procedureReference: procedure.reference,
              expenseType: 'service_invoice',
              expenseId: invoiceId,
              objectKey: analyzedServicePdf.objectKey,
              originalFilename: analyzedServicePdf.originalFilename,
              fileSize: analyzedServicePdf.fileSize,
              fileType: analyzedServicePdf.fileType
            }),
            credentials: 'include'
          });
          
          if (attachResponse.ok) {
            console.log('[Auto-attach] Service invoice PDF attached successfully');
            showToast({
              title: "Document attached",
              description: "The analyzed PDF has been automatically attached to the invoice",
            });
          } else {
            console.error('[Auto-attach] Failed to attach PDF:', await attachResponse.text());
          }
          
          // Clear the analyzed PDF reference
          setAnalyzedServicePdf(null);
        } catch (attachError) {
          console.error('[Auto-attach] Error attaching PDF to service invoice:', attachError);
        }
      }
      
      // Reset form
      serviceInvoiceForm.reset({
        amount: "",
        currency: "TRY",
        invoiceNumber: "",
        date: "",
        notes: "",
      });
      
      showToast({
        title: "Invoice added",
        description: analyzedServicePdf ? "Invoice saved with attached PDF" : "Service invoice saved successfully",
      });
      
      // Reload procedure data to ensure UI is in sync
      await loadProcedureData(procedure.reference);
    } catch (error) {
      console.error("Error saving service invoice:", error);
      showToast({
        title: "Error",
        description: "Failed to save service invoice to database",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };
  
  // Remove an expense from the list
  const removeExpense = async (index: number) => {
    console.log('Delete clicked for expense:', index, importExpenses[index]);
    const expense = importExpenses[index];
    
    // If the expense has an ID, it's saved in the database and needs to be deleted
    if (expense.id) {
      try {
        await apiRequest("DELETE", `/api/import-expenses/${expense.id}`);
        showToast({
          title: "Expense deleted",
          description: "Expense deleted successfully from the database",
        });
      } catch (error) {
        console.error("Error deleting expense:", error);
        showToast({
          title: "Error",
          description: "Failed to delete expense from the database",
          variant: "destructive",
        });
        return; // Don't remove from UI if database delete failed
      }
    }
    
    // Remove from UI array
    setImportExpenses(prev => prev.filter((_, i) => i !== index));
    showToast({
      title: "Expense removed",
      description: "Expense removed from the list",
    });
    
    // Reload procedure data to ensure UI is in sync with database
    if (procedure?.reference) {
      loadProcedureData(procedure.reference);
    }
  };
  
  // Start editing an expense
  const startEditExpense = (index: number) => {
    const expense = importExpenses[index];
    setEditingExpenseIndex(index);
    
    // Format date for HTML input (YYYY-MM-DD)
    const formatDateForInput = (dateValue: any) => {
      if (!dateValue) return "";
      const date = new Date(dateValue);
      return date.toISOString().split('T')[0]; // Gets YYYY-MM-DD format
    };
    
    // Populate the form with the expense data
    importExpenseForm.reset({
      category: expense.category,
      amount: expense.amount,
      currency: expense.currency,
      invoiceNumber: expense.invoiceNumber || "",
      invoiceDate: formatDateForInput(expense.invoiceDate),
      documentNumber: expense.documentNumber || "",
      policyNumber: expense.policyNumber || "",
      issuer: expense.issuer || "",
      notes: expense.notes || "",
    });
  };
  
  // Cancel editing
  const cancelEditExpense = () => {
    setEditingExpenseIndex(null);
    importExpenseForm.reset({
      category: "",
      amount: "",
      currency: "TRY",
      invoiceNumber: "",
      invoiceDate: "",
      documentNumber: "",
      policyNumber: "",
      issuer: "",
      notes: "",
    });
  };
  
  // Update an expense
  const updateExpense = async (data: any) => {
    if (editingExpenseIndex === null) return;
    
    const expense = importExpenses[editingExpenseIndex];
    
    // Clean the data before sending to API (same format as when adding new expense)
    const cleanedData = {
      procedureReference: procedure?.reference || "",
      // Ensure all values are strings or proper types
      amount: String(data.amount || ""),
      currency: String(data.currency || "TRY"),
      category: String(data.category || ""),
      invoiceNumber: data.invoiceNumber ? String(data.invoiceNumber) : null,
      invoiceDate: data.invoiceDate || null, // Keep as YYYY-MM-DD string to avoid timezone issues
      documentNumber: data.documentNumber ? String(data.documentNumber) : null,
      policyNumber: data.policyNumber ? String(data.policyNumber) : null,
      issuer: data.issuer ? String(data.issuer) : null,
      notes: data.notes ? String(data.notes) : null,
    };
    
    try {
      if (expense.id) {
        // Update in database
        await apiRequest("PUT", `/api/import-expenses/${expense.id}`, cleanedData);
        showToast({
          title: "Expense updated",
          description: "Expense updated successfully in the database",
        });
      }
      
      // Update in UI with the cleaned data
      const updatedExpenseForUI = {
        ...expense,
        ...cleanedData,
        invoiceDate: data.invoiceDate || expense.invoiceDate,
      };
      
      setImportExpenses(prev => 
        prev.map((exp, index) => 
          index === editingExpenseIndex ? updatedExpenseForUI : exp
        )
      );
      
      // Reset edit state
      setEditingExpenseIndex(null);
      importExpenseForm.reset({
        category: "",
        amount: "",
        currency: "TRY",
        invoiceNumber: "",
        invoiceDate: "",
        documentNumber: "",
        policyNumber: "",
        issuer: "",
        notes: "",
      });
      
      // Reload procedure data to ensure UI is in sync with database
      if (procedure?.reference) {
        loadProcedureData(procedure.reference);
      }
      
    } catch (error) {
      console.error("Error updating expense:", error);
      showToast({
        title: "Error",
        description: "Failed to update expense",
        variant: "destructive",
      });
    }
  };
  
  // Remove a service invoice from the list
  const removeServiceInvoice = async (index: number) => {
    console.log('Delete clicked for service invoice:', index, serviceInvoices[index]);
    const invoice = serviceInvoices[index];
    
    // If the invoice has an ID, it's saved in the database and needs to be deleted
    if (invoice.id) {
      try {
        await apiRequest("DELETE", `/api/service-invoices/${invoice.id}`);
        showToast({
          title: "Invoice deleted",
          description: "Service invoice deleted successfully from the database",
        });
      } catch (error) {
        console.error("Error deleting service invoice:", error);
        showToast({
          title: "Error",
          description: "Failed to delete service invoice from the database",
          variant: "destructive",
        });
        return; // Don't remove from UI if database delete failed
      }
    }
    
    // Remove from UI array
    setServiceInvoices(prev => prev.filter((_, i) => i !== index));
    showToast({
      title: "Invoice removed",
      description: "Service invoice removed from the list",
    });
    
    // Reload procedure data to ensure UI is in sync with database
    if (procedure?.reference) {
      loadProcedureData(procedure.reference);
    }
  };
  

  
  // Reset all forms and data
  const resetAll = () => {
    setIsConfirmDialogOpen(true);
  };
  
  const confirmReset = () => {
    setProcedure(null);
    setTaxData(null);
    setImportExpenses([]);
    setServiceInvoices([]);
    setIsReadOnly(false);
    
    // Reset selected items for document upload
    setSelectedTax(null);
    setSelectedExpense(null);
    setSelectedServiceInvoice(null);
    
    // Reset all forms
    shipmentForm.reset({
      reference: "",
    });
    
    taxForm.reset({
      customsTax: "0",
      additionalCustomsTax: "0",
      kkdf: "0",
      vat: "0",
      stampTax: "0",
    });
    
    importExpenseForm.reset({
      category: "",
      amount: "",
      currency: "TRY",
      invoiceNumber: "",
      invoiceDate: "",
      documentNumber: "",
      policyNumber: "",
      issuer: "",
      notes: "",
    });
    
    serviceInvoiceForm.reset({
      amount: "",
      currency: "TRY",
      invoiceNumber: "",
      date: "",
      notes: "",
    });
    
    setIsConfirmDialogOpen(false);
    
    showToast({
      title: "Reset complete",
      description: "All forms have been reset",
    });
  };
  
  // Get required fields for the current category
  const getCurrentCategoryRequiredFields = () => {
    const category = importExpenseForm.watch("category");
    return category ? categoryRequiredFields[category as keyof typeof categoryRequiredFields] || [] : [];
  };
  
  // Compute total amounts by expense type
  const computeTotals = () => {
    // Tax total
    const taxTotal = taxData ? 
      parseFloat(taxData.customsTax || "0") + 
      parseFloat(taxData.additionalCustomsTax || "0") + 
      parseFloat(taxData.kkdf || "0") + 
      parseFloat(taxData.vat || "0") + 
      parseFloat(taxData.stampTax || "0") : 0;
    
    // Import expenses total
    const importExpenseTotal = importExpenses.reduce((sum, expense) => {
      return sum + parseFloat(expense.amount || "0");
    }, 0);
    
    // Service invoices total
    const serviceInvoiceTotal = serviceInvoices.reduce((sum, invoice) => {
      return sum + parseFloat(invoice.amount || "0");
    }, 0);
    
    // Overall total
    const overallTotal = taxTotal + importExpenseTotal + serviceInvoiceTotal;
    
    return {
      taxTotal,
      importExpenseTotal,
      serviceInvoiceTotal,
      overallTotal
    };
  };
  
  const totals = computeTotals();
  
  return (
    <PageLayout title="Expense Entry" navItems={items}>
      <div className="container mx-auto p-6">
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Shipment Details</CardTitle>
            <CardDescription>
              Select a procedure from the dropdown or enter a reference number to load the shipment details
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-4 items-end mb-4">
              <div className="flex-1">
                <Label htmlFor="procedure-select">Select Procedure</Label>
                <Select
                  onValueChange={handleProcedureSelect}
                  disabled={isReadOnly || isLoadingProcedure}
                >
                  <SelectTrigger id="procedure-select" className="w-full">
                    <SelectValue placeholder="Choose a procedure" />
                  </SelectTrigger>
                  <SelectContent>
                    {procedures.map((proc) => (
                      <SelectItem key={proc.id} value={proc.reference}>
                        {proc.reference} - {proc.shipper}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            
            <div className="flex items-center mb-2">
              <div className="flex-grow border-t border-gray-300"></div>
              <span className="px-3 text-gray-500 text-sm">OR</span>
              <div className="flex-grow border-t border-gray-300"></div>
            </div>
            
            <form onSubmit={shipmentForm.handleSubmit(onSubmitShipmentForm)} className="flex gap-4 items-end">
              <div className="flex-1">
                <Label htmlFor="reference">Reference Number</Label>
                <Input
                  id="reference"
                  {...shipmentForm.register("reference")}
                  disabled={isReadOnly || isLoadingProcedure}
                  placeholder="Enter shipment reference"
                />
                {shipmentForm.formState.errors.reference && (
                  <p className="text-sm text-red-500 mt-1">
                    {shipmentForm.formState.errors.reference.message}
                  </p>
                )}
              </div>
              <Button type="submit" disabled={isReadOnly || isLoadingProcedure}>
                {isLoadingProcedure ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  "Search"
                )}
              </Button>
              {isReadOnly && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsReadOnly(false)}
                >
                  Edit
                </Button>
              )}
            </form>
          </CardContent>
          
          {procedure && (
            <>
              <CardContent className="border-t pt-6">
                {/* Read-only Procedure Info */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                  <div>
                    <Label>Invoice Number</Label>
                    <Input value={procedure.invoice_no || ""} readOnly />
                  </div>
                  <div>
                    <Label>Invoice Date</Label>
                    <Input value={formatDate(procedure.invoice_date)} readOnly />
                  </div>
                  <div>
                    <Label>Amount</Label>
                    <Input value={formatCurrency(procedure.amount, procedure.currency)} readOnly />
                  </div>
                  <div>
                    <Label>Arrival Date</Label>
                    <Input value={formatDate(procedure.arrival_date)} readOnly />
                  </div>
                </div>

                {/* Editable Shipment Details Form */}
                <Form {...shipmentDetailsEditForm}>
                  <form onSubmit={shipmentDetailsEditForm.handleSubmit(onShipmentSubmit)} className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <FormField
                        control={shipmentDetailsEditForm.control}
                        name="shipper"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Shipper/Exporter</FormLabel>
                            <FormControl>
                              <Input {...field} placeholder="ALO HONG KONG LTD" data-testid="input-shipper" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={shipmentDetailsEditForm.control}
                        name="package"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Package (Koli)</FormLabel>
                            <FormControl>
                              <Input 
                                type="number" 
                                placeholder="Enter package count (Kap Adedi)"
                                {...field}
                                onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                                data-testid="input-package"
                              />
                            </FormControl>
                            <FormDescription>
                              From "6 Kap Adedi" box on customs declaration
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={shipmentDetailsEditForm.control}
                        name="weight"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Weight (KG)</FormLabel>
                            <FormControl>
                              <Input 
                                type="number" 
                                step="0.01"
                                {...field}
                                onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                                data-testid="input-weight"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={shipmentDetailsEditForm.control}
                        name="pieces"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Pieces (Adet)</FormLabel>
                            <FormControl>
                              <Input 
                                type="number" 
                                {...field}
                                onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                                data-testid="input-pieces"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={shipmentDetailsEditForm.control}
                        name="awbNumber"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>AWB Number</FormLabel>
                            <FormControl>
                              <Input {...field} placeholder="235-12345678" data-testid="input-awb-number" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={shipmentDetailsEditForm.control}
                        name="customs"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Customs Office</FormLabel>
                            <FormControl>
                              <Input {...field} placeholder="İstanbul Havalimanı Gümrüğü" data-testid="input-customs" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={shipmentDetailsEditForm.control}
                        name="importDeclarationNumber"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Import Declaration Number</FormLabel>
                            <FormControl>
                              <Input {...field} placeholder="25341453IM00684473" data-testid="input-import-declaration-number" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={shipmentDetailsEditForm.control}
                        name="importDeclarationDate"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Import Declaration Date</FormLabel>
                            <FormControl>
                              <Input type="date" {...field} data-testid="input-import-declaration-date" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={shipmentDetailsEditForm.control}
                        name="usdTlRate"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>USD/TL Exchange Rate</FormLabel>
                            <FormControl>
                              <Input 
                                type="number" 
                                step="0.0001"
                                placeholder="34.5678"
                                {...field}
                                onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                                data-testid="input-usd-tl-rate"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <Button type="submit" disabled={isSubmittingShipment} data-testid="button-save-shipment">
                      {isSubmittingShipment ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Saving...
                        </>
                      ) : (
                        'Save Shipment Details'
                      )}
                    </Button>
                  </form>
                </Form>
              </CardContent>
            </>
          )}
        </Card>

        {/* Unified Upload Section for All Expenses */}
        {procedure && (
          <Card className="mb-6 border-2 border-dashed border-green-300 bg-green-50/30">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-green-700">
                <Upload className="h-5 w-5" />
                Upload Expense Documents
              </CardTitle>
              <CardDescription>
                Upload expense receipts and service invoices. Multiple PDFs can be selected at once.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                variant="outline"
                className="w-full h-20 border-green-400 text-green-700 hover:bg-green-100"
                onClick={() => setIsExpenseReceiptModalOpen(true)}
                data-testid="button-upload-all-expenses"
              >
                <div className="flex flex-col items-center gap-1">
                  <FileText className="h-8 w-8" />
                  <span>Click to Upload PDFs (Expense Receipts & Service Invoices)</span>
                </div>
              </Button>
            </CardContent>
          </Card>
        )}
        
        {procedure && (
          <>
            <Tabs value={activeTab} onValueChange={setActiveTab} className="mb-6">
              <TabsList className="grid grid-cols-3">
                <TabsTrigger value="tax">Tax</TabsTrigger>
                <TabsTrigger value="importExpense">Import Expenses</TabsTrigger>
                <TabsTrigger value="serviceInvoice">Service Invoices</TabsTrigger>
              </TabsList>
              
              <TabsContent value="tax">

                {taxDeclarationInfo && (
                  <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                    <p className="text-sm text-blue-800">
                      <strong>Declaration Info:</strong> {taxDeclarationInfo}
                    </p>
                  </div>
                )}

                <Card>
                  <CardHeader>
                    <CardTitle>Tax Information</CardTitle>
                    <CardDescription>
                      Enter tax information for this shipment
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <form
                      id="taxForm"
                      onSubmit={taxForm.handleSubmit(onSubmitTaxForm)}
                      className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
                    >
                      <div>
                        <Label htmlFor="customsTax">Customs Tax</Label>
                        <Input
                          id="customsTax"
                          type="number"
                          step="0.01"
                          {...taxForm.register("customsTax")}
                          placeholder="0.00"
                        />
                      </div>
                      <div>
                        <Label htmlFor="additionalCustomsTax">Additional Customs Tax</Label>
                        <Input
                          id="additionalCustomsTax"
                          type="number"
                          step="0.01"
                          {...taxForm.register("additionalCustomsTax")}
                          placeholder="0.00"
                        />
                      </div>
                      <div>
                        <Label htmlFor="kkdf">KKDF</Label>
                        <Input
                          id="kkdf"
                          type="number"
                          step="0.01"
                          {...taxForm.register("kkdf")}
                          placeholder="0.00"
                        />
                      </div>
                      <div>
                        <Label htmlFor="vat">VAT</Label>
                        <Input
                          id="vat"
                          type="number"
                          step="0.01"
                          {...taxForm.register("vat")}
                          placeholder="0.00"
                        />
                      </div>
                      <div>
                        <Label htmlFor="stampTax">Stamp Tax</Label>
                        <Input
                          id="stampTax"
                          type="number"
                          step="0.01"
                          {...taxForm.register("stampTax")}
                          placeholder="0.00"
                        />
                      </div>
                    </form>
                  </CardContent>
                  <CardFooter className="flex justify-between">
                    <div>
                      <span className="text-sm font-semibold">Tax Total: </span>
                      <span>{formatNumber(totals.taxTotal)}</span>
                    </div>
                    <Button
                      type="submit"
                      form="taxForm"
                      disabled={isSubmitting || !taxForm.formState.isDirty}
                    >
                      {isSubmitting ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : taxData?.id ? (
                        "Update Tax Information"
                      ) : (
                        "Save Tax Information"
                      )}
                    </Button>
                  </CardFooter>
                </Card>

                {/* Document upload section for tax */}
                {procedure && taxData?.id && (
                  <div className="mt-6">
                    <ExpenseDocumentUpload
                      procedureReference={procedure.reference}
                      expenseType="tax"
                      expenseId={taxData.id}
                      onUploadComplete={() => {
                        showToast({
                          title: "Document uploaded",
                          description: "Your document has been uploaded successfully"
                        });
                      }}
                    />
                  </div>
                )}
              </TabsContent>
              
              <TabsContent value="importExpense">
                <Card>
                  <CardHeader>
                    <CardTitle>Import Expenses</CardTitle>
                    <CardDescription>
                      Add import-related expenses
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <form
                      id="expenseForm"
                      onSubmit={importExpenseForm.handleSubmit(onSubmitExpenseForm)}
                      className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
                    >
                      <div>
                        <Label htmlFor="category">Expense Category</Label>
                        <Select
                          onValueChange={value => importExpenseForm.setValue("category", value)}
                          value={importExpenseForm.watch("category")}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select expense category" />
                          </SelectTrigger>
                          <SelectContent>
                            {expenseCategories.map(category => (
                              <SelectItem key={category} value={category}>
                                {formatCategoryName(category)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {importExpenseForm.formState.errors.category && (
                          <p className="text-sm text-red-500 mt-1">
                            {importExpenseForm.formState.errors.category.message}
                          </p>
                        )}
                      </div>
                      
                      <div>
                        <Label htmlFor="amount">Amount</Label>
                        <Input
                          id="amount"
                          type="number"
                          step="0.01"
                          {...importExpenseForm.register("amount")}
                          placeholder="0.00"
                        />
                        {importExpenseForm.formState.errors.amount && (
                          <p className="text-sm text-red-500 mt-1">
                            {importExpenseForm.formState.errors.amount.message}
                          </p>
                        )}
                      </div>
                      
                      <div>
                        <Label htmlFor="currency">Currency</Label>
                        <Select
                          onValueChange={value => importExpenseForm.setValue("currency", value)}
                          defaultValue={importExpenseForm.watch("currency")}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select currency" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="TRY">TRY</SelectItem>
                            <SelectItem value="USD">USD</SelectItem>
                            <SelectItem value="EUR">EUR</SelectItem>
                            <SelectItem value="GBP">GBP</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      
                      {(getCurrentCategoryRequiredFields().includes("invoiceNumber") || 
                        !importExpenseForm.watch("category")) && (
                        <div>
                          <Label htmlFor="invoiceNumber">Invoice Number</Label>
                          <Input
                            id="invoiceNumber"
                            {...importExpenseForm.register("invoiceNumber")}
                            placeholder="Invoice number"
                          />
                        </div>
                      )}
                      
                      {(getCurrentCategoryRequiredFields().includes("invoiceDate") || 
                        !importExpenseForm.watch("category")) && (
                        <div>
                          <Label htmlFor="invoiceDate">Invoice Date</Label>
                          <Input
                            id="invoiceDate"
                            type="date"
                            {...importExpenseForm.register("invoiceDate")}
                          />
                        </div>
                      )}
                      
                      {(getCurrentCategoryRequiredFields().includes("documentNumber") || 
                        !importExpenseForm.watch("category")) && (
                        <div>
                          <Label htmlFor="documentNumber">Document Number</Label>
                          <Input
                            id="documentNumber"
                            {...importExpenseForm.register("documentNumber")}
                            placeholder="Document number"
                          />
                        </div>
                      )}
                      
                      {(getCurrentCategoryRequiredFields().includes("policyNumber") || 
                        !importExpenseForm.watch("category")) && (
                        <div>
                          <Label htmlFor="policyNumber">Policy Number</Label>
                          <Input
                            id="policyNumber"
                            {...importExpenseForm.register("policyNumber")}
                            placeholder="Policy number"
                          />
                        </div>
                      )}
                      
                      {(getCurrentCategoryRequiredFields().includes("issuer") || 
                        !importExpenseForm.watch("category")) && (
                        <div>
                          <Label htmlFor="issuer">Issuer</Label>
                          <Input
                            id="issuer"
                            {...importExpenseForm.register("issuer")}
                            placeholder="Issuer name"
                          />
                        </div>
                      )}
                      
                      <div className="md:col-span-2 lg:col-span-3">
                        <Label htmlFor="notes">Notes</Label>
                        <Input
                          id="notes"
                          {...importExpenseForm.register("notes")}
                          placeholder="Additional notes"
                        />
                      </div>
                    </form>
                  </CardContent>
                  <CardFooter className="flex justify-end gap-2">
                    {editingExpenseIndex !== null && (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={cancelEditExpense}
                      >
                        <CloseIcon className="mr-2 h-4 w-4" />
                        Cancel
                      </Button>
                    )}
                    <Button
                      type="submit"
                      form="expenseForm"
                      disabled={!importExpenseForm.watch("category") || !importExpenseForm.watch("amount")}
                    >
                      {editingExpenseIndex !== null ? (
                        <>
                          <Save className="mr-2 h-4 w-4" />
                          Update Expense
                        </>
                      ) : (
                        <>
                          <Plus className="mr-2 h-4 w-4" />
                          Add Expense
                        </>
                      )}
                    </Button>
                  </CardFooter>
                </Card>
                
                {importExpenses.length > 0 && (
                  <Card className="mt-4">
                    <CardHeader>
                      <CardTitle>Import Expenses List</CardTitle>
                      <CardDescription>
                        Added expenses for this shipment
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Category</TableHead>
                            <TableHead>Amount</TableHead>
                            <TableHead>Details</TableHead>
                            <TableHead>Action</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {importExpenses.map((expense, index) => (
                            <TableRow key={expense.id || `new-${index}`}>
                              <TableCell className="font-medium">
                                {formatCategoryName(expense.category)}
                              </TableCell>
                              <TableCell>
                                {formatCurrency(expense.amount, expense.currency)}
                              </TableCell>
                              <TableCell>
                                {expense.invoiceNumber && (
                                  <p>Invoice: {expense.invoiceNumber}</p>
                                )}
                                {expense.documentNumber && (
                                  <p>Document: {expense.documentNumber}</p>
                                )}
                                {expense.policyNumber && (
                                  <p>Policy: {expense.policyNumber}</p>
                                )}
                                {expense.issuer && (
                                  <p>Issuer: {expense.issuer}</p>
                                )}
                              </TableCell>
                              <TableCell>
                                <div className="flex gap-2">
                                  {/* Show Edit button only for admin users */}
                                  {currentUser?.role === 'admin' && (
                                    <TooltipProvider>
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() => startEditExpense(index)}
                                          >
                                            <Edit className="h-4 w-4" />
                                          </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                          <p>Edit expense</p>
                                        </TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
                                  )}
                                  
                                  <TooltipProvider>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          size="sm"
                                          variant="destructive"
                                          onClick={() => removeExpense(index)}
                                        >
                                          <Trash2 className="h-4 w-4" />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        <p>Remove expense</p>
                                      </TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                    <CardFooter className="flex justify-between">
                      <div>
                        <span className="text-sm font-semibold">Import Expenses Total: </span>
                        <span>{formatNumber(totals.importExpenseTotal)}</span>
                      </div>
                    </CardFooter>
                  </Card>
                )}
                
                {/* Document upload for selected import expense */}
                {procedure && importExpenses.length > 0 && importExpenses.some(expense => expense.id) && (
                  <div className="mt-6">
                    <Card>
                      <CardHeader>
                        <CardTitle>Expense Documents</CardTitle>
                        <CardDescription>
                          Select an expense to upload or view documents
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="grid gap-4">
                          <div>
                            <Label htmlFor="selectedExpense">Select Expense</Label>
                            <Select
                              onValueChange={(value) => {
                                const expense = importExpenses.find(e => e.id && e.id.toString() === value);
                                if (expense) {
                                  setSelectedExpense(expense);
                                }
                              }}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Select an expense to manage documents" />
                              </SelectTrigger>
                              <SelectContent>
                                {importExpenses.filter(expense => expense.id).map((expense) => (
                                  <SelectItem key={expense.id} value={expense.id!.toString()}>
                                    {formatCategoryName(expense.category)} - {formatCurrency(expense.amount, expense.currency)}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          
                          {selectedExpense?.id && (
                            <ExpenseDocumentUpload
                              procedureReference={procedure.reference}
                              expenseType="import_expense"
                              expenseId={selectedExpense.id}
                              onUploadComplete={() => {
                                showToast({
                                  title: "Document uploaded",
                                  description: "Your document has been uploaded successfully"
                                });
                              }}
                            />
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                )}
              </TabsContent>
              
              <TabsContent value="serviceInvoice">
                <Card>
                  <CardHeader>
                    <CardTitle>Import Service Invoices</CardTitle>
                    <CardDescription>
                      Add import service invoices
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <form
                      id="serviceInvoiceForm"
                      onSubmit={serviceInvoiceForm.handleSubmit(onSubmitServiceInvoiceForm)}
                      className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
                    >
                      <div>
                        <Label htmlFor="amount">Amount</Label>
                        <Input
                          id="amount"
                          type="number"
                          step="0.01"
                          {...serviceInvoiceForm.register("amount")}
                          placeholder="0.00"
                        />
                        {serviceInvoiceForm.formState.errors.amount && (
                          <p className="text-sm text-red-500 mt-1">
                            {serviceInvoiceForm.formState.errors.amount.message}
                          </p>
                        )}
                      </div>
                      
                      <div>
                        <Label htmlFor="currency">Currency</Label>
                        <Select
                          onValueChange={value => serviceInvoiceForm.setValue("currency", value)}
                          defaultValue={serviceInvoiceForm.watch("currency")}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select currency" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="TRY">TRY</SelectItem>
                            <SelectItem value="USD">USD</SelectItem>
                            <SelectItem value="EUR">EUR</SelectItem>
                            <SelectItem value="GBP">GBP</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      
                      <div>
                        <Label htmlFor="invoiceNumber">Invoice Number</Label>
                        <Input
                          id="invoiceNumber"
                          {...serviceInvoiceForm.register("invoiceNumber")}
                          placeholder="Invoice number"
                        />
                        {serviceInvoiceForm.formState.errors.invoiceNumber && (
                          <p className="text-sm text-red-500 mt-1">
                            {serviceInvoiceForm.formState.errors.invoiceNumber.message}
                          </p>
                        )}
                      </div>
                      
                      <div>
                        <Label htmlFor="date">Date</Label>
                        <Input
                          id="date"
                          type="date"
                          {...serviceInvoiceForm.register("date")}
                        />
                        {serviceInvoiceForm.formState.errors.date && (
                          <p className="text-sm text-red-500 mt-1">
                            {serviceInvoiceForm.formState.errors.date.message}
                          </p>
                        )}
                      </div>
                      
                      <div className="md:col-span-2 lg:col-span-3">
                        <Label htmlFor="notes">Notes</Label>
                        <Input
                          id="notes"
                          {...serviceInvoiceForm.register("notes")}
                          placeholder="Additional notes"
                        />
                      </div>
                    </form>
                  </CardContent>
                  <CardFooter className="flex justify-end">
                    <Button
                      type="submit"
                      form="serviceInvoiceForm"
                      disabled={!serviceInvoiceForm.watch("amount") || !serviceInvoiceForm.watch("invoiceNumber") || !serviceInvoiceForm.watch("date")}
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      Add Invoice
                    </Button>
                  </CardFooter>
                </Card>
                
                {serviceInvoices.length > 0 && (
                  <div>
                    <Card className="mt-4">
                      <CardHeader>
                        <CardTitle>Service Invoices List</CardTitle>
                        <CardDescription>
                          Added service invoices for this shipment
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Invoice Number</TableHead>
                              <TableHead>Date</TableHead>
                              <TableHead>Amount</TableHead>
                              <TableHead>Notes</TableHead>
                              <TableHead>Action</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {serviceInvoices.map((invoice, index) => (
                              <TableRow key={invoice.id || `new-${index}`}>
                                <TableCell className="font-medium">
                                  {invoice.invoiceNumber}
                                </TableCell>
                                <TableCell>
                                  {formatDate(invoice.date)}
                                </TableCell>
                                <TableCell>
                                  {formatCurrency(invoice.amount, invoice.currency)}
                                </TableCell>
                                <TableCell>{invoice.notes || "-"}</TableCell>
                                <TableCell>
                                  <TooltipProvider>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          size="sm"
                                          variant="destructive"
                                          onClick={() => removeServiceInvoice(index)}
                                        >
                                          <Trash2 className="h-4 w-4" />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        <p>Remove invoice</p>
                                      </TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </CardContent>
                      <CardFooter className="flex justify-between">
                        <div>
                          <span className="text-sm font-semibold">Service Invoices Total: </span>
                          <span>{formatNumber(totals.serviceInvoiceTotal)}</span>
                        </div>
                      </CardFooter>
                    </Card>
                    
                    <Card className="mt-4">
                      <CardHeader>
                        <CardTitle>Service Invoice Documents</CardTitle>
                        <CardDescription>
                          Manage documents for service invoices
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-4">
                          <div>
                            <Label>Select Invoice</Label>
                            <Select
                              onValueChange={(value) => {
                                const invoice = serviceInvoices.find(i => i.id && i.id.toString() === value);
                                if (invoice) {
                                  setSelectedServiceInvoice(invoice);
                                }
                              }}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Select an invoice to manage documents" />
                              </SelectTrigger>
                              <SelectContent>
                                {serviceInvoices.filter(invoice => invoice.id).map((invoice) => (
                                  <SelectItem key={invoice.id} value={invoice.id!.toString()}>
                                    {invoice.invoiceNumber} - {formatCurrency(invoice.amount, invoice.currency)}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          
                          {selectedServiceInvoice?.id && (
                            <ExpenseDocumentUpload
                              procedureReference={procedure.reference}
                              expenseType="service_invoice"
                              expenseId={selectedServiceInvoice.id}
                              onUploadComplete={() => {
                                showToast({
                                  title: "Document uploaded",
                                  description: "Your document has been uploaded successfully"
                                });
                              }}
                            />
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                )}
              </TabsContent>
            </Tabs>
            
            {/* Import Documents Upload Section */}
            {procedure && (
              <Card className="mb-6">
                <CardHeader>
                  <CardTitle>Upload Import Documents</CardTitle>
                  <CardDescription>
                    Upload documents related to this import procedure
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ImportDocumentUpload
                    procedureReference={procedure.reference}
                    procedureId={procedure.id}
                    onUploadComplete={() => {
                      toast({
                        title: "Document uploaded",
                        description: "Your document has been uploaded successfully"
                      });
                    }}
                  />
                </CardContent>
              </Card>
            )}

            {(taxData || importExpenses.length > 0 || serviceInvoices.length > 0) && (
              <Card>
                <CardHeader>
                  <CardTitle>Expense Summary</CardTitle>
                  <CardDescription>
                    Summary of all expenses for this shipment
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-lg">Taxes</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <p className="text-2xl font-bold">{formatNumber(totals.taxTotal)}</p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-lg">Import Expenses</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <p className="text-2xl font-bold">{formatNumber(totals.importExpenseTotal)}</p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-lg">Service Invoices</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <p className="text-2xl font-bold">{formatNumber(totals.serviceInvoiceTotal)}</p>
                      </CardContent>
                    </Card>
                  </div>
                  
                  <div className="mt-6 border-t pt-4">
                    <div className="flex justify-between items-center">
                      <div>
                        <p className="text-lg font-semibold">Total Expenses</p>
                        <p className="text-xs text-muted-foreground">
                          All expense types combined
                        </p>
                      </div>
                      <p className="text-3xl font-bold">{formatNumber(totals.overallTotal)}</p>
                    </div>
                  </div>
                </CardContent>
                <CardFooter className="flex justify-end space-x-2">
                  <AlertDialog open={isConfirmDialogOpen} onOpenChange={setIsConfirmDialogOpen}>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline">
                        <RefreshCw className="mr-2 h-4 w-4" />
                        Reset
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This action will reset all forms and clear any unsaved data. This cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={confirmReset}>Reset</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                  
                  <Button
                    onClick={saveAllExpenses}
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <Save className="mr-2 h-4 w-4" />
                        Record All
                      </>
                    )}
                  </Button>
                </CardFooter>
              </Card>
            )}
          </>
        )}
      </div>

      {/* Expense Receipt Modal */}
      <Dialog open={isExpenseReceiptModalOpen} onOpenChange={setIsExpenseReceiptModalOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Upload Expense Receipts & Invoices
            </DialogTitle>
            <DialogDescription>
              Upload one or more expense receipt PDFs. Taxes and expenses from all files will be combined automatically.
            </DialogDescription>
          </DialogHeader>

          {recognizedItems.length === 0 ? (
            <div className="py-6">
              <div
                className={`
                  border-2 border-dashed rounded-lg p-8 text-center transition-all
                  ${isAnalyzingExpenseReceipt ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-green-400 hover:bg-gray-50'}
                `}
              >
                {isAnalyzingExpenseReceipt ? (
                  <div className="flex flex-col items-center gap-3">
                    <Loader2 className="h-10 w-10 animate-spin text-blue-500" />
                    <p className="text-sm text-gray-600">Analyzing document...</p>
                    <p className="text-xs text-gray-500">Extracting taxes, expenses, and matching invoices...</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3">
                    <Upload className="h-10 w-10 text-gray-400" />
                    <p className="text-sm text-gray-600 mb-2">
                      Upload expense receipt PDF(s)
                    </p>
                    <p className="text-xs text-gray-400 mb-2">
                      You can select multiple PDFs at once. Taxes will be combined automatically.
                    </p>
                    <input
                      type="file"
                      accept=".pdf"
                      multiple
                      className="hidden"
                      id="expense-receipt-input"
                      onChange={(e) => {
                        const files = e.target.files;
                        if (files && files.length > 0) {
                          handleExpenseReceiptPdfUpload(files);
                        }
                      }}
                      data-testid="input-expense-receipt"
                    />
                    <Button
                      variant="outline"
                      onClick={() => document.getElementById('expense-receipt-input')?.click()}
                      data-testid="button-browse-expense-receipt"
                    >
                      Browse Files (Select Multiple)
                    </Button>
                  </div>
                )}
              </div>
              {expenseReceiptError && (
                <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
                  {expenseReceiptError}
                </div>
              )}
            </div>
          ) : (
            <div className="py-4">
              <div className="mb-4 flex justify-between items-center">
                <div>
                  <p className="text-sm text-gray-600">
                    Found {recognizedItems.filter(i => i.type === 'tax').length} tax(es), {recognizedItems.filter(i => i.type === 'expense').length} expense(s), and {recognizedItems.filter(i => i.type === 'service_invoice').length} service invoice(s)
                  </p>
                </div>
                <div className="flex gap-2 items-center">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setRecognizedItems(prev => prev.map(item => ({ ...item, selected: true })))}
                  >
                    Select All
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setRecognizedItems(prev => prev.map(item => ({ ...item, selected: false })))}
                  >
                    Deselect All
                  </Button>
                  {uploadedPdfFile && (
                    <div className="flex items-center gap-1 ml-2 border-l pl-2">
                      <span className="text-xs text-gray-500">Add from page:</span>
                      <Input
                        type="number"
                        min={1}
                        max={uploadedPdfFile.pageCount}
                        value={addMissingPageNumber}
                        onChange={(e) => setAddMissingPageNumber(parseInt(e.target.value) || 1)}
                        className="w-16 h-8 text-sm text-center"
                        data-testid="input-missing-page-number"
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleAnalyzeMissingPage}
                        disabled={isAnalyzingMissingPage}
                        data-testid="button-add-missing-expense"
                      >
                        {isAnalyzingMissingPage ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Plus className="h-4 w-4" />
                        )}
                        Add
                      </Button>
                    </div>
                  )}
                </div>
              </div>

              <ScrollArea className="h-[400px] pr-4">
                {/* Taxes Section */}
                {recognizedItems.filter(i => i.type === 'tax').length > 0 && (
                  <div className="mb-4">
                    <h4 className="text-sm font-semibold text-blue-700 mb-2 flex items-center gap-2">
                      <span className="w-2 h-2 bg-blue-500 rounded-full"></span>
                      Taxes
                    </h4>
                    <div className="space-y-2">
                      {recognizedItems.filter(i => i.type === 'tax').map((item) => (
                        <Card
                          key={item.id}
                          className={`transition-all ${item.selected ? 'border-blue-300 bg-blue-50/30' : 'border-gray-200 opacity-60'}`}
                        >
                          <CardContent className="p-3">
                            <div className="flex items-center gap-3">
                              <Checkbox
                                checked={item.selected}
                                onCheckedChange={() => toggleItemSelection(item.id)}
                                data-testid={`checkbox-item-${item.id}`}
                              />
                              <div className="flex-1 flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <div>
                                    <p className="text-sm font-medium">{item.description}</p>
                                    <span className="text-lg font-semibold text-blue-700">
                                      {formatCurrency(item.amount.toString(), item.currency)}
                                    </span>
                                  </div>
                                  {item.pdfObjectKey && (
                                    <div className="flex items-center gap-1">
                                      <Input
                                        type="number"
                                        min={1}
                                        max={uploadedPdfFile?.pageCount || 100}
                                        value={item.pageNumber || 1}
                                        onChange={(e) => updateRecognizedItemField(item.id, 'pageNumber', parseInt(e.target.value) || 1)}
                                        className="w-14 h-7 text-xs text-center"
                                        disabled={!item.selected}
                                        data-testid={`input-page-number-${item.id}`}
                                      />
                                      <TooltipProvider>
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <Button
                                              variant="outline"
                                              size="sm"
                                              className="h-7 px-2 text-xs flex items-center gap-1 border-blue-300 text-blue-700 hover:bg-blue-50"
                                              onClick={() => {
                                                setPreviewPageNumber(item.pageNumber || 1);
                                                setIsPdfPreviewOpen(true);
                                              }}
                                              data-testid={`button-preview-pdf-${item.id}`}
                                            >
                                              <Eye className="h-3 w-3" />
                                            </Button>
                                          </TooltipTrigger>
                                          <TooltipContent>
                                            <p>View PDF page {item.pageNumber}</p>
                                          </TooltipContent>
                                        </Tooltip>
                                      </TooltipProvider>
                                    </div>
                                  )}
                                  {!item.pdfObjectKey && item.pageNumber && (
                                    <span className="text-xs text-gray-400 bg-gray-100 px-2 py-1 rounded">
                                      Page {item.pageNumber}
                                    </span>
                                  )}
                                </div>
                                <Select
                                  value={item.selectedCategory}
                                  onValueChange={(value) => updateRecognizedItemCategory(item.id, value)}
                                  disabled={!item.selected}
                                >
                                  <SelectTrigger className="w-48" data-testid={`select-category-${item.id}`}>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="customs_tax">Customs Tax</SelectItem>
                                    <SelectItem value="additional_customs_tax">Additional Customs Tax</SelectItem>
                                    <SelectItem value="kkdf">KKDF</SelectItem>
                                    <SelectItem value="vat">VAT (KDV)</SelectItem>
                                    <SelectItem value="stamp_tax">Stamp Tax</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>
                )}

                {/* Import Expenses Section */}
                {recognizedItems.filter(i => i.type === 'expense').length > 0 && (
                  <div className="mb-4">
                    <h4 className="text-sm font-semibold text-green-700 mb-2 flex items-center gap-2">
                      <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                      Import Expenses
                    </h4>
                    <div className="space-y-2">
                      {recognizedItems.filter(i => i.type === 'expense').map((item) => (
                        <Card
                          key={item.id}
                          className={`transition-all ${item.selected ? 'border-green-300 bg-green-50/30' : 'border-gray-200 opacity-60'}`}
                        >
                          <CardContent className="p-3">
                            <div className="flex items-start gap-3">
                              <Checkbox
                                checked={item.selected}
                                onCheckedChange={() => toggleItemSelection(item.id)}
                                className="mt-1"
                                data-testid={`checkbox-item-${item.id}`}
                              />
                              <div className="flex-1">
                                <div className="flex items-center justify-between mb-2">
                                  <div className="flex items-center gap-2">
                                    <div>
                                      <p className="text-sm font-medium">{item.description}</p>
                                      <span className="font-semibold text-lg text-green-700">
                                        {formatCurrency(item.amount.toString(), item.currency)}
                                      </span>
                                    </div>
                                    {item.pdfObjectKey && (
                                      <div className="flex items-center gap-1">
                                        <Input
                                          type="number"
                                          min={1}
                                          max={uploadedPdfFile?.pageCount || 100}
                                          value={item.pageNumber || 1}
                                          onChange={(e) => updateRecognizedItemField(item.id, 'pageNumber', parseInt(e.target.value) || 1)}
                                          className="w-14 h-8 text-xs text-center"
                                          disabled={!item.selected}
                                          data-testid={`input-page-number-${item.id}`}
                                        />
                                        <TooltipProvider>
                                          <Tooltip>
                                            <TooltipTrigger asChild>
                                              <Button
                                                variant="outline"
                                                size="sm"
                                                className="h-8 px-2 text-xs flex items-center gap-1 border-green-300 text-green-700 hover:bg-green-50"
                                                onClick={() => {
                                                  setPreviewPageNumber(item.pageNumber || 1);
                                                  setIsPdfPreviewOpen(true);
                                                }}
                                                data-testid={`button-preview-pdf-${item.id}`}
                                              >
                                                <Eye className="h-3 w-3" />
                                              </Button>
                                            </TooltipTrigger>
                                            <TooltipContent>
                                              <p>View PDF page {item.pageNumber}</p>
                                            </TooltipContent>
                                          </Tooltip>
                                        </TooltipProvider>
                                      </div>
                                    )}
                                    {!item.pdfObjectKey && item.pageNumber && (
                                      <span className="text-xs text-gray-400 bg-gray-100 px-2 py-1 rounded">
                                        Page {item.pageNumber}
                                      </span>
                                    )}
                                  </div>
                                  <div className="w-48">
                                    <Label className="text-xs text-gray-500 mb-1 block">Category</Label>
                                    <Select
                                      value={item.selectedCategory}
                                      onValueChange={(value) => updateRecognizedItemCategory(item.id, value)}
                                      disabled={!item.selected}
                                    >
                                      <SelectTrigger className="w-full" data-testid={`select-category-${item.id}`}>
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {expenseCategories.map(category => (
                                          <SelectItem key={category} value={category}>
                                            {formatCategoryName(category)}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  </div>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-4 gap-2 mt-2">
                                  <div>
                                    <Label className="text-xs text-gray-500 mb-1 block">Invoice Number</Label>
                                    <Input
                                      value={item.invoiceNumber || ''}
                                      onChange={(e) => updateRecognizedItemField(item.id, 'invoiceNumber', e.target.value)}
                                      placeholder="e.g., ABC2025000000001"
                                      disabled={!item.selected}
                                      className="h-8 text-sm"
                                      data-testid={`input-invoice-number-${item.id}`}
                                    />
                                  </div>
                                  <div>
                                    <Label className="text-xs text-gray-500 mb-1 block">Document No</Label>
                                    <Input
                                      value={item.receiptNumber || ''}
                                      onChange={(e) => updateRecognizedItemField(item.id, 'receiptNumber', e.target.value)}
                                      placeholder="From page 1 table"
                                      disabled={!item.selected}
                                      className="h-8 text-sm"
                                      data-testid={`input-document-number-${item.id}`}
                                    />
                                  </div>
                                  <div>
                                    <Label className="text-xs text-gray-500 mb-1 block">Invoice Date</Label>
                                    <Input
                                      type="date"
                                      value={item.invoiceDate || ''}
                                      onChange={(e) => updateRecognizedItemField(item.id, 'invoiceDate', e.target.value)}
                                      disabled={!item.selected}
                                      className="h-8 text-sm"
                                      data-testid={`input-invoice-date-${item.id}`}
                                    />
                                  </div>
                                  <div>
                                    <Label className="text-xs text-gray-500 mb-1 block">Issuer</Label>
                                    <Input
                                      value={item.issuer || ''}
                                      onChange={(e) => updateRecognizedItemField(item.id, 'issuer', e.target.value)}
                                      placeholder="Company name"
                                      disabled={!item.selected}
                                      className="h-8 text-sm"
                                      data-testid={`input-issuer-${item.id}`}
                                    />
                                  </div>
                                </div>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>
                )}

                {/* Service Invoices Section */}
                {recognizedItems.filter(i => i.type === 'service_invoice').length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold text-purple-700 mb-2 flex items-center gap-2">
                      <span className="w-2 h-2 bg-purple-500 rounded-full"></span>
                      Service Invoices
                    </h4>
                    <div className="space-y-2">
                      {recognizedItems.filter(i => i.type === 'service_invoice').map((item) => (
                        <Card
                          key={item.id}
                          className={`transition-all ${item.selected ? 'border-purple-300 bg-purple-50/30' : 'border-gray-200 opacity-60'}`}
                        >
                          <CardContent className="p-3">
                            <div className="flex items-start gap-3">
                              <Checkbox
                                checked={item.selected}
                                onCheckedChange={() => toggleItemSelection(item.id)}
                                className="mt-1"
                                data-testid={`checkbox-item-${item.id}`}
                              />
                              <div className="flex-1">
                                <div className="flex items-center justify-between mb-2">
                                  <div className="flex items-center gap-2">
                                    <div>
                                      <p className="text-sm font-medium">{item.description}</p>
                                      <span className="font-semibold text-lg text-purple-700">
                                        {formatCurrency(item.amount.toString(), item.currency)}
                                      </span>
                                    </div>
                                    {item.pdfObjectKey && (
                                      <div className="flex items-center gap-1">
                                        <Input
                                          type="number"
                                          min={1}
                                          max={uploadedPdfFile?.pageCount || 100}
                                          value={item.pageNumber || 1}
                                          onChange={(e) => updateRecognizedItemField(item.id, 'pageNumber', parseInt(e.target.value) || 1)}
                                          className="w-14 h-8 text-xs text-center"
                                          disabled={!item.selected}
                                          data-testid={`input-page-number-${item.id}`}
                                        />
                                        <TooltipProvider>
                                          <Tooltip>
                                            <TooltipTrigger asChild>
                                              <Button
                                                variant="outline"
                                                size="sm"
                                                className="h-8 px-2 text-xs flex items-center gap-1 border-purple-300 text-purple-700 hover:bg-purple-50"
                                                onClick={() => {
                                                  setPreviewPageNumber(item.pageNumber || 1);
                                                  setIsPdfPreviewOpen(true);
                                                }}
                                                data-testid={`button-preview-pdf-${item.id}`}
                                              >
                                                <Eye className="h-3 w-3" />
                                              </Button>
                                            </TooltipTrigger>
                                            <TooltipContent>
                                              <p>View PDF page {item.pageNumber}</p>
                                            </TooltipContent>
                                          </Tooltip>
                                        </TooltipProvider>
                                      </div>
                                    )}
                                    {!item.pdfObjectKey && item.pageNumber && (
                                      <span className="text-xs text-gray-400 bg-gray-100 px-2 py-1 rounded">
                                        Page {item.pageNumber}
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2">
                                  <div>
                                    <Label className="text-xs text-gray-500 mb-1 block">Invoice Number</Label>
                                    <Input
                                      value={item.invoiceNumber || ''}
                                      onChange={(e) => updateRecognizedItemField(item.id, 'invoiceNumber', e.target.value)}
                                      placeholder="e.g., ABC2025000000001"
                                      disabled={!item.selected}
                                      className="h-8 text-sm"
                                      data-testid={`input-invoice-number-${item.id}`}
                                    />
                                  </div>
                                  <div>
                                    <Label className="text-xs text-gray-500 mb-1 block">Invoice Date</Label>
                                    <Input
                                      type="date"
                                      value={item.invoiceDate || ''}
                                      onChange={(e) => updateRecognizedItemField(item.id, 'invoiceDate', e.target.value)}
                                      disabled={!item.selected}
                                      className="h-8 text-sm"
                                      data-testid={`input-invoice-date-${item.id}`}
                                    />
                                  </div>
                                </div>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>
                )}
              </ScrollArea>

              <div className="mt-4 p-3 bg-gray-50 rounded-lg">
                <div className="flex justify-between items-center">
                  <div>
                    <p className="text-sm font-medium">
                      Selected: {recognizedItems.filter(i => i.selected).length} of {recognizedItems.length}
                    </p>
                    <div className="flex gap-4 text-sm text-gray-500">
                      <span className="text-blue-600">
                        Taxes: {formatCurrency(
                          recognizedItems.filter(i => i.selected && i.type === 'tax').reduce((sum, i) => sum + i.amount, 0).toString(),
                          'TRY'
                        )}
                      </span>
                      <span className="text-green-600">
                        Expenses: {formatCurrency(
                          recognizedItems.filter(i => i.selected && i.type === 'expense').reduce((sum, i) => sum + i.amount, 0).toString(),
                          'TRY'
                        )}
                      </span>
                      <span className="text-purple-600">
                        Service: {formatCurrency(
                          recognizedItems.filter(i => i.selected && i.type === 'service_invoice').reduce((sum, i) => sum + i.amount, 0).toString(),
                          'TRY'
                        )}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setIsExpenseReceiptModalOpen(false);
                setRecognizedItems([]);
                setRecognizedTaxes(null);
                setExpenseReceiptError(null);
                setUploadedPdfFile(null);
              }}
            >
              Cancel
            </Button>
            {recognizedItems.length > 0 && (
              <Button
                onClick={addSelectedItems}
                disabled={isSubmitting || recognizedItems.filter(i => i.selected).length === 0}
                data-testid="button-add-selected-items"
              >
                {isSubmitting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Check className="mr-2 h-4 w-4" />
                )}
                Save {recognizedItems.filter(i => i.selected).length} Item(s)
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* PDF Page Preview Dialog */}
      <Dialog open={isPdfPreviewOpen} onOpenChange={setIsPdfPreviewOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              PDF Page Preview - Page {previewPageNumber}
            </DialogTitle>
            <DialogDescription>
              Review the PDF page to confirm this is the correct document for the expense.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 min-h-[500px] border rounded-lg bg-gray-50 overflow-auto flex items-center justify-center">
            {uploadedPdfFile && previewPageNumber && (
              <div className="text-center p-8">
                <FileText className="h-16 w-16 mx-auto mb-4 text-gray-400" />
                <p className="text-gray-600 mb-4">PDF Page {previewPageNumber} is ready for viewing.</p>
                <Button
                  onClick={() => {
                    const url = `/api/expense-documents/pdf-page/${encodeURIComponent(uploadedPdfFile.objectKey)}?page=${previewPageNumber}`;
                    window.open(url, '_blank');
                  }}
                  data-testid="button-open-pdf-new-tab"
                >
                  <Eye className="mr-2 h-4 w-4" />
                  Open PDF in New Tab
                </Button>
              </div>
            )}
            {!uploadedPdfFile && (
              <div className="flex items-center justify-center h-full text-gray-500">
                <p>PDF not available for preview</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsPdfPreviewOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageLayout>
  );
}