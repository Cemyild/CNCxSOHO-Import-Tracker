import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { ClipboardList, Download } from "lucide-react";

type TareksProcedure = {
  id: number;
  reference: string;
  shipper: string | null;
  invoice_no: string | null;
  invoice_date: string | null;
  amount: string | null;
  currency: string | null;
  piece: number | null;
  tareks_status: string | null;
  tareks_notes: string | null;
  style_nos: string | null;
};

type TareksDashboardData = {
  count: number;
  procedures: TareksProcedure[];
};

const TAREKS_STATUSES = [
  { value: "waiting_response" },
  { value: "inspection_date_confirmed" },
  { value: "samples_taken" },
  { value: "lab_testing" },
] as const;

type TareksStatusValue = typeof TAREKS_STATUSES[number]["value"];

const STATUS_BADGE_STYLES: Record<TareksStatusValue, string> = {
  waiting_response: "bg-amber-100 text-amber-800 border-amber-200",
  inspection_date_confirmed: "bg-blue-100 text-blue-800 border-blue-200",
  samples_taken: "bg-orange-100 text-orange-800 border-orange-200",
  lab_testing: "bg-purple-100 text-purple-800 border-purple-200",
};

function formatDate(date: string | null): string {
  if (!date) return "—";
  const d = new Date(date);
  if (isNaN(d.getTime())) return date;
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const year = d.getUTCFullYear();
  return `${day}.${month}.${year}`;
}

function NotesCell({
  initialValue,
  disabled,
  placeholder,
  onSave,
}: {
  initialValue: string;
  disabled: boolean;
  placeholder: string;
  onSave: (value: string) => void;
}) {
  const [value, setValue] = useState(initialValue);

  const commit = () => {
    if (value.trim() !== initialValue.trim()) {
      onSave(value.trim());
    }
  };

  return (
    <input
      type="text"
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          setValue(initialValue);
        }
      }}
      className="w-[220px] rounded-md border border-transparent bg-transparent px-2 py-1 text-sm text-gray-700 placeholder:text-gray-300 hover:border-gray-200 focus:border-gray-300 focus:bg-white focus:outline-none disabled:opacity-50 transition-colors"
    />
  );
}

function formatAmount(amount: string | null, currency: string | null): string {
  if (!amount) return "—";
  const num = parseFloat(amount);
  if (isNaN(num)) return "—";
  const curr = currency ?? "USD";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: curr,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(num);
}

export function TareksProceduresList() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [updatingId, setUpdatingId] = useState<number | null>(null);

  const { data, isLoading } = useQuery<TareksDashboardData>({
    queryKey: ["/api/dashboard/tareks-application"],
  });

  const mutation = useMutation({
    mutationFn: async ({
      id,
      tareks_status,
    }: {
      id: number;
      tareks_status: string;
    }) => {
      const res = await apiRequest("PATCH", `/api/procedures/${id}`, {
        tareks_status,
      });
      if (!res.ok) throw new Error("Failed to update status");
      return res.json();
    },
    onMutate: ({ id }) => {
      setUpdatingId(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/dashboard/tareks-application"],
      });
      toast({ title: t("tareks.statusUpdated") });
    },
    onError: () => {
      toast({ title: t("tareks.statusUpdateFailed"), variant: "destructive" });
    },
    onSettled: () => {
      setUpdatingId(null);
    },
  });

  const [savingNotesId, setSavingNotesId] = useState<number | null>(null);

  const notesMutation = useMutation({
    mutationFn: async ({
      id,
      tareks_notes,
    }: {
      id: number;
      tareks_notes: string | null;
    }) => {
      const res = await apiRequest("PATCH", `/api/procedures/${id}`, {
        tareks_notes,
      });
      if (!res.ok) throw new Error("Failed to update notes");
      return res.json();
    },
    onMutate: ({ id }) => {
      setSavingNotesId(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/dashboard/tareks-application"],
      });
      toast({ title: t("tareks.notesSaved") });
    },
    onError: () => {
      toast({ title: t("tareks.notesSaveFailed"), variant: "destructive" });
    },
    onSettled: () => {
      setSavingNotesId(null);
    },
  });

  return (
    <div className="mt-6 rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100">
        <ClipboardList className="h-5 w-5 text-red-500" />
        <h2 className="text-base font-semibold text-gray-900">
          {t("tareks.title")}
        </h2>
        {!isLoading && (
          <Badge className="ml-1 bg-red-100 text-red-700 border-red-200 text-xs">
            {data?.count ?? 0}
          </Badge>
        )}
        {!isLoading && (data?.procedures.length ?? 0) > 0 && (
          <button
            onClick={() =>
              window.open(
                "/api/dashboard/tareks-application/export/excel",
                "_blank"
              )
            }
            className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            title={t("tareks.exportToExcel")}
          >
            <Download className="h-3.5 w-3.5" />
            {t("tareks.exportExcel")}
          </button>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
              <th className="px-4 py-3 text-left font-medium">{t("tareks.col.reference")}</th>
              <th className="px-4 py-3 text-left font-medium">{t("tareks.col.shipper")}</th>
              <th className="px-4 py-3 text-left font-medium">{t("tareks.col.invoiceNo")}</th>
              <th className="px-4 py-3 text-left font-medium">{t("tareks.col.invoiceDate")}</th>
              <th className="px-4 py-3 text-right font-medium">{t("tareks.col.amount")}</th>
              <th className="px-4 py-3 text-right font-medium">{t("tareks.col.pieces")}</th>
              <th className="px-4 py-3 text-left font-medium">{t("tareks.col.styleNo")}</th>
              <th className="px-4 py-3 text-left font-medium">{t("tareks.col.status")}</th>
              <th className="px-4 py-3 text-left font-medium">{t("tareks.col.notes")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {isLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: 9 }).map((_, j) => (
                    <td key={j} className="px-4 py-3">
                      <Skeleton className="h-4 w-full" />
                    </td>
                  ))}
                </tr>
              ))
            ) : !data || data.procedures.length === 0 ? (
              <tr>
                <td
                  colSpan={9}
                  className="px-4 py-8 text-center text-gray-400 text-sm"
                >
                  {t("tareks.empty")}
                </td>
              </tr>
            ) : (
              data.procedures.map((proc) => {
                const knownValues = TAREKS_STATUSES.map((s) => s.value) as readonly string[];
                const rawStatus = proc.tareks_status ?? "waiting_response";
                const statusValue: TareksStatusValue = knownValues.includes(rawStatus)
                  ? (rawStatus as TareksStatusValue)
                  : "waiting_response";
                const badgeStyle = STATUS_BADGE_STYLES[statusValue];
                return (
                  <tr
                    key={proc.id}
                    className="hover:bg-gray-50 transition-colors"
                  >
                    <td className="px-4 py-3 font-medium">
                      <button
                        className="text-blue-600 hover:text-blue-800 hover:underline text-left"
                        onClick={() =>
                          setLocation(
                            `/procedure-details?reference=${encodeURIComponent(proc.reference ?? "")}`
                          )
                        }
                      >
                        {proc.reference ?? "—"}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {proc.shipper ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {proc.invoice_no ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {formatDate(proc.invoice_date)}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-900 font-medium">
                      {formatAmount(proc.amount, proc.currency)}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-600">
                      {proc.piece ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-gray-600 max-w-[200px] truncate" title={proc.style_nos ?? ""}>
                      {proc.style_nos ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <Select
                        value={statusValue}
                        onValueChange={(val) =>
                          mutation.mutate({
                            id: proc.id,
                            tareks_status: val,
                          })
                        }
                        disabled={updatingId === proc.id}
                      >
                        <SelectTrigger className="h-7 w-[210px] border-0 p-0 shadow-none focus:ring-0">
                          <Badge
                            className={`text-xs font-medium border ${badgeStyle} cursor-pointer`}
                          >
                            {t(`tareks.status.${statusValue}`)}
                          </Badge>
                        </SelectTrigger>
                        <SelectContent>
                          {TAREKS_STATUSES.map((s) => (
                            <SelectItem key={s.value} value={s.value}>
                              {t(`tareks.status.${s.value}`)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-4 py-3">
                      <NotesCell
                        key={`${proc.id}-${proc.tareks_notes ?? ""}`}
                        initialValue={proc.tareks_notes ?? ""}
                        disabled={savingNotesId === proc.id}
                        placeholder={t("tareks.notesPlaceholder")}
                        onSave={(value) =>
                          notesMutation.mutate({
                            id: proc.id,
                            tareks_notes: value === "" ? null : value,
                          })
                        }
                      />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
