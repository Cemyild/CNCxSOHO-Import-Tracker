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

export interface InvoiceMetadata {
  invoice_no?: string;
  invoice_date?: string;
  shipper?: string;
}

interface DocumentUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (products: ProductItem[], invoiceMetadata?: InvoiceMetadata) => void;
  title?: string;
  description?: string;
  importButtonLabel?: (count: number) => string;
}

export function DocumentUploadDialog({
  open,
  onOpenChange,
  onImport,
  title,
  description,
  importButtonLabel,
}: DocumentUploadDialogProps) {
  const { toast } = useToast();
  const [parsedData, setParsedData] = useState<ProductItem[]>([]);
  const [invoiceMeta, setInvoiceMeta] = useState<InvoiceMetadata | undefined>(undefined);
  const [showPreview, setShowPreview] = useState(false);
  const [fileName, setFileName] = useState("");
  const [s3Key, setS3Key] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // Shared response handler — works for both multipart upload and JSON
  // {s3_key} requests, since the server returns the same shape.
  const handleExtractionResponse = async (response: Response, sourceLabel: string) => {
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
    setInvoiceMeta(data.invoiceMetadata);
    setShowPreview(true);
    toast({
      title: "Success",
      description: `Found ${data.products.length} products in ${sourceLabel}`,
    });
  };

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

      await handleExtractionResponse(response, file.name);
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

  // Load by S3 key — used by automation flows (e.g. Cowork via Chrome
  // extension) where programmatic <input type="file"> assignment is blocked
  // by browser security. The caller PUT the file to S3 first (via the
  // prepare_invoice_upload MCP tool), then pastes the returned key here.
  const handleS3KeyUpload = async () => {
    const key = s3Key.trim();
    if (!key) {
      toast({ title: "S3 key gerekli", description: "Lütfen S3 anahtarını yapıştır", variant: "destructive" });
      return;
    }
    setFileName(key.split("/").pop() ?? key);
    setIsLoading(true);
    try {
      const response = await fetch("/api/tax-calculation/extract-products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ s3_key: key }),
      });
      await handleExtractionResponse(response, key.split("/").pop() ?? key);
    } catch {
      toast({
        title: "Error",
        description: "Failed to fetch from S3 key",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleImport = () => {
    onImport(parsedData, invoiceMeta);
    toast({
      title: "Success",
      description: `Imported ${parsedData.length} products`,
    });
    handleClose();
  };

  const handleClose = () => {
    setParsedData([]);
    setInvoiceMeta(undefined);
    setShowPreview(false);
    setFileName("");
    setS3Key("");
    setIsLoading(false);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) handleClose(); }}>
      <DialogContent className="max-w-6xl max-h-[85vh] overflow-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            {title ?? "Upload Invoice / Excel"}
          </DialogTitle>
          <DialogDescription>
            {description ??
              "Upload a commercial invoice PDF or Excel file (.pdf, .xlsx, .xls). AI will extract product data automatically."}
          </DialogDescription>
        </DialogHeader>

        {!showPreview ? (
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1 block">Dosyadan yükle</label>
              <Input
                key={fileName}
                type="file"
                accept=".pdf,.xlsx,.xls"
                onChange={handleFileUpload}
                disabled={isLoading}
              />
            </div>

            <div className="relative">
              <div className="absolute inset-0 flex items-center" aria-hidden="true">
                <div className="w-full border-t" />
              </div>
              <div className="relative flex justify-center">
                <span className="bg-background px-2 text-xs uppercase text-muted-foreground">veya</span>
              </div>
            </div>

            <div>
              <label className="text-sm font-medium mb-1 block">
                S3 anahtarı ile yükle
                <span className="text-xs text-muted-foreground font-normal ml-1">
                  (otomasyon / Cowork için)
                </span>
              </label>
              <div className="flex gap-2">
                <Input
                  type="text"
                  placeholder="örn. mcp-uploads/1779165792540-TR00028_Draft_Tax_File.xlsx"
                  value={s3Key}
                  onChange={(e) => setS3Key(e.target.value)}
                  disabled={isLoading}
                />
                <Button onClick={handleS3KeyUpload} disabled={isLoading || !s3Key.trim()}>
                  Yükle
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                `prepare_invoice_upload` ile S3'e PUT edilmiş dosyanın anahtarını yapıştır.
              </p>
            </div>

            {isLoading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                AI ürün verilerini çıkarıyor…
              </div>
            )}
            <Button variant="outline" onClick={handleClose} disabled={isLoading}>
              İptal
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground">
              File: <span className="font-medium">{fileName}</span> (
              {parsedData.length} products)
            </div>

            {invoiceMeta && (invoiceMeta.invoice_no || invoiceMeta.invoice_date || invoiceMeta.shipper) && (
              <div className="rounded-md border bg-muted/40 p-3 text-sm">
                <div className="font-medium mb-1">Detected invoice info</div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  <div><span className="text-muted-foreground">Invoice #: </span>{invoiceMeta.invoice_no || "-"}</div>
                  <div><span className="text-muted-foreground">Date: </span>{invoiceMeta.invoice_date || "-"}</div>
                  <div><span className="text-muted-foreground">Shipper: </span>{invoiceMeta.shipper || "-"}</div>
                </div>
              </div>
            )}

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
                {importButtonLabel
                  ? importButtonLabel(parsedData.length)
                  : `Import ${parsedData.length} Products`}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
