import {
  Calendar,
  Home,
  Inbox,
  Search,
  Settings,
  BarChart2,
  Calculator,
} from "lucide-react";
import { PageLayout } from "@/components/layout/PageLayout";
import { ProceduresTable } from "@/components/ui/procedures-table";

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

export default function ProceduresPage() {
  return (
    <PageLayout title="Procedures" navItems={items}>
      <ProceduresTable />
    </PageLayout>
  );
}
