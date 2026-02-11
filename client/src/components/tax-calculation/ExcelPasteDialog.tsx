import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ClipboardPaste, Upload, CheckCircle2, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";

interface ProductItem {
  tempId?: string;
  style: string;
  color?: string;
  category?: string;
  fabric_content?: string;
  cost: string;
  unit_count: number;
  country_of_origin?: string;
  hts_code?: string;
  total_value?: string;
  matchStatus?: string;
}

interface ExcelPasteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (products: ProductItem[]) => void;
}

export function ExcelPasteDialog({ open, onOpenChange, onImport }: ExcelPasteDialogProps) {
  const { toast } = useToast();
  const [pasteData, setPasteData] = useState("");
  const [parsedData, setParsedData] = useState<ProductItem[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [parseWarnings, setParseWarnings] = useState<string[]>([]);

  const detectSeparator = (text: string): string => {
    const firstLine = text.split('\n')[0];
    const tabCount = (firstLine.match(/\t/g) || []).length;
    const commaCount = (firstLine.match(/,/g) || []).length;
    
    if (tabCount >= commaCount) return '\t';
    return ',';
  };

  const parseValue = (value: string | undefined, type: 'string' | 'number'): any => {
    if (!value || value.trim() === '') {
      return type === 'number' ? 0 : '';
    }
    if (type === 'number') {
      const num = parseFloat(value.trim());
      return isNaN(num) ? 0 : num;
    }
    return value.trim();
  };

  const validateProduct = (product: ProductItem, rowNum: number): string | null => {
    if (!product.style) return `Row ${rowNum}: Missing style`;
    const cost = parseFloat(product.cost);
    if (isNaN(cost) || cost <= 0) return `Row ${rowNum}: Invalid or zero cost`;
    if (product.unit_count <= 0) return `Row ${rowNum}: Invalid or zero units`;
    return null;
  };

  const parseExcelData = () => {
    if (!pasteData.trim()) {
      toast({
        title: "Error",
        description: "Please paste some data first",
        variant: "destructive",
      });
      return;
    }

    const lines = pasteData.trim().split('\n').filter(line => line.trim());
    if (lines.length === 0) {
      toast({
        title: "Error",
        description: "No data found",
        variant: "destructive",
      });
      return;
    }

    const separator = detectSeparator(pasteData);
    const products: ProductItem[] = [];
    const warnings: string[] = [];

    lines.forEach((line, index) => {
      const columns = line.split(separator);
      const rowNum = index + 1;

      // Expected 8 columns: HTS Code, Country, Style, Color, Category, Fabric, Cost, Units
      if (columns.length < 5) {
        warnings.push(`Row ${rowNum}: Too few columns (expected 8, got ${columns.length})`);
        return;
      }

      const costValue = parseValue(columns[6], 'number');
      const unitValue = parseValue(columns[7], 'number');

      const product: ProductItem = {
        tempId: `paste-${Date.now()}-${index}`,
        hts_code: parseValue(columns[0], 'string'),
        country_of_origin: parseValue(columns[1], 'string'),
        style: parseValue(columns[2], 'string'),
        color: parseValue(columns[3], 'string'),
        category: parseValue(columns[4], 'string'),
        fabric_content: parseValue(columns[5], 'string'),
        cost: costValue.toFixed(2),
        unit_count: Math.floor(unitValue),
        total_value: (costValue * unitValue).toFixed(2),
        matchStatus: "unmatched",
      };

      const validation = validateProduct(product, rowNum);
      if (validation) {
        warnings.push(validation);
        return;
      }

      products.push(product);
    });

    if (products.length === 0) {
      toast({
        title: "Error",
        description: "No valid products found. Check that each row has Style, Cost, and Units.",
        variant: "destructive",
      });
      return;
    }

    setParsedData(products);
    setParseWarnings(warnings);
    setShowPreview(true);

    if (warnings.length > 0) {
      toast({
        title: "Warning",
        description: `Parsed ${products.length} products, but ${warnings.length} rows were skipped`,
        variant: "destructive",
      });
    } else {
      toast({
        title: "Success",
        description: `✅ Found ${products.length} products with 8 columns each`,
      });
    }
  };

  const handleImport = () => {
    if (parsedData.length === 0) {
      toast({
        title: "Error",
        description: "No data to import",
        variant: "destructive",
      });
      return;
    }

    onImport(parsedData);
    toast({
      title: "Success",
      description: `Imported ${parsedData.length} products successfully`,
    });
    
    setPasteData("");
    setParsedData([]);
    setShowPreview(false);
    setParseWarnings([]);
    onOpenChange(false);
  };

  const handleCancel = () => {
    setPasteData("");
    setParsedData([]);
    setShowPreview(false);
    setParseWarnings([]);
    onOpenChange(false);
  };

  const exampleData = `HTS Code\tCountry\tStyle\tColor\tCategory\tFabric\tCost\tUnits
6102.10.0000\tCN\tW4754P\tIvory\tWomen's Outerwear\t100% COTTON\t19.48\t40
4202.22.8100\tCN\tA0481U\tBlack\tAccessory - Bags\t100% NYLON\t11.50\t30`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[85vh] overflow-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardPaste className="h-5 w-5" />
            Paste from Excel
          </DialogTitle>
          <DialogDescription>
            Paste tab-separated data with 8 columns: HTS Code, Country, Style, Color, Category, Fabric Content, Cost, Units
          </DialogDescription>
        </DialogHeader>

        {!showPreview ? (
          <div className="space-y-4">
            <Textarea
              placeholder={exampleData}
              value={pasteData}
              onChange={(e) => setPasteData(e.target.value)}
              className="min-h-[250px] font-mono text-xs"
              data-testid="textarea-paste-data"
            />
            
            <div className="flex gap-2">
              <Button onClick={parseExcelData} data-testid="button-parse-data">
                <Upload className="mr-2 h-4 w-4" />
                Parse Data
              </Button>
              <Button variant="outline" onClick={handleCancel}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              {parseWarnings.length === 0 ? (
                <Badge variant="default" className="bg-green-600">
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  {parsedData.length} products parsed successfully
                </Badge>
              ) : (
                <Badge variant="destructive">
                  <AlertCircle className="h-3 w-3 mr-1" />
                  {parseWarnings.length} rows skipped
                </Badge>
              )}
            </div>

            {parseWarnings.length > 0 && (
              <div className="bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3 text-xs">
                <p className="font-semibold text-yellow-800 dark:text-yellow-200 mb-1">Warnings:</p>
                <ul className="list-disc list-inside space-y-1 text-yellow-700 dark:text-yellow-300">
                  {parseWarnings.slice(0, 5).map((warning, i) => (
                    <li key={i}>{warning}</li>
                  ))}
                  {parseWarnings.length > 5 && (
                    <li>...and {parseWarnings.length - 5} more</li>
                  )}
                </ul>
              </div>
            )}

            <div className="border rounded-lg overflow-x-auto max-h-[400px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">#</TableHead>
                    <TableHead className="min-w-[110px]">HTS Code</TableHead>
                    <TableHead className="min-w-[80px]">Country</TableHead>
                    <TableHead className="min-w-[100px]">Style</TableHead>
                    <TableHead className="min-w-[80px]">Color</TableHead>
                    <TableHead className="min-w-[120px]">Category</TableHead>
                    <TableHead className="min-w-[120px]">Fabric</TableHead>
                    <TableHead className="min-w-[80px] text-right">Cost</TableHead>
                    <TableHead className="min-w-[70px] text-right">Units</TableHead>
                    <TableHead className="min-w-[100px] text-right">Total Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parsedData.map((product, index) => (
                    <TableRow key={index}>
                      <TableCell className="text-xs text-muted-foreground">{index + 1}</TableCell>
                      <TableCell className="text-sm font-mono">{product.hts_code || "-"}</TableCell>
                      <TableCell className="text-sm">{product.country_of_origin || "-"}</TableCell>
                      <TableCell className="font-medium text-sm">{product.style}</TableCell>
                      <TableCell className="text-sm">{product.color || "-"}</TableCell>
                      <TableCell className="text-sm">{product.category || "-"}</TableCell>
                      <TableCell className="text-sm">{product.fabric_content || "-"}</TableCell>
                      <TableCell className="text-sm text-right">${product.cost}</TableCell>
                      <TableCell className="text-sm text-right">{product.unit_count}</TableCell>
                      <TableCell className="text-sm font-bold text-right">${product.total_value}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setShowPreview(false)}>
                Back
              </Button>
              <Button onClick={handleImport} data-testid="button-import-data">
                Import {parsedData.length} Products
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
