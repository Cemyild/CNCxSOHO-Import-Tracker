import { 
  Calendar,
  Home,
  Inbox,
  Search,
  Settings,
  BarChart2,
  Calculator,
  Save,
  ClipboardPaste,
  Upload as UploadIcon,
  ArrowLeft
} from "lucide-react";
import { PageLayout } from "@/components/layout/PageLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useState, useEffect } from "react";
import { useLocation, useParams, Link } from "wouter";
import type { InsertTaxCalculation, TaxCalculation, TaxCalculationItem, Product } from "@shared/schema";
import { InvoiceInfoForm } from "@/components/tax-calculation/InvoiceInfoForm";
import { ProductsTable, ProductItem } from "@/components/tax-calculation/ProductsTable";
import { ExcelPasteDialog } from "@/components/tax-calculation/ExcelPasteDialog";
import { ExcelUploadDialog } from "@/components/tax-calculation/ExcelUploadDialog";
import { MissingDataModal } from "@/components/tax-calculation/MissingDataModal";
import { CalculationLoadingModal } from "@/components/tax-calculation/CalculationLoadingModal";
import { AtrRatesModal } from "@/components/tax-calculation/AtrRatesModal";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";

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
];

export default function TaxCalculationEditPage() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  
  const [invoiceData, setInvoiceData] = useState<Partial<InsertTaxCalculation>>({
    reference: "",
    invoice_no: "",
    invoice_date: null,
    transport_cost: "0",
    insurance_cost: "0",
    storage_cost: "0",
    currency_rate: "0",
    is_prepaid: false,
    is_atr: false,
    status: "draft",
  });

  const [products, setProducts] = useState<ProductItem[]>([]);
  const [originalProducts, setOriginalProducts] = useState<ProductItem[]>([]);
  const [removedProducts, setRemovedProducts] = useState<ProductItem[]>([]);
  const [showPasteDialog, setShowPasteDialog] = useState(false);
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [showMissingDataModal, setShowMissingDataModal] = useState(false);
  const [missingData, setMissingData] = useState<{ missingProducts: any[]; missingHsCodes: string[] }>({
    missingProducts: [],
    missingHsCodes: []
  });
  const [validationCache, setValidationCache] = useState<string | null>(null);
  
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState('');
  const [loadingProgress, setLoadingProgress] = useState(0);
  
  const [showAtrRatesModal, setShowAtrRatesModal] = useState(false);
  const [missingAtrRates, setMissingAtrRates] = useState<{ tr_hs_code: string; country_of_origin: string }[]>([]);
  const [pendingAtrItems, setPendingAtrItems] = useState<ProductItem[]>([]);
  
  const [showRemovedItemsDialog, setShowRemovedItemsDialog] = useState(false);
  const [pendingRemovedItems, setPendingRemovedItems] = useState<ProductItem[]>([]);
  const [isDataLoaded, setIsDataLoaded] = useState(false);

  const { data: calculationData, isLoading: isLoadingCalculation } = useQuery<{ calculation: TaxCalculation; items: TaxCalculationItem[] }>({
    queryKey: [`/api/tax-calculation/calculations/${id}`],
    enabled: !!id,
  });

  const { data: productsData } = useQuery<{ products: Product[] }>({
    queryKey: ["/api/tax-calculation/products"],
  });

  useEffect(() => {
    if (calculationData && !isDataLoaded) {
      const { calculation, items: calcItems } = calculationData;
      
      setInvoiceData({
        reference: calculation.reference || "",
        invoice_no: calculation.invoice_no || "",
        invoice_date: calculation.invoice_date || null,
        transport_cost: calculation.transport_cost || "0",
        insurance_cost: calculation.insurance_cost || "0",
        storage_cost: calculation.storage_cost || "0",
        currency_rate: calculation.currency_rate || "0",
        is_prepaid: calculation.is_prepaid || false,
        is_atr: calculation.is_atr || false,
        status: calculation.status || "draft",
      });

      const loadedProducts: ProductItem[] = calcItems.map((item, index) => ({
        tempId: `existing-${item.id}`,
        id: item.id,
        product_id: item.product_id || undefined,
        style: item.style || "",
        color: item.color || "",
        category: item.category || "",
        description: item.description || "",
        fabric_content: item.fabric_content || "",
        cost: item.cost?.toString() || "0",
        unit_count: item.unit_count || 0,
        country_of_origin: item.country_of_origin || "",
        hts_code: item.hts_code || "",
        total_value: item.total_value?.toString() || "0",
        tr_hs_code: item.tr_hs_code || "",
        matchStatus: item.product_id ? "matched" : "unmatched",
        line_number: item.line_number || index + 1,
      }));

      setProducts(loadedProducts);
      setOriginalProducts(loadedProducts);
      setIsDataLoaded(true);
    }
  }, [calculationData, isDataLoaded]);

  const updateCalculationMutation = useMutation({
    mutationFn: async (data: { calculation: Partial<InsertTaxCalculation>; items: ProductItem[]; calculate: boolean; removedItemIds: number[] }) => {
      setLoadingStep('Updating calculation');
      setLoadingProgress(25);
      console.log('💾 STEP 1: UPDATING CALCULATION...');
      
      const totalValue = data.items.reduce((sum, item) => sum + parseFloat(item.total_value || "0"), 0);
      const totalQuantity = data.items.reduce((sum, item) => sum + (item.unit_count || 0), 0);

      const invoiceDateValue = data.calculation.invoice_date;
      const calcData = {
        ...data.calculation,
        invoice_date: invoiceDateValue && typeof invoiceDateValue === 'object' && 'toISOString' in invoiceDateValue
          ? (invoiceDateValue as Date).toISOString().split('T')[0]
          : invoiceDateValue,
        total_value: totalValue.toString(),
        total_quantity: totalQuantity,
      };

      const calcResponse = await apiRequest("PUT", `/api/tax-calculation/calculations/${id}`, calcData);
      if (!calcResponse.ok) {
        const error = await calcResponse.json();
        throw new Error(error.message || "Failed to update calculation");
      }

      if (data.removedItemIds.length > 0) {
        setLoadingStep('Removing items');
        setLoadingProgress(35);
        console.log(`🗑️ Removing ${data.removedItemIds.length} items...`);
        
        for (const itemId of data.removedItemIds) {
          const deleteResponse = await apiRequest("DELETE", `/api/tax-calculation/items/${itemId}`);
          if (!deleteResponse.ok) {
            console.warn(`Failed to delete item ${itemId}`);
          }
        }
      }

      setLoadingStep('Updating items');
      setLoadingProgress(50);
      console.log('📦 STEP 2: UPDATING ITEMS...');

      for (const item of data.items) {
        const { tempId, matchStatus, id: itemId, ...itemData } = item as any;
        
        const cost = parseFloat(itemData.cost);
        const unitCount = parseInt(String(itemData.unit_count));
        const totalValue = parseFloat(itemData.total_value || String(cost * unitCount));
        
        const normalizedItem = {
          ...itemData,
          cost: cost,
          unit_count: unitCount,
          total_value: totalValue,
        };

        if (tempId?.startsWith('existing-') && itemId) {
          const updateResponse = await apiRequest("PUT", `/api/tax-calculation/items/${itemId}`, normalizedItem);
          if (!updateResponse.ok) {
            console.warn(`Failed to update item ${itemId}`);
          }
        } else if (tempId?.startsWith('temp-') || tempId?.startsWith('removed-')) {
          const createResponse = await apiRequest("POST", `/api/tax-calculation/calculations/${id}/items`, normalizedItem);
          if (!createResponse.ok) {
            console.warn(`Failed to create new item`);
          }
        }
      }
      
      setLoadingProgress(70);

      if (data.calculate) {
        setLoadingStep('Calculating');
        console.log('🧮 STEP 3: CALCULATING TAXES...');
        
        const calcTaxResponse = await apiRequest("POST", `/api/tax-calculation/calculations/${id}/calculate`, {});
        if (!calcTaxResponse.ok) throw new Error("Failed to calculate taxes");
        
        setLoadingProgress(100);
        console.log('✅ CALCULATION COMPLETE');
        
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      return { id };
    },
    onSuccess: () => {
      setIsLoading(false);
      queryClient.invalidateQueries({ queryKey: ["/api/tax-calculation/calculations"] });
      queryClient.invalidateQueries({ queryKey: [`/api/tax-calculation/calculations/${id}`] });
      
      if (removedProducts.length > 0) {
        setPendingRemovedItems(removedProducts);
        setShowRemovedItemsDialog(true);
      } else {
        toast({
          title: "Success",
          description: "Calculation updated successfully",
        });
        navigate(`/tax-calculation/${id}`);
      }
    },
    onError: (error: Error) => {
      setIsLoading(false);
      toast({
        title: "Error",
        description: error.message || "Failed to update calculation",
        variant: "destructive",
      });
    },
  });

  const handleInvoiceChange = (field: string, value: any) => {
    setInvoiceData({ ...invoiceData, [field]: value });
  };

  const addSingleProduct = () => {
    const tempId = `temp-${Date.now()}`;
    setProducts([...products, {
      tempId,
      style: "",
      cost: "0.00",
      unit_count: 1,
      total_value: "0.00",
      matchStatus: "unmatched",
    }]);
  };

  const updateProduct = (tempId: string, field: keyof ProductItem, value: any) => {
    setProducts(products.map(p => {
      if (p.tempId !== tempId) return p;
      
      const updated = { ...p, [field]: value };
      
      if (field === 'cost' || field === 'unit_count') {
        const costStr = field === 'cost' ? value : updated.cost;
        const cost = parseFloat(costStr || "0");
        const validCost = isNaN(cost) ? 0 : cost;
        
        const units = field === 'unit_count' ? parseInt(String(value)) : (updated.unit_count || 0);
        const validUnits = isNaN(units) ? 0 : units;
        
        updated.cost = validCost.toFixed(2);
        updated.unit_count = validUnits;
        updated.total_value = (validCost * validUnits).toFixed(2);
      }
      
      return updated;
    }));
  };

  const deleteProduct = (tempId: string) => {
    const productToRemove = products.find(p => p.tempId === tempId);
    if (productToRemove) {
      if (tempId.startsWith('existing-')) {
        setRemovedProducts([...removedProducts, productToRemove]);
      }
      setProducts(products.filter(p => p.tempId !== tempId));
    }
  };

  const matchProductToDatabase = (style: string) => {
    const existingProducts = productsData?.products || [];
    const styleMatch = style?.toLowerCase().trim();
    
    if (!styleMatch) {
      return { 
        product_id: undefined,
        tr_hs_code: "",
        fabric_content: undefined,
        country_of_origin: undefined,
        hts_code: undefined,
        matchStatus: "unmatched" as const 
      };
    }
    
    const matched = existingProducts.find(
      ep => ep.style?.toLowerCase().trim() === styleMatch
    );
    
    if (matched) {
      if (matched.tr_hs_code) {
        return {
          product_id: matched.id,
          tr_hs_code: matched.tr_hs_code,
          fabric_content: matched.fabric_content || undefined,
          country_of_origin: matched.country_of_origin || undefined,
          hts_code: matched.hts_code || undefined,
          matchStatus: "matched" as const,
        };
      } else {
        return {
          product_id: matched.id,
          tr_hs_code: "",
          fabric_content: matched.fabric_content || undefined,
          country_of_origin: matched.country_of_origin || undefined,
          hts_code: matched.hts_code || undefined,
          matchStatus: "partial" as const,
        };
      }
    }
    
    return { 
      product_id: undefined,
      tr_hs_code: "",
      fabric_content: undefined,
      country_of_origin: undefined,
      hts_code: undefined,
      matchStatus: "unmatched" as const 
    };
  };

  const handleImportProducts = (importedProducts: ProductItem[]) => {
    const validProducts = importedProducts.filter(p => {
      if (!p.style || p.style.trim().length === 0) return false;
      
      const cost = parseFloat(p.cost);
      if (isNaN(cost) || cost <= 0) return false;
      
      const units = parseInt(String(p.unit_count));
      if (isNaN(units) || units <= 0) return false;
      
      return true;
    });
    
    const updatedProducts = validProducts.map((p, index) => {
      const matchData = matchProductToDatabase(p.style);
      const cost = parseFloat(p.cost);
      const units = parseInt(String(p.unit_count));
      const totalValue = (cost * units).toFixed(2);
      
      return { 
        ...p,
        product_id: matchData.product_id,
        line_number: products.length + index + 1,
        tr_hs_code: matchData.tr_hs_code || p.tr_hs_code || "",
        fabric_content: p.fabric_content || matchData.fabric_content,
        country_of_origin: p.country_of_origin || matchData.country_of_origin,
        hts_code: p.hts_code || matchData.hts_code,
        matchStatus: matchData.matchStatus,
        cost: cost.toFixed(2),
        unit_count: units,
        total_value: totalValue
      };
    });
    
    if (validProducts.length < importedProducts.length) {
      toast({
        title: "Import Warning",
        description: `${importedProducts.length - validProducts.length} products skipped (missing style, zero cost, or zero units)`,
        variant: "destructive",
      });
    }
    
    setProducts([...products, ...updatedProducts]);
  };

  const validateBeforeCalculation = async () => {
    const productHash = JSON.stringify(products.map(p => ({ style: p.style, tr_hs_code: p.tr_hs_code, product_id: p.product_id })));
    
    if (validationCache === productHash) {
      console.log('[VALIDATE] ⏭️  Using cached validation result (products unchanged)');
      return missingData;
    }
    
    console.log('[VALIDATE] Running fresh validation');
    
    const missingProducts = [];
    const hsCodesToCheck = new Set<string>();
    
    for (let i = 0; i < products.length; i++) {
      const product = products[i];
      
      if (!product.product_id && product.style) {
        const missingProduct = {
          style: product.style,
          color: product.color,
          category: product.category,
          fabric_content: product.fabric_content,
          country_of_origin: product.country_of_origin,
          hts_code: product.hts_code,
          tr_hs_code: product.tr_hs_code,
          item_description: product.description
        };
        missingProducts.push(missingProduct);
      }
      
      if (product.tr_hs_code) {
        hsCodesToCheck.add(product.tr_hs_code);
      }
    }
    
    let missingHsCodes: string[] = [];
    
    if (hsCodesToCheck.size > 0) {
      console.log(`[VALIDATE] Checking ${hsCodesToCheck.size} unique HS codes in batch`);
      const response = await apiRequest("POST", "/api/tax-calculation/hs-codes/validate", {
        codes: Array.from(hsCodesToCheck)
      });
      
      const { missing } = await response.json();
      missingHsCodes = missing;
      console.log(`[VALIDATE] ✓ Found ${hsCodesToCheck.size - missing.length} HS codes, ${missing.length} missing`);
    }
    
    const result = {
      missingProducts,
      missingHsCodes
    };
    
    setValidationCache(productHash);
    setMissingData(result);
    
    return result;
  };

  const handleSave = async (calculate: boolean) => {
    if (!invoiceData.reference) {
      toast({
        title: "Validation Error",
        description: "Reference is required",
        variant: "destructive",
      });
      return;
    }

    if (products.length === 0) {
      toast({
        title: "Validation Error",
        description: "At least one product is required",
        variant: "destructive",
      });
      return;
    }

    const hasInvalidProduct = products.some(p => {
      const cost = parseFloat(p.cost);
      const units = parseInt(String(p.unit_count));
      return !p.style || !p.style.trim() || isNaN(cost) || cost <= 0 || isNaN(units) || units <= 0;
    });

    if (hasInvalidProduct) {
      toast({
        title: "Validation Error",
        description: "All products must have a style, valid cost (>0), and units (>0)",
        variant: "destructive",
      });
      return;
    }

    const removedItemIds = removedProducts
      .filter(p => p.tempId?.startsWith('existing-'))
      .map(p => (p as any).id)
      .filter((id): id is number => typeof id === 'number');

    if (calculate) {
      try {
        setIsLoading(true);
        setLoadingStep('Validating');
        setLoadingProgress(10);
        console.log('📝 STEP 0: VALIDATING...');
        
        const validation = await validateBeforeCalculation();
        
        if (validation.missingProducts.length > 0 || validation.missingHsCodes.length > 0) {
          setIsLoading(false);
          setMissingData(validation);
          setShowMissingDataModal(true);
          return;
        }
        
        if (invoiceData.is_atr) {
          setLoadingStep('Checking ATR rates');
          setLoadingProgress(15);
          console.log('📋 STEP 0.5: CHECKING ATR RATES...');
          
          const atrCheckItems = products
            .filter(p => p.tr_hs_code && p.country_of_origin)
            .map(p => ({ tr_hs_code: p.tr_hs_code!, country_of_origin: p.country_of_origin! }));
          
          if (atrCheckItems.length > 0) {
            const atrResponse = await apiRequest("POST", "/api/tax-calculation/atr-rates/check", {
              items: atrCheckItems
            });
            
            if (!atrResponse.ok) {
              throw new Error("Failed to check ATR rates");
            }
            
            const atrResult = await atrResponse.json();
            console.log(`[ATR CHECK] Result:`, atrResult);
            
            if (atrResult.hasMissingRates && atrResult.missingHsCodes.length > 0) {
              setIsLoading(false);
              setMissingAtrRates(atrResult.missingHsCodes);
              setPendingAtrItems(products);
              setShowAtrRatesModal(true);
              return;
            }
          }
        }
      } catch (error) {
        console.error('[SAVE] Validation error:', error);
        setIsLoading(false);
        toast({
          title: "Validation Error",
          description: error instanceof Error ? error.message : "Failed to validate data. Please try again.",
          variant: "destructive",
        });
        return;
      }
    } else {
      setIsLoading(true);
    }

    updateCalculationMutation.mutate({
      calculation: invoiceData,
      items: products,
      calculate,
      removedItemIds,
    });
  };

  const handleAtrRatesComplete = async () => {
    setShowAtrRatesModal(false);
    setIsLoading(true);
    setLoadingStep('Proceeding with calculation');
    setLoadingProgress(20);
    
    console.log('[ATR RATES] Modal completed, proceeding with calculation...');
    
    const removedItemIds = removedProducts
      .filter(p => p.tempId?.startsWith('existing-'))
      .map(p => (p as any).id)
      .filter((id): id is number => typeof id === 'number');
    
    updateCalculationMutation.mutate({
      calculation: invoiceData,
      items: pendingAtrItems.length > 0 ? pendingAtrItems : products,
      calculate: true,
      removedItemIds,
    });
  };

  const handleMissingDataComplete = async () => {
    setShowMissingDataModal(false);
    setIsLoading(true);
    setLoadingStep('Updating product data');
    setLoadingProgress(20);
    
    console.log('[MISSING DATA] Modal completed, fetching updated product data...');
    
    try {
      const response = await fetch('/api/tax-calculation/products');
      if (!response.ok) {
        throw new Error('Failed to fetch products');
      }
      
      const { products: dbProducts } = await response.json();
      console.log(`[MISSING DATA] Fetched ${dbProducts.length} products from database`);
      
      const productMap = new Map<string, any>(dbProducts.map((p: any) => [p.style, p]));
      
      const updatedItems = products.map(item => {
        const dbProduct = productMap.get(item.style);
        if (dbProduct) {
          console.log(`[MISSING DATA] ✓ Updated ${item.style}: product_id=${(dbProduct as any).id}, tr_hs_code=${(dbProduct as any).tr_hs_code}`);
          return {
            ...item,
            product_id: (dbProduct as any).id,
            tr_hs_code: (dbProduct as any).tr_hs_code,
            category: (dbProduct as any).category || item.category,
            fabric_content: (dbProduct as any).fabric_content || item.fabric_content,
            country_of_origin: (dbProduct as any).country_of_origin || item.country_of_origin,
            hts_code: (dbProduct as any).hts_code || item.hts_code,
          };
        }
        console.warn(`[MISSING DATA] ⚠️  Product not found in database: ${item.style}`);
        return item;
      });
      
      console.log('[MISSING DATA] ✓ All items updated with database product data');
      
      if (invoiceData.is_atr) {
        setLoadingStep('Checking ATR rates');
        setLoadingProgress(22);
        console.log('[MISSING DATA] Checking ATR rates for updated items...');
        
        const atrCheckItems = updatedItems
          .filter(p => p.tr_hs_code && p.country_of_origin)
          .map(p => ({ tr_hs_code: p.tr_hs_code!, country_of_origin: p.country_of_origin! }));
        
        if (atrCheckItems.length > 0) {
          const atrResponse = await apiRequest("POST", "/api/tax-calculation/atr-rates/check", {
            items: atrCheckItems
          });
          
          if (atrResponse.ok) {
            const atrResult = await atrResponse.json();
            
            if (atrResult.hasMissingRates && atrResult.missingHsCodes.length > 0) {
              setIsLoading(false);
              setMissingAtrRates(atrResult.missingHsCodes);
              setPendingAtrItems(updatedItems);
              setShowAtrRatesModal(true);
              return;
            }
          }
        }
      }
      
      setLoadingStep('Updating calculation');
      setLoadingProgress(25);
      
      const removedItemIds = removedProducts
        .filter(p => p.tempId?.startsWith('existing-'))
        .map(p => (p as any).id)
        .filter((id): id is number => typeof id === 'number');
      
      updateCalculationMutation.mutate({
        calculation: invoiceData,
        items: updatedItems,
        calculate: true,
        removedItemIds,
      });
    } catch (error) {
      console.error('[MISSING DATA] Error fetching products:', error);
      setIsLoading(false);
      toast({
        title: "Error",
        description: "Failed to refresh product data. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleCreateNewCalculationWithRemovedItems = () => {
    setShowRemovedItemsDialog(false);
    setRemovedProducts([]);
    
    const removedItemsData = pendingRemovedItems.map(item => ({
      style: item.style,
      color: item.color,
      category: item.category,
      description: item.description,
      fabric_content: item.fabric_content,
      cost: item.cost,
      unit_count: item.unit_count,
      country_of_origin: item.country_of_origin,
      hts_code: item.hts_code,
      tr_hs_code: item.tr_hs_code,
      product_id: item.product_id,
    }));
    
    const newCalcData = {
      reference: invoiceData.reference ? `${invoiceData.reference}-SPLIT` : "",
      invoice_no: invoiceData.invoice_no || "",
      invoice_date: invoiceData.invoice_date || null,
      transport_cost: "0",
      insurance_cost: "0",
      storage_cost: "0",
      currency_rate: invoiceData.currency_rate || "0",
      is_prepaid: invoiceData.is_prepaid || false,
      is_atr: invoiceData.is_atr || false,
      removedItems: removedItemsData,
    };
    
    sessionStorage.setItem('newCalculationFromRemoved', JSON.stringify(newCalcData));
    
    toast({
      title: "Success",
      description: "Calculation updated. Redirecting to create new calculation with removed items...",
    });
    
    navigate('/tax-calculation/new?fromRemoved=true');
  };

  const handleSkipNewCalculation = () => {
    setShowRemovedItemsDialog(false);
    setRemovedProducts([]);
    setPendingRemovedItems([]);
    toast({
      title: "Success",
      description: "Calculation updated successfully",
    });
    navigate(`/tax-calculation/${id}`);
  };

  if (isLoadingCalculation) {
    return (
      <PageLayout title="Edit Tax Calculation" navItems={items}>
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-muted-foreground">Loading calculation...</div>
        </div>
      </PageLayout>
    );
  }

  if (!calculationData) {
    return (
      <PageLayout title="Edit Tax Calculation" navItems={items}>
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-muted-foreground">Calculation not found</div>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout title="Edit Tax Calculation" navItems={items}>
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Link href={`/tax-calculation/${id}`}>
                <Button variant="ghost" size="sm" data-testid="button-back">
                  <ArrowLeft className="h-4 w-4 mr-1" />
                  Back to Results
                </Button>
              </Link>
            </div>
            <h1 className="text-3xl font-bold">Edit Tax Calculation</h1>
            <p className="text-muted-foreground">Modify calculation details and items</p>
          </div>
          <div className="flex gap-2">
            <Button 
              variant="outline" 
              onClick={() => navigate(`/tax-calculation/${id}`)}
              data-testid="button-cancel"
            >
              Cancel
            </Button>
            <Button 
              variant="outline" 
              onClick={() => handleSave(false)} 
              disabled={updateCalculationMutation.isPending || isLoading}
              data-testid="button-save-draft"
            >
              <Save className="mr-2 h-4 w-4" />
              Save Changes
            </Button>
            <Button 
              onClick={() => handleSave(true)}
              disabled={updateCalculationMutation.isPending || isLoading}
              data-testid="button-recalculate"
            >
              <Calculator className="mr-2 h-4 w-4" />
              {isLoading ? 'Processing...' : 'Save & Recalculate'}
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Invoice Information</CardTitle>
          </CardHeader>
          <CardContent>
            <InvoiceInfoForm 
              data={invoiceData} 
              onChange={handleInvoiceChange}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Products ({products.length} items)</CardTitle>
            <div className="flex gap-2">
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => setShowPasteDialog(true)}
                data-testid="button-paste-excel"
              >
                <ClipboardPaste className="mr-2 h-4 w-4" />
                Paste from Excel
              </Button>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => setShowUploadDialog(true)}
                data-testid="button-upload-excel"
              >
                <UploadIcon className="mr-2 h-4 w-4" />
                Upload Excel
              </Button>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={addSingleProduct}
                data-testid="button-add-product"
              >
                Add Product
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {removedProducts.length > 0 && (
              <div className="mb-4 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-md">
                <p className="text-sm text-yellow-800 dark:text-yellow-200">
                  {removedProducts.length} item(s) marked for removal. These will be removed when you save.
                </p>
              </div>
            )}
            <ProductsTable
              products={products}
              onUpdateProduct={updateProduct}
              onDeleteProduct={deleteProduct}
              onMatchProduct={matchProductToDatabase}
              availableProducts={productsData?.products || []}
            />
          </CardContent>
        </Card>
      </div>

      <ExcelPasteDialog
        open={showPasteDialog}
        onOpenChange={setShowPasteDialog}
        onImport={handleImportProducts}
      />

      <ExcelUploadDialog
        open={showUploadDialog}
        onOpenChange={setShowUploadDialog}
        onImport={handleImportProducts}
      />

      <MissingDataModal
        open={showMissingDataModal}
        onCancel={() => setShowMissingDataModal(false)}
        missingProducts={missingData.missingProducts}
        missingHsCodes={missingData.missingHsCodes}
        onComplete={handleMissingDataComplete}
      />

      <CalculationLoadingModal
        open={isLoading}
        currentStep={loadingStep}
        progress={loadingProgress}
      />

      <AtrRatesModal
        open={showAtrRatesModal}
        onCancel={() => setShowAtrRatesModal(false)}
        missingAtrRates={missingAtrRates}
        onComplete={handleAtrRatesComplete}
      />

      <Dialog open={showRemovedItemsDialog} onOpenChange={setShowRemovedItemsDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Calculation with Removed Items?</DialogTitle>
            <DialogDescription>
              You removed {pendingRemovedItems.length} item(s) from this calculation. 
              Would you like to create a new calculation with these removed items?
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <div className="max-h-40 overflow-y-auto border rounded-md p-2">
              {pendingRemovedItems.map((item, idx) => (
                <div key={idx} className="text-sm py-1 border-b last:border-b-0">
                  <span className="font-medium">{item.style}</span>
                  <span className="text-muted-foreground ml-2">
                    {item.unit_count} pcs @ ${item.cost}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleSkipNewCalculation} data-testid="button-skip-new-calc">
              No, Just Save
            </Button>
            <Button onClick={handleCreateNewCalculationWithRemovedItems} data-testid="button-create-new-calc">
              Yes, Create New Calculation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageLayout>
  );
}
