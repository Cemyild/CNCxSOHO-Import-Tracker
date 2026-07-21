import { useTranslation } from "react-i18next";
import { AlertTriangle, CheckCircle2, ArrowRight } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface UnusedColumn {
  field: string;
  colIndex: number;
  header: string;
  winnerHeader: string;
}

export interface DetectionSummary {
  sheetName: string;
  availableSheets: string[];
  headerRowIndex: number;
  dataRowCount: number;
  skippedRowCount: number;
  mapped: Array<{ field: string; colIndex: number; header: string }>;
  unusedCandidates: UnusedColumn[];
  unmappedHeaders: string[];
}

export function EnrichmentDetectionStep({
  detection,
  onSheetChange,
  onHeaderRowChange,
  busy,
}: {
  detection: DetectionSummary;
  onSheetChange: (sheetName: string) => void;
  onHeaderRowChange: (headerRowIndex: number) => void;
  busy: boolean;
}) {
  const { t } = useTranslation();

  const handleHeaderRowInputChange = (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const oneBasedRow = Number(event.target.value);
    if (!Number.isInteger(oneBasedRow) || oneBasedRow < 1) return;
    onHeaderRowChange(oneBasedRow - 1);
  };

  // Bounded height rather than h-full: see the note in EnrichmentPreviewStep —
  // the dialog is a grid, so h-full here resolves to the full content height
  // and the mapped-column list never scrolls.
  return (
    <ScrollArea className="max-h-[50vh]">
      <div className="flex flex-col gap-4 p-1">
        <div className="rounded-md border bg-muted/40 p-3 text-sm">
          <div className="mb-2 font-medium">
            {t("taxCalcComp.enrichment.detectionTitle")}
          </div>
          <dl className="grid grid-cols-[160px_1fr] items-center gap-y-2">
            <dt className="text-muted-foreground">
              {t("taxCalcComp.enrichment.detectionSheet")}
            </dt>
            <dd>
              <Select
                value={detection.sheetName}
                onValueChange={onSheetChange}
                disabled={busy}
              >
                <SelectTrigger className="h-8 w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {detection.availableSheets.map((sheet) => (
                    <SelectItem key={sheet} value={sheet}>
                      {sheet}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </dd>
            <dt className="text-muted-foreground">
              {t("taxCalcComp.enrichment.detectionHeaderRow")}
            </dt>
            <dd>
              <Input
                type="number"
                min={1}
                className="h-8 w-24"
                value={detection.headerRowIndex + 1}
                onChange={handleHeaderRowInputChange}
                disabled={busy}
              />
            </dd>
            <dt className="text-muted-foreground">
              {t("taxCalcComp.enrichment.detectionDataRows")}
            </dt>
            <dd className="font-mono">{detection.dataRowCount}</dd>
          </dl>
          {detection.skippedRowCount > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              {t("taxCalcComp.enrichment.detectionSkipped", {
                count: detection.skippedRowCount,
              })}
            </p>
          )}
        </div>

        <div className="rounded-md border">
          <div className="border-b bg-muted/40 px-3 py-2 text-sm font-medium">
            {t("taxCalcComp.enrichment.detectionMapped", {
              count: detection.mapped.length,
            })}
          </div>
          <ul className="divide-y">
            {detection.mapped.map((column) => (
              <li
                key={column.field}
                className="flex items-center gap-2 px-3 py-1.5 text-sm"
              >
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-600" />
                <span className="font-mono text-xs">{column.header}</span>
                <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                <span className="font-medium">{column.field}</span>
              </li>
            ))}
          </ul>
        </div>

        {detection.unusedCandidates.length > 0 && (
          <ul className="flex flex-col gap-1">
            {detection.unusedCandidates.map((unused) => (
              <li
                key={`${unused.field}-${unused.colIndex}`}
                className="flex items-start gap-2 rounded border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-900"
              >
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {t("taxCalcComp.enrichment.detectionUnused", {
                  header: unused.header,
                  winner: unused.winnerHeader,
                })}
              </li>
            ))}
          </ul>
        )}

        {detection.unmappedHeaders.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {t("taxCalcComp.enrichment.detectionUnmapped", {
              count: detection.unmappedHeaders.length,
            })}
          </p>
        )}
      </div>
    </ScrollArea>
  );
}
