import { 
  Calendar,
  FileText,
  Filter as FilterIcon,
  CreditCard,
  BarChart,
} from "lucide-react"
import { PageLayout } from "@/components/layout/PageLayout"
import { Button } from "@/components/ui/button"
import { Link } from "wouter"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useEffect, useState } from "react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { DateRange } from "react-day-picker"
import { format, subMonths } from "date-fns"
import { 
  BarChart as RechartsBarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip as RechartsTooltip, 
  Legend, 
  ResponsiveContainer,
  Cell 
} from "recharts"
import { useQuery } from "@tanstack/react-query"
import { Skeleton } from "@/components/ui/skeleton"
import { formatAmount } from "@/utils/formatters"
import { Calendar as CalendarComponent } from "@/components/ui/calendar"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { cn } from "@/lib/utils"

// Define consistent colors for the chart
const colors = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8', 
  '#F78FB3', '#3498DB', '#F9ED69', '#F08A5D', '#B83B5E',
  '#6A67CE'
];

// Define the data structure for the expense analytics
type ExpenseAnalyticsData = {
  category: string;
  totalAmount: number;
  count: number;
}

// Category display mapping for better human-readable labels
const categoryLabels: Record<string, string> = {
  'export_registry_fee': 'Export Registry Fee',
  'insurance': 'Insurance',
  'awb_fee': 'AWB Fee',
  'airport_storage_fee': 'Airport Storage Fee',
  'bonded_warehouse_storage_fee': 'W/H Storage Fee',
  'transportation': 'Transportation',
  'international_transportation': 'Int\'l Transportation',
  'tareks_fee': 'Tareks Fee',
  'customs_inspection': 'Customs Inspection',
  'azo_test': 'AZO Test',
  'other': 'Other'
};

// Our custom DateRangePicker component
function CustomDateRangePicker({
  className,
  dateRange,
  onUpdate,
}: {
  className?: string;
  dateRange: DateRange | undefined;
  onUpdate: (range: DateRange | undefined) => void;
}) {
  return (
    <div className={cn("grid gap-2", className)}>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            id="date"
            variant={"outline"}
            className={cn(
              "w-full justify-start text-left font-normal",
              !dateRange && "text-muted-foreground"
            )}
          >
            <Calendar className="mr-2 h-4 w-4" />
            {dateRange?.from ? (
              dateRange.to ? (
                <>
                  {format(dateRange.from, "LLL dd, y")} -{" "}
                  {format(dateRange.to, "LLL dd, y")}
                </>
              ) : (
                format(dateRange.from, "LLL dd, y")
              )
            ) : (
              <span>Pick a date range</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="center">
          <CalendarComponent
            initialFocus
            mode="range"
            defaultMonth={dateRange?.from}
            selected={dateRange}
            onSelect={onUpdate}
            numberOfMonths={2}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

export default function ExpensesPage() {
  // Set default range to one month
  const defaultEndDate = new Date();
  const defaultStartDate = subMonths(defaultEndDate, 1);
  
  // State for filters and data
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: defaultStartDate,
    to: defaultEndDate
  });
  
  const [chartData, setChartData] = useState<ExpenseAnalyticsData[]>([]);
  
  // Format dates for API calls
  const formattedDateFrom = dateRange?.from ? format(dateRange.from, 'yyyy-MM-dd') : '';
  const formattedDateTo = dateRange?.to ? format(dateRange.to, 'yyyy-MM-dd') : '';
  
  // Build query parameters for the analytics API
  const getQueryParams = () => {
    const params = new URLSearchParams();
    
    if (dateRange?.from) {
      params.append('startDate', formattedDateFrom);
    }
    
    if (dateRange?.to) {
      params.append('endDate', formattedDateTo);
    }
    
    return params.toString();
  };
  
  // Fetch analytics data based on selected filters
  const { 
    data: analyticsData,
    isLoading,
    isError,
    error,
    refetch
  } = useQuery({
    queryKey: [`/api/expenses/analytics?${getQueryParams()}`],
    enabled: Boolean(dateRange?.from && dateRange?.to),
  });
  
  // Process the analytics data when it changes
  useEffect(() => {
    if (analyticsData && analyticsData.data) {
      // Ensure all values are properly converted to numbers
      const transformedData = analyticsData.data.map((item: any) => ({
        category: item.category,
        totalAmount: parseFloat(item.totalAmount || '0'),
        count: parseInt(item.count || '0', 10)
      }));
      
      setChartData(transformedData);
    } else {
      setChartData([]);
    }
  }, [analyticsData]);
  
  // Calculate totals - all values should be numbers at this point
  const totalExpenseAmount = chartData.reduce((sum, item) => sum + item.totalAmount, 0);
  const totalExpenseCount = chartData.reduce((sum, item) => sum + item.count, 0);
  
  // Find the largest expense category for the summary card
  const largestExpenseCategory = chartData.length > 0 
    ? chartData.reduce((prev, current) => (prev.totalAmount > current.totalAmount) ? prev : current) 
    : null;
  
  // Helper function to get readable category names
  const getCategoryLabel = (category: string) => {
    return categoryLabels[category] || category;
  };
  
  // Format data for the recharts bar chart
  const barChartData = [...chartData]
    .sort((a, b) => b.totalAmount - a.totalAmount) // Sort by amount descending
    .map(item => ({
      name: getCategoryLabel(item.category),
      value: item.totalAmount,
      category: item.category
    }));
  
  return (
    <PageLayout title="Expense Analytics">
      <div className="flex flex-col gap-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Expense Analytics</h1>
            <p className="text-muted-foreground">
              Analyze expense patterns and distribution across procedures.
            </p>
          </div>
          <Link href="/expenses">
            <Button className="ml-auto" variant="outline">
              <CreditCard className="mr-2 h-4 w-4" />
              View Expenses
            </Button>
          </Link>
        </div>
        
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Filters</CardTitle>
            <CardDescription>
              Filter by procedure import declaration dates
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6">
            <div>
              <label className="text-sm font-medium">Date Range (Import Declaration Date)</label>
              <CustomDateRangePicker
                className="[&>button]:!w-full"
                dateRange={dateRange}
                onUpdate={setDateRange}
              />
            </div>
            
            <Button 
              variant="outline" 
              onClick={() => refetch()}
              className="self-start"
            >
              <FilterIcon className="mr-2 h-4 w-4" />
              Apply Filters
            </Button>
          </CardContent>
        </Card>
        
        {isError && (
          <Alert variant="destructive">
            <AlertTitle>Error loading expense data</AlertTitle>
            <AlertDescription>
              {String(error)}
            </AlertDescription>
          </Alert>
        )}
        
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">
                Total Expenses
              </CardTitle>
              <CardDescription>
                Total amount for the selected period
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-8 w-36" />
              ) : (
                <div className="text-2xl font-bold">
                  {formatAmount(totalExpenseAmount)} ₺
                </div>
              )}
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">
                Expense Entries
              </CardTitle>
              <CardDescription>
                Number of expense transactions
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-8 w-12" />
              ) : (
                <div className="text-2xl font-bold">
                  {totalExpenseCount}
                </div>
              )}
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">
                Largest Expense Category
              </CardTitle>
              <CardDescription>
                Highest spending category
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-8 w-36" />
              ) : largestExpenseCategory ? (
                <div>
                  <div className="font-medium">
                    {getCategoryLabel(largestExpenseCategory.category)}
                  </div>
                  <div className="text-2xl font-bold">
                    {formatAmount(largestExpenseCategory.totalAmount)} ₺
                  </div>
                </div>
              ) : (
                <div className="text-muted-foreground">No data available</div>
              )}
            </CardContent>
          </Card>
        </div>
        
        <Card>
          <CardHeader>
            <CardTitle>Expense Distribution by Category</CardTitle>
            <CardDescription>
              Breakdown of expenses across different categories
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="h-[350px] w-full flex items-center justify-center">
                <Skeleton className="h-[300px] w-full" />
              </div>
            ) : chartData.length === 0 ? (
              <div className="h-[350px] w-full flex items-center justify-center text-muted-foreground">
                <div className="text-center">
                  <FileText className="mx-auto h-12 w-12 text-muted-foreground/50" />
                  <p className="mt-2">
                    No expense data available for the selected date range
                  </p>
                  <p className="text-sm text-muted-foreground/70">
                    Try adjusting the import declaration date filter
                  </p>
                </div>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={350}>
                <RechartsBarChart 
                  data={barChartData} 
                  layout="vertical" 
                  margin={{ left: 30 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" />
                  <YAxis type="category" dataKey="name" width={150} />
                  <RechartsTooltip 
                    formatter={(value: number) => [`${formatAmount(value)} ₺`, 'Total Amount']}
                  />
                  <Legend />
                  <Bar dataKey="value" name="Total Amount">
                    {barChartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
                    ))}
                  </Bar>
                </RechartsBarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </PageLayout>
  );
}