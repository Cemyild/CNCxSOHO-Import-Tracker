import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { PageLayout } from "@/components/layout/PageLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Download, Check, ChevronsUpDown } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";

type Mode = "single" | "multi" | "dateRange" | "all";

interface BulkBody {
  mode: Mode;
  procedureIds?: number[];
  dateFrom?: string;
  dateTo?: string;
}

interface CountResult {
  procedureCount: number;
  fileCount: number;
  totalBytes: number;
  excludedNoDecDate: number;
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

function parseFilenameFromContentDisposition(h: string | null): string | null {
  if (!h) return null;
  const m = /filename="?([^"]+)"?/.exec(h);
  return m ? m[1] : null;
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function isBodyReady(body: BulkBody): boolean {
  switch (body.mode) {
    case "single":
      return (body.procedureIds?.length ?? 0) === 1;
    case "multi":
      return (body.procedureIds?.length ?? 0) >= 1;
    case "dateRange":
      return !!(body.dateFrom && body.dateTo);
    case "all":
      return true;
  }
}

export default function BulkDownloadPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [mode, setMode] = useState<Mode>("single");
  const [singleId, setSingleId] = useState<number | null>(null);
  const [multiIds, setMultiIds] = useState<number[]>([]);
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<number>(0);

  const body: BulkBody = useMemo(() => {
    switch (mode) {
      case "single":
        return { mode, procedureIds: singleId != null ? [singleId] : [] };
      case "multi":
        return { mode, procedureIds: multiIds };
      case "dateRange":
        return { mode, dateFrom, dateTo };
      case "all":
        return { mode };
    }
  }, [mode, singleId, multiIds, dateFrom, dateTo]);

  const ready = isBodyReady(body);

  interface ProcedureListItem {
    id: number;
    reference: string;
    shipper: string | null;
    import_dec_date: string | null;
  }

  const { data: procedureList = [] } = useQuery<ProcedureListItem[]>({
    queryKey: ["/api/procedures"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/procedures");
      const data = await res.json();
      const rows = Array.isArray(data) ? data : (data?.procedures ?? []);
      return rows.map((r: any) => ({
        id: r.id,
        reference: r.reference ?? `#${r.id}`,
        shipper: r.shipper ?? null,
        import_dec_date: r.import_dec_date ?? null,
      }));
    },
  });

  const [multiSearch, setMultiSearch] = useState("");
  const filteredForMulti = useMemo(() => {
    const q = multiSearch.trim().toLowerCase();
    if (!q) return procedureList;
    return procedureList.filter(
      (p) =>
        p.reference.toLowerCase().includes(q) || (p.shipper ?? "").toLowerCase().includes(q),
    );
  }, [procedureList, multiSearch]);

  const allFilteredSelected =
    filteredForMulti.length > 0 && filteredForMulti.every((p) => multiIds.includes(p.id));

  const singleSelected = procedureList.find((p) => p.id === singleId) ?? null;
  const [singleOpen, setSingleOpen] = useState(false);

  const { data: count } = useQuery<CountResult>({
    queryKey: ["/api/bulk-download/count", body],
    queryFn: async () => {
      const res = await apiRequest("POST", "/api/bulk-download/count", body);
      return await res.json();
    },
    enabled: ready,
  });

  async function handleDownload() {
    if (count && count.totalBytes > 500 * 1024 * 1024) {
      const mb = Math.round(count.totalBytes / (1024 * 1024));
      const proceed = window.confirm(
        t('bulkDownload.largeDownloadConfirm', { mb }),
      );
      if (!proceed) return;
    }
    setDownloading(true);
    setDownloadProgress(0);
    try {
      const res = await fetch("/api/bulk-download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "include",
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`HTTP ${res.status}: ${errText}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("Response has no body to stream");

      const chunks: Uint8Array[] = [];
      let received = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          received += value.length;
          setDownloadProgress(received);
        }
      }

      const blob = new Blob(chunks, { type: "application/zip" });
      const filename =
        parseFilenameFromContentDisposition(res.headers.get("content-disposition")) ??
        "CNCxSOHO-Documents.zip";
      triggerBlobDownload(blob, filename);
    } catch (err) {
      toast({
        title: t('bulkDownload.downloadFailed'),
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setDownloading(false);
      setDownloadProgress(0);
    }
  }

  const summaryText = !ready
    ? t('bulkDownload.summary.makeSelection')
    : count
      ? `${t('bulkDownload.summary.procedures', { count: count.procedureCount })} · ${t('bulkDownload.summary.files', { count: count.fileCount })} · ~${formatBytes(count.totalBytes)}` +
        (count.excludedNoDecDate > 0 ? `  ·  ${t('bulkDownload.summary.excluded', { count: count.excludedNoDecDate })}` : "")
      : t('bulkDownload.summary.calculating');

  return (
    <PageLayout title={t('bulkDownload.title')}>
      <Card className="max-w-4xl mx-auto">
        <CardHeader>
          <CardTitle>{t('bulkDownload.title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
            <TabsList className="grid grid-cols-4 w-full">
              <TabsTrigger value="single">{t('bulkDownload.tabs.single')}</TabsTrigger>
              <TabsTrigger value="multi">{t('bulkDownload.tabs.multi')}</TabsTrigger>
              <TabsTrigger value="dateRange">{t('bulkDownload.tabs.dateRange')}</TabsTrigger>
              <TabsTrigger value="all">{t('bulkDownload.tabs.all')}</TabsTrigger>
            </TabsList>

            <TabsContent value="single" className="pt-4 space-y-2">
              <label className="text-sm font-medium">{t('bulkDownload.procedure')}</label>
              <Popover open={singleOpen} onOpenChange={setSingleOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    className="w-full justify-between"
                  >
                    {singleSelected
                      ? `${singleSelected.reference}${singleSelected.shipper ? " — " + singleSelected.shipper : ""}`
                      : t('bulkDownload.pickProcedure')}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[min(640px,90vw)] p-0">
                  <Command>
                    <CommandInput placeholder={t('bulkDownload.searchPlaceholder')} />
                    <CommandList>
                      <CommandEmpty>{t('bulkDownload.noMatches')}</CommandEmpty>
                      <CommandGroup>
                        {procedureList.map((p) => (
                          <CommandItem
                            key={p.id}
                            value={`${p.reference} ${p.shipper ?? ""}`}
                            onSelect={() => {
                              setSingleId(p.id);
                              setSingleOpen(false);
                            }}
                          >
                            <Check className={cn("mr-2 h-4 w-4", singleId === p.id ? "opacity-100" : "opacity-0")} />
                            <span className="font-mono mr-2">{p.reference}</span>
                            {p.shipper && <span className="text-muted-foreground">— {p.shipper}</span>}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </TabsContent>
            <TabsContent value="multi" className="pt-4 space-y-3">
              <div className="flex gap-2">
                <Input
                  placeholder={t('bulkDownload.searchPlaceholder')}
                  value={multiSearch}
                  onChange={(e) => setMultiSearch(e.target.value)}
                  className="flex-1"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (allFilteredSelected) {
                      const filteredIds = new Set(filteredForMulti.map((p) => p.id));
                      setMultiIds(multiIds.filter((id) => !filteredIds.has(id)));
                    } else {
                      const merged = new Set([...multiIds, ...filteredForMulti.map((p) => p.id)]);
                      setMultiIds(Array.from(merged));
                    }
                  }}
                >
                  {allFilteredSelected ? t('bulkDownload.deselectVisible') : t('bulkDownload.selectVisible')}
                </Button>
                <Button variant="outline" size="sm" onClick={() => setMultiIds([])} disabled={multiIds.length === 0}>
                  {t('bulkDownload.clear')}
                </Button>
              </div>

              <div className="max-h-[360px] overflow-y-auto border rounded-md divide-y">
                {filteredForMulti.length === 0 && (
                  <div className="p-4 text-sm text-muted-foreground">{t('bulkDownload.noProceduresMatch')}</div>
                )}
                {filteredForMulti.map((p) => (
                  <label
                    key={p.id}
                    className="flex items-center gap-3 px-3 py-2 hover:bg-muted/50 cursor-pointer"
                  >
                    <Checkbox
                      checked={multiIds.includes(p.id)}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          if (!multiIds.includes(p.id)) setMultiIds([...multiIds, p.id]);
                        } else {
                          setMultiIds(multiIds.filter((id) => id !== p.id));
                        }
                      }}
                    />
                    <span className="font-mono text-sm w-32">{p.reference}</span>
                    <span className="text-sm text-muted-foreground flex-1 truncate">{p.shipper ?? "—"}</span>
                  </label>
                ))}
              </div>

              <div className="text-xs text-muted-foreground">
                {t('bulkDownload.selectionCounter', { selected: multiIds.length, visible: filteredForMulti.length, total: procedureList.length })}
              </div>
            </TabsContent>
            <TabsContent value="dateRange" className="pt-4 space-y-3">
              <div className="flex gap-4 items-end">
                <div className="flex-1">
                  <label className="text-sm font-medium block mb-1">{t('bulkDownload.fromDate')}</label>
                  <Input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    max={dateTo || undefined}
                  />
                </div>
                <div className="flex-1">
                  <label className="text-sm font-medium block mb-1">{t('bulkDownload.toDate')}</label>
                  <Input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    min={dateFrom || undefined}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                {t('bulkDownload.dateRangeNote')}
              </p>
            </TabsContent>
            <TabsContent value="all" className="pt-4">
              <p className="text-sm">{t('bulkDownload.allDescription')}</p>
            </TabsContent>
          </Tabs>

          <div className="space-y-3 border-t pt-4">
            <div className="flex items-center justify-between">
              <div className="text-sm text-muted-foreground">{summaryText}</div>
              <Button disabled={!ready || downloading} onClick={handleDownload}>
                <Download className="mr-2 h-4 w-4" />
                {downloading ? t('bulkDownload.downloading') : t('bulkDownload.downloadZip')}
              </Button>
            </div>
            {downloading && (
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>
                    {formatBytes(downloadProgress)}
                    {count?.totalBytes ? ` / ~${formatBytes(count.totalBytes)}` : ""}
                  </span>
                  <span>
                    {count?.totalBytes && downloadProgress > 0
                      ? `${Math.min(100, Math.round((downloadProgress / count.totalBytes) * 100))}%`
                      : ""}
                  </span>
                </div>
                <Progress
                  value={
                    count?.totalBytes
                      ? Math.min(100, (downloadProgress / count.totalBytes) * 100)
                      : 0
                  }
                />
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </PageLayout>
  );
}
