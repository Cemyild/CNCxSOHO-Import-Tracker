import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FlaskConical, Loader2, Plus, Search, Trash2, Upload, X } from "lucide-react";
import { PageLayout } from "@/components/layout/PageLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

type TareksReportRow = {
  id: number;
  originalFilename: string;
  fileSize: number;
  fileType: string;
  procedureReference: string | null;
  testDate: string | null;
  notes: string | null;
  createdAt: string | null;
  styles: string[];
};

/** One table row = one style of one report, so a report can appear several times. */
type StyleRow = {
  key: string;
  style: string | null;
  report: TareksReportRow;
};

type PendingFile = {
  file: File;
  styles: string[];
  unknownStyles: string[];
  procedureReference: string;
};

function formatBytes(bytes: number): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  return `${day}.${month}.${d.getFullYear()}`;
}

function parseFilenameFromContentDisposition(header: string | null): string | null {
  if (!header) return null;
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (utf8) {
    try {
      return decodeURIComponent(utf8[1]);
    } catch {
      return utf8[1];
    }
  }
  const plain = /filename="?([^";]+)"?/.exec(header);
  return plain ? plain[1] : null;
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

export default function TareksReportsPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [downloading, setDownloading] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [parsing, setParsing] = useState(false);
  const [styleDraft, setStyleDraft] = useState<Record<number, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data, isLoading } = useQuery<{ reports: TareksReportRow[] }>({
    queryKey: ["/api/tareks-reports"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/tareks-reports");
      return await res.json();
    },
  });

  const reports = data?.reports ?? [];

  // Flatten to style rows, then filter locally so search feels instant.
  const rows: StyleRow[] = useMemo(() => {
    const flat: StyleRow[] = [];
    for (const report of reports) {
      if (report.styles.length === 0) {
        flat.push({ key: `${report.id}-none`, style: null, report });
      } else {
        for (const style of report.styles) {
          flat.push({ key: `${report.id}-${style}`, style, report });
        }
      }
    }
    flat.sort((a, b) => {
      const as = a.style ?? "￿";
      const bs = b.style ?? "￿";
      if (as !== bs) return as.localeCompare(bs);
      return a.report.originalFilename.localeCompare(b.report.originalFilename);
    });

    const needle = search.trim().toUpperCase();
    if (!needle) return flat;
    return flat.filter(
      (r) =>
        (r.style ?? "").includes(needle) ||
        r.report.originalFilename.toUpperCase().includes(needle) ||
        (r.report.procedureReference ?? "").toUpperCase().includes(needle),
    );
  }, [reports, search]);

  // Selection lives on the report id: one file selected once, however many
  // style rows it occupies.
  const visibleIds = useMemo(() => [...new Set(rows.map((r) => r.report.id))], [rows]);
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));
  const someVisibleSelected = visibleIds.some((id) => selectedIds.includes(id));

  function toggleAll() {
    setSelectedIds(allVisibleSelected ? [] : visibleIds);
  }

  function toggleOne(id: number) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  async function handleFilesPicked(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    setParsing(true);
    try {
      const res = await apiRequest("POST", "/api/tareks-reports/parse-filenames", {
        filenames: files.map((f) => f.name),
      });
      const parsed = (await res.json()) as {
        results: Array<{ filename: string; styles: string[]; unknownStyles: string[] }>;
      };
      const byName = new Map(parsed.results.map((r) => [r.filename, r]));
      setPending((prev) => [
        ...prev,
        ...files.map((file) => ({
          file,
          styles: byName.get(file.name)?.styles ?? [],
          unknownStyles: byName.get(file.name)?.unknownStyles ?? [],
          procedureReference: "",
        })),
      ]);
    } catch (err) {
      // Detection is only a convenience — let the user add styles by hand.
      setPending((prev) => [
        ...prev,
        ...files.map((file) => ({
          file,
          styles: [],
          unknownStyles: [],
          procedureReference: "",
        })),
      ]);
      toast({
        title: t("tareksReports.parseFailed"),
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setParsing(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function removePending(index: number) {
    setPending((prev) => prev.filter((_, i) => i !== index));
  }

  function removeStyle(index: number, style: string) {
    setPending((prev) =>
      prev.map((p, i) => (i === index ? { ...p, styles: p.styles.filter((s) => s !== style) } : p)),
    );
  }

  function addStyle(index: number) {
    const raw = (styleDraft[index] ?? "").trim().toUpperCase();
    if (!raw) return;
    setPending((prev) =>
      prev.map((p, i) =>
        i === index && !p.styles.includes(raw) ? { ...p, styles: [...p.styles, raw] } : p,
      ),
    );
    setStyleDraft((prev) => ({ ...prev, [index]: "" }));
  }

  function setProcedure(index: number, value: string) {
    setPending((prev) =>
      prev.map((p, i) => (i === index ? { ...p, procedureReference: value } : p)),
    );
  }

  const uploadMutation = useMutation({
    mutationFn: async () => {
      const form = new FormData();
      for (const item of pending) form.append("files", item.file, item.file.name);
      form.append(
        "meta",
        JSON.stringify(
          pending.map((item) => ({
            filename: item.file.name,
            styles: item.styles,
            procedureReference: item.procedureReference.trim() || null,
          })),
        ),
      );
      const res = await apiRequest("POST", "/api/tareks-reports", form);
      return (await res.json()) as {
        created: Array<{ id: number }>;
        failed: Array<{ filename: string; error: string }>;
      };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/tareks-reports"] });
      setUploadOpen(false);
      setPending([]);
      if (result.failed.length > 0) {
        toast({
          title: t("tareksReports.uploadPartial", {
            ok: result.created.length,
            failed: result.failed.length,
          }),
          description: result.failed.map((f) => f.filename).join(", "),
          variant: "destructive",
        });
      } else {
        toast({
          title: t("tareksReports.uploadDone", { count: result.created.length }),
        });
      }
    },
    onError: (err: unknown) => {
      toast({
        title: t("tareksReports.uploadFailed"),
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/tareks-reports/${id}`);
    },
    onSuccess: (_data, id) => {
      setSelectedIds((prev) => prev.filter((x) => x !== id));
      queryClient.invalidateQueries({ queryKey: ["/api/tareks-reports"] });
      toast({ title: t("tareksReports.deleteDone") });
    },
    onError: (err: unknown) => {
      toast({
        title: t("tareksReports.deleteFailed"),
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    },
  });

  async function downloadSelected() {
    if (selectedIds.length === 0) return;
    setDownloading(true);
    try {
      const res = await apiRequest("POST", "/api/tareks-reports/download", { ids: selectedIds });
      const blob = await res.blob();
      const filename =
        parseFilenameFromContentDisposition(res.headers.get("content-disposition")) ??
        "tareks-reports.zip";
      triggerBlobDownload(blob, filename);
    } catch (err) {
      toast({
        title: t("tareksReports.downloadFailed"),
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setDownloading(false);
    }
  }

  async function downloadOne(report: TareksReportRow) {
    try {
      const res = await apiRequest("GET", `/api/tareks-reports/${report.id}/download`);
      const blob = await res.blob();
      triggerBlobDownload(blob, report.originalFilename);
    } catch (err) {
      toast({
        title: t("tareksReports.downloadFailed"),
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  }

  return (
    <PageLayout title={t("nav.tareksReports")}>
      <Card className="max-w-6xl mx-auto">
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="flex items-center gap-2">
            <FlaskConical className="h-5 w-5" />
            {t("tareksReports.title")}
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("tareksReports.searchPlaceholder")}
                className="pl-8 w-56"
              />
            </div>
            <Button
              variant="outline"
              onClick={downloadSelected}
              disabled={selectedIds.length === 0 || downloading}
            >
              {downloading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              {t("tareksReports.downloadSelected", { count: selectedIds.length })}
            </Button>
            <Button onClick={() => setUploadOpen(true)}>
              <Upload className="mr-2 h-4 w-4" />
              {t("tareksReports.uploadButton")}
            </Button>
          </div>
        </CardHeader>

        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="py-16 text-center text-muted-foreground">
              {search ? t("tareksReports.noMatches") : t("tareksReports.empty")}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={allVisibleSelected}
                        onCheckedChange={toggleAll}
                        aria-label={t("tareksReports.selectAll")}
                        data-state={
                          allVisibleSelected
                            ? "checked"
                            : someVisibleSelected
                              ? "indeterminate"
                              : "unchecked"
                        }
                      />
                    </TableHead>
                    <TableHead>{t("tareksReports.columns.style")}</TableHead>
                    <TableHead>{t("tareksReports.columns.file")}</TableHead>
                    <TableHead className="w-28">{t("tareksReports.columns.size")}</TableHead>
                    <TableHead className="w-32">{t("tareksReports.columns.uploaded")}</TableHead>
                    <TableHead className="w-32">{t("tareksReports.columns.procedure")}</TableHead>
                    <TableHead className="w-24 text-right">
                      {t("tareksReports.columns.actions")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow
                      key={row.key}
                      data-state={selectedIds.includes(row.report.id) ? "selected" : undefined}
                    >
                      <TableCell>
                        <Checkbox
                          checked={selectedIds.includes(row.report.id)}
                          onCheckedChange={() => toggleOne(row.report.id)}
                          aria-label={row.style ?? row.report.originalFilename}
                        />
                      </TableCell>
                      <TableCell className="font-medium">
                        {row.style ?? (
                          <span className="text-muted-foreground">
                            {t("tareksReports.noStyle")}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="max-w-md truncate" title={row.report.originalFilename}>
                        {row.report.originalFilename}
                      </TableCell>
                      <TableCell>{formatBytes(row.report.fileSize)}</TableCell>
                      <TableCell>{formatDate(row.report.createdAt)}</TableCell>
                      <TableCell>
                        {row.report.procedureReference ? (
                          <Badge variant="outline">{row.report.procedureReference}</Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => downloadOne(row.report)}
                          title={t("tareksReports.downloadOne")}
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            if (window.confirm(t("tareksReports.confirmDelete"))) {
                              deleteMutation.mutate(row.report.id);
                            }
                          }}
                          title={t("tareksReports.delete")}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {rows.length > 0 && (
            <p className="mt-3 text-sm text-muted-foreground">
              {t("tareksReports.summary", {
                rows: rows.length,
                reports: visibleIds.length,
                selected: selectedIds.length,
              })}
            </p>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={uploadOpen}
        onOpenChange={(open) => {
          setUploadOpen(open);
          if (!open) setPending([]);
        }}
      >
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("tareksReports.uploadTitle")}</DialogTitle>
            <DialogDescription>{t("tareksReports.uploadHelp")}</DialogDescription>
          </DialogHeader>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf,.jpg,.jpeg,.png"
            className="hidden"
            onChange={(e) => handleFilesPicked(e.target.files)}
          />

          <Button
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={parsing}
          >
            {parsing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-2 h-4 w-4" />
            )}
            {t("tareksReports.pickFiles")}
          </Button>

          <div className="space-y-3">
            {pending.map((item, index) => (
              <div key={`${item.file.name}-${index}`} className="rounded-md border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium" title={item.file.name}>
                      {item.file.name}
                    </p>
                    <p className="text-xs text-muted-foreground">{formatBytes(item.file.size)}</p>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => removePending(index)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-1">
                  {item.styles.length === 0 && (
                    <span className="text-xs text-amber-600">
                      {t("tareksReports.noStyleDetected")}
                    </span>
                  )}
                  {item.styles.map((style) => (
                    <Badge
                      key={style}
                      variant={item.unknownStyles.includes(style) ? "outline" : "secondary"}
                      className="gap-1"
                      title={
                        item.unknownStyles.includes(style)
                          ? t("tareksReports.unknownStyleHint")
                          : undefined
                      }
                    >
                      {style}
                      <button
                        type="button"
                        onClick={() => removeStyle(index, style)}
                        className="ml-1"
                        aria-label={`${style} ${t("tareksReports.remove")}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>

                <div className="mt-2 flex flex-wrap gap-2">
                  <Input
                    value={styleDraft[index] ?? ""}
                    onChange={(e) =>
                      setStyleDraft((prev) => ({ ...prev, [index]: e.target.value }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addStyle(index);
                      }
                    }}
                    placeholder={t("tareksReports.addStylePlaceholder")}
                    className="w-44"
                  />
                  <Button variant="outline" size="sm" onClick={() => addStyle(index)}>
                    {t("tareksReports.addStyle")}
                  </Button>
                  <Input
                    value={item.procedureReference}
                    onChange={(e) => setProcedure(index, e.target.value)}
                    placeholder={t("tareksReports.procedurePlaceholder")}
                    className="w-44"
                  />
                </div>
              </div>
            ))}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadOpen(false)}>
              {t("tareksReports.cancel")}
            </Button>
            <Button
              onClick={() => uploadMutation.mutate()}
              disabled={pending.length === 0 || uploadMutation.isPending}
            >
              {uploadMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("tareksReports.save", { count: pending.length })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageLayout>
  );
}
