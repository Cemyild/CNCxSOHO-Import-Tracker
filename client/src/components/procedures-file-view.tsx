import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  ChevronRight,
  Download,
  ExternalLink,
  File,
  FileImage,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderOpen,
  Loader2,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { Procedure } from "@shared/schema";

interface ProcedureDoc {
  id: number;
  expenseType: string;
  originalFilename: string;
  objectKey: string | null;
  storedFilename: string | null;
  fileSize: number;
  fileType: string;
  importDocumentType: string | null;
  createdAt: string | null;
  // Present for expense receipts / service invoices (?details=1)
  expense?: {
    category: string;
    number: string | null;
    date: string | null;
    amount: string | null;
    currency: string | null;
    issuer: string | null;
  };
}

// Same grouping and order as the Bulk Download ZIP folders.
const SUBFOLDERS = ["import_document", "import_expense", "service_invoice", "tax"] as const;

function formatSize(bytes: number): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("tr-TR");
}

// invoice_date is free text: normalise yyyy-mm-dd and dd/mm/yyyy to dd.mm.yyyy.
function formatInvoiceDate(value: string | null): string {
  if (!value) return "";
  const t = value.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (m) return `${m[3].padStart(2, "0")}.${m[2].padStart(2, "0")}.${m[1]}`;
  m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/.exec(t);
  if (m) return `${m[1].padStart(2, "0")}.${m[2].padStart(2, "0")}.${m[3]}`;
  return t;
}

function formatAmount(amount: string | null, currency: string | null): string {
  if (amount == null || amount === "") return "";
  const n = Number(amount);
  if (isNaN(n)) return amount;
  const formatted = n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency ? `${formatted} ${currency}` : formatted;
}

function fileIcon(doc: ProcedureDoc) {
  const name = doc.originalFilename.toLowerCase();
  const type = (doc.fileType || "").toLowerCase();
  if (type.startsWith("image/") || /\.(png|jpe?g|gif|webp)$/.test(name)) return FileImage;
  if (type.includes("sheet") || type.includes("excel") || /\.(xlsx?|csv)$/.test(name)) return FileSpreadsheet;
  if (type.includes("pdf") || name.endsWith(".pdf")) return FileText;
  return File;
}

function previewUrl(doc: ProcedureDoc): string {
  return doc.objectKey
    ? `/api/expense-documents/file/${encodeURIComponent(doc.objectKey)}?preview=true`
    : `/api/expense-documents/${doc.id}/download?preview=true`;
}

function downloadUrl(doc: ProcedureDoc): string {
  return `/api/expense-documents/${doc.id}/download`;
}

const natural = (a: string, b: string) =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

// "CNCALO-117 / 2" → base "CNCALO-117", part "2". References without "/" are their own base.
function splitReference(ref: string): { base: string; part: string } {
  const slash = ref.indexOf("/");
  if (slash < 0) return { base: ref.trim(), part: "" };
  return { base: ref.slice(0, slash).trim(), part: ref.slice(slash + 1).trim() };
}

// Newest first: same prefix grouped together, then the whole number descending
// (CNCALO-120 above CNCALO-25, not a character-by-character sort).
function compareBaseDesc(a: string, b: string): number {
  const pa = /^(\D*)(\d+)(.*)$/.exec(a);
  const pb = /^(\D*)(\d+)(.*)$/.exec(b);
  if (!pa || !pb) return pa ? -1 : pb ? 1 : natural(a, b);
  const byPrefix = natural(pa[1], pb[1]);
  if (byPrefix !== 0) return byPrefix;
  const byNumber = Number(pb[2]) - Number(pa[2]);
  if (byNumber !== 0) return byNumber;
  return natural(pa[3], pb[3]);
}

interface ReferenceGroup {
  key: string;
  base: string;
  procedures: Procedure[];
}

function groupProcedures(procedures: Procedure[]): ReferenceGroup[] {
  const map = new Map<string, ReferenceGroup>();
  for (const p of procedures) {
    if (!p.reference) continue;
    const { base } = splitReference(p.reference);
    const key = base.replace(/\s+/g, " ").toUpperCase();
    if (!map.has(key)) map.set(key, { key, base, procedures: [] });
    map.get(key)!.procedures.push(p);
  }
  const groups = Array.from(map.values());
  for (const g of groups) {
    g.procedures.sort((a, b) =>
      natural(splitReference(a.reference as string).part, splitReference(b.reference as string).part),
    );
  }
  return groups.sort((a, b) => compareBaseDesc(a.base, b.base));
}

export function ProceduresFileView({ procedures }: { procedures: Procedure[] }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<Set<string>>(new Set());

  const { data: countsData } = useQuery<{ counts: Record<string, number> }>({
    queryKey: ["/api/expense-document-counts"],
    staleTime: 30_000,
  });
  const counts = countsData?.counts;

  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const groups = useMemo(() => groupProcedures(procedures), [procedures]);

  const folderFor = (p: Procedure) => (
    <ProcedureFolder
      key={p.id}
      procedure={p}
      count={counts?.[p.reference as string]}
      isOpen={open.has(p.reference as string)}
      onToggle={() => toggle(p.reference as string)}
    />
  );

  return (
    <div className="rounded-md border">
      <div className="flex items-center border-b bg-muted/40 px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <span className="grow">{t("procedures.fileView.name")}</span>
        <span className="hidden w-28 text-right sm:block">{t("procedures.fileView.size")}</span>
        <span className="hidden w-28 text-right md:block">{t("procedures.fileView.date")}</span>
        <span className="w-20" />
      </div>
      {groups.length === 0 ? (
        <div className="h-24 flex items-center justify-center text-sm text-muted-foreground">
          {t("procedures.noResults")}
        </div>
      ) : (
        <ul role="tree" className="divide-y">
          {groups.map((g) => {
            // A lone reference is shown as-is; "/1", "/2"… splits share a parent folder.
            if (g.procedures.length === 1) return folderFor(g.procedures[0]);
            const groupKey = `group:${g.key}`;
            const total = counts
              ? g.procedures.reduce((sum, p) => sum + (counts[p.reference as string] ?? 0), 0)
              : undefined;
            return (
              <GroupFolder
                key={groupKey}
                name={g.base}
                childCount={g.procedures.length}
                fileCount={total}
                isOpen={open.has(groupKey)}
                onToggle={() => toggle(groupKey)}
              >
                {g.procedures.map(folderFor)}
              </GroupFolder>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function GroupFolder({
  name,
  childCount,
  fileCount,
  isOpen,
  onToggle,
  children,
}: {
  name: string;
  childCount: number;
  fileCount: number | undefined;
  isOpen: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const FolderIcon = isOpen ? FolderOpen : Folder;

  return (
    <li role="treeitem" aria-expanded={isOpen}>
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          "flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-muted/50 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70",
          isOpen && "bg-muted/30",
        )}
      >
        <ChevronRight
          size={16}
          className={cn("shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-90")}
          aria-hidden="true"
        />
        <FolderIcon size={18} className="shrink-0 text-amber-500" aria-hidden="true" />
        <span className="font-medium truncate">{name}</span>
        <span className="ms-1 inline-flex h-5 shrink-0 items-center rounded border border-border bg-background px-1.5 text-[0.625rem] font-medium text-muted-foreground/80">
          {t("procedures.fileView.procedureCount", { count: childCount })}
        </span>
        {fileCount !== undefined && (
          <span className="inline-flex h-5 shrink-0 items-center rounded border border-border bg-background px-1.5 text-[0.625rem] font-medium text-muted-foreground/80">
            {t("procedures.fileView.fileCount", { count: fileCount })}
          </span>
        )}
      </button>
      {isOpen && (
        <ul role="group" className="ms-8 border-s divide-y">
          {children}
        </ul>
      )}
    </li>
  );
}

function ProcedureFolder({
  procedure,
  count,
  isOpen,
  onToggle,
}: {
  procedure: Procedure;
  count: number | undefined;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const reference = procedure.reference as string;
  const isEmpty = count === 0;

  // package is free text: numbers get a unit ("22 pallets"), anything else is shown as typed.
  const quantity = (value: string | number | null, key: string) => {
    if (value == null || String(value).trim() === "" || String(value).trim() === "0") return null;
    const n = Number(value);
    return isNaN(n) ? String(value) : t(key, { count: n, value: n.toLocaleString("tr-TR") });
  };

  // Shipper · invoice amount · piece count · pallet (package) count — skipping blanks.
  const summary = [
    procedure.shipper,
    parseFloat(String(procedure.amount ?? "")) > 0
      ? new Intl.NumberFormat("en-US", { style: "currency", currency: procedure.currency || "TRY" })
          .format(parseFloat(String(procedure.amount)))
      : null,
    quantity(procedure.piece, "procedures.fileView.pieces"),
    quantity(procedure.package, "procedures.fileView.pallets"),
  ].filter(Boolean) as string[];

  const { data, isLoading, error } = useQuery<{ documents: ProcedureDoc[] }>({
    queryKey: ["/api/expense-documents/procedure", reference, "details"],
    queryFn: async () => {
      const res = await fetch(`/api/expense-documents/procedure/${encodeURIComponent(reference)}?details=1`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    enabled: isOpen,
    staleTime: 30_000,
  });

  const groups = useMemo(() => {
    const docs = data?.documents ?? [];
    const known = new Set<string>(SUBFOLDERS);
    const result = SUBFOLDERS.map((type) => ({
      type: type as string,
      docs: docs.filter((d) => d.expenseType === type),
    }));
    const other = docs.filter((d) => !known.has(d.expenseType));
    if (other.length) result.push({ type: "other", docs: other });
    return result.filter((g) => g.docs.length > 0);
  }, [data]);

  const FolderIcon = isOpen ? FolderOpen : Folder;

  return (
    <li role="treeitem" aria-expanded={isOpen}>
      <div
        className={cn(
          "group flex items-center gap-2 px-4 py-2.5 hover:bg-muted/50 transition-colors",
          isOpen && "bg-muted/30",
        )}
      >
        <button
          type="button"
          onClick={onToggle}
          className="flex grow items-center gap-2 text-left min-w-0 outline-none focus-visible:ring-2 focus-visible:ring-ring/70 rounded-sm"
        >
          <ChevronRight
            size={16}
            className={cn("shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-90")}
            aria-hidden="true"
          />
          <FolderIcon
            size={18}
            className={cn("shrink-0", isEmpty ? "text-muted-foreground/50" : "text-amber-500")}
            aria-hidden="true"
          />
          <span className={cn("font-medium truncate", isEmpty && "text-muted-foreground")}>{reference}</span>
          {summary.length > 0 && (
            <span className="hidden lg:inline truncate text-sm text-muted-foreground">· {summary.join(" · ")}</span>
          )}
          {count !== undefined && (
            <span className="ms-1 inline-flex h-5 shrink-0 items-center rounded border border-border bg-background px-1.5 text-[0.625rem] font-medium text-muted-foreground/80">
              {t("procedures.fileView.fileCount", { count })}
            </span>
          )}
        </button>
        <Link
          href={`/procedure-details?reference=${encodeURIComponent(reference)}`}
          className="shrink-0 text-xs text-muted-foreground opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-foreground transition-opacity"
        >
          {t("procedures.viewDetails")}
        </Link>
      </div>

      {isOpen && (
        <div className="pb-2">
          {isLoading ? (
            <div className="flex items-center gap-2 py-2 ps-14 text-sm text-muted-foreground">
              <Loader2 size={14} className="animate-spin" aria-hidden="true" />
              {t("procedures.loading")}
            </div>
          ) : error ? (
            <div className="py-2 ps-14 text-sm text-red-500">{t("procedures.fileView.loadError")}</div>
          ) : groups.length === 0 ? (
            <div className="py-2 ps-14 text-sm text-muted-foreground">{t("procedures.fileView.empty")}</div>
          ) : (
            <ul role="group">
              {groups.map((g) => (
                <SubFolder key={g.type} type={g.type} docs={g.docs} />
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

function SubFolder({ type, docs }: { type: string; docs: ProcedureDoc[] }) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(true);
  const FolderIcon = isOpen ? FolderOpen : Folder;

  return (
    <li role="treeitem" aria-expanded={isOpen}>
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="flex w-full items-center gap-2 py-1.5 pe-4 ps-10 text-left text-sm hover:bg-muted/50 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
      >
        <ChevronRight
          size={14}
          className={cn("shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-90")}
          aria-hidden="true"
        />
        <FolderIcon size={16} className="shrink-0 text-amber-500/80" aria-hidden="true" />
        <span className="font-medium">{t(`procedures.fileView.folders.${type}`)}</span>
        <span className="text-xs text-muted-foreground">({docs.length})</span>
      </button>
      {isOpen && (
        <ul role="group">
          {docs.map((d) => (
            <FileRow key={d.id} doc={d} />
          ))}
        </ul>
      )}
    </li>
  );
}

function FileRow({ doc }: { doc: ProcedureDoc }) {
  const { t } = useTranslation();
  const Icon = fileIcon(doc);
  const typeLabel = doc.importDocumentType
    ? t(`importDocUpload.docTypes.${doc.importDocumentType}`, { defaultValue: doc.importDocumentType })
    : null;
  const exp = doc.expense;
  // Expense receipts / service invoices: show the expense category instead of
  // the uploaded filename (often just "page-3.pdf"); the filename stays in the tooltip.
  const title = exp
    ? t(`expenseEntry.category.${exp.category}`, { defaultValue: exp.category })
    : doc.originalFilename;
  const details = exp
    ? [
        exp.number ? t("procedures.fileView.numberLabel", { number: exp.number }) : null,
        formatInvoiceDate(exp.date),
        formatAmount(exp.amount, exp.currency),
        exp.issuer,
      ].filter(Boolean)
    : [];

  return (
    <li role="treeitem" className="group flex items-center gap-2 py-1.5 pe-4 ps-[4.75rem] text-sm hover:bg-muted/50 transition-colors">
      <a
        href={previewUrl(doc)}
        target="_blank"
        rel="noopener noreferrer"
        className="flex grow items-center gap-2 min-w-0 hover:underline underline-offset-2"
        title={doc.originalFilename}
      >
        <Icon size={16} className="shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className={cn("truncate", exp && "font-medium")}>{title}</span>
        {details.length > 0 && (
          <span className="hidden sm:inline truncate text-xs text-muted-foreground">
            {details.join(" · ")}
          </span>
        )}
        {typeLabel && (
          <span className="hidden sm:inline-flex shrink-0 items-center rounded-full bg-muted px-2 py-0.5 text-[0.65rem] font-medium text-muted-foreground no-underline">
            {typeLabel}
          </span>
        )}
      </a>
      <span className="hidden w-28 shrink-0 text-right text-xs text-muted-foreground sm:block">{formatSize(doc.fileSize)}</span>
      <span className="hidden w-28 shrink-0 text-right text-xs text-muted-foreground md:block">{formatDate(doc.createdAt)}</span>
      <div className="flex w-20 shrink-0 justify-end gap-1">
        <Button asChild size="icon" variant="ghost" className="h-7 w-7 shadow-none">
          <a href={previewUrl(doc)} target="_blank" rel="noopener noreferrer" aria-label={t("procedures.fileView.open")} title={t("procedures.fileView.open")}>
            <ExternalLink size={14} aria-hidden="true" />
          </a>
        </Button>
        <Button asChild size="icon" variant="ghost" className="h-7 w-7 shadow-none">
          <a href={downloadUrl(doc)} download aria-label={t("procedures.fileView.download")} title={t("procedures.fileView.download")}>
            <Download size={14} aria-hidden="true" />
          </a>
        </Button>
      </div>
    </li>
  );
}
