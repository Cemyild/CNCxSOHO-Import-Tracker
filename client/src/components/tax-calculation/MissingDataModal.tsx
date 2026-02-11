import { useState, useEffect, useMemo } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MissingProductsForm } from "./MissingProductsForm";
import { MissingHsCodesForm } from "./MissingHsCodesForm";

interface Product {
  style: string;
  color?: string;
  category?: string;
  fabric_content?: string;
  country_of_origin?: string;
  hts_code?: string;
  tr_hs_code?: string;
  brand?: string;
  item_description?: string;
}

interface MissingDataModalProps {
  open: boolean;
  missingProducts: Product[];
  missingHsCodes: string[];
  onComplete: () => void;
  onCancel: () => void;
}

export function MissingDataModal({ 
  open, 
  missingProducts, 
  missingHsCodes, 
  onComplete, 
  onCancel 
}: MissingDataModalProps) {
  const [currentStep, setCurrentStep] = useState<'products' | 'hscodes'>('products');
  
  // Filter to unique style codes only
  const uniqueProducts = useMemo(() => {
    const styleMap = new Map<string, Product>();
    missingProducts.forEach(product => {
      if (!styleMap.has(product.style)) {
        // Keep first occurrence, set color to "MIXED" if duplicates exist
        const hasDuplicates = missingProducts.filter(p => p.style === product.style).length > 1;
        styleMap.set(product.style, {
          ...product,
          color: hasDuplicates ? "MIXED" : (product.color || "")
        });
      }
    });
    return Array.from(styleMap.values());
  }, [missingProducts]);
  
  // Reset when modal opens
  useEffect(() => {
    if (open) {
      console.log('=== MISSING DATA MODAL OPENED ===');
      console.log('Total Products:', missingProducts.length);
      console.log('Unique Products:', uniqueProducts.length, uniqueProducts.map(p => p.style));
      console.log('Missing HS Codes:', missingHsCodes.length, missingHsCodes);
      setCurrentStep(uniqueProducts.length > 0 ? 'products' : 'hscodes');
    }
  }, [open, uniqueProducts.length, uniqueProducts, missingHsCodes]);
  
  const handleProductsComplete = () => {
    console.log('[MODAL] Products step complete');
    if (missingHsCodes.length > 0) {
      console.log('[MODAL] Moving to HS codes step');
      setCurrentStep('hscodes');
    } else {
      console.log('[MODAL] No HS codes needed, completing');
      onComplete();
    }
  };
  
  const handleHsCodesComplete = () => {
    console.log('[MODAL] HS codes step complete');
    onComplete();
  };
  
  return (
    <Dialog open={open} onOpenChange={onCancel}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Missing Data Detected</DialogTitle>
          <DialogDescription>
            Please provide missing information before calculating taxes.
            {missingProducts.length > uniqueProducts.length && (
              <span className="text-yellow-600 font-semibold">
                {' '}Note: {missingProducts.length - uniqueProducts.length} duplicate style codes filtered.
              </span>
            )}
          </DialogDescription>
        </DialogHeader>
        
        {currentStep === 'products' && uniqueProducts.length > 0 && (
          <MissingProductsForm 
            products={uniqueProducts}
            onComplete={handleProductsComplete}
          />
        )}
        
        {currentStep === 'hscodes' && missingHsCodes.length > 0 && (
          <MissingHsCodesForm 
            hsCodes={missingHsCodes}
            onComplete={handleHsCodesComplete}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
