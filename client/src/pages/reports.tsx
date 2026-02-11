import { 
  Calendar,
  Home,
  Inbox,
  Search,
  Settings,
  BarChart2,
  Calculator
} from "lucide-react"
import { PageLayout } from "@/components/layout/PageLayout"

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
]

export default function ReportsPage() {
  return (
    <PageLayout title="Reports" navItems={items}>
      <div className="container mx-auto p-6">
        <h1 className="text-3xl font-bold tracking-tight mb-6">Reports Dashboard</h1>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Analytics Card */}
          <div className="bg-card border rounded-lg shadow-sm overflow-hidden">
            <div className="p-6">
              <div className="flex items-center gap-4 mb-4">
                <BarChart2 className="h-8 w-8 text-primary" />
                <h3 className="text-xl font-semibold">Expense Analytics</h3>
              </div>
              <p className="text-muted-foreground mb-4">
                Analyze expense patterns and distribution across procedures.
              </p>
              <a href="/analytics" className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2">
                View Analytics
              </a>
            </div>
          </div>
          
          {/* Tax Analytics Card */}
          <div className="bg-card border rounded-lg shadow-sm overflow-hidden">
            <div className="p-6">
              <div className="flex items-center gap-4 mb-4">
                <Calendar className="h-8 w-8 text-primary" />
                <h3 className="text-xl font-semibold">Tax Analytics</h3>
              </div>
              <p className="text-muted-foreground mb-4">
                View and analyze all the taxes paid and distribution across procedures.
              </p>
              <a href="/taxreport" className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2">
                View Taxes
              </a>
            </div>
          </div>
          
          {/* Custom Reports Card */}
          <div className="bg-card border rounded-lg shadow-sm overflow-hidden">
            <div className="p-6">
              <div className="flex items-center gap-4 mb-4">
                <Search className="h-8 w-8 text-primary" />
                <h3 className="text-xl font-semibold">Custom Reports</h3>
              </div>
              <p className="text-muted-foreground mb-4">
                Build and save custom reports with specific metrics and filters.
              </p>
              <a href="/customreport" className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2">
                Create Report
              </a>
            </div>
          </div>
        </div>
      </div>
    </PageLayout>
  )
}