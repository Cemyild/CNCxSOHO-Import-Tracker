import type { ComponentType } from "react";
import {
  Archive,
  ArrowLeftRight,
  BarChart2,
  Calculator,
  FlaskConical,
  Calendar,
  FileText,
  Home,
  Inbox,
  Mail,
  Search,
  Settings,
  Sparkles,
  Warehouse,
} from "lucide-react";

export type NavItem = {
  titleKey: string;
  url: string;
  icon: ComponentType<any>;
  /** Yalnızca admin rolüne gösterilir. */
  adminOnly?: boolean;
};

export const defaultNavItems: NavItem[] = [
  { titleKey: "nav.dashboard", url: "/dashboard", icon: Home },
  { titleKey: "nav.procedures", url: "/procedures", icon: Inbox },
  { titleKey: "nav.expenses", url: "/expenses", icon: Calendar },
  { titleKey: "nav.payments", url: "/payments", icon: Search },
  { titleKey: "nav.offsets", url: "/offsets", icon: ArrowLeftRight },
  { titleKey: "nav.taxCalculation", url: "/tax-calculation", icon: Calculator },
  { titleKey: "nav.storageCalculator", url: "/storage-calculator", icon: Warehouse },
  { titleKey: "nav.reports", url: "/reports", icon: BarChart2 },
  { titleKey: "nav.tareksReports", url: "/tareks-reports", icon: FlaskConical },
  { titleKey: "nav.bulkDownload", url: "/bulk-download", icon: Archive },
  { titleKey: "nav.askCnc", url: "/ask", icon: Sparkles },
  { titleKey: "nav.invoiceMaker", url: "/invoice-maker", icon: FileText },
  { titleKey: "nav.emailInbox", url: "/inbox", icon: Mail, adminOnly: true },
  { titleKey: "nav.settings", url: "/settings", icon: Settings },
];
