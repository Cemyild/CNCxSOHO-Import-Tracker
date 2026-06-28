import type { ComponentType } from "react";
import {
  Archive,
  BarChart2,
  Calculator,
  Calendar,
  FileText,
  Home,
  Inbox,
  Search,
  Settings,
  Sparkles,
  Warehouse,
} from "lucide-react";

export type NavItem = {
  titleKey: string;
  url: string;
  icon: ComponentType<any>;
};

export const defaultNavItems: NavItem[] = [
  { titleKey: "nav.dashboard", url: "/dashboard", icon: Home },
  { titleKey: "nav.procedures", url: "/procedures", icon: Inbox },
  { titleKey: "nav.expenses", url: "/expenses", icon: Calendar },
  { titleKey: "nav.payments", url: "/payments", icon: Search },
  { titleKey: "nav.taxCalculation", url: "/tax-calculation", icon: Calculator },
  { titleKey: "nav.storageCalculator", url: "/storage-calculator", icon: Warehouse },
  { titleKey: "nav.reports", url: "/reports", icon: BarChart2 },
  { titleKey: "nav.bulkDownload", url: "/bulk-download", icon: Archive },
  { titleKey: "nav.askCnc", url: "/ask", icon: Sparkles },
  { titleKey: "nav.invoiceMaker", url: "/invoice-maker", icon: FileText },
  { titleKey: "nav.settings", url: "/settings", icon: Settings },
];
