import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { DollarSign, Package, Receipt, CreditCard } from "lucide-react";
import { BentoCard, BentoGrid } from "@/components/ui/bento-grid";

interface SnapshotData {
  totalValueUSD: number;
  totalPieces: number;
  totalTaxPaid: number;
  totalExpensesPaid: number;
}

export function DashboardSnapshot() {
  const { t } = useTranslation();
  const { data: snapshot, isLoading } = useQuery<SnapshotData>({
    queryKey: ['/api/dashboard/snapshot'],
    enabled: true
  });

  if (isLoading) {
    return (
      <div className="mb-6">
        <BentoGrid className="grid-cols-1 lg:grid-cols-4 auto-rows-[12rem]">
          <div className="col-span-1 bg-gray-100 animate-pulse rounded-xl" />
          <div className="col-span-1 bg-gray-100 animate-pulse rounded-xl" />
          <div className="col-span-1 bg-gray-100 animate-pulse rounded-xl" />
          <div className="col-span-1 bg-gray-100 animate-pulse rounded-xl" />
        </BentoGrid>
      </div>
    );
  }

  const formatCurrency = (amount: number, currency: string = 'USD') => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('en-US').format(num);
  };

  const snapshotCards = [
    {
      Icon: DollarSign,
      name: t("snapshot.totalValueImported"),
      description: formatCurrency(snapshot?.totalValueUSD || 0),
      href: "/procedures",
      cta: t("snapshot.viewDetails"),
      background: <div className="absolute inset-0 bg-gradient-to-br from-green-50 to-emerald-100 opacity-60" />,
      className: "col-span-3 lg:col-span-1",
    },
    {
      Icon: Package,
      name: t("snapshot.totalPiecesImported"),
      description: formatNumber(snapshot?.totalPieces || 0) + " " + t("snapshot.pieces"),
      href: "/procedures",
      cta: t("snapshot.viewDetails"),
      background: <div className="absolute inset-0 bg-gradient-to-br from-blue-50 to-cyan-100 opacity-60" />,
      className: "col-span-3 lg:col-span-1",
    },
    {
      Icon: Receipt,
      name: t("snapshot.totalTaxPaid"),
      description: "₺" + formatNumber(snapshot?.totalTaxPaid || 0),
      href: "/expenses",
      cta: t("snapshot.viewDetails"),
      background: <div className="absolute inset-0 bg-gradient-to-br from-orange-50 to-amber-100 opacity-60" />,
      className: "col-span-3 lg:col-span-1",
    },
    {
      Icon: CreditCard,
      name: t("snapshot.totalExpensesPaid"),
      description: "₺" + formatNumber(snapshot?.totalExpensesPaid || 0),
      href: "/expenses",
      cta: t("snapshot.viewDetails"),
      background: <div className="absolute inset-0 bg-gradient-to-br from-purple-50 to-violet-100 opacity-60" />,
      className: "col-span-3 lg:col-span-1",
    },
  ];

  return (
    <div className="mb-6">
      <BentoGrid className="grid-cols-1 lg:grid-cols-4 auto-rows-[12rem]">
        {snapshotCards.map((card) => (
          <BentoCard key={card.name} {...card} />
        ))}
      </BentoGrid>
    </div>
  );
}