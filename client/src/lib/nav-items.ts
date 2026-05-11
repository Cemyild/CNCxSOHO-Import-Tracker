import type { ComponentType } from "react";
import {
  BarChart2,
  Calculator,
  Calendar,
  Home,
  Inbox,
  Search,
  Settings,
  Sparkles,
  Warehouse,
} from "lucide-react";

export type NavItem = {
  title: string;
  url: string;
  icon: ComponentType<any>;
};

export const defaultNavItems: NavItem[] = [
  { title: "Dashboard", url: "/dashboard", icon: Home },
  { title: "Procedures", url: "/procedures", icon: Inbox },
  { title: "Expenses", url: "/expenses", icon: Calendar },
  { title: "Payments", url: "/payments", icon: Search },
  { title: "Tax Calculation", url: "/tax-calculation", icon: Calculator },
  { title: "Storage Calculator", url: "/storage-calculator", icon: Warehouse },
  { title: "Reports", url: "/reports", icon: BarChart2 },
  { title: "Ask CNC?", url: "/ask", icon: Sparkles },
  { title: "Settings", url: "/settings", icon: Settings },
];
