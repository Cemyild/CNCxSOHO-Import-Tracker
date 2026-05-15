import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageLayout } from "@/components/layout/PageLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Download } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

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

  const { data: count } = useQuery<CountResult>({
    queryKey: ["/api/bulk-download/count", body],
    queryFn: async () => {
      const res = await apiRequest("POST", "/api/bulk-download/count", body);
      return await res.json();
    },
    enabled: ready,
  });

  async function handleDownload() {
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

            <TabsContent value="single" className="pt-4">
              <p className="text-sm text-muted-foreground">Single procedure tab — implemented in Task 12</p>
            </TabsContent>
            <TabsContent value="multi" className="pt-4">
              <p className="text-sm text-muted-foreground">Multi-select tab — implemented in Task 13</p>
            </TabsContent>
            <TabsContent value="dateRange" className="pt-4">
              <p className="text-sm text-muted-foreground">Date range tab — implemented in Task 14</p>
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
