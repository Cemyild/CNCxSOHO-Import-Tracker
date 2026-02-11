import { useQuery } from "@tanstack/react-query";
import { DollarSign, CreditCard, TrendingUp, TrendingDown } from "lucide-react";
import { BentoCard, BentoGrid } from "@/components/ui/bento-grid";

interface PaymentSummaryData {
  totalExpenses: number;
  totalPayments: number;
  remainingBalance: number;
  isOverpaid: boolean;
}

export function PaymentSummaryCards() {
  // Fetch all financial summaries to aggregate totals
  const { data: allSummariesData, isLoading } = useQuery({
    queryKey: ["/api/financial-summary"],
    queryFn: async () => {
      const response = await fetch("/api/financial-summary");
      if (!response.ok) {
        throw new Error("Failed to fetch financial summaries");
      }
      return response.json();
    },
  });

  if (isLoading) {
    return (
      <div className="mb-6">
        <BentoGrid className="grid-cols-1 lg:grid-cols-3 auto-rows-[12rem]">
          <div className="col-span-1 bg-gray-100 animate-pulse rounded-xl" />
          <div className="col-span-1 bg-gray-100 animate-pulse rounded-xl" />
          <div className="col-span-1 bg-gray-100 animate-pulse rounded-xl" />
        </BentoGrid>
      </div>
    );
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('tr-TR', {
      style: 'currency',
      currency: 'TRY',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  };

  // Calculate aggregated totals from all procedures
  let totalExpenses = 0;
  let totalPayments = 0;
  let remainingBalance = 0;

  if (allSummariesData?.financialSummaries) {
    allSummariesData.financialSummaries.forEach((summary: any) => {
      totalExpenses += summary.totalExpenses || 0;
      totalPayments += summary.totalPayments || 0;
      remainingBalance += summary.remainingBalance || 0;
    });
  }

  const isOverpaid = remainingBalance < 0;
  const balanceAmount = Math.abs(remainingBalance);

  const summaryCards = [
    {
      Icon: DollarSign,
      name: "Total Expenses",
      description: formatCurrency(totalExpenses),
      href: "#",
      cta: "View Details",
      background: <div className="absolute inset-0 bg-gradient-to-br from-red-50 to-rose-100 opacity-60" />,
      className: "col-span-3 lg:col-span-1",
    },
    {
      Icon: CreditCard,
      name: "Total Payments",
      description: formatCurrency(totalPayments),
      href: "#",
      cta: "View Details",
      background: <div className="absolute inset-0 bg-gradient-to-br from-blue-50 to-cyan-100 opacity-60" />,
      className: "col-span-3 lg:col-span-1",
    },
    {
      Icon: isOverpaid ? TrendingDown : TrendingUp,
      name: isOverpaid ? "Overpaid" : "Balance",
      description: formatCurrency(balanceAmount),
      href: "#",
      cta: "View Details",
      background: isOverpaid 
        ? <div className="absolute inset-0 bg-gradient-to-br from-green-50 to-emerald-100 opacity-60" />
        : <div className="absolute inset-0 bg-gradient-to-br from-red-50 to-rose-100 opacity-60" />,
      className: "col-span-3 lg:col-span-1",
    },
  ];

  return (
    <div className="mb-6">
      <BentoGrid className="grid-cols-1 lg:grid-cols-3 auto-rows-[12rem]">
        {summaryCards.map((card) => (
          <BentoCard key={card.name} {...card} />
        ))}
      </BentoGrid>
    </div>
  );
}