import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from '@/hooks/use-toast';
import { Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';

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
  const { t } = useTranslation();
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
      title: t('taxCalcComp.missingProducts.trHsSelectedTitle'),
      description: t('taxCalcComp.missingProducts.applied', { code: trHsCode })
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
        throw new Error(error.details || error.error || t('taxCalcComp.missingProducts.failedToSave'));
      }

      await response.json();

      toast({
        title: t('common.success'),
        description: t('taxCalcComp.missingProducts.savedToDatabase', { style: formData.style })
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
        title: t('common.error'),
        description: t('taxCalcComp.missingProducts.saveFailed', { error: error instanceof Error ? error.message : t('taxCalcComp.missingProducts.unknownError') }),
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
          {t('taxCalcComp.missingProducts.productHeading', { current: currentIndex + 1, total: products.length, style: currentProduct.style })}
        </h3>
        <p className="text-sm text-gray-600">
          {t('taxCalcComp.missingProducts.editAndSave')}
        </p>
      </div>

      {currentProduct?.hts_code && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h4 className="font-semibold text-blue-800 mb-2 flex items-center gap-2">
            <Info className="w-5 h-5" />
            {t('taxCalcComp.missingProducts.suggestedTrHsCodes')}
          </h4>
          <p className="text-sm text-blue-600 mb-3">
            {t('taxCalcComp.missingProducts.basedOnHts')} <span className="font-mono font-semibold">{currentProduct.hts_code}</span>
          </p>

          {isLoadingSuggestions ? (
            <div className="text-sm text-gray-500">{t('taxCalcComp.missingProducts.loadingSuggestions')}</div>
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
                      {t('taxCalcComp.missingProducts.productsUseThis', { count: suggestion.product_count })}
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
                    {t('taxCalcComp.missingProducts.useThis')}
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-gray-500 italic">
              {t('taxCalcComp.missingProducts.noMatchingTrHs')}
            </div>
          )}
        </div>
      )}
      
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>{t('taxCalcComp.missingProducts.brand')}</Label>
          <Select
            value={formData.brand}
            onValueChange={(value) => setFormData({ ...formData, brand: value })}
          >
            <SelectTrigger data-testid="select-brand">
              <SelectValue placeholder={isLoadingBrands ? t('taxCalcComp.missingProducts.loadingBrands') : t('taxCalcComp.missingProducts.selectBrand')} />
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
          <Label>{t('taxCalcComp.missingProducts.styleRequired')}</Label>
          <Input
            value={formData.style}
            disabled
            data-testid="input-style"
          />
        </div>

        <div>
          <Label>{t('taxCalcComp.missingProducts.category')}</Label>
          <Input
            value={formData.category}
            onChange={(e) => handleCategoryChange(e.target.value)}
            placeholder={t('taxCalcComp.missingProducts.categoryPlaceholder')}
            data-testid="input-category"
          />
        </div>

        <div>
          <Label>{t('taxCalcComp.missingProducts.color')}</Label>
          <Input
            value={formData.color || "MIXED"}
            disabled
            className="bg-gray-50 text-gray-600"
            data-testid="input-color"
          />
          <p className="text-xs text-gray-500 mt-1">
            {t('taxCalcComp.missingProducts.colorMixedNote')}
          </p>
        </div>

        <div className="col-span-2">
          <Label>{t('taxCalcComp.missingProducts.fabricContent')}</Label>
          <Input
            value={formData.fabric_content}
            onChange={(e) => setFormData({ ...formData, fabric_content: e.target.value })}
            placeholder={t('taxCalcComp.missingProducts.fabricPlaceholder')}
            data-testid="input-fabric-content"
          />
        </div>

        <div>
          <Label>{t('taxCalcComp.missingProducts.countryOfOrigin')}</Label>
          <Input
            value={formData.country_of_origin}
            onChange={(e) => setFormData({ ...formData, country_of_origin: e.target.value.toUpperCase() })}
            placeholder={t('taxCalcComp.missingProducts.countryPlaceholder')}
            maxLength={2}
            data-testid="input-country-origin"
          />
        </div>

        <div>
          <Label>{t('taxCalcComp.missingProducts.htsCode')}</Label>
          <Input
            value={formData.hts_code}
            onChange={(e) => setFormData({ ...formData, hts_code: e.target.value })}
            placeholder={t('taxCalcComp.missingProducts.htsPlaceholder')}
            data-testid="input-hts-code"
          />
        </div>

        <div className="col-span-2">
          <Label>{t('taxCalcComp.missingProducts.trHsCode')}</Label>
          <Input
            value={formData.tr_hs_code}
            onChange={(e) => setFormData({ ...formData, tr_hs_code: e.target.value })}
            placeholder={t('taxCalcComp.missingProducts.trHsPlaceholder')}
            data-testid="input-tr-hs-code"
          />
          <p className="text-xs text-gray-500 mt-1">
            {t('taxCalcComp.missingProducts.selectOrEnterManually')}
          </p>
        </div>

        <div className="col-span-2">
          <Label>{t('taxCalcComp.missingProducts.itemDescription')}</Label>
          <Input
            value={formData.item_description}
            onChange={(e) => setFormData({ ...formData, item_description: e.target.value })}
            placeholder={t('taxCalcComp.missingProducts.itemDescriptionPlaceholder')}
            data-testid="input-item-description"
          />
          <p className="text-xs text-gray-500 mt-1">
            {t('taxCalcComp.missingProducts.autoSetToCategory')}
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
          {t('taxCalcComp.missingProducts.skipAll')}
        </Button>
        <Button
          onClick={handleSave}
          disabled={isSaving}
          data-testid="button-save-product"
        >
          {isSaving ? t('taxCalcComp.missingProducts.saving') : t('taxCalcComp.missingProducts.saveNext')}
        </Button>
      </div>
    </div>
  );
}
