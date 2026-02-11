import React, { useState, useRef, ChangeEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { Trash2, Pencil, Plus, Calculator, Upload, FileText, Download, FileUp, RefreshCw } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { formatDate } from '@/utils/formatters';
import Papa from 'papaparse';

// Define interfaces for the component
interface InvoiceLineItem {
  id: number;
  procedureReference: string;
  description: string;
  styleNo?: string;
  quantity: number;
  unitPrice: string;
  totalPrice: string;
  finalCost?: string;
  finalCostPerItem?: string;
  costMultiplier?: string;
  createdAt: Date;
  updatedAt: Date;
}

interface InvoiceLineItemsConfigType {
  id: number;
  procedureReference: string;
  distributionMethod: 'proportional' | 'equal';
  isVisible: boolean;
  createdBy: number;
  updatedBy: number;
  createdAt: Date;
  updatedAt: Date;
}

interface InvoiceLineItemsTableProps {
  procedureReference: string;
  currency: string;
  exchangeRate?: number;
}

const InvoiceLineItemsTable: React.FC<InvoiceLineItemsTableProps> = ({ 
  procedureReference,
  currency,
  exchangeRate = 1
}) => {
  const queryClient = useQueryClient();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<InvoiceLineItem | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);
  const [isBulkUploadDialogOpen, setIsBulkUploadDialogOpen] = useState(false);
  const [bulkItems, setBulkItems] = useState('');
  
  // CSV upload related state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvData, setCsvData] = useState<any[]>([]);
  const [csvPreview, setCsvPreview] = useState<any[]>([]);
  const [csvDelimiter, setCsvDelimiter] = useState<string>(',');
  const [columnMapping, setColumnMapping] = useState({
    description: '',
    styleNo: '',
    quantity: '',
    unitPrice: '',
    totalPrice: '',
  });
  const [activeTab, setActiveTab] = useState('json');
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [showPreview, setShowPreview] = useState(false);

  // Form state for add/edit dialog
  const [formData, setFormData] = useState({
    description: '',
    styleNo: '',
    quantity: 1,
    unitPrice: '',
    totalPrice: '',
  });

  // Query to fetch line items for this procedure
  const { 
    data: lineItemsData, 
    isLoading: isLoadingLineItems,
    refetch: refetchLineItems,
    isFetching: isFetchingLineItems 
  } = useQuery({
    queryKey: ['/api/invoice-line-items/procedure', procedureReference],
    queryFn: async () => {
      try {
        console.log(`Fetching line items for procedure: ${procedureReference}`);
        
        // Make API request and get the response
        const response = await apiRequest('GET', `/api/invoice-line-items/procedure/${encodeURIComponent(procedureReference)}`);
        
        // Parse the response to JSON
        const jsonData = await response.json();
        console.log('Line items data received:', JSON.stringify(jsonData));
        
        // Add more detailed logging of the data structure
        if (jsonData && jsonData.lineItems) {
          console.log(`Number of line items: ${jsonData.lineItems.length}`);
          if (jsonData.lineItems.length > 0) {
            console.log('First item sample:', JSON.stringify(jsonData.lineItems[0]));
          }
        } else {
          console.warn('Data structure is not as expected. Received:', typeof jsonData, jsonData);
        }
        
        // Return the parsed JSON data
        return jsonData;
      } catch (error) {
        console.error('Error fetching line items:', error);
        throw error; // Rethrow to let React Query handle it
      }
    },
    enabled: !!procedureReference,
    staleTime: 0, // Always treat data as stale to ensure refetches after mutations
    refetchOnWindowFocus: true, // Refetch when window regains focus
    retry: 3 // Retry failed requests up to 3 times
  });

  // Query to fetch configuration for this procedure
  const { data: configData } = useQuery({
    queryKey: ['/api/invoice-line-items-config', procedureReference],
    queryFn: async () => {
      try {
        const response = await apiRequest('GET', `/api/invoice-line-items-config/${encodeURIComponent(procedureReference)}`);
        return await response.json();
      } catch (error) {
        console.error('Error fetching config:', error);
        throw error;
      }
    },
    enabled: !!procedureReference
  });

  // Mutations for CRUD operations
  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const response = await apiRequest('POST', '/api/invoice-line-items', data);
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/invoice-line-items/procedure', procedureReference] });
      setIsAddDialogOpen(false);
      resetForm();
      toast({
        title: 'Success',
        description: 'Invoice line item created successfully',
      });
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: `Failed to create invoice line item: ${error}`,
        variant: 'destructive',
      });
    }
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number, data: any }) => {
      const response = await apiRequest('PATCH', `/api/invoice-line-items/${id}`, data);
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/invoice-line-items/procedure', procedureReference] });
      setIsEditDialogOpen(false);
      setSelectedItem(null);
      resetForm();
      toast({
        title: 'Success',
        description: 'Invoice line item updated successfully',
      });
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: `Failed to update invoice line item: ${error}`,
        variant: 'destructive',
      });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await apiRequest('DELETE', `/api/invoice-line-items/${id}`);
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/invoice-line-items/procedure', procedureReference] });
      toast({
        title: 'Success',
        description: 'Invoice line item deleted successfully',
      });
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: `Failed to delete invoice line item: ${error}`,
        variant: 'destructive',
      });
    }
  });

  const calculateCostsMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('POST', `/api/invoice-line-items/calculate/${encodeURIComponent(procedureReference)}`);
      return await response.json();
    },
    onSuccess: (data) => {
      // First invalidate the query to get fresh data
      queryClient.invalidateQueries({ queryKey: ['/api/invoice-line-items/procedure', procedureReference] });
      
      // Reset calculating state
      setIsCalculating(false);
      
      // Show success toast with more detailed information
      toast({
        title: 'Calculation Complete',
        description: `Updated ${data.totalLineItems} items using ${data.distributionMethod} distribution. The Total Cost is ${formatCurrency(data.totalCostUSD, 'USD')}`,
        variant: 'default',
      });
      
      // After a short delay, briefly highlight the updated cells 
      // by adding a CSS class that will be automatically removed after animation
      setTimeout(() => {
        const cells = document.querySelectorAll('.final-cost-cell, .cost-per-item-cell');
        cells.forEach(cell => {
          cell.classList.add('highlight-updated');
          // Remove highlight class after animation completes
          setTimeout(() => {
            cell.classList.remove('highlight-updated');
          }, 2000);
        });
      }, 300);
    },
    onError: (error) => {
      setIsCalculating(false);
      toast({
        title: 'Calculation Failed',
        description: `Failed to calculate costs: ${error}`,
        variant: 'destructive',
      });
    }
  });

  const bulkCreateMutation = useMutation({
    mutationFn: async (lineItems: any[]) => {
      const response = await apiRequest('POST', '/api/invoice-line-items/bulk', { lineItems });
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/invoice-line-items/procedure', procedureReference] });
      setIsBulkUploadDialogOpen(false);
      setBulkItems('');
      toast({
        title: 'Success',
        description: 'Bulk line items created successfully',
      });
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: `Failed to create bulk line items: ${error}`,
        variant: 'destructive',
      });
    }
  });

  const configMutation = useMutation({
    mutationFn: async (data: any) => {
      const response = await apiRequest('POST', '/api/invoice-line-items-config', data);
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/invoice-line-items-config', procedureReference] });
      toast({
        title: 'Success',
        description: 'Configuration updated successfully',
      });
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: `Failed to update configuration: ${error}`,
        variant: 'destructive',
      });
    }
  });
  
  // Delete all line items mutation
  const [isDeleteAllDialogOpen, setIsDeleteAllDialogOpen] = useState<boolean>(false);
  const deleteAllMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('DELETE', `/api/invoice-line-items/procedure/${encodeURIComponent(procedureReference)}`);
      return await response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/invoice-line-items/procedure', procedureReference] });
      setIsDeleteAllDialogOpen(false);
      toast({
        title: 'Success',
        description: `Successfully deleted ${data.deletedCount} invoice line items`,
      });
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: `Failed to delete all line items: ${error}`,
        variant: 'destructive',
      });
    }
  });

  // Handle form input changes
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    
    // Update form data
    setFormData(prev => {
      const updated = { ...prev, [name]: value };
      
      // Auto-calculate total price when quantity or unit price changes
      if (name === 'quantity' || name === 'unitPrice') {
        const quantity = name === 'quantity' ? parseFloat(value) || 0 : parseFloat(prev.quantity.toString()) || 0;
        const unitPrice = name === 'unitPrice' ? parseFloat(value) || 0 : parseFloat(prev.unitPrice) || 0;
        updated.totalPrice = (quantity * unitPrice).toString();
      }
      
      return updated;
    });
  };

  // Reset form to default values
  const resetForm = () => {
    setFormData({
      description: '',
      styleNo: '',
      quantity: 1,
      unitPrice: '',
      totalPrice: '',
    });
  };

  // Open edit dialog and populate form with selected item data
  const handleEdit = (item: InvoiceLineItem) => {
    setSelectedItem(item);
    setFormData({
      description: item.description,
      styleNo: item.styleNo || '',
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      totalPrice: item.totalPrice,
    });
    setIsEditDialogOpen(true);
  };

  // Handle delete confirmation
  const handleDelete = (id: number) => {
    if (window.confirm('Are you sure you want to delete this line item?')) {
      deleteMutation.mutate(id);
    }
  };

  // Handle form submission for creating new item
  const handleCreate = () => {
    createMutation.mutate({
      procedureReference,
      ...formData
    });
  };

  // Handle form submission for updating item
  const handleUpdate = () => {
    if (selectedItem) {
      updateMutation.mutate({
        id: selectedItem.id,
        data: {
          ...formData
        }
      });
    }
  };

  // Handle bulk upload
  const handleBulkUpload = () => {
    try {
      // Try to parse the JSON input
      const items = JSON.parse(bulkItems);
      
      // Validate that it's an array
      if (!Array.isArray(items)) {
        throw new Error('Input must be an array of line items');
      }
      
      // Add procedureReference to each item
      const itemsWithReference = items.map(item => ({
        ...item,
        procedureReference
      }));
      
      // Submit the data
      bulkCreateMutation.mutate(itemsWithReference);
    } catch (error) {
      toast({
        title: 'Invalid JSON format',
        description: String(error),
        variant: 'destructive',
      });
    }
  };

  // Toggle the cost distribution method
  const toggleDistributionMethod = () => {
    const currentMethod = configData?.config?.distributionMethod || 'proportional';
    const newMethod = currentMethod === 'proportional' ? 'equal' : 'proportional';
    
    configMutation.mutate({
      procedureReference,
      distributionMethod: newMethod,
      isVisible: true,
      updatedBy: 2, // Using a valid user ID (cem.yildirim)
    });
  };

  // Calculate costs for all line items
  const calculateCosts = () => {
    if (!lineItemsData?.lineItems?.length) {
      toast({
        title: 'No line items to calculate',
        description: 'Please add at least one line item before calculating costs.',
        variant: 'destructive',
      });
      return;
    }
    
    // Show start calculation toast
    toast({
      title: 'Calculating costs',
      description: 'Distributing expenses across line items...',
    });
    
    setIsCalculating(true);
    calculateCostsMutation.mutate();
  };
  
  // Format currency for display
  const formatItemCurrency = (value: string | undefined) => {
    if (!value) return '-';
    const numValue = parseFloat(value);
    if (isNaN(numValue)) return '-';
    return formatCurrency(numValue, currency === 'USD' ? 'USD' : 'TRY');
  };
  
  // Helper functions for totals
  const getTotalOriginalValue = () => {
    if (!lineItemsData?.lineItems?.length) return 0;
    return lineItemsData.lineItems.reduce((sum: number, item: InvoiceLineItem) => 
      sum + parseFloat(item.totalPrice || '0'), 0);
  };
  
  const getTotalFinalCost = () => {
    if (!lineItemsData?.lineItems?.length) return 0;
    return lineItemsData.lineItems.reduce((sum: number, item: InvoiceLineItem) => 
      sum + parseFloat(item.finalCost || item.totalPrice || '0'), 0);
  };
  
  // CSV file handling methods
  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      setCsvFile(file);
      
      // Reset the file input so the same file can be selected again if needed
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      
      // Parse the CSV file
      parseCSVFile(file);
    }
  };
  
  // Parse CSV file with PapaParse
  const parseCSVFile = (file: File) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      delimiter: csvDelimiter,
      complete: (results) => {
        if (results.data && results.data.length > 0) {
          // Get the headers from the first row
          const headers = results.meta.fields || [];
          setCsvHeaders(headers);
          setCsvData(results.data);
          
          // Set default column mappings if column names match expected fields
          const mapping = { ...columnMapping };
          headers.forEach(header => {
            const lowerHeader = header.toLowerCase();
            if (lowerHeader.includes('desc')) {
              mapping.description = header;
            } else if (lowerHeader.includes('style')) {
              mapping.styleNo = header;
            } else if (lowerHeader.includes('quant')) {
              mapping.quantity = header;
            } else if (lowerHeader.includes('unit') && lowerHeader.includes('price')) {
              mapping.unitPrice = header;
            } else if (lowerHeader.includes('total') && lowerHeader.includes('price')) {
              mapping.totalPrice = header;
            }
          });
          setColumnMapping(mapping);
          
          // Show a preview of the first 5 rows
          setCsvPreview(results.data.slice(0, 5));
          setShowPreview(true);
        } else {
          toast({
            title: 'Error',
            description: 'No data found in CSV file',
            variant: 'destructive',
          });
        }
      },
      error: (error) => {
        toast({
          title: 'Error parsing CSV',
          description: error.message,
          variant: 'destructive',
        });
      }
    });
  };
  
  // Handle delimiter change
  const handleDelimiterChange = (value: string) => {
    setCsvDelimiter(value);
    if (csvFile) {
      parseCSVFile(csvFile);
    }
  };
  
  // Handle column mapping change
  const handleColumnMappingChange = (field: string, value: string) => {
    setColumnMapping(prev => ({
      ...prev,
      [field]: value
    }));
  };
  
  // Process the CSV data and create line items
  const handleProcessCSV = () => {
    try {
      // Validate that all required field mappings are set
      if (!columnMapping.description || !columnMapping.quantity || 
          !columnMapping.unitPrice || !columnMapping.totalPrice) {
        throw new Error('All field mappings must be selected');
      }
      
      // Transform CSV data to line items format
      const items = csvData.map((row: any) => {
        const quantity = parseFloat(row[columnMapping.quantity]) || 0;
        const unitPrice = parseFloat(row[columnMapping.unitPrice].replace(/,/g, '')) || 0;
        let totalPrice = parseFloat(row[columnMapping.totalPrice].replace(/,/g, '')) || 0;
        
        // If total price is not provided or is 0, calculate it
        if (totalPrice === 0 && quantity > 0 && unitPrice > 0) {
          totalPrice = quantity * unitPrice;
        }
        
        return {
          description: row[columnMapping.description] || 'Unnamed Item',
          styleNo: columnMapping.styleNo ? row[columnMapping.styleNo] : null,
          quantity: quantity,
          unitPrice: unitPrice.toString(),
          totalPrice: totalPrice.toString(),
          procedureReference
        };
      });
      
      // Validate items
      if (items.length === 0) {
        throw new Error('No valid line items could be created from the CSV data');
      }
      
      // Submit the data
      bulkCreateMutation.mutate(items);
      
      // Reset CSV state
      setCsvFile(null);
      setCsvData([]);
      setCsvPreview([]);
      setShowPreview(false);
      setActiveTab('json');
    } catch (error) {
      toast({
        title: 'Error processing CSV',
        description: String(error),
        variant: 'destructive',
      });
    }
  };
  
  // Generate CSV template for download
  const generateCSVTemplate = () => {
    const headers = ['Description', 'Style', 'Quantity', 'UnitPrice', 'TotalPrice'];
    const sample = [
      ['Item 1', 'A123', '5', '12.50', '62.50'],
      ['Item 2', 'B456', '2', '25.00', '50.00']
    ];
    
    const csv = [
      headers.join(','),
      ...sample.map(row => row.join(','))
    ].join('\n');
    
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'invoice_line_items_template.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // These functions are now defined above

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle className="flex justify-between">
          <span>Invoice Line Items</span>
          <div className="flex space-x-2">
            <Button 
              variant="outline" 
              onClick={() => setIsDeleteAllDialogOpen(true)} 
              size="sm"
              className="bg-red-50 hover:bg-red-100 text-red-600 hover:text-red-700"
              disabled={!lineItemsData?.lineItems?.length}
            >
              <Trash2 className="h-4 w-4 mr-1" />
              Delete All
            </Button>
            <Button variant="outline" onClick={() => setIsBulkUploadDialogOpen(true)} size="sm">
              <Upload className="h-4 w-4 mr-1" />
              Bulk Upload
            </Button>
            <Button onClick={() => setIsAddDialogOpen(true)} size="sm">
              <Plus className="h-4 w-4 mr-1" />
              Add Item
            </Button>
          </div>
        </CardTitle>
        <CardDescription>
          Manage individual invoice line items and calculate their true costs including expenses
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* Debug logging */}
        <div className="hidden">
          {console.log('Rendering debug info:')}
          {console.log('- isLoadingLineItems:', isLoadingLineItems)}
          {console.log('- isFetchingLineItems:', isFetchingLineItems)}
          {console.log('- lineItemsData exists:', !!lineItemsData)}
          {console.log('- lineItemsData type:', typeof lineItemsData)}
          {lineItemsData && console.log('- lineItemsData.lineItems exists:', !!lineItemsData.lineItems)}
          {lineItemsData && lineItemsData.lineItems && console.log('- lineItemsData.lineItems type:', typeof lineItemsData.lineItems)}
          {lineItemsData && lineItemsData.lineItems && console.log('- lineItemsData.lineItems is array:', Array.isArray(lineItemsData.lineItems))}
          {lineItemsData && lineItemsData.lineItems && console.log('- lineItemsData.lineItems length:', lineItemsData.lineItems.length)}
        </div>

        {/* Loading state */}
        {isLoadingLineItems || isFetchingLineItems ? (
          <div className="text-center py-4">
            <div className="flex flex-col items-center space-y-2">
              <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary"></div>
              <p>Loading line items...</p>
            </div>
          </div>
        ) : null}

        {/* Error state */}
        {!isLoadingLineItems && !isFetchingLineItems && !lineItemsData ? (
          <div className="text-center py-4 text-destructive">
            <p>Error loading line items.</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => refetchLineItems()}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Retry
            </Button>
          </div>
        ) : null}

        {/* Invalid data structure */}
        {!isLoadingLineItems && !isFetchingLineItems && lineItemsData && (!lineItemsData.lineItems || !Array.isArray(lineItemsData.lineItems)) ? (
          <div className="text-center py-4 text-destructive">
            <p>Invalid line items data structure.</p>
            <pre className="text-xs mt-2 bg-slate-100 p-2 rounded overflow-auto max-h-20">
              {JSON.stringify(lineItemsData, null, 2)}
            </pre>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => refetchLineItems()}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Retry
            </Button>
          </div>
        ) : null}

        {/* Line items list */}
        {!isLoadingLineItems && !isFetchingLineItems && lineItemsData && lineItemsData.lineItems && Array.isArray(lineItemsData.lineItems) && lineItemsData.lineItems.length > 0 ? (
          <>
            <div className="flex justify-between mb-4">
              <div>
                <span className="text-sm font-medium">Distribution Method: </span>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={toggleDistributionMethod}
                >
                  {configData?.config?.distributionMethod === 'equal' ? 'Equal' : 'Proportional'}
                </Button>
                <span className="text-xs ml-2 text-muted-foreground">
                  {configData?.config?.distributionMethod === 'equal' 
                    ? 'Expenses divided equally among items' 
                    : 'Expenses allocated proportionally to item value'}
                </span>
              </div>
              <div className="flex space-x-2">
                <Button 
                  variant="outline"
                  size="sm"
                  onClick={() => refetchLineItems()}
                  disabled={isFetchingLineItems}
                >
                  <RefreshCw className={`h-4 w-4 mr-1 ${isFetchingLineItems ? 'animate-spin' : ''}`} />
                  Refresh
                </Button>
                <Button 
                  onClick={calculateCosts}
                  disabled={isCalculating}
                  size="sm"
                >
                  <Calculator className="h-4 w-4 mr-1" />
                  {isCalculating ? 'Calculating...' : 'Calculate Costs'}
                </Button>
              </div>
            </div>
            
            <div className="border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Description</TableHead>
                    <TableHead>Style</TableHead>
                    <TableHead className="text-right">Quantity</TableHead>
                    <TableHead className="text-right">Unit Price</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Final Cost</TableHead>
                    <TableHead className="text-right">Cost/Item</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lineItemsData.lineItems.map((item: InvoiceLineItem) => (
                    <TableRow key={item.id}>
                      <TableCell>{item.description}</TableCell>
                      <TableCell>{item.styleNo || '-'}</TableCell>
                      <TableCell className="text-right">{item.quantity}</TableCell>
                      <TableCell className="text-right">{formatItemCurrency(item.unitPrice)}</TableCell>
                      <TableCell className="text-right">{formatItemCurrency(item.totalPrice)}</TableCell>
                      <TableCell className="text-right font-semibold final-cost-cell">
                        {item.finalCost ? formatItemCurrency(item.finalCost) : '-'}
                      </TableCell>
                      <TableCell className="text-right cost-per-item-cell">
                        {item.finalCostPerItem ? formatItemCurrency(item.finalCostPerItem) : '-'}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end space-x-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleEdit(item)}
                            title="Edit"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDelete(item.id)}
                            title="Delete"
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            
            <div className="mt-4 flex justify-between">
              <div>
                <p className="text-sm font-semibold">Items: {lineItemsData.lineItems.length}</p>
                {lineItemsData.lineItems.some((item: InvoiceLineItem) => item.costMultiplier) && (
                  <p className="text-sm">
                    Cost Multiplier: {parseFloat(lineItemsData.lineItems[0].costMultiplier || '0').toFixed(4)}
                  </p>
                )}
              </div>
              <div>
                <div className="text-right">
                  <p className="text-sm font-medium">
                    Total Original Value: {formatCurrency(getTotalOriginalValue(), currency === 'USD' ? 'USD' : 'TRY')}
                  </p>
                  <p className="text-sm font-bold">
                    Total Final Cost: {formatCurrency(getTotalFinalCost(), currency === 'USD' ? 'USD' : 'TRY')}
                  </p>
                </div>
              </div>
            </div>
          </>
        ) : null}

        {/* Empty state */}
        {!isLoadingLineItems && !isFetchingLineItems && lineItemsData && lineItemsData.lineItems && Array.isArray(lineItemsData.lineItems) && lineItemsData.lineItems.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <p>No line items found for this invoice.</p>
            <p className="text-sm mt-2">Click "Add Item" to create your first line item.</p>
          </div>
        ) : null}
      </CardContent>

      {/* Add Dialog */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Invoice Line Item</DialogTitle>
            <DialogDescription>
              Add details for the new invoice line item.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-1 gap-2">
              <Label htmlFor="description">Description</Label>
              <Input
                id="description"
                name="description"
                value={formData.description}
                onChange={handleInputChange}
                placeholder="Item description"
              />
            </div>
            <div className="grid grid-cols-1 gap-2">
              <Label htmlFor="styleNo">Style No</Label>
              <Input
                id="styleNo"
                name="styleNo"
                value={formData.styleNo}
                onChange={handleInputChange}
                placeholder="Style number (optional)"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="quantity">Quantity</Label>
                <Input
                  id="quantity"
                  name="quantity"
                  type="number"
                  value={formData.quantity}
                  onChange={handleInputChange}
                  min="1"
                />
              </div>
              <div>
                <Label htmlFor="unitPrice">Unit Price ({currency})</Label>
                <Input
                  id="unitPrice"
                  name="unitPrice"
                  type="number"
                  value={formData.unitPrice}
                  onChange={handleInputChange}
                  step="0.01"
                  min="0"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="totalPrice">Total Price ({currency})</Label>
              <Input
                id="totalPrice"
                name="totalPrice"
                value={formData.totalPrice}
                onChange={handleInputChange}
                disabled
              />
              <p className="text-sm text-muted-foreground mt-1">
                Auto-calculated from quantity × unit price
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleCreate}
              disabled={createMutation.isPending || !formData.description || parseFloat(formData.totalPrice) <= 0}
            >
              {createMutation.isPending ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Invoice Line Item</DialogTitle>
            <DialogDescription>
              Update the details for this invoice line item.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-1 gap-2">
              <Label htmlFor="edit-description">Description</Label>
              <Input
                id="edit-description"
                name="description"
                value={formData.description}
                onChange={handleInputChange}
                placeholder="Item description"
              />
            </div>
            <div className="grid grid-cols-1 gap-2">
              <Label htmlFor="edit-styleNo">Style No</Label>
              <Input
                id="edit-styleNo"
                name="styleNo"
                value={formData.styleNo}
                onChange={handleInputChange}
                placeholder="Style number (optional)"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="edit-quantity">Quantity</Label>
                <Input
                  id="edit-quantity"
                  name="quantity"
                  type="number"
                  value={formData.quantity}
                  onChange={handleInputChange}
                  min="1"
                />
              </div>
              <div>
                <Label htmlFor="edit-unitPrice">Unit Price ({currency})</Label>
                <Input
                  id="edit-unitPrice"
                  name="unitPrice"
                  type="number"
                  value={formData.unitPrice}
                  onChange={handleInputChange}
                  step="0.01"
                  min="0"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="edit-totalPrice">Total Price ({currency})</Label>
              <Input
                id="edit-totalPrice"
                name="totalPrice"
                value={formData.totalPrice}
                onChange={handleInputChange}
                disabled
              />
              <p className="text-sm text-muted-foreground mt-1">
                Auto-calculated from quantity × unit price
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setIsEditDialogOpen(false);
              setSelectedItem(null);
              resetForm();
            }}>
              Cancel
            </Button>
            <Button 
              onClick={handleUpdate}
              disabled={updateMutation.isPending || !formData.description || parseFloat(formData.totalPrice) <= 0}
            >
              {updateMutation.isPending ? 'Updating...' : 'Update'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete All Confirmation Dialog */}
      <Dialog open={isDeleteAllDialogOpen} onOpenChange={setIsDeleteAllDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete All Line Items</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete all invoice line items for this procedure? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm font-medium text-destructive">
              This will permanently delete all {lineItemsData?.lineItems?.length || 0} line items.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDeleteAllDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              variant="destructive" 
              onClick={() => deleteAllMutation.mutate()}
              disabled={deleteAllMutation.isPending}
            >
              {deleteAllMutation.isPending ? 'Deleting...' : 'Delete All'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Upload Dialog */}
      <Dialog open={isBulkUploadDialogOpen} onOpenChange={(open) => {
        setIsBulkUploadDialogOpen(open);
        if (!open) {
          // Reset state when dialog is closed
          setActiveTab('json');
          setBulkItems('');
          setCsvFile(null);
          setCsvData([]);
          setCsvPreview([]);
          setShowPreview(false);
        }
      }}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Bulk Upload Line Items</DialogTitle>
            <DialogDescription>
              Upload multiple line items at once via JSON or CSV format.
            </DialogDescription>
          </DialogHeader>
          
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="json">JSON</TabsTrigger>
              <TabsTrigger value="csv">CSV</TabsTrigger>
            </TabsList>
            
            <TabsContent value="json" className="mt-4">
              <div className="grid gap-4 py-2">
                <div>
                  <Label htmlFor="bulk-items">JSON Data</Label>
                  <textarea
                    id="bulk-items"
                    className="w-full min-h-[200px] p-2 border rounded-md font-mono text-sm"
                    value={bulkItems}
                    onChange={(e) => setBulkItems(e.target.value)}
                    placeholder='[
  {
    "description": "Item 1",
    "styleNo": "A123",
    "quantity": 5,
    "unitPrice": "12.50",
    "totalPrice": "62.50"
  },
  {
    "description": "Item 2",
    "styleNo": "B456",
    "quantity": 2,
    "unitPrice": "25.00",
    "totalPrice": "50.00"
  }
]'
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Each item must have description, quantity, unitPrice, and totalPrice fields.
                    The styleNo field is optional. The procedureReference will be added automatically.
                  </p>
                </div>
                
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsBulkUploadDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button 
                    onClick={handleBulkUpload}
                    disabled={bulkCreateMutation.isPending || !bulkItems.trim()}
                  >
                    {bulkCreateMutation.isPending ? 'Uploading...' : 'Upload'}
                  </Button>
                </DialogFooter>
              </div>
            </TabsContent>
            
            <TabsContent value="csv" className="mt-4">
              <div className="grid gap-4 py-2">
                {!csvFile ? (
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="csv-file">Upload CSV File</Label>
                      <div className="mt-2 flex items-center gap-3">
                        <Button
                          variant="outline" 
                          onClick={() => fileInputRef.current?.click()}
                          className="w-full py-8 border-dashed border-2 flex flex-col items-center justify-center"
                        >
                          <FileUp className="h-6 w-6 mb-2" />
                          <span>Click to browse or drop file here</span>
                          <span className="text-xs text-muted-foreground mt-1">Supports .csv files</span>
                        </Button>
                        <input 
                          type="file"
                          ref={fileInputRef}
                          className="hidden"
                          accept=".csv"
                          onChange={handleFileSelect}
                        />
                      </div>
                    </div>
                    
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={generateCSVTemplate}
                        >
                          <Download className="h-4 w-4 mr-1" />
                          Download Template
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <div>
                        <h3 className="font-medium">File: {csvFile.name}</h3>
                        <p className="text-sm text-muted-foreground">
                          {csvData.length} rows found
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setCsvFile(null);
                          setCsvData([]);
                          setCsvPreview([]);
                          setShowPreview(false);
                        }}
                      >
                        Change File
                      </Button>
                    </div>
                    
                    <div>
                      <Label htmlFor="delimiter">Delimiter</Label>
                      <Select
                        value={csvDelimiter}
                        onValueChange={handleDelimiterChange}
                      >
                        <SelectTrigger id="delimiter" className="w-full">
                          <SelectValue placeholder="Select delimiter" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value=",">Comma (,)</SelectItem>
                          <SelectItem value=";">Semicolon (;)</SelectItem>
                          <SelectItem value="\t">Tab</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    
                    <div>
                      <h3 className="font-medium mb-2">Map Columns</h3>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label htmlFor="description-field">Description</Label>
                          <Select
                            value={columnMapping.description}
                            onValueChange={(value) => handleColumnMappingChange('description', value)}
                          >
                            <SelectTrigger id="description-field">
                              <SelectValue placeholder="Select field" />
                            </SelectTrigger>
                            <SelectContent>
                              {csvHeaders.map((header) => (
                                <SelectItem key={header} value={header}>
                                  {header}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div>
                          <Label htmlFor="style-field">Style</Label>
                          <Select
                            value={columnMapping.styleNo}
                            onValueChange={(value) => handleColumnMappingChange('styleNo', value)}
                          >
                            <SelectTrigger id="style-field">
                              <SelectValue placeholder="Select field (optional)" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">None (Optional)</SelectItem>
                              {csvHeaders.map((header) => (
                                <SelectItem key={header} value={header}>
                                  {header}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        
                        <div>
                          <Label htmlFor="quantity-field">Quantity</Label>
                          <Select
                            value={columnMapping.quantity}
                            onValueChange={(value) => handleColumnMappingChange('quantity', value)}
                          >
                            <SelectTrigger id="quantity-field">
                              <SelectValue placeholder="Select field" />
                            </SelectTrigger>
                            <SelectContent>
                              {csvHeaders.map((header) => (
                                <SelectItem key={header} value={header}>
                                  {header}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        
                        <div>
                          <Label htmlFor="unit-price-field">Unit Price</Label>
                          <Select
                            value={columnMapping.unitPrice}
                            onValueChange={(value) => handleColumnMappingChange('unitPrice', value)}
                          >
                            <SelectTrigger id="unit-price-field">
                              <SelectValue placeholder="Select field" />
                            </SelectTrigger>
                            <SelectContent>
                              {csvHeaders.map((header) => (
                                <SelectItem key={header} value={header}>
                                  {header}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        
                        <div>
                          <Label htmlFor="total-price-field">Total Price</Label>
                          <Select
                            value={columnMapping.totalPrice}
                            onValueChange={(value) => handleColumnMappingChange('totalPrice', value)}
                          >
                            <SelectTrigger id="total-price-field">
                              <SelectValue placeholder="Select field" />
                            </SelectTrigger>
                            <SelectContent>
                              {csvHeaders.map((header) => (
                                <SelectItem key={header} value={header}>
                                  {header}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>
                    
                    {showPreview && csvPreview.length > 0 && (
                      <div>
                        <div className="flex justify-between items-center mb-2">
                          <h3 className="font-medium">Preview</h3>
                          <span className="text-xs text-muted-foreground">Showing first {csvPreview.length} rows</span>
                        </div>
                        <div className="border rounded overflow-x-auto">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                {csvHeaders.map((header) => (
                                  <TableHead key={header}>{header}</TableHead>
                                ))}
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {csvPreview.map((row, rowIndex) => (
                                <TableRow key={rowIndex}>
                                  {csvHeaders.map((header) => (
                                    <TableCell key={header}>
                                      {row[header]}
                                    </TableCell>
                                  ))}
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      </div>
                    )}
                    
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setIsBulkUploadDialogOpen(false)}>
                        Cancel
                      </Button>
                      <Button 
                        onClick={handleProcessCSV}
                        disabled={
                          bulkCreateMutation.isPending || 
                          !columnMapping.description || 
                          !columnMapping.quantity || 
                          !columnMapping.unitPrice || 
                          !columnMapping.totalPrice
                        }
                      >
                        {bulkCreateMutation.isPending ? 'Uploading...' : 'Upload'}
                      </Button>
                    </DialogFooter>
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </Card>
  );
};

export default InvoiceLineItemsTable;