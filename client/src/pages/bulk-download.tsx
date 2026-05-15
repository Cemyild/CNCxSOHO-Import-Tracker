import { useState, useMemo } from "react";
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
  const { toast } = useToast();
  const [mode, setMode] = useState<Mode>("single");
  const [singleId, setSingleId] = useState<number | null>(null);
  const [multiIds, setMultiIds] = useState<number[]>([]);
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [downloading, setDownloading] = useState(false);

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
      const rows = await res.json();
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
        `This will download about ${mb} MB and may take several minutes. Continue?`,
      );
      if (!proceed) return;
    }
    setDownloading(true);
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
      const blob = await res.blob();
      const filename = parseFilenameFromContentDisposition(res.headers.get("content-disposition")) ?? "CNCxSOHO-Documents.zip";
      triggerBlobDownload(blob, filename);
    } catch (err) {
      toast({
        title: "Download failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setDownloading(false);
    }
  }

  const summaryText = !ready
    ? "Make a selection to see what will be downloaded"
    : count
      ? `${count.procedureCount} procedure${count.procedureCount === 1 ? "" : "s"} · ${count.fileCount} file${count.fileCount === 1 ? "" : "s"} · ~${formatBytes(count.totalBytes)}` +
        (count.excludedNoDecDate > 0 ? `  ·  ${count.excludedNoDecDate} excluded (no declaration date)` : "")
      : "Calculating…";

  return (
    <PageLayout title="Bulk Document Download">
      <Card className="max-w-4xl mx-auto">
        <CardHeader>
          <CardTitle>Bulk Document Download</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
            <TabsList className="grid grid-cols-4 w-full">
              <TabsTrigger value="single">Single</TabsTrigger>
              <TabsTrigger value="multi">Multi-select</TabsTrigger>
              <TabsTrigger value="dateRange">Date Range</TabsTrigger>
              <TabsTrigger value="all">Everything</TabsTrigger>
            </TabsList>

            <TabsContent value="single" className="pt-4 space-y-2">
              <label className="text-sm font-medium">Procedure</label>
              <Popover open={singleOpen} onOpenChange={setSingleOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    className="w-full justify-between"
                  >
                    {singleSelected
                      ? `${singleSelected.reference}${singleSelected.shipper ? " — " + singleSelected.shipper : ""}`
                      : "Pick a procedure…"}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[min(640px,90vw)] p-0">
                  <Command>
                    <CommandInput placeholder="Search reference or shipper…" />
                    <CommandList>
                      <CommandEmpty>No matches.</CommandEmpty>
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
                  placeholder="Search reference or shipper…"
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
                  {allFilteredSelected ? "Deselect visible" : "Select visible"}
                </Button>
                <Button variant="outline" size="sm" onClick={() => setMultiIds([])} disabled={multiIds.length === 0}>
                  Clear
                </Button>
              </div>

              <div className="max-h-[360px] overflow-y-auto border rounded-md divide-y">
                {filteredForMulti.length === 0 && (
                  <div className="p-4 text-sm text-muted-foreground">No procedures match.</div>
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
                {multiIds.length} selected ({filteredForMulti.length} visible / {procedureList.length} total)
              </div>
            </TabsContent>
            <TabsContent value="dateRange" className="pt-4 space-y-3">
              <div className="flex gap-4 items-end">
                <div className="flex-1">
                  <label className="text-sm font-medium block mb-1">From (Import Declaration Date)</label>
                  <Input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    max={dateTo || undefined}
                  />
                </div>
                <div className="flex-1">
                  <label className="text-sm font-medium block mb-1">To</label>
                  <Input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    min={dateFrom || undefined}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Procedures without an Import Declaration Date are excluded from this filter.
              </p>
            </TabsContent>
            <TabsContent value="all" className="pt-4">
              <p className="text-sm">Download every procedure's documents in one ZIP.</p>
            </TabsContent>
          </Tabs>

          <div className="flex items-center justify-between border-t pt-4">
            <div className="text-sm text-muted-foreground">{summaryText}</div>
            <Button disabled={!ready || downloading} onClick={handleDownload}>
              <Download className="mr-2 h-4 w-4" />
              {downloading ? "Preparing…" : "Download ZIP"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </PageLayout>
  );
}
