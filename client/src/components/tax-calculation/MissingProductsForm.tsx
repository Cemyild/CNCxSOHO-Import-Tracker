import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from '@/hooks/use-toast';
import { Info } from 'lucide-react';

interface Product {
  style: string;
  brand?: string;
  category?: string;
  color?: string;
  fabric_content?: string;
  country_of_origin?: string;
  hts_code?: string;
  tr_hs_code?: string;
  item_description?: string;
  product_id?: number | null;
}

interface TrHsCodeSuggestion {
  tr_hs_code: string;
  product_count: number;
}

export function MissingProductsForm({ 
  products, 
  onComplete
}: {
  products: Product[];
  onComplete: () => void;
}) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [suggestions, setSuggestions] = useState<TrHsCodeSuggestion[]>([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [brands, setBrands] = useState<string[]>([]);
  const [isLoadingBrands, setIsLoadingBrands] = useState(true);
  
  const currentProduct = products[currentIndex];
  
  const [formData, setFormData] = useState({
    brand: '',
    style: '',
    category: '',
    color: '',
    fabric_content: '',
    country_of_origin: '',
    hts_code: '',
    tr_hs_code: '',
    item_description: '',
  });

  // Fetch brands from database on mount
  useEffect(() => {
    const fetchBrands = async () => {
      try {
        const response = await fetch('/api/tax-calculation/products');
        if (response.ok) {
          const data = await response.json();
          const brandSet = new Set<string>();
          (data.products || []).forEach((p: any) => {
            if (p.brand && p.brand.trim() !== '') {
              brandSet.add(p.brand);
            }
          });
          const uniqueBrands = Array.from(brandSet).sort();
          setBrands(uniqueBrands);
        }
      } catch (error) {
        console.error('Failed to fetch brands:', error);
      } finally {
        setIsLoadingBrands(false);
      }
    };
    
    fetchBrands();
  }, []);
  
  // Update form ONLY when currentIndex changes
  useEffect(() => {
    if (currentProduct) {
      console.log(`[FORM] Showing product ${currentIndex + 1}/${products.length}:`, currentProduct.style);
      const category = currentProduct.category || '';
      setFormData({
        brand: currentProduct.brand || '',
        style: currentProduct.style || '',
        category: category,
        color: currentProduct.color || '',
        fabric_content: currentProduct.fabric_content || '',
        country_of_origin: currentProduct.country_of_origin || '',
        hts_code: currentProduct.hts_code || '',
        tr_hs_code: currentProduct.tr_hs_code || '',
        item_description: currentProduct.item_description || category,
      });
    }
  }, [currentIndex]);

  // Fetch TR HS Code suggestions when product changes
  useEffect(() => {
    const fetchSuggestions = async () => {
      if (!currentProduct?.hts_code) {
        setSuggestions([]);
        return;
      }
      
      setIsLoadingSuggestions(true);
      
      try {
        const response = await fetch(
          `/api/tax-calculation/products/suggestions-by-hts?hts_code=${encodeURIComponent(currentProduct.hts_code)}`
        );
        
        if (response.ok) {
          const data = await response.json();
          setSuggestions(data.suggestions || []);
        } else {
          setSuggestions([]);
        }
      } catch (error) {
        console.error('Failed to fetch suggestions:', error);
        setSuggestions([]);
      } finally {
        setIsLoadingSuggestions(false);
      }
    };
    
    fetchSuggestions();
  }, [currentProduct?.hts_code, currentIndex]);

  // Handle clicking a suggestion
  const handleUseSuggestion = (trHsCode: string) => {
    setFormData(prev => ({ ...prev, tr_hs_code: trHsCode }));
    toast({
      title: "TR HS Code Selected",
      description: `Applied: ${trHsCode}`
    });
  };

  // Sync item_description with category when category changes
  const handleCategoryChange = (value: string) => {
    setFormData(prev => ({ 
      ...prev, 
      category: value,
      item_description: value
    }));
  };
  
  const handleSave = async () => {
    if (isSaving || !currentProduct) return;
    
    setIsSaving(true);
    
    try {
      console.log(`[FORM] Saving product ${currentIndex + 1}/${products.length}:`, formData.style);
      
      const response = await fetch('/api/tax-calculation/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.details || error.error || 'Failed to save');
      }
      
      await response.json();
      
      toast({
        title: "Success",
        description: `${formData.style} saved to database`
      });
      
      console.log(`[FORM] Save successful. Current index: ${currentIndex}, Total: ${products.length}`);
      
      // Check if last product
      if (currentIndex >= products.length - 1) {
        console.log('[FORM] Last product saved, calling onComplete');
        setTimeout(() => onComplete(), 100);
      } else {
        // Move to next product
        const nextIndex = currentIndex + 1;
        console.log(`[FORM] Moving to next product: ${nextIndex + 1}/${products.length}`);
        setCurrentIndex(nextIndex);
      }
      
    } catch (error) {
      console.error('[FORM] Save error:', error);
      toast({
        title: "Error",
        description: `Failed to save: ${error instanceof Error ? error.message : 'Unknown error'}`,
        variant: "destructive"
      });
    } finally {
      setIsSaving(false);
    }
  };
  
  if (!currentProduct) {
    return null;
  }
  
  return (
    <div className="space-y-4">
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
        <h3 className="font-semibold mb-2">
          Product {currentIndex + 1} of {products.length}: {currentProduct.style}
        </h3>
        <p className="text-sm text-gray-600">
          Edit the information if needed and save it to the database.
        </p>
      </div>

      {currentProduct?.hts_code && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h4 className="font-semibold text-blue-800 mb-2 flex items-center gap-2">
            <Info className="w-5 h-5" />
            Suggested TR HS Codes
          </h4>
          <p className="text-sm text-blue-600 mb-3">
            Based on HTS Code: <span className="font-mono font-semibold">{currentProduct.hts_code}</span>
          </p>
          
          {isLoadingSuggestions ? (
            <div className="text-sm text-gray-500">Loading suggestions...</div>
          ) : suggestions.length > 0 ? (
            <div className="space-y-2">
              {suggestions.map((suggestion, idx) => (
                <div 
                  key={idx}
                  className="flex items-center justify-between bg-white rounded-md px-3 py-2 border border-blue-100"
                >
                  <div>
                    <span className="font-mono font-medium">{suggestion.tr_hs_code}</span>
                    <span className="text-sm text-gray-500 ml-2">
                      ({suggestion.product_count} product{suggestion.product_count > 1 ? 's' : ''} use this)
                    </span>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="text-blue-600 hover:bg-blue-50"
                    onClick={() => handleUseSuggestion(suggestion.tr_hs_code)}
                    data-testid={`button-use-suggestion-${idx}`}
                  >
                    Use This
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-gray-500 italic">
              No matching TR HS Codes found for this HTS Code in the database.
            </div>
          )}
        </div>
      )}
      
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Brand</Label>
          <Select 
            value={formData.brand} 
            onValueChange={(value) => setFormData({ ...formData, brand: value })}
          >
            <SelectTrigger data-testid="select-brand">
              <SelectValue placeholder={isLoadingBrands ? "Loading brands..." : "Select a brand"} />
            </SelectTrigger>
            <SelectContent>
              {brands.map((brand) => (
                <SelectItem key={brand} value={brand}>
                  {brand}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        
        <div>
          <Label>Style *</Label>
          <Input 
            value={formData.style} 
            disabled
            data-testid="input-style"
          />
        </div>
        
        <div>
          <Label>Category</Label>
          <Input 
            value={formData.category}
            onChange={(e) => handleCategoryChange(e.target.value)}
            placeholder="e.g., Women's Outerwear"
            data-testid="input-category"
          />
        </div>
        
        <div>
          <Label>Color</Label>
          <Input 
            value={formData.color || "MIXED"}
            disabled
            className="bg-gray-50 text-gray-600"
            data-testid="input-color"
          />
          <p className="text-xs text-gray-500 mt-1">
            Color is set to "MIXED" for products with multiple colors in the invoice
          </p>
        </div>
        
        <div className="col-span-2">
          <Label>Fabric Content</Label>
          <Input 
            value={formData.fabric_content}
            onChange={(e) => setFormData({ ...formData, fabric_content: e.target.value })}
            placeholder="e.g., 100% COTTON"
            data-testid="input-fabric-content"
          />
        </div>
        
        <div>
          <Label>Country of Origin</Label>
          <Input 
            value={formData.country_of_origin}
            onChange={(e) => setFormData({ ...formData, country_of_origin: e.target.value.toUpperCase() })}
            placeholder="e.g., CN, VN, TR"
            maxLength={2}
            data-testid="input-country-origin"
          />
        </div>
        
        <div>
          <Label>HTS Code</Label>
          <Input 
            value={formData.hts_code}
            onChange={(e) => setFormData({ ...formData, hts_code: e.target.value })}
            placeholder="e.g., 6102.10.0000"
            data-testid="input-hts-code"
          />
        </div>
        
        <div className="col-span-2">
          <Label>TR HS CODE</Label>
          <Input 
            value={formData.tr_hs_code}
            onChange={(e) => setFormData({ ...formData, tr_hs_code: e.target.value })}
            placeholder="e.g., 6102.10.00.00.00"
            data-testid="input-tr-hs-code"
          />
          <p className="text-xs text-gray-500 mt-1">
            Select a suggestion above or enter manually
          </p>
        </div>
        
        <div className="col-span-2">
          <Label>Item Description</Label>
          <Input 
            value={formData.item_description}
            onChange={(e) => setFormData({ ...formData, item_description: e.target.value })}
            placeholder="Auto-filled from category"
            data-testid="input-item-description"
          />
          <p className="text-xs text-gray-500 mt-1">
            Automatically set to match Category
          </p>
        </div>
      </div>
      
      <div className="flex justify-end space-x-2">
        <Button 
          variant="outline" 
          onClick={onComplete} 
          disabled={isSaving}
          data-testid="button-skip-all-products"
        >
          Skip All
        </Button>
        <Button 
          onClick={handleSave} 
          disabled={isSaving}
          data-testid="button-save-product"
        >
          {isSaving ? 'Saving...' : 'Save & Next'}
        </Button>
      </div>
    </div>
  );
}
