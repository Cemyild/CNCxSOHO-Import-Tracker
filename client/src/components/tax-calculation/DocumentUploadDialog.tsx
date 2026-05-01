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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FileSpreadsheet, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

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

interface DocumentUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (products: ProductItem[]) => void;
}

export function DocumentUploadDialog({
  open,
  onOpenChange,
  onImport,
}: DocumentUploadDialogProps) {
  const { toast } = useToast();
  const [parsedData, setParsedData] = useState<ProductItem[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [fileName, setFileName] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setIsLoading(true);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/tax-calculation/extract-products", {
        method: "POST",
        body: formData,
      });

      const text = await response.text();
      let data: any = {};
      try { data = JSON.parse(text); } catch { /* not JSON */ }

      if (!response.ok) {
        toast({
          title: "Error",
          description: data.error ?? "Failed to extract products",
          variant: "destructive",
        });
        return;
      }

      if (!data.products || data.products.length === 0) {
        toast({
          title: "No products found",
          description: "No product rows could be extracted from the document",
          variant: "destructive",
        });
        return;
      }

      setParsedData(data.products);
      setShowPreview(true);
      toast({
        title: "Success",
        description: `Found ${data.products.length} products in ${file.name}`,
      });
    } catch {
      toast({
        title: "Error",
        description: "Failed to upload document",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleImport = () => {
    onImport(parsedData);
    toast({
      title: "Success",
      description: `Imported ${parsedData.length} products`,
    });
    handleClose();
  };

  const handleClose = () => {
    setParsedData([]);
    setShowPreview(false);
    setFileName("");
    setIsLoading(false);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) handleClose(); }}>
      <DialogContent className="max-w-6xl max-h-[85vh] overflow-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            Upload Invoice / Excel
          </DialogTitle>
          <DialogDescription>
            Upload a commercial invoice PDF or Excel file (.pdf, .xlsx, .xls).
            AI will extract product data automatically.
          </DialogDescription>
        </DialogHeader>

        {!showPreview ? (
          <div className="space-y-4">
            <Input
              type="file"
              accept=".pdf,.xlsx,.xls"
              onChange={handleFileUpload}
              disabled={isLoading}
            />
            {isLoading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                AI is extracting product data…
              </div>
            )}
            <Button variant="outline" onClick={handleClose} disabled={isLoading}>
              Cancel
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground">
              File: <span className="font-medium">{fileName}</span> (
              {parsedData.length} products)
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
                    <TableHead className="min-w-[100px] text-right">
                      Total Value
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parsedData.map((product, index) => (
                    <TableRow key={index}>
                      <TableCell className="text-xs text-muted-foreground">
                        {index + 1}
                      </TableCell>
                      <TableCell className="font-medium text-sm">
                        {product.style}
                      </TableCell>
                      <TableCell className="text-sm">
                        {product.color || "-"}
                      </TableCell>
                      <TableCell className="text-sm">
                        {product.category || "-"}
                      </TableCell>
                      <TableCell className="text-sm">
                        {product.fabric_content || "-"}
                      </TableCell>
                      <TableCell className="text-sm text-right">
                        {product.cost ? `$${product.cost}` : "-"}
                      </TableCell>
                      <TableCell className="text-sm text-right">
                        {product.unit_count}
                      </TableCell>
                      <TableCell className="text-sm">
                        {product.country_of_origin || "-"}
                      </TableCell>
                      <TableCell className="text-sm font-mono">
                        {product.hts_code || "-"}
                      </TableCell>
                      <TableCell className="text-sm font-bold text-right">
                        {product.total_value ? `$${product.total_value}` : "-"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setShowPreview(false)}>
                Back
              </Button>
              <Button onClick={handleImport}>
                Import {parsedData.length} Products
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
