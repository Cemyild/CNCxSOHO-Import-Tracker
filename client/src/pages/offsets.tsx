import React from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { PageLayout } from '@/components/layout/PageLayout';
import { formatCurrency } from '@/lib/formatters';

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

  const { data } = useQuery<CandidateResult>({
    queryKey: ['/api/offsets/candidates'],
    queryFn: async () => {
      const response = await apiRequest('GET', '/api/offsets/candidates');
      return await response.json();
    },
  });

  return (
    <PageLayout title={t('nav.offsets')}>
      <div className="space-y-4">
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
        </div>

        {(data?.uncosted.count ?? 0) > 0 && (
          <p className="text-sm text-muted-foreground">
            {t('offsets.summary.uncosted', {
              n: data?.uncosted.count ?? 0,
              amount: formatCurrency(data?.uncosted.amount ?? 0),
            })}
          </p>
        )}
      </div>
    </PageLayout>
  );
}
