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
  const [taxes, setTaxes] = useState(result.taxes);
  const [expenses, setExpenses] = useState(result.expenses);
  const [serviceInvoices, setServiceInvoices] = useState(result.serviceInvoices);
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
        taxes,
        expenses,
        serviceInvoices,
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
      {/* Taxes */}
      <Card>
        <CardHeader>
          <CardTitle>{t("procedureImport.taxesTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {(["customsTax", "additionalCustomsTax", "kkdf", "vat", "stampTax"] as const).map((k) => (
            <div key={k}>
              <label className="text-sm">{t(`procedureImport.tax.${k}`)}</label>
              <Input
                type="number"
                value={String(taxes[k] ?? 0)}
                onChange={(e) => setTaxes({ ...taxes, [k]: num(e.target.value) })}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Import expenses */}
      <Card>
        <CardHeader>
          <CardTitle>{t("procedureImport.expensesTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("procedureImport.col.category")}</TableHead>
                <TableHead>{t("procedureImport.col.amount")}</TableHead>
                <TableHead>{t("procedureImport.col.currency")}</TableHead>
                <TableHead>{t("procedureImport.col.invoiceNumber")}</TableHead>
                <TableHead>{t("procedureImport.col.page")}</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {expenses.map((e, i) => (
                <TableRow key={i}>
                  <TableCell>{t(`procedureImport.category.${e.category}`, e.category)}</TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      value={String(e.amount)}
                      onChange={(ev) => {
                        const c = [...expenses];
                        c[i] = { ...e, amount: num(ev.target.value) };
                        setExpenses(c);
                      }}
                    />
                  </TableCell>
                  <TableCell>{e.currency}</TableCell>
                  <TableCell>
                    <Input
                      value={e.invoiceNumber}
                      onChange={(ev) => {
                        const c = [...expenses];
                        c[i] = { ...e, invoiceNumber: ev.target.value };
                        setExpenses(c);
                      }}
                    />
                  </TableCell>
                  <TableCell>{e.originalPage ?? "-"}</TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setExpenses(expenses.filter((_, j) => j !== i))}
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

      {/* Service invoices */}
      <Card>
        <CardHeader>
          <CardTitle>{t("procedureImport.serviceInvoicesTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("procedureImport.col.invoiceNumber")}</TableHead>
                <TableHead>{t("procedureImport.col.amount")}</TableHead>
                <TableHead>{t("procedureImport.col.currency")}</TableHead>
                <TableHead>{t("procedureImport.col.date")}</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {serviceInvoices.map((si, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <Input
                      value={si.invoiceNumber}
                      onChange={(ev) => {
                        const c = [...serviceInvoices];
                        c[i] = { ...si, invoiceNumber: ev.target.value };
                        setServiceInvoices(c);
                      }}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      value={String(si.amount)}
                      onChange={(ev) => {
                        const c = [...serviceInvoices];
                        c[i] = { ...si, amount: num(ev.target.value) };
                        setServiceInvoices(c);
                      }}
                    />
                  </TableCell>
                  <TableCell>{si.currency}</TableCell>
                  <TableCell>
                    <Input
                      type="date"
                      value={si.date}
                      onChange={(ev) => {
                        const c = [...serviceInvoices];
                        c[i] = { ...si, date: ev.target.value };
                        setServiceInvoices(c);
                      }}
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setServiceInvoices(serviceInvoices.filter((_, j) => j !== i))}
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
