import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileSpreadsheet, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  EnrichmentDetectionStep,
  type DetectionSummary,
} from "@/components/enrichment/EnrichmentDetectionStep";
import {
  EnrichmentPreviewStep,
  type PreviewItem,
  type UnmatchedItem,
} from "@/components/enrichment/EnrichmentPreviewStep";

type Step = "upload" | "detection" | "preview";

interface ExcelDataEnrichmentProps {
  onSuccess?: () => void;
}

/** apiRequest throws `Error("<status>: <raw body>")`; recover the JSON body. */
function parseServerError(error: unknown): {
  code?: string;
  detectedHeaders?: string[];
  availableSheets?: string[];
} | null {
  const message = error instanceof Error ? error.message : String(error);
  const jsonStart = message.indexOf("{");
  if (jsonStart === -1) return null;
  try {
    return JSON.parse(message.slice(jsonStart));
  } catch {
    return null;
  }
}

export function ExcelDataEnrichment({ onSuccess }: ExcelDataEnrichmentProps) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [detection, setDetection] = useState<DetectionSummary | null>(null);
  const [items, setItems] = useState<PreviewItem[]>([]);
  const [unmatched, setUnmatched] = useState<UnmatchedItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const { t } = useTranslation();

  const reset = () => {
    setStep("upload");
    setFile(null);
    setDetection(null);
    setItems([]);
    setUnmatched([]);
    setSelectedIds([]);
  };

  /** Turns a server error body into a message the user can act on. */
  const describeError = (error: unknown): string => {
    const body = parseServerError(error);
    if (body?.code === "no_data") {
      return t("taxCalcComp.enrichment.errorNoData");
    }
    if (body?.code === "no_headers") {
      return t("taxCalcComp.enrichment.errorNoHeaders", {
        headers: (body.detectedHeaders ?? []).slice(0, 12).join(", "),
      });
    }
    if (body?.code === "sheet_not_found") {
      return t("taxCalcComp.enrichment.errorSheetNotFound", {
        sheets: (body.availableSheets ?? []).join(", "),
      });
    }
    return t("taxCalcComp.enrichment.failedToProcess");
  };

  const handleAnalyze = async () => {
    if (!file) return;
    setLoading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await apiRequest("POST", "/api/enrichment/analyze", form);
      const data = await response.json();
      setDetection(data.detection);
      setStep("detection");
    } catch (error) {
      toast({
        title: t("common.error"),
        description: describeError(error),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handlePreview = async () => {
    if (!file || !detection) return;
    setLoading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("sheetName", detection.sheetName);
      form.append("headerRowIndex", String(detection.headerRowIndex));
      const response = await apiRequest("POST", "/api/enrichment/preview", form);
      const data = await response.json();

      setItems(data.matched ?? []);
      setUnmatched(data.unmatched ?? []);
      setSelectedIds((data.matched ?? []).map((m: PreviewItem) => m.procedureId));

      if ((data.matched ?? []).length === 0) {
        toast({
          title: t("taxCalcComp.enrichment.noMatchesTitle"),
          description: t("taxCalcComp.enrichment.noMatchesDesc"),
          variant: "destructive",
        });
      }
      setStep("preview");
    } catch (error) {
      toast({
        title: t("common.error"),
        description: describeError(error),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleApply = async () => {
    setLoading(true);
    try {
      const updates = items
        .filter((item) => selectedIds.includes(item.procedureId))
        .map((item) => ({
          procedureId: item.procedureId,
          changes: Object.fromEntries(
            item.changes.map((change) => [change.field, change.newValue]),
          ),
        }));

      const response = await apiRequest("POST", "/api/enrichment/apply", {
        updates,
      });
      const result = await response.json();
      const succeeded = (result.results ?? []).filter(
        (r: { status: string }) => r.status === "success",
      ).length;

      toast({
        title: t("common.success"),
        description: t("taxCalcComp.enrichment.enrichedSuccess", {
          count: succeeded,
        }),
      });

      setOpen(false);
      reset();
      onSuccess?.();
    } catch {
      toast({
        title: t("common.error"),
        description: t("taxCalcComp.enrichment.failedToApply"),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const toggleSelection = (id: number) =>
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );

  const toggleAll = () =>
    setSelectedIds((prev) =>
      prev.length === items.length ? [] : items.map((item) => item.procedureId),
    );

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (!value) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <FileSpreadsheet className="h-4 w-4" />
          {t("taxCalcComp.enrichment.triggerButton")}
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[85vh] max-w-4xl flex-col">
        <DialogHeader>
          <DialogTitle>{t("taxCalcComp.enrichment.title")}</DialogTitle>
          <DialogDescription>
            {t("taxCalcComp.enrichment.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-hidden p-1">
          {step === "upload" && (
            <div className="flex h-64 flex-col items-center justify-center gap-4 rounded-lg border-2 border-dashed bg-muted/50">
              <div className="rounded-full border bg-background p-4 shadow-sm">
                <Upload className="h-8 w-8 text-muted-foreground" />
              </div>
              <div className="text-center">
                <p className="font-medium">
                  {t("taxCalcComp.enrichment.clickToUpload")}
                </p>
                <p className="text-sm text-muted-foreground">
                  {t("taxCalcComp.enrichment.excelFilesHint")}
                </p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept=".xlsx,.xls"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <Button onClick={() => fileInputRef.current?.click()}>
                {t("taxCalcComp.enrichment.selectFile")}
              </Button>
              {file && (
                <div className="flex items-center gap-2 rounded border bg-background px-3 py-1 text-sm">
                  <FileSpreadsheet className="h-4 w-4 text-green-600" />
                  {file.name}
                </div>
              )}
            </div>
          )}

          {step === "detection" && detection && (
            <EnrichmentDetectionStep detection={detection} />
          )}

          {step === "preview" && (
            <EnrichmentPreviewStep
              items={items}
              unmatched={unmatched}
              selectedIds={selectedIds}
              onToggle={toggleSelection}
              onToggleAll={toggleAll}
            />
          )}
        </div>

        <DialogFooter>
          {step === "upload" && (
            <Button onClick={handleAnalyze} disabled={!file || loading}>
              {loading
                ? t("taxCalcComp.enrichment.analyzing")
                : t("taxCalcComp.enrichment.analyzeFile")}
            </Button>
          )}
          {step === "detection" && (
            <div className="flex w-full justify-between">
              <Button variant="ghost" onClick={reset}>
                {t("taxCalcComp.enrichment.backToUpload")}
              </Button>
              <Button onClick={handlePreview} disabled={loading}>
                {loading
                  ? t("taxCalcComp.enrichment.loadingPreview")
                  : t("taxCalcComp.enrichment.detectionContinue")}
              </Button>
            </div>
          )}
          {step === "preview" && (
            <div className="flex w-full justify-between">
              <Button variant="ghost" onClick={() => setStep("detection")}>
                {t("taxCalcComp.enrichment.backToDetection")}
              </Button>
              <Button
                onClick={handleApply}
                disabled={selectedIds.length === 0 || loading}
              >
                {loading
                  ? t("taxCalcComp.enrichment.updating")
                  : t("taxCalcComp.enrichment.applyUpdates", {
                      count: selectedIds.length,
                    })}
              </Button>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
