import { useState, useEffect } from "react";
import {
  Calendar,
  Home,
  Inbox,
  Search,
  Settings,
  BarChart2,
  Calculator,
} from "lucide-react";
import { DashboardCard } from "@/components/ui/expandable-card";
import { CardsProvider } from "@/components/hooks/use-cards-context";
import { PageLayout } from "@/components/layout/PageLayout";
import { DashboardSnapshot } from "@/components/dashboard-snapshot";

// Menu items
const items = [
  {
    title: "Dashboard",
    url: "/dashboard",
    icon: Home,
  },
  {
    title: "Procedures",
    url: "/procedures",
    icon: Inbox,
  },
  {
    title: "Expenses",
    url: "/expenses",
    icon: Calendar,
  },
  {
    title: "Payments",
    url: "/payments",
    icon: Search,
  },
  {
    title: "Tax Calculation",
    url: "/tax-calculation",
    icon: Calculator,
  },
  {
    title: "Reports",
    url: "/reports",
    icon: BarChart2,
  },
  {
    title: "Settings",
    url: "/settings",
    icon: Settings,
  },
];

interface DashboardData {
  count: number;
  procedures: Array<{
    reference: string;
    shipment_status?: string;
    document_status?: string;
    payment_status?: string;
    created_at?: string;
  }>;
}

export default function DashboardPage() {
  const [dashboardData, setDashboardData] = useState<{
    activeProcedures: DashboardData;
    pendingDocuments: DashboardData;
    awaitingPayment: DashboardData;
  }>({
    activeProcedures: { count: 0, procedures: [] },
    pendingDocuments: { count: 0, procedures: [] },
    awaitingPayment: { count: 0, procedures: [] }
  });
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Fetch dashboard data
  useEffect(() => {
    const fetchDashboardData = async () => {
      try {
        setLoading(true);
        
        // Fetch all dashboard data in parallel
        const [activeProceduresRes, pendingDocumentsRes, awaitingPaymentRes] = await Promise.all([
          fetch('/api/dashboard/active-procedures'),
          fetch('/api/dashboard/pending-documents'),
          fetch('/api/dashboard/awaiting-payment')
        ]);
        
        // Check if all requests were successful
        if (!activeProceduresRes.ok || !pendingDocumentsRes.ok || !awaitingPaymentRes.ok) {
          throw new Error('Failed to fetch dashboard data');
        }
        
        // Parse JSON responses
        const [activeProcedures, pendingDocuments, awaitingPayment] = await Promise.all([
          activeProceduresRes.json(),
          pendingDocumentsRes.json(),
          awaitingPaymentRes.json()
        ]);
        
        // Update state with fetched data
        setDashboardData({
          activeProcedures,
          pendingDocuments,
          awaitingPayment
        });
        
        setError(null);
      } catch (err) {
        console.error('Error fetching dashboard data:', err);
        setError('Failed to load dashboard data');
      } finally {
        setLoading(false);
      }
    };
    
    fetchDashboardData();
  }, []);

  return (
    <PageLayout title="Dashboard" navItems={items}>
      <DashboardSnapshot />
      <CardsProvider>
        <div className="grid gap-4 md:grid-cols-3">
          <DashboardCard
            title="Active Procedures"
            procedures={dashboardData.activeProcedures.procedures}
            count={dashboardData.activeProcedures.count}
            isLoading={loading}
          />

          <DashboardCard
            title="Pending Documents"
            procedures={dashboardData.pendingDocuments.procedures}
            count={dashboardData.pendingDocuments.count}
            isLoading={loading}
          />

          <DashboardCard
            title="Awaiting Payment"
            procedures={dashboardData.awaitingPayment.procedures}
            count={dashboardData.awaitingPayment.count}
            isLoading={loading}
          />
        </div>
      </CardsProvider>
    </PageLayout>
  );
}