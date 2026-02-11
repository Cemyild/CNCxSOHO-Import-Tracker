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
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Upload, FileSpreadsheet } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import * as XLSX from "xlsx";

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

interface ExcelUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (products: ProductItem[]) => void;
}

export function ExcelUploadDialog({ open, onOpenChange, onImport }: ExcelUploadDialogProps) {
  const { toast } = useToast();
  const [parsedData, setParsedData] = useState<ProductItem[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [fileName, setFileName] = useState("");

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const workbook = XLSX.read(data, { type: "binary" });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];

        if (jsonData.length < 2) {
          toast({
            title: "Error",
            description: "Excel file must have at least a header row and one data row",
            variant: "destructive",
          });
          return;
        }

        const headers = jsonData[0].map((h: any) => String(h || "").trim().toLowerCase());
        const products: ProductItem[] = [];

        for (let i = 1; i < jsonData.length; i++) {
          const row = jsonData[i];
          if (!row || row.length === 0) continue;

          const product: ProductItem = {
            tempId: `upload-${Date.now()}-${i}`,
            style: "",
            cost: "0",
            unit_count: 0,
            total_value: "0",
            matchStatus: "unmatched",
          };

          headers.forEach((header, index) => {
            const value = String(row[index] || "").trim();
            
            if (header.includes('style')) product.style = value;
            else if (header.includes('color')) product.color = value;
            else if (header.includes('category')) product.category = value;
            else if (header.includes('fabric')) product.fabric_content = value;
            else if (header.includes('cost') || header.includes('price')) {
              const costNum = parseFloat(value);
              product.cost = (isNaN(costNum) || costNum < 0) ? "0.00" : costNum.toFixed(2);
            }
            else if (header.includes('unit') || header.includes('qty') || header.includes('quantity')) {
              const units = parseInt(value);
              product.unit_count = (isNaN(units) || units < 1) ? 0 : units;
            }
            else if (header.includes('country')) product.country_of_origin = value;
            else if (header.includes('hts') || header.includes('hs')) product.hts_code = value;
          });

          const cost = parseFloat(product.cost);
          const units = product.unit_count;
          const validCost = isNaN(cost) ? 0 : cost;
          const validUnits = isNaN(units) ? 0 : units;
          product.total_value = (validCost * validUnits).toFixed(2);

          if (product.style) {
            products.push(product);
          }
        }

        setParsedData(products);
        setShowPreview(true);

        toast({
          title: "Success",
          description: `Parsed ${products.length} products from ${file.name}`,
        });
      } catch (error) {
        toast({
          title: "Error",
          description: "Failed to parse Excel file",
          variant: "destructive",
        });
      }
    };

    reader.readAsBinaryString(file);
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
      description: `Imported ${parsedData.length} products`,
    });
    
    setParsedData([]);
    setShowPreview(false);
    setFileName("");
    onOpenChange(false);
  };

  const handleCancel = () => {
    setParsedData([]);
    setShowPreview(false);
    setFileName("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[85vh] overflow-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            Upload Excel File
          </DialogTitle>
          <DialogDescription>
            Upload an Excel file (.xlsx, .xls) with product data. Expected columns: Style, Color, Category, Fabric, Cost, Unit, Country, HTS Code
          </DialogDescription>
        </DialogHeader>

        {!showPreview ? (
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <Input
                type="file"
                accept=".xlsx,.xls"
                onChange={handleFileUpload}
                data-testid="input-excel-file"
              />
            </div>
            
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleCancel}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground">
              File: <span className="font-medium">{fileName}</span> ({parsedData.length} products)
            </div>

            <div className="border rounded-lg overflow-x-auto max-h-[400px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">#</TableHead>
                    <TableHead className="min-w-[100px]">Style</TableHead>
                    <TableHead className="min-w-[80px]">Color</TableHead>
                    <TableHead className="min-w-[120px]">Category</TableHead>
                    <TableHead className="min-w-[120px]">Fabric</TableHead>
                    <TableHead className="min-w-[80px] text-right">Cost</TableHead>
                    <TableHead className="min-w-[70px] text-right">Units</TableHead>
                    <TableHead className="min-w-[80px]">Country</TableHead>
                    <TableHead className="min-w-[110px]">HTS Code</TableHead>
                    <TableHead className="min-w-[100px] text-right">Total Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parsedData.map((product, index) => (
                    <TableRow key={index}>
                      <TableCell className="text-xs text-muted-foreground">{index + 1}</TableCell>
                      <TableCell className="font-medium text-sm">{product.style}</TableCell>
                      <TableCell className="text-sm">{product.color || "-"}</TableCell>
                      <TableCell className="text-sm">{product.category || "-"}</TableCell>
                      <TableCell className="text-sm">{product.fabric_content || "-"}</TableCell>
                      <TableCell className="text-sm text-right">${product.cost}</TableCell>
                      <TableCell className="text-sm text-right">{product.unit_count}</TableCell>
                      <TableCell className="text-sm">{product.country_of_origin || "-"}</TableCell>
                      <TableCell className="text-sm font-mono">{product.hts_code || "-"}</TableCell>
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
              <Button onClick={handleImport} data-testid="button-import-excel">
                Import {parsedData.length} Products
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
