import React from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { PageLayout } from '@/components/layout/PageLayout';
import { formatCurrency, formatDateTime } from '@/lib/formatters';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import {
  OffsetPreviewModal,
  type OffsetPlan,
} from '@/components/offset-preview-modal';

export interface OffsetCandidate {
  reference: string;
  shipper: string | null;
  paymentStatus: string | null;
  /** Positive = owes money, negative = overpaid. */
  balance: number;
}

export interface CandidateResult {
  overpayments: OffsetCandidate[];
  debts: OffsetCandidate[];
  totalOverpayment: number;
  totalDebt: number;
  uncosted: { count: number; amount: number };
}

export interface OffsetHistoryEntry {
  id: number;
  batchId: string;
  fromReference: string;
  toReference: string;
  amount: number;
  offsetDate: string;
  mode: 'auto' | 'manual';
  createdByName: string | null;
  reversedAt: string | null;
}

/** Query string shared by the candidates and preview endpoints. */
export function filterQuery(shipper: string, showClosed: boolean): string {
  const params = new URLSearchParams();
  if (shipper) params.set('shipper', shipper);
  if (!showClosed) params.set('includeClosed', 'false');
  const query = params.toString();
  return query ? `?${query}` : '';
}

export function SummaryCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-md border p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-sm text-muted-foreground">{hint}</p>
    </div>
  );
}

export default function OffsetsPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [shipper, setShipper] = React.useState<string>('');
  const [showClosed, setShowClosed] = React.useState(true);
  const [selectedSource, setSelectedSource] = React.useState<string | null>(null);
  const [selectedTarget, setSelectedTarget] = React.useState<string | null>(null);
  const [manualAmount, setManualAmount] = React.useState<string>('');
  const [previewOpen, setPreviewOpen] = React.useState(false);

  const { data } = useQuery<CandidateResult>({
    queryKey: ['/api/offsets/candidates', shipper, showClosed],
    queryFn: async () => {
      const response = await apiRequest(
        'GET',
        `/api/offsets/candidates${filterQuery(shipper, showClosed)}`,
      );
      return await response.json();
    },
  });

  // Kept fresh alongside the candidate lists so the "closed in one click"
  // card is always in step with what the lists show.
  const { data: plan } = useQuery<OffsetPlan>({
    queryKey: ['/api/offsets/preview', shipper, showClosed],
    queryFn: async () => {
      const response = await apiRequest(
        'GET',
        `/api/offsets/preview${filterQuery(shipper, showClosed)}`,
      );
      return await response.json();
    },
  });

  const source =
    data?.overpayments.find((c) => c.reference === selectedSource) ?? null;
  const target = data?.debts.find((c) => c.reference === selectedTarget) ?? null;
  const suggested =
    source && target ? Math.min(Math.abs(source.balance), target.balance) : 0;

  React.useEffect(() => {
    setManualAmount(suggested > 0 ? suggested.toFixed(2) : '');
  }, [suggested]);

  const shippers = React.useMemo(() => {
    const all = [...(data?.overpayments ?? []), ...(data?.debts ?? [])];
    return Array.from(
      new Set(all.map((c) => c.shipper).filter(Boolean) as string[]),
    ).sort();
  }, [data]);

  const { data: history } = useQuery<{ offsets: OffsetHistoryEntry[] }>({
    queryKey: ['/api/offsets/history'],
    queryFn: async () => {
      const response = await apiRequest('GET', '/api/offsets/history');
      return await response.json();
    },
  });

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ['/api/offsets/candidates'] });
    queryClient.invalidateQueries({ queryKey: ['/api/offsets/preview'] });
    queryClient.invalidateQueries({ queryKey: ['/api/offsets/history'] });
  };

  const undoToast = {
    onSuccess: () => {
      toast({ title: t('offsets.toast.reverseSuccess') });
      refreshAll();
    },
    onError: (error: unknown) => {
      toast({
        title: t('offsets.toast.reverseError'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive' as const,
      });
    },
  };

  const reverseOne = useMutation({
    mutationFn: async (id: number) => {
      const response = await apiRequest('POST', `/api/offsets/${id}/reverse`);
      return await response.json();
    },
    ...undoToast,
  });

  const reverseWholeBatch = useMutation({
    mutationFn: async (batchId: string) => {
      const response = await apiRequest(
        'POST',
        `/api/offsets/batch/${batchId}/reverse`,
      );
      return await response.json();
    },
    ...undoToast,
  });

  const batches = React.useMemo(() => {
    const grouped = new Map<string, OffsetHistoryEntry[]>();
    for (const entry of history?.offsets ?? []) {
      grouped.set(entry.batchId, [...(grouped.get(entry.batchId) ?? []), entry]);
    }
    return Array.from(grouped.entries());
  }, [history]);

  const applyManual = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('POST', '/api/offsets/apply', {
        mode: 'manual',
        moves: [
          {
            fromReference: source!.reference,
            toReference: target!.reference,
            amount: parseFloat(manualAmount),
          },
        ],
      });
      return await response.json();
    },
    onSuccess: (result) => {
      toast({
        title: t('offsets.toast.applySuccess', {
          n: result.applied,
          amount: formatCurrency(parseFloat(manualAmount)),
        }),
      });
      setSelectedSource(null);
      setSelectedTarget(null);
      queryClient.invalidateQueries({ queryKey: ['/api/offsets/candidates'] });
      queryClient.invalidateQueries({ queryKey: ['/api/offsets/preview'] });
      queryClient.invalidateQueries({ queryKey: ['/api/offsets/history'] });
    },
    onError: (error: unknown) => {
      toast({
        title: t('offsets.toast.applyError'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    },
  });

  const amount = parseFloat(manualAmount);
  const manualValid =
    source !== null &&
    target !== null &&
    Number.isFinite(amount) &&
    amount > 0 &&
    amount <= Math.abs(source.balance) + 0.005 &&
    amount <= target.balance + 0.005;

  const renderRow = (
    candidate: OffsetCandidate,
    selected: boolean,
    onSelect: () => void,
  ) => (
    <button
      key={candidate.reference}
      type="button"
      onClick={onSelect}
      className={`w-full rounded-md border p-3 text-left transition-colors ${
        selected ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{candidate.reference}</span>
        <span className="font-mono">
          {formatCurrency(Math.abs(candidate.balance))}
        </span>
      </div>
      <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
        <span className="truncate">{candidate.shipper ?? '—'}</span>
        {candidate.paymentStatus === 'closed' && (
          <span className="rounded bg-orange-100 px-1.5 py-0.5 text-orange-700 dark:bg-orange-950 dark:text-orange-300">
            {t('offsets.lists.closedBadge')}
          </span>
        )}
      </div>
    </button>
  );

  return (
    <PageLayout title={t('nav.offsets')}>
      <Tabs defaultValue="match" className="space-y-4">
        <TabsList>
          <TabsTrigger value="match">{t('offsets.tabs.match')}</TabsTrigger>
          <TabsTrigger value="history">{t('offsets.tabs.history')}</TabsTrigger>
        </TabsList>

        <TabsContent value="match" className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <select
            className="h-9 rounded-md border bg-background px-2 text-sm"
            value={shipper}
            onChange={(e) => setShipper(e.target.value)}
            aria-label={t('offsets.filters.shipper')}
          >
            <option value="">{t('offsets.filters.allShippers')}</option>
            {shippers.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showClosed}
              onChange={(e) => setShowClosed(e.target.checked)}
            />
            {t('offsets.filters.showClosed')}
          </label>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <SummaryCard
            label={t('offsets.summary.totalOverpayment')}
            value={formatCurrency(data?.totalOverpayment ?? 0)}
            hint={t('offsets.summary.procedureCount', {
              n: data?.overpayments.length ?? 0,
            })}
          />
          <SummaryCard
            label={t('offsets.summary.totalDebt')}
            value={formatCurrency(data?.totalDebt ?? 0)}
            hint={t('offsets.summary.debtCount', { n: data?.debts.length ?? 0 })}
          />
          <SummaryCard
            label={t('offsets.summary.closable')}
            value={formatCurrency(plan?.usedAmount ?? 0)}
            hint={t('offsets.summary.debtCount', {
              n: plan?.closedDebts.length ?? 0,
            })}
          />
        </div>

        <div>
          <Button
            onClick={() => setPreviewOpen(true)}
            disabled={(plan?.moves.length ?? 0) === 0}
          >
            ⚡ {t('offsets.actions.autoMatch')}
          </Button>
        </div>

        {(data?.uncosted.count ?? 0) > 0 && (
          <p className="text-sm text-muted-foreground">
            {t('offsets.summary.uncosted', {
              n: data?.uncosted.count ?? 0,
              amount: formatCurrency(data?.uncosted.amount ?? 0),
            })}
          </p>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <section className="space-y-2">
            <h2 className="text-sm font-semibold">
              {t('offsets.lists.overpayments', {
                n: data?.overpayments.length ?? 0,
              })}
            </h2>
            <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
              {data?.overpayments.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {t('offsets.lists.emptyOverpayments')}
                </p>
              )}
              {data?.overpayments.map((c) =>
                renderRow(c, c.reference === selectedSource, () =>
                  setSelectedSource(
                    c.reference === selectedSource ? null : c.reference,
                  ),
                ),
              )}
            </div>
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold">
              {t('offsets.lists.debts', { n: data?.debts.length ?? 0 })}
            </h2>
            <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
              {data?.debts.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {t('offsets.lists.emptyDebts')}
                </p>
              )}
              {data?.debts.map((c) =>
                renderRow(c, c.reference === selectedTarget, () =>
                  setSelectedTarget(
                    c.reference === selectedTarget ? null : c.reference,
                  ),
                ),
              )}
            </div>
          </section>
        </div>

        <div className="flex flex-wrap items-end gap-3 rounded-md border p-4">
          {source && target ? (
            <>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">
                  {t('offsets.manual.amount')}
                </label>
                <Input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={manualAmount}
                  onChange={(e) => setManualAmount(e.target.value)}
                  className="w-40"
                />
              </div>
              <Button
                onClick={() => applyManual.mutate()}
                disabled={!manualValid || applyManual.isPending}
              >
                {source.reference} → {target.reference}
              </Button>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t('offsets.manual.selectBoth')}
            </p>
          )}
        </div>

        <OffsetPreviewModal
          isOpen={previewOpen}
          onClose={() => setPreviewOpen(false)}
          plan={plan ?? null}
          onApplied={() => {
            setSelectedSource(null);
            setSelectedTarget(null);
            queryClient.invalidateQueries({ queryKey: ['/api/offsets/candidates'] });
            queryClient.invalidateQueries({ queryKey: ['/api/offsets/preview'] });
            queryClient.invalidateQueries({ queryKey: ['/api/offsets/history'] });
          }}
        />
        </TabsContent>

        <TabsContent value="history" className="space-y-4">
          {batches.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {t('offsets.history.empty')}
            </p>
          )}
          {batches.map(([batchId, entries]) => {
            const total = entries.reduce((s, e) => s + e.amount, 0);
            const open = entries.filter((e) => e.reversedAt === null);
            return (
              <div key={batchId} className="rounded-md border">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2 text-sm">
                  <span>
                    {formatDateTime(entries[0].offsetDate)} ·{' '}
                    {entries[0].createdByName ?? '—'} ·{' '}
                    {entries[0].mode === 'auto'
                      ? t('offsets.history.auto')
                      : t('offsets.history.manual')}{' '}
                    ·{' '}
                    {t('offsets.history.batchSummary', {
                      n: entries.length,
                      amount: formatCurrency(total),
                    })}
                  </span>
                  {open.length > 1 && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => reverseWholeBatch.mutate(batchId)}
                      disabled={reverseWholeBatch.isPending}
                    >
                      {t('offsets.actions.reverseBatch')}
                    </Button>
                  )}
                </div>
                {entries.map((entry) => (
                  <div
                    key={entry.id}
                    className={`flex items-center justify-between gap-3 px-3 py-2 text-sm ${
                      entry.reversedAt ? 'text-muted-foreground line-through' : ''
                    }`}
                  >
                    <span className="flex-1">
                      {entry.fromReference} → {entry.toReference}
                    </span>
                    <span className="font-mono">{formatCurrency(entry.amount)}</span>
                    {entry.reversedAt ? (
                      <span className="text-xs no-underline">
                        {t('offsets.history.reversed')}
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => reverseOne.mutate(entry.id)}
                        disabled={reverseOne.isPending}
                      >
                        {t('offsets.actions.reverse')}
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            );
          })}
        </TabsContent>
      </Tabs>
    </PageLayout>
  );
}
