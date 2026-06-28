import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Trash2, CheckCircle2, AlertCircle, XCircle } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

export interface ProductItem {
  tempId?: string;
  product_id?: number;
  style: string;
  color?: string;
  category?: string;
  description?: string;
  fabric_content?: string;
  cost: string;
  unit_count: number;
  country_of_origin?: string;
  hts_code?: string;
  total_value?: string;
  matchStatus?: string;
  tr_hs_code?: string;
}

interface ProductsTableProps {
  products: ProductItem[];
  onUpdateProduct: (tempId: string, field: keyof ProductItem, value: any) => void;
  onDeleteProduct: (tempId: string) => void;
  onMatchProduct?: (style: string) => any;
  availableProducts?: Array<{ 
    id: number;
    style: string | null; 
    tr_hs_code?: string | null;
    fabric_content?: string | null;
    country_of_origin?: string | null;
    hts_code?: string | null;
  }>;
}

export function ProductsTable({ 
  products, 
  onUpdateProduct, 
  onDeleteProduct,
  onMatchProduct,
  availableProducts = []
}: ProductsTableProps) {
  const { t } = useTranslation();

  const getMatchBadge = (status?: string) => {
    const statusMap = {
      matched: {
        label: t('taxCalcComp.productsTable.matched'),
        icon: CheckCircle2,
        className: "bg-green-500 hover:bg-green-600"
      },
      partial: {
        label: t('taxCalcComp.productsTable.partial'),
        icon: AlertCircle,
        className: "bg-yellow-500 hover:bg-yellow-600"
      },
      unmatched: {
        label: t('taxCalcComp.productsTable.unmatched'),
        icon: XCircle,
        className: "bg-red-500 hover:bg-red-600"
      },
    };
    
    const statusInfo = statusMap[status as keyof typeof statusMap] || statusMap.unmatched;
    const Icon = statusInfo.icon;
    
    return (
      <Badge className={statusInfo.className}>
        <Icon className="mr-1 h-3 w-3" />
        {statusInfo.label}
      </Badge>
    );
  };

  return (
    <div className="border rounded-lg overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-[100px]">{t('taxCalcComp.productsTable.styleRequired')}</TableHead>
            <TableHead className="min-w-[80px]">{t('taxCalcComp.table.color')}</TableHead>
            <TableHead className="min-w-[120px]">{t('taxCalcComp.table.category')}</TableHead>
            <TableHead className="min-w-[150px]">{t('taxCalcComp.productsTable.fabricContent')}</TableHead>
            <TableHead className="min-w-[80px]">{t('taxCalcComp.table.country')}</TableHead>
            <TableHead className="min-w-[120px]">{t('taxCalcComp.table.htsCode')}</TableHead>
            <TableHead className="min-w-[80px]">{t('taxCalcComp.productsTable.costRequired')}</TableHead>
            <TableHead className="min-w-[80px]">{t('taxCalcComp.productsTable.unitsRequired')}</TableHead>
            <TableHead className="min-w-[100px]">{t('taxCalcComp.table.totalValue')}</TableHead>
            <TableHead className="min-w-[150px]">{t('taxCalcComp.productsTable.trHsCode')}</TableHead>
            <TableHead className="min-w-[100px]">{t('taxCalcComp.productsTable.status')}</TableHead>
            <TableHead className="min-w-[100px]">{t('taxCalcComp.productsTable.actions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {products.length === 0 ? (
            <TableRow>
              <TableCell colSpan={12} className="text-center py-8 text-muted-foreground">
                {t('taxCalcComp.productsTable.noProducts')}
              </TableCell>
            </TableRow>
          ) : (
            products.map((product) => (
              <TableRow key={product.tempId}>
                <TableCell>
                  <Input
                    value={product.style}
                    onChange={(e) => {
                      const newStyle = e.target.value;
                      onUpdateProduct(product.tempId!, "style", newStyle);
                      
                      if (onMatchProduct) {
                        const matchData = onMatchProduct(newStyle);
                        Object.entries(matchData).forEach(([key, value]) => {
                          onUpdateProduct(product.tempId!, key as keyof ProductItem, value);
                        });
                      }
                    }}
                    placeholder="W4754P"
                    className="h-8"
                    data-testid={`input-style-${product.tempId}`}
                  />
                </TableCell>
                <TableCell>
                  <Input
                    value={product.color || ""}
                    onChange={(e) => onUpdateProduct(product.tempId!, "color", e.target.value)}
                    placeholder="Ivory"
                    className="h-8"
                    data-testid={`input-color-${product.tempId}`}
                  />
                </TableCell>
                <TableCell>
                  <Input
                    value={product.category || ""}
                    onChange={(e) => onUpdateProduct(product.tempId!, "category", e.target.value)}
                    placeholder="Women's"
                    className="h-8"
                    data-testid={`input-category-${product.tempId}`}
                  />
                </TableCell>
                <TableCell className="text-sm" data-testid={`text-fabric-${product.tempId}`}>
                  {product.fabric_content || <span className="text-muted-foreground italic">-</span>}
                </TableCell>
                <TableCell className="text-sm" data-testid={`text-country-${product.tempId}`}>
                  {product.country_of_origin || <span className="text-muted-foreground italic">-</span>}
                </TableCell>
                <TableCell className="text-sm font-mono" data-testid={`text-hts-${product.tempId}`}>
                  {product.hts_code || <span className="text-muted-foreground italic">-</span>}
                </TableCell>
                <TableCell>
                  <Input
                    type="number"
                    step="0.01"
                    value={product.cost}
                    onChange={(e) => onUpdateProduct(product.tempId!, "cost", e.target.value)}
                    className="h-8"
                    data-testid={`input-cost-${product.tempId}`}
                  />
                </TableCell>
                <TableCell>
                  <Input
                    type="number"
                    value={product.unit_count}
                    onChange={(e) => onUpdateProduct(product.tempId!, "unit_count", parseInt(e.target.value) || 0)}
                    className="h-8"
                    data-testid={`input-units-${product.tempId}`}
                  />
                </TableCell>
                <TableCell className="font-bold" data-testid={`text-total-${product.tempId}`}>
                  ${product.total_value || "0.00"}
                </TableCell>
                <TableCell>
                  <Input
                    value={product.tr_hs_code || ""}
                    onChange={(e) => onUpdateProduct(product.tempId!, "tr_hs_code", e.target.value)}
                    placeholder="6102.10.00.00.00"
                    className="h-8 font-mono text-xs"
                    data-testid={`input-trhs-${product.tempId}`}
                  />
                </TableCell>
                <TableCell>
                  {getMatchBadge(product.matchStatus)}
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onDeleteProduct(product.tempId!)}
                    data-testid={`button-delete-${product.tempId}`}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
