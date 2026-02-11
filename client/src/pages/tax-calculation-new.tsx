import { 
  Calendar,
  Home,
  Inbox,
  Search,
  Settings,
  BarChart2,
  Calculator,
  Plus,
  Save,
  ClipboardPaste,
  Upload as UploadIcon
} from "lucide-react";
import { PageLayout } from "@/components/layout/PageLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import type { InsertTaxCalculation, InsertTaxCalculationItem, Product } from "@shared/schema";
import { InvoiceInfoForm } from "@/components/tax-calculation/InvoiceInfoForm";
import { ProductsTable, ProductItem } from "@/components/tax-calculation/ProductsTable";
import { ExcelPasteDialog } from "@/components/tax-calculation/ExcelPasteDialog";
import { ExcelUploadDialog } from "@/components/tax-calculation/ExcelUploadDialog";
import { MissingDataModal } from "@/components/tax-calculation/MissingDataModal";
import { CalculationLoadingModal } from "@/components/tax-calculation/CalculationLoadingModal";
import { AtrRatesModal } from "@/components/tax-calculation/AtrRatesModal";

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

export default function TaxCalculationNewPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [isFromRemovedItems, setIsFromRemovedItems] = useState(false);
  
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
  const [showPasteDialog, setShowPasteDialog] = useState(false);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('fromRemoved') === 'true') {
      const savedData = sessionStorage.getItem('newCalculationFromRemoved');
      if (savedData) {
        try {
          const parsed = JSON.parse(savedData);
          setInvoiceData({
            reference: parsed.reference || "",
            invoice_no: parsed.invoice_no || "",
            invoice_date: parsed.invoice_date || null,
            transport_cost: parsed.transport_cost || "0",
            insurance_cost: parsed.insurance_cost || "0",
            storage_cost: parsed.storage_cost || "0",
            currency_rate: parsed.currency_rate || "0",
            is_prepaid: parsed.is_prepaid || false,
            is_atr: parsed.is_atr || false,
            status: "draft",
          });

          if (parsed.removedItems && Array.isArray(parsed.removedItems)) {
            const loadedProducts: ProductItem[] = parsed.removedItems.map((item: any, index: number) => ({
              tempId: `removed-${Date.now()}-${index}`,
              style: item.style || "",
              color: item.color || "",
              category: item.category || "",
              description: item.description || "",
              fabric_content: item.fabric_content || "",
              cost: item.cost?.toString() || "0",
              unit_count: item.unit_count || 0,
              country_of_origin: item.country_of_origin || "",
              hts_code: item.hts_code || "",
              tr_hs_code: item.tr_hs_code || "",
              product_id: item.product_id,
              matchStatus: item.product_id ? "matched" : "unmatched",
              total_value: (parseFloat(item.cost || "0") * (item.unit_count || 0)).toFixed(2),
            }));
            setProducts(loadedProducts);
            setIsFromRemovedItems(true);
            toast({
              title: "Items Loaded",
              description: `${loadedProducts.length} items loaded from previous calculation`,
            });
          }
          
          sessionStorage.removeItem('newCalculationFromRemoved');
        } catch (e) {
          console.error('Failed to parse removed items data:', e);
          sessionStorage.removeItem('newCalculationFromRemoved');
        }
      }
    }
  }, [toast]);
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

  const { data: productsData } = useQuery<{ products: Product[] }>({
    queryKey: ["/api/tax-calculation/products"],
  });

  const createCalculationMutation = useMutation({
    mutationFn: async (data: { calculation: Partial<InsertTaxCalculation>; items: ProductItem[]; calculate: boolean }) => {
      setLoadingStep('Creating calculation');
      setLoadingProgress(25);
      console.log('💾 STEP 1: CREATING CALCULATION...');
      
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

      const calcResponse = await apiRequest("POST", "/api/tax-calculation/calculations", calcData);
      if (!calcResponse.ok) {
        const error = await calcResponse.json();
        throw new Error(error.message || "Failed to create calculation");
      }
      
      const { calculation } = await calcResponse.json();
      console.log(`✓ Calculation created (ID: ${calculation.id})`);

      setLoadingStep('Creating items');
      setLoadingProgress(40);
      console.log('📦 STEP 2: CREATING ITEMS...');
      console.log(`[BATCH] Preparing ${data.items.length} items for batch creation`);
      
      const normalizedItems = data.items.map(item => {
        const { tempId, matchStatus, ...itemData } = item;
        
        const cost = parseFloat(itemData.cost);
        const unitCount = parseInt(String(itemData.unit_count));
        const totalValue = parseFloat(itemData.total_value || String(cost * unitCount));
        
        return {
          ...itemData,
          cost: cost,
          unit_count: unitCount,
          total_value: totalValue,
        };
      });

      const batchResponse = await apiRequest(
        "POST", 
        `/api/tax-calculation/calculations/${calculation.id}/items/batch`,
        { items: normalizedItems }
      );
      
      if (!batchResponse.ok) {
        const error = await batchResponse.json();
        throw new Error(error.error || "Failed to create items");
      }
      
      const batchResult = await batchResponse.json();
      console.log(`[BATCH] ✓ Created ${batchResult.count} items in single request`);
      setLoadingProgress(60);

      if (data.calculate) {
        setLoadingStep('Calculating');
        console.log('🧮 STEP 3: CALCULATING TAXES...');
        console.log('⏱️  This may take 1-2 minutes for large calculations...');
        
        const calcTaxResponse = await apiRequest("POST", `/api/tax-calculation/calculations/${calculation.id}/calculate`, {});
        if (!calcTaxResponse.ok) throw new Error("Failed to calculate taxes");
        
        setLoadingProgress(100);
        console.log('✅ CALCULATION COMPLETE');
        
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      return calculation;
    },
    onSuccess: (calculation) => {
      setIsLoading(false);
      queryClient.invalidateQueries({ queryKey: ["/api/tax-calculation/calculations"] });
      toast({
        title: "Success",
        description: "Calculation created successfully",
      });
      navigate(`/tax-calculation/${calculation.id}`);
    },
    onError: (error: Error) => {
      setIsLoading(false);
      toast({
        title: "Error",
        description: error.message || "Failed to create calculation",
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
    setProducts(products.filter(p => p.tempId !== tempId));
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
        // IMPORTANT: Only use matchData.product_id (ignore p.product_id from import)
        product_id: matchData.product_id,
        line_number: index + 1, // Preserve Excel row order (1-based)
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

    // If calculating taxes, validate for missing data
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
          return; // Don't calculate yet
        }
        
        // Check for missing ATR rates if is_atr is enabled
        if (invoiceData.is_atr) {
          setLoadingStep('Checking ATR rates');
          setLoadingProgress(15);
          console.log('📋 STEP 0.5: CHECKING ATR RATES...');
          
          // Build unique HS code + country combinations from products
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
              return; // Show ATR modal before proceeding
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
        return; // Don't proceed with creation
      }
    }

    createCalculationMutation.mutate({
      calculation: invoiceData,
      items: products,
      calculate,
    });
  };

  const handleAtrRatesComplete = async () => {
    setShowAtrRatesModal(false);
    setIsLoading(true);
    setLoadingStep('Proceeding with calculation');
    setLoadingProgress(20);
    
    console.log('[ATR RATES] Modal completed, proceeding with calculation...');
    
    // Use the pending items that were saved before showing the modal
    createCalculationMutation.mutate({
      calculation: invoiceData,
      items: pendingAtrItems.length > 0 ? pendingAtrItems : products,
      calculate: true,
    });
  };

  const handleMissingDataComplete = async () => {
    setShowMissingDataModal(false);
    setIsLoading(true);
    setLoadingStep('Updating product data');
    setLoadingProgress(20);
    
    console.log('[MISSING DATA] Modal completed, fetching updated product data...');
    
    try {
      // Fetch all products from database to get updated product_id and tr_hs_code
      const response = await fetch('/api/tax-calculation/products');
      if (!response.ok) {
        throw new Error('Failed to fetch products');
      }
      
      const { products: dbProducts } = await response.json();
      console.log(`[MISSING DATA] Fetched ${dbProducts.length} products from database`);
      
      // Create a map for quick lookup: style -> product
      const productMap = new Map<string, any>(dbProducts.map((p: any) => [p.style, p]));
      
      // Update items array with database product_id and tr_hs_code
      const updatedItems = products.map(item => {
        const dbProduct = productMap.get(item.style);
        if (dbProduct) {
          console.log(`[MISSING DATA] ✓ Updated ${item.style}: product_id=${(dbProduct as any).id}, tr_hs_code=${(dbProduct as any).tr_hs_code}`);
          return {
            ...item,
            product_id: (dbProduct as any).id,
            tr_hs_code: (dbProduct as any).tr_hs_code,
            // Also update other fields in case they were modified
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
      
      // Check for missing ATR rates if is_atr is enabled
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
              return; // Show ATR modal before proceeding
            }
          }
        }
      }
      
      setLoadingStep('Creating calculation');
      setLoadingProgress(25);
      
      // After adding missing data, proceed with calculation using UPDATED items
      createCalculationMutation.mutate({
        calculation: invoiceData,
        items: updatedItems,
        calculate: true,
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

  return (
    <PageLayout title="New Tax Calculation" navItems={items}>
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold">New Tax Calculation</h1>
            <p className="text-muted-foreground">Create a new tax calculation for import procedures</p>
          </div>
          <div className="flex gap-2">
            <Button 
              variant="outline" 
              onClick={() => navigate("/tax-calculation")}
              data-testid="button-cancel"
            >
              Cancel
            </Button>
            <Button 
              variant="outline" 
              onClick={() => handleSave(false)} 
              disabled={createCalculationMutation.isPending || isLoading}
              data-testid="button-save-draft"
            >
              <Save className="mr-2 h-4 w-4" />
              Save Draft
            </Button>
            <Button 
              onClick={() => handleSave(true)}
              disabled={createCalculationMutation.isPending || isLoading}
              data-testid="button-calculate"
            >
              <Calculator className="mr-2 h-4 w-4" />
              {isLoading ? 'Processing...' : 'Calculate Taxes'}
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>📄 Invoice Information</CardTitle>
          </CardHeader>
          <CardContent>
            <InvoiceInfoForm 
              data={invoiceData} 
              onChange={handleInvoiceChange}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex justify-between items-center">
              <CardTitle>📦 Products</CardTitle>
              <div className="flex gap-2">
                <Button
                  onClick={() => setShowPasteDialog(true)}
                  data-testid="button-paste-excel"
                >
                  <ClipboardPaste className="mr-2 h-4 w-4" />
                  Paste from Excel
                </Button>
                <Button
                  onClick={() => setShowUploadDialog(true)}
                  data-testid="button-upload-excel"
                >
                  <UploadIcon className="mr-2 h-4 w-4" />
                  Upload Excel File
                </Button>
                <Button
                  variant="outline"
                  onClick={addSingleProduct}
                  data-testid="button-add-product"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add Single Product
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
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
        missingProducts={missingData.missingProducts}
        missingHsCodes={missingData.missingHsCodes}
        onComplete={handleMissingDataComplete}
        onCancel={() => setShowMissingDataModal(false)}
      />

      <AtrRatesModal
        open={showAtrRatesModal}
        missingAtrRates={missingAtrRates}
        onComplete={handleAtrRatesComplete}
        onCancel={() => setShowAtrRatesModal(false)}
      />

      <CalculationLoadingModal 
        open={isLoading}
        currentStep={loadingStep}
        progress={loadingProgress}
      />
    </PageLayout>
  );
}
