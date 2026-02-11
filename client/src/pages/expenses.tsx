import { 
  Calendar,
  Home,
  Inbox,
  Settings,
  BarChart2,
  CreditCard,
  Calculator
} from "lucide-react"
import { PageLayout } from "@/components/layout/PageLayout"
import { ExpensesTable } from "@/components/ui/expenses-table"

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
    icon: CreditCard,
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
]

export default function ExpensesPage() {
  return (
    <PageLayout title="Expenses" navItems={items}>
      {ExpensesTable()}
    </PageLayout>
  )
}