import { 
  Calendar,
  Home,
  Inbox,
  Settings,
  BarChart2,
  FilterIcon,
  CreditCard,
  PieChart,
  SlidersHorizontal,
  Plus,
  Calculator
} from "lucide-react"
import { PageLayout } from "@/components/layout/PageLayout"
import { Button } from "@/components/ui/button"
import { Link } from "wouter"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useEffect, useState, useMemo } from "react"
import { DatePickerWithRange } from "@/components/ui/date-range-picker"
import { DateRange } from "react-day-picker"
import { addDays, format, subDays, subWeeks, startOfWeek, endOfWeek, getWeek, getMonth, getYear, startOfMonth, endOfMonth } from "date-fns"
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select"
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
import { apiRequest } from "@/lib/queryClient"
import { useQuery } from "@tanstack/react-query"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { formatAmount } from "@/utils/formatters"


// Utility functions for trend data
const getTotalAmount = (data: any[]): number => {
  if (!data || data.length === 0) return 0;
  return data.reduce((sum: number, item: any) => sum + (item.amount || 0), 0);
}

const getAverageAmount = (data: any[]): number => {
  if (!data || data.length === 0) return 0;
  const total = getTotalAmount(data);
  return Math.round(total / data.length);
}

const getHighestPeriod = (data: any[]): string => {
  if (!data || data.length === 0) return 'N/A';
  let highest = data[0];
  
  for (let i = 1; i < data.length; i++) {
    if (data[i].amount > highest.amount) {
      highest = data[i];
    }
  }
  
  return highest.period;
}

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

type ExpenseAnalyticsData = {
  category: string;
  totalAmount: number;
  count: number;
}

// Colors for different expense categories
const COLORS = [
  "#0088FE", "#00C49F", "#FFBB28", "#FF8042", "#8884D8", 
  "#D62728", "#9467BD", "#E377C2", "#7F7F7F", "#BCBD22"
];

// Format category name for display
const formatCategoryName = (name: string) => {
  return name.split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

export default function AnalyticsPage() {
  // Date range state with default values (last 90 days)
  const [date, setDate] = useState<DateRange | undefined>(() => {
    const to = new Date(); // Today
    const from = new Date();
    from.setDate(from.getDate() - 90); // Go back 90 days to ensure we have data
    console.log(`Using real date range: ${from.toISOString()} to ${to.toISOString()}`);
    return { from, to };
  });
  
  // State variables for filters and view modes
  const [selectedProcedures, setSelectedProcedures] = useState<string[]>([]);
  const [aggregateView, setAggregateView] = useState<boolean>(true);
  
  // State for the trend analysis section
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [isMonthlyView, setIsMonthlyView] = useState<boolean>(false);
  
  // Fetch expense data with filters
  // Reusable date formatting function
  const formatDateParam = (dateObj: Date) => {
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const { data: analyticsData, isLoading, error } = useQuery({
    queryKey: ['/api/expenses/analytics', date?.from, date?.to, selectedProcedures, aggregateView],
    queryFn: async () => {
      const params = new URLSearchParams();
      
      if (date?.from) {
        // Use the reusable formatter to avoid timezone issues
        const formattedFromDate = formatDateParam(date.from);
        console.log(`Using startDate: ${formattedFromDate}`);
        params.append('startDate', formattedFromDate);
      }
      
      if (date?.to) {
        // Use the reusable formatter to avoid timezone issues
        const formattedToDate = formatDateParam(date.to);
        console.log(`Using endDate: ${formattedToDate}`);
        params.append('endDate', formattedToDate);
      }
      
      if (selectedProcedures.length > 0) {
        params.append('procedures', selectedProcedures.join(','));
      }
      
      params.append('aggregate', aggregateView ? 'true' : 'false');
      
      const response = await apiRequest('GET', `/api/expenses/analytics?${params.toString()}`);
      return response.json();
    },
    enabled: Boolean(date),
  });
  
  // Fetch procedures for the filter dropdown
  const { data: procedures, isLoading: isLoadingProcedures } = useQuery({
    queryKey: ['/api/procedures'],
  });
  
  // Format data for charts
  const formattedData = analyticsData?.data?.map((item: ExpenseAnalyticsData, index: number) => ({
    ...item,
    name: formatCategoryName(item.category),
    color: COLORS[index % COLORS.length]
  })) || [];
  
  // Get total expense amount
  const totalExpenseAmount = formattedData.reduce(
    (sum: number, item: any) => sum + item.totalAmount, 
    0
  );
  
  // Fetch real trend data from API with current date range
  const { data: trendData, isLoading: isTrendLoading, isError: isTrendError } = useQuery({
    queryKey: ['/api/expenses/trend', selectedCategory, isMonthlyView, date?.from, date?.to],
    queryFn: async () => {
      if (!selectedCategory || !date?.from || !date?.to) {
        console.log("Missing required params for trend data");
        return { data: [] };
      }
      
      // Format date as YYYY-MM-DD without timezone issues
      const formatDateParam = (dateObj: Date) => {
        const year = dateObj.getFullYear();
        const month = String(dateObj.getMonth() + 1).padStart(2, '0');
        const day = String(dateObj.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      };
      
      const fromDateStr = formatDateParam(date.from);
      const toDateStr = formatDateParam(date.to);
      
      console.log(`Fetching trend data for ${selectedCategory} from ${fromDateStr} to ${toDateStr}`);
      
      const response = await fetch(
        `/api/expenses/trend?category=${selectedCategory}&startDate=${fromDateStr}&endDate=${toDateStr}&groupBy=${isMonthlyView ? 'month' : 'week'}`
      );
      
      if (!response.ok) {
        console.error("Trend data API error:", await response.text());
        throw new Error('Failed to fetch trend data');
      }
      
      const result = await response.json();
      console.log(`Retrieved trend data: ${result.data?.length || 0} data points`);
      return result;
    },
    enabled: !!selectedCategory && !!date?.from && !!date?.to
  });
  
  // Process trend data for the chart
  const processedTrendData = useMemo(() => {
    if (!trendData || !trendData.data || trendData.data.length === 0) {
      return [];
    }
    
    return trendData.data.map((item: any) => ({
      period: item.period,
      amount: typeof item.amount === 'string' ? parseFloat(item.amount) : item.amount
    }));
  }, [trendData]);

  return (
    <PageLayout title="Expense Analytics" navItems={items}>
      <div className="container mx-auto p-6">
        <div className="mb-6 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Expense Analytics</h1>
            <p className="text-muted-foreground">
              Analyze expense patterns and distribution across procedures.
            </p>
          </div>
          
          <div className="flex flex-col sm:flex-row gap-3">
            <Link href="/expense-entry">
              <Button className="whitespace-nowrap">
                <Plus className="mr-2 h-4 w-4" />
                Add New Expense
              </Button>
            </Link>
          </div>
        </div>
        
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Filters Card */}
          <Card className="lg:col-span-12">
            <CardHeader className="pb-3">
              <CardTitle>Filters</CardTitle>
              <CardDescription>
                Filter and customize the data view
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-6">
              <div>
                <Label className="mb-2 block">Date Range</Label>
                <DatePickerWithRange
                  value={date}
                  onChange={setDate}
                />
              </div>
            </CardContent>
          </Card>
          
          {/* Summary Cards */}
          <div className="lg:col-span-4 space-y-6">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle>Total Expenses</CardTitle>
                <CardDescription>
                  Total amount for the selected period
                </CardDescription>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <Skeleton className="h-12 w-32" />
                ) : (
                  <div className="text-3xl font-bold">
                    {formatAmount(totalExpenseAmount)}
                  </div>
                )}
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="pb-2">
                <CardTitle>Expense Count</CardTitle>
                <CardDescription>
                  Number of expense transactions
                </CardDescription>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <Skeleton className="h-12 w-32" />
                ) : (
                  <div className="text-3xl font-bold">
                    {formattedData.reduce((sum: number, item: {count: number}) => sum + item.count, 0)}
                  </div>
                )}
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="pb-2">
                <CardTitle>Largest Expense Category</CardTitle>
                <CardDescription>
                  Highest spending category
                </CardDescription>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <Skeleton className="h-12 w-full" />
                ) : formattedData.length > 0 ? (
                  <div>
                    <div className="text-xl font-semibold">
                      {formattedData.sort((a: {totalAmount: number}, b: {totalAmount: number}) => b.totalAmount - a.totalAmount)[0].name}
                    </div>
                    <div className="text-2xl font-bold mt-1">
                      {formatAmount(formattedData.sort((a: {totalAmount: number}, b: {totalAmount: number}) => b.totalAmount - a.totalAmount)[0].totalAmount)}
                    </div>
                  </div>
                ) : (
                  <div className="text-muted-foreground">No data available</div>
                )}
              </CardContent>
            </Card>
          </div>
          
          {/* Bar Chart */}
          <Card className="lg:col-span-8">
            <CardHeader>
              <CardTitle>Expense Distribution by Category</CardTitle>
              <CardDescription>
                Breakdown of expenses across different categories
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0 pl-2">
              {isLoading ? (
                <div className="flex items-center justify-center h-[350px]">
                  <Skeleton className="h-[300px] w-full" />
                </div>
              ) : formattedData.length > 0 ? (
                <div className="h-[350px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <RechartsBarChart
                      data={formattedData}
                      margin={{
                        top: 20,
                        right: 30,
                        left: 20,
                        bottom: 50,
                      }}
                      barSize={50}
                      // Using isAnimationActive for animation control
                      isAnimationActive={true}
                    >
                      {/* Only horizontal grid lines with reduced opacity */}
                      <CartesianGrid 
                        strokeDasharray="3 3" 
                        vertical={false}
                        stroke="#f0f0f0" 
                      />
                      
                      {/* Improved X-axis styling */}
                      <XAxis 
                        dataKey="name" 
                        angle={-45} 
                        textAnchor="end"
                        height={70}
                        interval={0}
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: '#666', fontSize: 12 }}
                        dy={10}
                      />
                      
                      {/* Improved Y-axis styling with compact notation */}
                      <YAxis 
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: '#666', fontSize: 12 }}
                        tickFormatter={(value) => value >= 1000000 
                          ? `${(value/1000000).toFixed(1)}M` 
                          : value >= 1000 
                            ? `${(value/1000).toFixed(0)}k` 
                            : value
                        }
                        width={60}
                      />
                      
                      {/* Enhanced tooltip */}
                      <RechartsTooltip 
                        content={({ active, payload }) => {
                          if (active && payload && payload.length) {
                            const data = payload[0].payload;
                            const value = data.totalAmount;
                            const total = totalExpenseAmount;
                            const percentage = ((value / total) * 100).toFixed(1);
                            
                            return (
                              <div className="bg-white p-3 shadow-md rounded-md border border-gray-100">
                                <p className="text-gray-600 mb-1">{data.name}</p>
                                <p className="text-gray-800 font-semibold">{formatAmount(value)} ₺</p>
                                <p className="text-gray-500 text-sm">{percentage}% of total</p>
                              </div>
                            );
                          }
                          return null;
                        }}
                        cursor={{ fill: 'rgba(0, 0, 0, 0.05)' }}
                      />
                      
                      {/* Removed the Legend as requested */}
                      
                      {/* Enhanced Bar with gradients and rounded corners */}
                      <Bar 
                        dataKey="totalAmount" 
                        name=""
                        radius={[4, 4, 0, 0]}
                      >
                        {formattedData.map((entry: {color: string, totalAmount: number, name: string}, index: number) => (
                          <Cell 
                            key={`cell-${index}`} 
                            fill={`url(#gradient-${index})`}
                            filter={`url(#shadow-${index})`}
                          />
                        ))}
                      </Bar>
                      
                      {/* Gradients for bars */}
                      <defs>
                        {formattedData.map((entry: {color: string}, index: number) => (
                          <linearGradient
                            key={`gradient-${index}`}
                            id={`gradient-${index}`}
                            x1="0"
                            y1="0"
                            x2="0" 
                            y2="1"
                          >
                            <stop offset="5%" stopColor={entry.color} stopOpacity={0.9} />
                            <stop offset="95%" stopColor={entry.color} stopOpacity={0.6} />
                          </linearGradient>
                        ))}
                        
                        {/* Shadows for bars */}
                        {formattedData.map((entry: {color: string}, index: number) => (
                          <filter
                            key={`shadow-${index}`}
                            id={`shadow-${index}`}
                            height="130%"
                          >
                            <feDropShadow
                              dx="0"
                              dy="3"
                              stdDeviation="3"
                              floodColor={entry.color}
                              floodOpacity="0.3"
                            />
                          </filter>
                        ))}
                      </defs>
                    </RechartsBarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="flex items-center justify-center h-[350px] text-muted-foreground">
                  No data available for the selected filters
                </div>
              )}
            </CardContent>
          </Card>
          
          
          {/* Expense Trend Analysis */}
          <Card className="lg:col-span-12 mt-6">
            <CardHeader>
              <CardTitle>Expense Trend Analysis</CardTitle>
              <CardDescription>
                View expense trends over time for specific categories
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="category-select" className="mb-2 block">Select Expense Category</Label>
                  <Select
                    value={selectedCategory}
                    onValueChange={(value) => {
                      setSelectedCategory(value);
                    }}
                  >
                    <SelectTrigger id="category-select" className="w-full">
                      <SelectValue placeholder="Select a category" />
                    </SelectTrigger>
                    <SelectContent>
                      {formattedData?.map((item) => (
                        <SelectItem 
                          key={item.category} 
                          value={item.category}
                        >
                          {item.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="flex items-center justify-end space-x-2">
                  <Label htmlFor="period-toggle">Weekly</Label>
                  <Switch 
                    id="period-toggle"
                    checked={isMonthlyView}
                    onCheckedChange={setIsMonthlyView}
                  />
                  <Label htmlFor="period-toggle">Monthly</Label>
                </div>
              </div>
              
              {/* Chart Container with explicit height */}
              <div className="mt-4">
                {isLoading || isTrendLoading ? (
                  <div className="h-80 min-h-[300px] w-full flex items-center justify-center">
                    <Skeleton className="h-[300px] w-full" />
                  </div>
                ) : formattedData.length === 0 || !selectedCategory || processedTrendData.length === 0 ? (
                  <div className="h-80 min-h-[300px] w-full flex items-center justify-center text-muted-foreground">
                    <div className="text-center">
                      <BarChart2 className="mx-auto h-12 w-12 text-muted-foreground/50" />
                      <p className="mt-2">No trend data available</p>
                      <p className="text-sm text-muted-foreground/70">
                        {formattedData.length === 0 
                          ? "No expense data for the selected date range" 
                          : "Select a category to view expense trends"}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div>
                    {/* Chart visualization with fixed height */}
                    <div className="h-80 min-h-[300px] w-full my-4">
                      <ResponsiveContainer width="100%" height="100%">
                        <RechartsBarChart
                          data={processedTrendData}
                          margin={{ top: 10, right: 10, left: 10, bottom: 20 }}
                          barSize={40}
                        >
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                          <XAxis 
                            dataKey="period" 
                            axisLine={false}
                            tickLine={false}
                            tick={{ fill: '#666', fontSize: 12 }}
                            dy={10}
                          />
                          <YAxis 
                            axisLine={false}
                            tickLine={false}
                            tick={{ fill: '#666', fontSize: 12 }}
                            tickFormatter={(value) => value >= 1000 ? `${(value/1000).toFixed(0)}k` : value}
                            width={60}
                          />
                          <RechartsTooltip 
                            formatter={(value: any) => [`${formatAmount(value)} ₺`, 'Amount']}
                            cursor={{ fill: 'rgba(0, 0, 0, 0.05)' }}
                          />
                          <Bar 
                            dataKey="amount" 
                            name="Expense Amount" 
                            fill="url(#colorGradient)"
                            radius={[4, 4, 0, 0]}
                          />
                          <defs>
                            <linearGradient id="colorGradient" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.8}/>
                              <stop offset="100%" stopColor="#60a5fa" stopOpacity={0.6}/>
                            </linearGradient>
                          </defs>
                        </RechartsBarChart>
                      </ResponsiveContainer>
                    </div>
                    
                    {/* Summary statistics */}
                    <div className="flex justify-between mt-6 pt-4 border-t border-gray-100">
                      <div>
                        <p className="text-sm text-gray-500">Total</p>
                        <p className="text-lg font-semibold text-gray-800">
                          {formatAmount(getTotalAmount(processedTrendData))} ₺
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-gray-500">Average</p>
                        <p className="text-lg font-semibold text-gray-800">
                          {formatAmount(getAverageAmount(processedTrendData))} ₺
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-gray-500">Highest Period</p>
                        <p className="text-lg font-semibold text-gray-800">
                          {getHighestPeriod(processedTrendData)}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

        </div>
      </div>
    </PageLayout>
  )
}