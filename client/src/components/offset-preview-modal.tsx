import React from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { formatCurrency } from '@/lib/formatters';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export interface OffsetMove {
  fromReference: string;
  toReference: string;
  amount: number;
}

export interface OffsetPlan {
  moves: OffsetMove[];
  closedDebts: string[];
  unmatchedDebts: string[];
  usedAmount: number;
  remainingOverpayment: number;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  plan: OffsetPlan | null;
  onApplied: () => void;
}

export function OffsetPreviewModal({ isOpen, onClose, plan, onApplied }: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  // Moves are identified by their position in plan.moves — two transfers can
  // legitimately share source, target and amount.
  const [excluded, setExcluded] = React.useState<Set<number>>(new Set());

  React.useEffect(() => {
    if (isOpen) setExcluded(new Set());
  }, [isOpen, plan]);

  const moves = plan?.moves ?? [];
  const selected = moves.filter((_, index) => !excluded.has(index));

  // Group by target so the "closes / partial" label sits where it is true:
  // one debt can be fed by several sources.
  const groups = React.useMemo(() => {
    const byTarget = new Map<string, { move: OffsetMove; index: number }[]>();
    moves.forEach((move, index) => {
      byTarget.set(move.toReference, [
        ...(byTarget.get(move.toReference) ?? []),
        { move, index },
      ]);
    });

    return Array.from(byTarget.entries()).map(([reference, planned]) => {
      const plannedTotal = planned.reduce((s, p) => s + p.move.amount, 0);
      const kept = planned.filter((p) => !excluded.has(p.index));
      const keptTotal = kept.reduce((s, p) => s + p.move.amount, 0);
      return {
        reference,
        planned,
        plannedTotal,
        keptCount: kept.length,
        keptTotal,
        closes: kept.length > 0 && Math.abs(plannedTotal - keptTotal) < 0.005,
      };
    });
  }, [moves, excluded]);

  const selectedTotal = selected.reduce((s, m) => s + m.amount, 0);
  const closingCount = groups.filter((g) => g.closes).length;

  const apply = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('POST', '/api/offsets/apply', {
        mode: 'auto',
        moves: selected,
      });
      return await response.json();
    },
    onSuccess: (result) => {
      toast({
        title: t('offsets.toast.applySuccess', {
          n: result.applied,
          amount: formatCurrency(selectedTotal),
        }),
      });
      onApplied();
      onClose();
    },
    onError: (error: unknown) => {
      toast({
        title: t('offsets.toast.applyError'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    },
  });

  const toggle = (index: number) => {
    setExcluded((previous) => {
      const next = new Set(previous);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[700px]">
        <DialogHeader>
          <DialogTitle>{t('offsets.preview.title')}</DialogTitle>
          <DialogDescription>{t('offsets.preview.description')}</DialogDescription>
        </DialogHeader>

        {moves.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {t('offsets.preview.empty')}
          </p>
        ) : (
          <>
            <div className="rounded-md border p-3 text-sm">
              <p>{t('offsets.preview.closedDebts', { n: closingCount })}</p>
              <p>
                {t('offsets.preview.usedAmount', {
                  amount: formatCurrency(selectedTotal),
                })}
              </p>
              <p>{t('offsets.preview.moveCount', { n: selected.length })}</p>
              <p className="text-muted-foreground">
                {t('offsets.preview.remaining', {
                  amount: formatCurrency(
                    (plan?.remainingOverpayment ?? 0) +
                      ((plan?.usedAmount ?? 0) - selectedTotal),
                  ),
                })}
              </p>
              <p className="text-muted-foreground">
                {t('offsets.preview.unmatched', {
                  n: plan?.unmatchedDebts.length ?? 0,
                })}
              </p>
            </div>

            <div className="space-y-3">
              {groups.map((group) => (
                <div key={group.reference} className="rounded-md border">
                  <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-2 text-sm font-medium">
                    <span>
                      {group.reference} · {formatCurrency(group.plannedTotal)}
                    </span>
                    <span
                      className={group.closes ? 'text-green-600' : 'text-orange-600'}
                    >
                      {group.closes
                        ? t('offsets.preview.willClose')
                        : t('offsets.preview.partial')}
                      {group.planned.length > 1 &&
                        ` · ${t('offsets.preview.sourceCount', {
                          n: group.planned.length,
                        })}`}
                    </span>
                  </div>
                  {group.planned.map(({ move, index }) => (
                    <label
                      key={index}
                      className="flex items-center gap-3 px-3 py-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={!excluded.has(index)}
                        onChange={() => toggle(index)}
                      />
                      <span className="flex-1">{move.fromReference}</span>
                      <span className="font-mono">{formatCurrency(move.amount)}</span>
                    </label>
                  ))}
                </div>
              ))}
            </div>
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={apply.isPending}>
            {t('offsets.actions.cancel')}
          </Button>
          <Button
            onClick={() => apply.mutate()}
            disabled={selected.length === 0 || apply.isPending}
          >
            {t('offsets.actions.apply', { n: selected.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
