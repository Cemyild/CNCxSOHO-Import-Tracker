import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  CalendarIcon,
  Check,
  ChevronDown,
  Download,
  FileSpreadsheet,
  Loader2,
  Plus,
  Trash2,
  Upload,
  Wand2,
} from "lucide-react";
import { PageLayout } from "@/components/layout/PageLayout";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import {
  emptyLineItem,
  nextLineItemId,
  parseDraftTaxFile,
  type InvoiceLineItem,
} from "@/lib/draft-tax-parse";
import {
  DEFAULT_FINAL_DESTINATIONS,
  DEFAULT_PAYMENT_TERMS,
  DEFAULT_PORTS_OF_LOADING,
  DELIVERY_PLACES,
  EMPTY_INVOICE_HEADER,
  EMPTY_PALLET_DRAFT,
  GOODS_DESCRIPTIONS,
  IMPORTERS,
  INCOTERMS,
  palletCbm,
  SHIPMENT_MODES,
  SHIPPERS,
  type InvoiceHeaderForm,
  type PalletDraft,
  type PalletRow,
} from "@/lib/invoice-maker-data";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadCustomOptions(storageKey: string): string[] {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function saveCustomOptions(storageKey: string, options: string[]) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(options));
  } catch {
    // localStorage unavailable — options just won't persist
  }
}

// ---------------------------------------------------------------------------
// AddableSelect: dropdown with an inline "add new option" popover.
// User-added options persist in localStorage under storageKey.
// ---------------------------------------------------------------------------

type AddableSelectProps = {
  value: string;
  onChange: (value: string) => void;
  defaultOptions: string[];
  storageKey: string;
  placeholder: string;
  addLabel: string;
};

function AddableSelect({
  value,
  onChange,
  defaultOptions,
  storageKey,
  placeholder,
  addLabel,
}: AddableSelectProps) {
  const { t } = useTranslation();
  const [customOptions, setCustomOptions] = useState<string[]>(() =>
    loadCustomOptions(storageKey),
  );
  const [addOpen, setAddOpen] = useState(false);
  const [draft, setDraft] = useState("");

  const allOptions = [
    ...defaultOptions,
    ...customOptions.filter((o) => !defaultOptions.includes(o)),
  ];

  const handleAdd = () => {
    const next = draft.trim().toUpperCase();
    if (!next) return;
    if (!allOptions.includes(next)) {
      const updated = [...customOptions, next];
      setCustomOptions(updated);
      saveCustomOptions(storageKey, updated);
    }
    onChange(next);
    setDraft("");
    setAddOpen(false);
  };

  return (
    <div className="flex gap-2">
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="flex-1" data-testid={`select-${storageKey}`}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {allOptions.map((opt) => (
            <SelectItem key={opt} value={opt}>
              {opt}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Popover open={addOpen} onOpenChange={setAddOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="icon" title={addLabel}>
            <Plus className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72" align="end">
          <div className="space-y-2">
            <Label>{addLabel}</Label>
            <div className="flex gap-2">
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAdd();
                  }
                }}
                placeholder={t("invoiceMaker.typeNewValue")}
                autoFocus
              />
              <Button onClick={handleAdd} disabled={!draft.trim()}>
                {t("invoiceMaker.add")}
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Address preview box shown under entity dropdowns
// ---------------------------------------------------------------------------

function AddressPreview({ address }: { address: string | undefined }) {
  if (!address) return null;
  return (
    <div className="mt-2 rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground whitespace-pre-line leading-relaxed">
      {address}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const fmtUsd = (n: number) =>
  n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

type HistoryRow = {
  id: number;
  invoice_no: string;
  total_qty: number;
  total_amount: string;
  filename: string;
  created_at: string;
};

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function InvoiceMakerPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<InvoiceHeaderForm>(EMPTY_INVOICE_HEADER);
  const [goodsOpen, setGoodsOpen] = useState(false);
  const [lineItems, setLineItems] = useState<InvoiceLineItem[]>([]);
  const [resolvingHs, setResolvingHs] = useState(false);
  const draftFileRef = useRef<HTMLInputElement>(null);

  const set = <K extends keyof InvoiceHeaderForm>(
    key: K,
    value: InvoiceHeaderForm[K],
  ) => setForm((prev) => ({ ...prev, [key]: value }));

  const updateLineItem = <K extends keyof InvoiceLineItem>(
    id: string,
    key: K,
    value: InvoiceLineItem[K],
  ) =>
    setLineItems((prev) =>
      prev.map((li) =>
        li.id === id
          ? {
              ...li,
              [key]: value,
              // manual edit of the HTS cell overrides auto-fill marking
              ...(key === "htsCode" ? { hsSource: "manual" as const } : {}),
            }
          : li,
      ),
    );

  const removeLineItem = (id: string) =>
    setLineItems((prev) => prev.filter((li) => li.id !== id));

  const addLineItem = () => setLineItems((prev) => [...prev, emptyLineItem()]);

  const clearLineItems = () => setLineItems([]);

  // Fill empty HTS cells from past tax_calculation_items via the API.
  const resolveHsCodes = async (items: InvoiceLineItem[]) => {
    const styles = Array.from(
      new Set(
        items.filter((li) => !li.htsCode.trim()).map((li) => li.styleNo.trim()),
      ),
    ).filter(Boolean);
    if (styles.length === 0) return;

    setResolvingHs(true);
    try {
      const res = await apiRequest("POST", "/api/invoice-maker/resolve-hs-codes", {
        styles,
      });
      const { matches } = (await res.json()) as {
        matches: Record<string, string>;
      };
      let filled = 0;
      setLineItems((prev) =>
        prev.map((li) => {
          if (!li.htsCode.trim() && matches[li.styleNo.trim()]) {
            return {
              ...li,
              htsCode: matches[li.styleNo.trim()],
              hsSource: "db" as const,
            };
          }
          return li;
        }),
      );
      filled = items.filter(
        (li) => !li.htsCode.trim() && matches[li.styleNo.trim()],
      ).length;
      toast({
        title: t("invoiceMaker.hsLookupTitle"),
        description:
          filled > 0
            ? t("invoiceMaker.hsLookupFilled", { count: filled })
            : t("invoiceMaker.hsLookupNone"),
      });
    } catch (error) {
      toast({
        title: t("invoiceMaker.hsLookupFailedTitle"),
        description: String(error),
        variant: "destructive",
      });
    } finally {
      setResolvingHs(false);
    }
  };

  const handleDraftFile = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = ""; // allow re-selecting the same file
    if (!file) return;

    try {
      const data = await file.arrayBuffer();
      const result = parseDraftTaxFile(data);
      if (result.lineItems.length === 0) {
        toast({
          title: t("invoiceMaker.noRowsTitle"),
          description: t("invoiceMaker.noRowsDesc"),
          variant: "destructive",
        });
        return;
      }
      setLineItems(result.lineItems);
      if (result.poNumbers.length > 0) {
        set("poOrderNo", result.poNumbers.join(", "));
      }
      toast({
        title: t("invoiceMaker.draftLoadedTitle"),
        description: t("invoiceMaker.draftLoadedDesc", {
          skuCount: result.skuRowCount,
          lineCount: result.lineItems.length,
        }),
      });
      await resolveHsCodes(result.lineItems);
    } catch (error) {
      toast({
        title: t("invoiceMaker.parseFailedTitle"),
        description: String(error),
        variant: "destructive",
      });
    }
  };

  const lineTotals = lineItems.reduce(
    (acc, li) => {
      const qty = Number(li.qty) || 0;
      const price = Number(li.unitPrice) || 0;
      acc.qty += qty;
      acc.amount += qty * price;
      return acc;
    },
    { qty: 0, amount: 0 },
  );

  const missingHsCount = lineItems.filter((li) => !li.htsCode.trim()).length;

  // ------------------------------------------------- Pallets (packing list)
  const [pallets, setPallets] = useState<PalletRow[]>([]);
  const [palletDraft, setPalletDraft] = useState<PalletDraft>(
    EMPTY_PALLET_DRAFT,
  );

  const setDraft = <K extends keyof PalletDraft>(key: K, value: string) =>
    setPalletDraft((prev) => ({ ...prev, [key]: value }));

  const palletDraftValid =
    Number(palletDraft.length) > 0 &&
    Number(palletDraft.width) > 0 &&
    Number(palletDraft.height) > 0 &&
    Number(palletDraft.qty) >= 1 &&
    Number(palletDraft.grossWt) > 0;

  const addPallet = () => {
    if (!palletDraftValid) return;
    setPallets((prev) => [
      ...prev,
      { id: nextLineItemId(), ...palletDraft },
    ]);
    setPalletDraft(EMPTY_PALLET_DRAFT);
  };

  const removePallet = (id: string) =>
    setPallets((prev) => prev.filter((p) => p.id !== id));

  const palletTotals = pallets.reduce(
    (acc, p) => {
      acc.count += Number(p.qty) || 0;
      acc.weight += Number(p.grossWt) || 0;
      acc.cbm += palletCbm(p);
      return acc;
    },
    { count: 0, weight: 0, cbm: 0 },
  );

  const palletDimension = (p: PalletRow) =>
    `${p.length}x${p.width}x${p.height}`;

  // ------------------------------------------------------------- History
  const { data: historyData } = useQuery({
    queryKey: ["/api/invoice-maker/history"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/invoice-maker/history");
      return (await res.json()) as { history: HistoryRow[] };
    },
  });
  const history = historyData?.history ?? [];
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  const handleHistoryDownload = async (row: HistoryRow) => {
    setDownloadingId(row.id);
    try {
      const res = await apiRequest(
        "GET",
        `/api/invoice-maker/history/${row.id}/download`,
      );
      triggerDownload(await res.blob(), row.filename);
    } catch (error) {
      toast({
        title: t("invoiceMaker.downloadFailedTitle"),
        description: String(error),
        variant: "destructive",
      });
    } finally {
      setDownloadingId(null);
    }
  };

  // -------------------------------------------------------------- Export
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    if (!selectedShipper) {
      toast({
        title: t("invoiceMaker.shipperRequiredTitle"),
        description: t("invoiceMaker.shipperRequiredDesc"),
        variant: "destructive",
      });
      return;
    }
    if (lineItems.length === 0) {
      toast({
        title: t("invoiceMaker.noLineItemsTitle"),
        description: t("invoiceMaker.noLineItemsDesc"),
        variant: "destructive",
      });
      return;
    }
    if (missingHsCount > 0) {
      toast({
        title: t("invoiceMaker.missingHsTitle"),
        description: t("invoiceMaker.missingHsDesc", { count: missingHsCount }),
        variant: "destructive",
      });
      return;
    }
    if (pallets.length === 0) {
      toast({
        title: t("invoiceMaker.noPalletsTitle"),
        description: t("invoiceMaker.noPalletsDesc"),
        variant: "destructive",
      });
      return;
    }

    setExporting(true);
    try {
      const payload = {
        shipperId: selectedShipper.id,
        shipperAddress: selectedShipper.address,
        importerAddress: selectedImporter?.address ?? "",
        deliveryAddress: selectedDelivery?.address ?? "",
        invoiceNo: form.invoiceNo.trim(),
        invoiceDate: form.invoiceDate
          ? format(form.invoiceDate, "yyyy-MM-dd")
          : null,
        invoiceReference: form.invoiceReference.trim(),
        poOrderNo: form.poOrderNo.trim(),
        portOfLoading: form.portOfLoading,
        finalDestination: form.finalDestination,
        paymentTerm: form.paymentTerm,
        shipmentMode: form.shipmentMode,
        shipmentTerm: form.shipmentTerm,
        whInvoiceRef: form.whInvoiceRef.trim(),
        goodsDescription: form.goodsDescriptions.join(", "),
        totalCartons: form.totalCartons.trim()
          ? Number(form.totalCartons)
          : null,
        lineItems: lineItems.map((li) => ({
          styleNo: li.styleNo,
          styleDescription: li.styleDescription,
          htsCode: li.htsCode,
          composition: li.composition,
          madeIn: li.madeIn,
          qty: Number(li.qty) || 0,
          uom: li.uom,
          currency: li.currency,
          unitPrice: Number(li.unitPrice) || 0,
        })),
        pallets: pallets.map((p) => ({
          dimension: palletDimension(p),
          qty: Number(p.qty) || 0,
          grossWt: Number(p.grossWt) || 0,
        })),
      };

      const res = await apiRequest("POST", "/api/invoice-maker/export", payload);
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition") || "";
      const fnMatch = /filename="([^"]+)"/.exec(cd);
      const filename = fnMatch
        ? fnMatch[1]
        : `${form.invoiceNo.trim() || "Commercial Invoice"} CI & PL.xlsx`;

      triggerDownload(blob, filename);
      queryClient.invalidateQueries({
        queryKey: ["/api/invoice-maker/history"],
      });

      toast({
        title: t("invoiceMaker.excelExportedTitle"),
        description: filename,
      });
    } catch (error) {
      toast({
        title: t("invoiceMaker.exportFailedTitle"),
        description: String(error),
        variant: "destructive",
      });
    } finally {
      setExporting(false);
    }
  };

  const selectedShipper = SHIPPERS.find((s) => s.id === form.shipperId);
  const selectedImporter = IMPORTERS.find((i) => i.id === form.importerId);
  const selectedDelivery = DELIVERY_PLACES.find(
    (d) => d.id === form.deliveryPlaceId,
  );

  const toggleGoods = (item: string) => {
    set(
      "goodsDescriptions",
      form.goodsDescriptions.includes(item)
        ? form.goodsDescriptions.filter((g) => g !== item)
        : // keep canonical order from GOODS_DESCRIPTIONS
          GOODS_DESCRIPTIONS.filter(
            (g) => form.goodsDescriptions.includes(g) || g === item,
          ),
    );
  };

  return (
    <PageLayout title={t("nav.invoiceMaker")}>
      <div className="mx-auto max-w-5xl space-y-6">
        {/* ------------------------------------------------ Invoice details */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t("invoiceMaker.invoiceDetails")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2 md:col-span-1">
                <Label>{t("invoiceMaker.shipperLabel")}</Label>
                <Select
                  value={form.shipperId}
                  onValueChange={(v) => set("shipperId", v)}
                >
                  <SelectTrigger data-testid="select-shipper">
                    <SelectValue placeholder={t("invoiceMaker.selectShipper")} />
                  </SelectTrigger>
                  <SelectContent>
                    {SHIPPERS.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t("invoiceMaker.invoiceNoLabel")}</Label>
                <Input
                  value={form.invoiceNo}
                  onChange={(e) => set("invoiceNo", e.target.value)}
                  placeholder={t("invoiceMaker.invoiceNoPlaceholder")}
                  data-testid="input-invoice-no"
                />
              </div>
              <div className="space-y-2">
                <Label>{t("invoiceMaker.invoiceDateLabel")}</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !form.invoiceDate && "text-muted-foreground",
                      )}
                      data-testid="button-invoice-date"
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {form.invoiceDate
                        ? format(form.invoiceDate, "d-MMM-yy")
                        : t("invoiceMaker.pickDate")}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={form.invoiceDate}
                      onSelect={(d) => set("invoiceDate", d ?? undefined)}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            <AddressPreview address={selectedShipper?.address} />

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>{t("invoiceMaker.invoiceReferenceLabel")}</Label>
                <Input
                  value={form.invoiceReference}
                  onChange={(e) => set("invoiceReference", e.target.value)}
                  placeholder="e.g. 53598062, 53598053, 53598054"
                  data-testid="input-invoice-reference"
                />
              </div>
              <div className="space-y-2">
                <Label>{t("invoiceMaker.poOrderNoLabel")}</Label>
                <Input
                  value={form.poOrderNo}
                  onChange={(e) => set("poOrderNo", e.target.value)}
                  placeholder="e.g. SP26 TUR US FTW UNIT - 26916518, ..."
                  data-testid="input-po-order-no"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ------------------------------------------------------- Parties */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t("invoiceMaker.parties")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>{t("invoiceMaker.importerLabel")}</Label>
                <Select
                  value={form.importerId}
                  onValueChange={(v) => set("importerId", v)}
                >
                  <SelectTrigger data-testid="select-importer">
                    <SelectValue placeholder={t("invoiceMaker.selectImporter")} />
                  </SelectTrigger>
                  <SelectContent>
                    {IMPORTERS.map((i) => (
                      <SelectItem key={i.id} value={i.id}>
                        {i.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <AddressPreview address={selectedImporter?.address} />
              </div>
              <div className="space-y-2">
                <Label>{t("invoiceMaker.deliveryPlaceLabel")}</Label>
                <Select
                  value={form.deliveryPlaceId}
                  onValueChange={(v) => set("deliveryPlaceId", v)}
                >
                  <SelectTrigger data-testid="select-delivery-place">
                    <SelectValue placeholder={t("invoiceMaker.selectDeliveryPlace")} />
                  </SelectTrigger>
                  <SelectContent>
                    {DELIVERY_PLACES.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <AddressPreview address={selectedDelivery?.address} />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ------------------------------------------------------ Shipment */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t("invoiceMaker.shipment")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label>{t("invoiceMaker.portOfLoadingLabel")}</Label>
                <AddableSelect
                  value={form.portOfLoading}
                  onChange={(v) => set("portOfLoading", v)}
                  defaultOptions={DEFAULT_PORTS_OF_LOADING}
                  storageKey="invoiceMaker.customPorts"
                  placeholder={t("invoiceMaker.selectPort")}
                  addLabel={t("invoiceMaker.addNewPort")}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("invoiceMaker.finalDestinationLabel")}</Label>
                <AddableSelect
                  value={form.finalDestination}
                  onChange={(v) => set("finalDestination", v)}
                  defaultOptions={DEFAULT_FINAL_DESTINATIONS}
                  storageKey="invoiceMaker.customDestinations"
                  placeholder={t("invoiceMaker.selectDestination")}
                  addLabel={t("invoiceMaker.addNewDestination")}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("invoiceMaker.paymentTermLabel")}</Label>
                <AddableSelect
                  value={form.paymentTerm}
                  onChange={(v) => set("paymentTerm", v)}
                  defaultOptions={DEFAULT_PAYMENT_TERMS}
                  storageKey="invoiceMaker.customPaymentTerms"
                  placeholder={t("invoiceMaker.selectPaymentTerm")}
                  addLabel={t("invoiceMaker.addNewPaymentTerm")}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("invoiceMaker.shipmentModeLabel")}</Label>
                <Select
                  value={form.shipmentMode}
                  onValueChange={(v) => set("shipmentMode", v)}
                >
                  <SelectTrigger data-testid="select-shipment-mode">
                    <SelectValue placeholder={t("invoiceMaker.selectMode")} />
                  </SelectTrigger>
                  <SelectContent>
                    {SHIPMENT_MODES.map((m) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t("invoiceMaker.shipmentTermLabel")}</Label>
                <Select
                  value={form.shipmentTerm}
                  onValueChange={(v) => set("shipmentTerm", v)}
                >
                  <SelectTrigger data-testid="select-shipment-term">
                    <SelectValue placeholder={t("invoiceMaker.selectIncoterm")} />
                  </SelectTrigger>
                  <SelectContent>
                    {INCOTERMS.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t("invoiceMaker.whInvoiceRefLabel")}</Label>
                <Input
                  value={form.whInvoiceRef}
                  onChange={(e) => set("whInvoiceRef", e.target.value)}
                  placeholder="e.g. 26916518, 25947372, ..."
                  data-testid="input-wh-invoice-ref"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ---------------------------------------------- Goods and totals */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t("invoiceMaker.goodsSummary")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2 md:max-w-md">
              <Label>{t("invoiceMaker.descriptionOfGoodsLabel")}</Label>
              <Popover open={goodsOpen} onOpenChange={setGoodsOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-between font-normal",
                      form.goodsDescriptions.length === 0 &&
                        "text-muted-foreground",
                    )}
                    data-testid="button-goods-descriptions"
                  >
                    <span className="truncate">
                      {form.goodsDescriptions.length > 0
                        ? form.goodsDescriptions.join(", ")
                        : t("invoiceMaker.selectDescriptions")}
                    </span>
                    <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-72" align="start">
                  <div className="space-y-3">
                    {GOODS_DESCRIPTIONS.map((g) => (
                      <label
                        key={g}
                        className="flex cursor-pointer items-center gap-2 text-sm"
                      >
                        <Checkbox
                          checked={form.goodsDescriptions.includes(g)}
                          onCheckedChange={() => toggleGoods(g)}
                        />
                        {g}
                      </label>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
              {form.goodsDescriptions.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  <Check className="mr-1 inline h-3 w-3" />
                  {t("invoiceMaker.willBeWrittenAs")}{" "}
                  <span className="font-medium">
                    {form.goodsDescriptions.join(", ")}
                  </span>
                </p>
              )}
            </div>

            {/* ----------------------------------- Pallets (packing list) */}
            <div className="space-y-3">
              <Label>{t("invoiceMaker.palletsPackingList")}</Label>
              <div className="flex flex-wrap items-end gap-2">
                <div className="space-y-1">
                  <Label className="text-xs font-normal text-muted-foreground">
                    {t("invoiceMaker.lengthCm")}
                  </Label>
                  <Input
                    className="h-9 w-24"
                    type="number"
                    min="0"
                    step="any"
                    value={palletDraft.length}
                    onChange={(e) => setDraft("length", e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addPallet()}
                    data-testid="input-pallet-length"
                  />
                </div>
                <span className="pb-2 text-muted-foreground">×</span>
                <div className="space-y-1">
                  <Label className="text-xs font-normal text-muted-foreground">
                    {t("invoiceMaker.widthCm")}
                  </Label>
                  <Input
                    className="h-9 w-24"
                    type="number"
                    min="0"
                    step="any"
                    value={palletDraft.width}
                    onChange={(e) => setDraft("width", e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addPallet()}
                    data-testid="input-pallet-width"
                  />
                </div>
                <span className="pb-2 text-muted-foreground">×</span>
                <div className="space-y-1">
                  <Label className="text-xs font-normal text-muted-foreground">
                    {t("invoiceMaker.heightCm")}
                  </Label>
                  <Input
                    className="h-9 w-24"
                    type="number"
                    min="0"
                    step="any"
                    value={palletDraft.height}
                    onChange={(e) => setDraft("height", e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addPallet()}
                    data-testid="input-pallet-height"
                  />
                </div>
                <div className="ml-2 space-y-1">
                  <Label className="text-xs font-normal text-muted-foreground">
                    {t("invoiceMaker.noOfPallets")}
                  </Label>
                  <Input
                    className="h-9 w-24"
                    type="number"
                    min="1"
                    step="1"
                    value={palletDraft.qty}
                    onChange={(e) => setDraft("qty", e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addPallet()}
                    data-testid="input-pallet-qty"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-normal text-muted-foreground">
                    {t("invoiceMaker.grossWtKgs")}
                  </Label>
                  <Input
                    className="h-9 w-28"
                    type="number"
                    min="0"
                    step="any"
                    value={palletDraft.grossWt}
                    onChange={(e) => setDraft("grossWt", e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addPallet()}
                    data-testid="input-pallet-weight"
                  />
                </div>
                <Button
                  className="h-9"
                  onClick={addPallet}
                  disabled={!palletDraftValid}
                  data-testid="button-add-pallet"
                >
                  <Plus className="mr-1 h-4 w-4" />
                  {t("invoiceMaker.add")}
                </Button>
              </div>

              {pallets.length > 0 && (
                <div className="overflow-x-auto rounded-md border md:max-w-3xl">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="min-w-[180px]">
                          {t("invoiceMaker.palletDimensionHeader")}
                        </TableHead>
                        <TableHead className="text-right">
                          {t("invoiceMaker.noOfPallets")}
                        </TableHead>
                        <TableHead className="text-right">
                          {t("invoiceMaker.grossWtKgs")}
                        </TableHead>
                        <TableHead className="text-right">{t("invoiceMaker.cbm")}</TableHead>
                        <TableHead className="w-10" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pallets.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell className="font-medium">
                            {palletDimension(p)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {p.qty}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {p.grossWt}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {palletCbm(p).toFixed(2)}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-destructive"
                              onClick={() => removePallet(p.id)}
                              title={t("invoiceMaker.removePallet")}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="bg-muted/40 font-medium">
                        <TableCell>{t("invoiceMaker.grandTotalUpper")}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {palletTotals.count}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtUsd(palletTotals.weight)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {palletTotals.cbm.toFixed(2)}
                        </TableCell>
                        <TableCell />
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>

            {/* ------------------------------------------ Shipment summary */}
            <div className="grid gap-4 md:grid-cols-4">
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5">
                  {t("invoiceMaker.grossWeightKgs")}
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
                    {t("invoiceMaker.autoBadge")}
                  </span>
                </Label>
                <div
                  className="flex h-10 items-center rounded-md border bg-muted/40 px-3 text-sm font-medium tabular-nums"
                  data-testid="stat-gross-weight"
                >
                  {pallets.length > 0 ? fmtUsd(palletTotals.weight) : "—"}
                </div>
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5">
                  {t("invoiceMaker.measCbm")}
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
                    {t("invoiceMaker.autoBadge")}
                  </span>
                </Label>
                <div
                  className="flex h-10 items-center rounded-md border bg-muted/40 px-3 text-sm font-medium tabular-nums"
                  data-testid="stat-meas-cbm"
                >
                  {pallets.length > 0 ? palletTotals.cbm.toFixed(2) : "—"}
                </div>
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5">
                  {t("invoiceMaker.totalPallets")}
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
                    {t("invoiceMaker.autoBadge")}
                  </span>
                </Label>
                <div
                  className="flex h-10 items-center rounded-md border bg-muted/40 px-3 text-sm font-medium tabular-nums"
                  data-testid="stat-total-pallets"
                >
                  {pallets.length > 0 ? palletTotals.count : "—"}
                </div>
              </div>
              <div className="space-y-2">
                <Label>{t("invoiceMaker.totalCartons")}</Label>
                <Input
                  type="number"
                  min="0"
                  step="1"
                  value={form.totalCartons}
                  onChange={(e) => set("totalCartons", e.target.value)}
                  placeholder="e.g. 13"
                  data-testid="input-total-cartons"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ---------------------------------------------------- Line items */}
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-lg">{t("invoiceMaker.invoiceLineItems")}</CardTitle>
            <div className="flex flex-wrap gap-2">
              <input
                ref={draftFileRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={handleDraftFile}
                data-testid="input-draft-file"
              />
              <Button
                variant="default"
                size="sm"
                onClick={() => draftFileRef.current?.click()}
                data-testid="button-upload-draft"
              >
                <Upload className="mr-2 h-4 w-4" />
                {t("invoiceMaker.uploadDraftTaxFile")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => resolveHsCodes(lineItems)}
                disabled={resolvingHs || lineItems.length === 0}
                title={t("invoiceMaker.autoFillHsTitle")}
                data-testid="button-resolve-hs"
              >
                {resolvingHs ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Wand2 className="mr-2 h-4 w-4" />
                )}
                {t("invoiceMaker.autoFillHs")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={addLineItem}
                data-testid="button-add-row"
              >
                <Plus className="mr-2 h-4 w-4" />
                {t("invoiceMaker.addRow")}
              </Button>
              {lineItems.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearLineItems}
                  className="text-muted-foreground"
                  data-testid="button-clear-rows"
                >
                  {t("invoiceMaker.clear")}
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {lineItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 rounded-md border border-dashed p-10 text-center">
                <FileSpreadsheet className="h-10 w-10 text-muted-foreground/60" />
                <div className="text-sm text-muted-foreground">
                  {t("invoiceMaker.emptyStateLine1Prefix")}{" "}
                  <span className="font-medium">
                    {t("invoiceMaker.emptyStateDraftTerm")}
                  </span>{" "}
                  {t("invoiceMaker.emptyStateLine1Suffix")}
                  <br />
                  {t("invoiceMaker.emptyStateLine2")}
                </div>
              </div>
            ) : (
              <>
                {missingHsCount > 0 && (
                  <p className="mb-3 text-sm font-medium text-destructive">
                    {t("invoiceMaker.missingHsWarning", { count: missingHsCount })}
                  </p>
                )}
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-8">#</TableHead>
                        <TableHead className="min-w-[110px]">{t("invoiceMaker.colStyleNo")}</TableHead>
                        <TableHead className="min-w-[170px]">
                          {t("invoiceMaker.colStyleDescription")}
                        </TableHead>
                        <TableHead className="min-w-[160px]">{t("invoiceMaker.colHtsCode")}</TableHead>
                        <TableHead className="min-w-[260px]">
                          {t("invoiceMaker.colComposition")}
                        </TableHead>
                        <TableHead className="min-w-[80px]">{t("invoiceMaker.colMadeIn")}</TableHead>
                        <TableHead className="min-w-[80px] text-right">
                          {t("invoiceMaker.colQty")}
                        </TableHead>
                        <TableHead className="min-w-[70px]">{t("invoiceMaker.colUom")}</TableHead>
                        <TableHead className="min-w-[80px]">{t("invoiceMaker.colCurrency")}</TableHead>
                        <TableHead className="min-w-[100px] text-right">
                          {t("invoiceMaker.colUnitPrice")}
                        </TableHead>
                        <TableHead className="min-w-[110px] text-right">
                          {t("invoiceMaker.colAmount")}
                        </TableHead>
                        <TableHead className="w-10" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {lineItems.map((li, idx) => {
                        const amount =
                          (Number(li.qty) || 0) * (Number(li.unitPrice) || 0);
                        return (
                          <TableRow key={li.id}>
                            <TableCell className="text-xs text-muted-foreground">
                              {idx + 1}
                            </TableCell>
                            <TableCell>
                              <Input
                                className="h-8"
                                value={li.styleNo}
                                onChange={(e) =>
                                  updateLineItem(li.id, "styleNo", e.target.value)
                                }
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                className="h-8"
                                value={li.styleDescription}
                                onChange={(e) =>
                                  updateLineItem(
                                    li.id,
                                    "styleDescription",
                                    e.target.value,
                                  )
                                }
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                className={cn(
                                  "h-8 font-mono text-xs",
                                  !li.htsCode.trim() &&
                                    "border-destructive focus-visible:ring-destructive",
                                )}
                                value={li.htsCode}
                                onChange={(e) =>
                                  updateLineItem(li.id, "htsCode", e.target.value)
                                }
                                placeholder={t("invoiceMaker.trHsCodePlaceholder")}
                                title={
                                  li.hsSource === "db"
                                    ? t("invoiceMaker.autoFilledTitle")
                                    : undefined
                                }
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                className="h-8 text-xs"
                                value={li.composition}
                                onChange={(e) =>
                                  updateLineItem(
                                    li.id,
                                    "composition",
                                    e.target.value,
                                  )
                                }
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                className="h-8"
                                value={li.madeIn}
                                onChange={(e) =>
                                  updateLineItem(li.id, "madeIn", e.target.value)
                                }
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                className="h-8 text-right"
                                type="number"
                                min="0"
                                step="1"
                                value={li.qty}
                                onChange={(e) =>
                                  updateLineItem(li.id, "qty", e.target.value)
                                }
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                className="h-8"
                                value={li.uom}
                                onChange={(e) =>
                                  updateLineItem(li.id, "uom", e.target.value)
                                }
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                className="h-8"
                                value={li.currency}
                                onChange={(e) =>
                                  updateLineItem(li.id, "currency", e.target.value)
                                }
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                className="h-8 text-right"
                                type="number"
                                min="0"
                                step="any"
                                value={li.unitPrice}
                                onChange={(e) =>
                                  updateLineItem(
                                    li.id,
                                    "unitPrice",
                                    e.target.value,
                                  )
                                }
                              />
                            </TableCell>
                            <TableCell className="text-right text-sm font-medium tabular-nums">
                              ${fmtUsd(amount)}
                            </TableCell>
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                onClick={() => removeLineItem(li.id)}
                                title={t("invoiceMaker.removeRow")}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      <TableRow className="bg-muted/40 font-medium">
                        <TableCell />
                        <TableCell>{t("invoiceMaker.grandTotal")}</TableCell>
                        <TableCell colSpan={4} />
                        <TableCell className="text-right tabular-nums">
                          {lineTotals.qty.toLocaleString("en-US")}
                        </TableCell>
                        <TableCell colSpan={3} />
                        <TableCell className="text-right tabular-nums">
                          ${fmtUsd(lineTotals.amount)}
                        </TableCell>
                        <TableCell />
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* ------------------------------------------------------- Export */}
        <div className="flex justify-end">
          <Button
            size="lg"
            onClick={handleExport}
            disabled={exporting}
            data-testid="button-export-excel"
          >
            {exporting ? (
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            ) : (
              <Download className="mr-2 h-5 w-5" />
            )}
            {t("invoiceMaker.exportExcel")}
          </Button>
        </div>

        {/* ------------------------------------------------------ History */}
        <Card className="mb-10">
          <CardHeader>
            <CardTitle className="text-lg">{t("invoiceMaker.generatedInvoices")}</CardTitle>
          </CardHeader>
          <CardContent>
            {history.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {t("invoiceMaker.noInvoicesYet")}
              </p>
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[140px]">{t("invoiceMaker.histInvoiceNo")}</TableHead>
                      <TableHead className="min-w-[150px]">{t("invoiceMaker.histDate")}</TableHead>
                      <TableHead className="min-w-[90px] text-right">
                        {t("invoiceMaker.histQuantity")}
                      </TableHead>
                      <TableHead className="min-w-[120px] text-right">
                        {t("invoiceMaker.histTotal")}
                      </TableHead>
                      <TableHead className="w-12" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {history.map((row) => (
                      <TableRow key={row.id} data-testid={`history-row-${row.id}`}>
                        <TableCell className="font-medium">
                          {row.invoice_no}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {format(new Date(row.created_at), "d MMM yyyy HH:mm")}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.total_qty.toLocaleString("en-US")}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          ${fmtUsd(Number(row.total_amount))}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => handleHistoryDownload(row)}
                            disabled={downloadingId === row.id}
                            title={t("invoiceMaker.downloadFile", { filename: row.filename })}
                          >
                            {downloadingId === row.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Download className="h-4 w-4" />
                            )}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </PageLayout>
  );
}
