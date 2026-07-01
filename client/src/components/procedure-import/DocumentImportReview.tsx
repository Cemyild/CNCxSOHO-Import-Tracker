import { useState } from "react";
import { useTranslation } from "react-i18next";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { AnalyzeDocumentResult } from "./types";

interface Props {
  result: AnalyzeDocumentResult;
  getReference: () => string;
  getHeader: () => AnalyzeDocumentResult["header"];
  onCreated: (reference: string) => void;
}

export function DocumentImportReview({ result, getReference, getHeader, onCreated }: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [products, setProducts] = useState(result.products);
  const [isSaving, setIsSaving] = useState(false);

  const num = (v: string) => (v === "" ? 0 : parseFloat(v) || 0);

  const handleCreate = async () => {
    const reference = getReference().trim();
    if (!reference) {
      toast({
        title: t("procedureImport.referenceRequiredTitle"),
        description: t("procedureImport.referenceRequiredDesc"),
        variant: "destructive",
      });
      return;
    }
    setIsSaving(true);
    try {
      const payload = {
        reference,
        header: getHeader(),
        taxes: { customsTax: 0, additionalCustomsTax: 0, kkdf: 0, vat: 0, stampTax: 0 },
        expenses: [],
        serviceInvoices: [],
        products,
        documents: result.documents,
        pdfObjectKey: result.pdfFile.objectKey,
        pdfOriginalFilename: result.pdfFile.originalFilename,
      };
      const res = await apiRequest("POST", "/api/procedures/create-from-document", payload);
      const data = await res.json();
      toast({
        title: t("procedureImport.createdTitle"),
        description: t("procedureImport.createdDesc", {
          ok: data.attachments?.ok ?? 0,
          failed: data.attachments?.failed ?? 0,
        }),
      });
      onCreated(reference);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      toast({ title: t("procedureImport.createFailedTitle"), description: message, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Products */}
      <Card>
        <CardHeader>
          <CardTitle>{t("procedureImport.productsTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("procedureImport.col.style")}</TableHead>
                <TableHead>{t("procedureImport.col.unit")}</TableHead>
                <TableHead>{t("procedureImport.col.cost")}</TableHead>
                <TableHead>{t("procedureImport.col.totalValue")}</TableHead>
                <TableHead>{t("procedureImport.col.trHsCode")}</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.map((p, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <Input
                      value={p.style}
                      onChange={(ev) => {
                        const c = [...products];
                        c[i] = { ...p, style: ev.target.value };
                        setProducts(c);
                      }}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      value={String(p.unit_count)}
                      onChange={(ev) => {
                        const c = [...products];
                        c[i] = { ...p, unit_count: parseInt(ev.target.value) || 0 };
                        setProducts(c);
                      }}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      value={String(p.cost)}
                      onChange={(ev) => {
                        const c = [...products];
                        c[i] = { ...p, cost: num(ev.target.value) };
                        setProducts(c);
                      }}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      value={String(p.total_value)}
                      onChange={(ev) => {
                        const c = [...products];
                        c[i] = { ...p, total_value: num(ev.target.value) };
                        setProducts(c);
                      }}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      value={p.tr_hs_code}
                      onChange={(ev) => {
                        const c = [...products];
                        c[i] = { ...p, tr_hs_code: ev.target.value };
                        setProducts(c);
                      }}
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setProducts(products.filter((_, j) => j !== i))}
                    >
                      {t("procedureImport.remove")}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleCreate} disabled={isSaving}>
          {isSaving ? t("procedureImport.creating") : t("procedureImport.createButton")}
        </Button>
      </div>
    </div>
  );
}
