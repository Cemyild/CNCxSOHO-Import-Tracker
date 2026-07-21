import { useTranslation } from "react-i18next";
import { ArrowRight, AlertTriangle } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export interface PreviewChange {
  field: string;
  oldValue: unknown;
  newValue: string;
}

export interface PreviewItem {
  procedureId: number;
  reference: string;
  matchMethod: string;
  excelRowNumbers: number[];
  changes: PreviewChange[];
}

export interface UnmatchedItem {
  excelRowNumber: number;
  customsFileNo: string | null;
  reason: "not_found" | "ambiguous" | "no_key";
  invoiceNo: string | null;
  amount: number | null;
  candidates: string[];
}

export function EnrichmentPreviewStep({
  items,
  unmatched,
  selectedIds,
  onToggle,
  onToggleAll,
}: {
  items: PreviewItem[];
  unmatched: UnmatchedItem[];
  selectedIds: number[];
  onToggle: (id: number) => void;
  onToggleAll: () => void;
}) {
  const { t } = useTranslation();

  const methodLabel = (method: string) =>
    t(`taxCalcComp.enrichment.matchedBy_${method.replace("+", "")}`, {
      defaultValue: method,
    });

  // "amount"-only matches bind a row to a procedure with no invoice number
  // confirming it — the only path that can bind to an unrelated record — so
  // it is flagged amber instead of the neutral blue used for the other two.
  const methodTone = (method: string) =>
    method === "amount"
      ? "bg-amber-100 text-amber-800"
      : "bg-blue-100 text-blue-800";

  const unmatchedReason = (row: UnmatchedItem) => {
    if (row.reason === "ambiguous") {
      return t("taxCalcComp.enrichment.unmatchedReason_ambiguous", {
        candidates: row.candidates.join(", "),
      });
    }
    if (row.reason === "no_key") {
      return t("taxCalcComp.enrichment.unmatchedReason_no_key");
    }
    return t("taxCalcComp.enrichment.unmatchedReason_not_found", {
      invoice: row.invoiceNo ?? "—",
      amount: row.amount ?? "—",
    });
  };

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-muted-foreground">
          {t("taxCalcComp.enrichment.recordsToUpdate", { count: items.length })}
        </span>
        <span className="text-xs text-muted-foreground">
          {t("taxCalcComp.enrichment.selected", { count: selectedIds.length })}
        </span>
      </div>

      <div className="relative flex-1 overflow-hidden rounded-md border">
        <ScrollArea className="h-full">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>
                <TableHead className="w-[50px]">
                  <Checkbox
                    checked={
                      selectedIds.length === items.length && items.length > 0
                    }
                    onCheckedChange={onToggleAll}
                  />
                </TableHead>
                <TableHead>{t("taxCalcComp.enrichment.reference")}</TableHead>
                <TableHead>{t("taxCalcComp.enrichment.matchMethod")}</TableHead>
                <TableHead>
                  {t("taxCalcComp.enrichment.changesHeader")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow
                  key={item.procedureId}
                  className={
                    selectedIds.includes(item.procedureId) ? "" : "opacity-50"
                  }
                >
                  <TableCell>
                    <Checkbox
                      checked={selectedIds.includes(item.procedureId)}
                      onCheckedChange={() => onToggle(item.procedureId)}
                    />
                  </TableCell>
                  <TableCell className="font-medium">
                    {item.reference}
                    {item.excelRowNumbers.length > 1 && (
                      <div className="text-xs font-normal text-muted-foreground">
                        {t("taxCalcComp.enrichment.mergedRows", {
                          rows: item.excelRowNumbers.join(" + "),
                        })}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${methodTone(item.matchMethod)}`}
                    >
                      {methodLabel(item.matchMethod)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      {item.changes.map((change) => (
                        <div
                          key={change.field}
                          className="grid grid-cols-[140px_1fr] items-center gap-2 text-sm"
                        >
                          <span className="font-mono text-xs text-muted-foreground">
                            {change.field}:
                          </span>
                          <span className="flex items-center gap-1.5">
                            <span className="text-xs text-red-400 line-through">
                              {change.oldValue
                                ? String(change.oldValue)
                                : t("taxCalcComp.enrichment.empty")}
                            </span>
                            <ArrowRight className="h-3 w-3 text-muted-foreground" />
                            <span className="font-medium text-green-600">
                              {change.newValue}
                            </span>
                          </span>
                        </div>
                      ))}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollArea>
      </div>

      {unmatched.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50">
          <div className="flex items-center gap-2 border-b border-amber-200 px-3 py-2 text-sm font-medium text-amber-900">
            <AlertTriangle className="h-4 w-4" />
            {t("taxCalcComp.enrichment.unmatchedTitle", {
              count: unmatched.length,
            })}
          </div>
          <ScrollArea className="max-h-32">
            <ul className="divide-y divide-amber-200">
              {unmatched.map((row) => (
                <li key={row.excelRowNumber} className="px-3 py-2 text-xs">
                  <span className="font-medium text-amber-900">
                    {t("taxCalcComp.enrichment.unmatchedRow", {
                      row: row.excelRowNumber,
                    })}
                  </span>
                  {row.customsFileNo && (
                    <span className="ml-2 text-amber-800">
                      {t("taxCalcComp.enrichment.unmatchedFile", {
                        file: row.customsFileNo,
                      })}
                    </span>
                  )}
                  <div className="text-amber-800">{unmatchedReason(row)}</div>
                </li>
              ))}
            </ul>
          </ScrollArea>
        </div>
      )}
    </div>
  );
}
