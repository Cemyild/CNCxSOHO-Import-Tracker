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

type TaxAnalyticsData = {
  category: string;
  totalAmount: number;
  count: number;
}

// Colors for different tax categories
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

export default function TaxAnalyticsPage() {
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
  
  // Reusable date formatting function
  const formatDateParam = (dateObj: Date) => {
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // Sample tax data structure for now - this would be replaced by actual API calls
  // Using the same structure as expenses but with tax-specific categories
  const { data: analyticsData, isLoading, error } = useQuery({
    queryKey: ['/api/taxes/analytics', date?.from, date?.to, selectedProcedures, aggregateView],
    queryFn: async () => {
      const params = new URLSearchParams();
      
      if (date?.from) {
        const formattedFromDate = formatDateParam(date.from);
        console.log(`Using startDate: ${formattedFromDate}`);
        params.append('startDate', formattedFromDate);
      }
      
      if (date?.to) {
        const formattedToDate = formatDateParam(date.to);
        console.log(`Using endDate: ${formattedToDate}`);
        params.append('endDate', formattedToDate);
      }
      
      if (selectedProcedures.length > 0) {
        params.append('procedures', selectedProcedures.join(','));
      }
      
      params.append('aggregate', aggregateView ? 'true' : 'false');
      
      // Connect to the tax data endpoint
      const response = await apiRequest('GET', `/api/taxes/analytics?${params.toString()}`);
      return response.json();
    },
    enabled: Boolean(date),
  });
  
  // Fetch procedures for the filter dropdown
  const { data: procedures, isLoading: isLoadingProcedures } = useQuery({
    queryKey: ['/api/procedures'],
  });
  
  // Format data for charts - mapping expenses to taxes for demonstration
  const formattedData = analyticsData?.data?.map((item: TaxAnalyticsData, index: number) => ({
    ...item,
    name: formatCategoryName(item.category).replace('Fee', 'Tax'), // Replace 'Fee' with 'Tax' for demo
    color: COLORS[index % COLORS.length]
  })) || [];
  
  // Get total tax amount
  const totalTaxAmount = formattedData.reduce(
    (sum: number, item: {totalAmount: number}) => sum + item.totalAmount, 
    0
  );
  
  // Fetch ALL historical trend data for taxes (not filtered by date range)
  const { data: trendAllData, isLoading: isTrendAllLoading, isError: isTrendAllError } = useQuery({
    queryKey: ['/api/taxes/trend-all', selectedCategory, isMonthlyView],
    queryFn: async () => {
      if (!selectedCategory) {
        console.log("Missing required params for trend data");
        return { data: [] };
      }
      
      console.log(`Fetching ALL historical tax trend data for ${selectedCategory}`);
      
      // Use the new "all" tax trend endpoint
      const response = await fetch(
        `/api/taxes/trend-all?category=${selectedCategory}&groupBy=${isMonthlyView ? 'month' : 'week'}`
      );
      
      if (!response.ok) {
        console.error("All trend data API error:", await response.text());
        throw new Error('Failed to fetch complete trend data');
      }
      
      const result = await response.json();
      console.log(`Retrieved complete tax trend data: ${result.data?.length || 0} data points`);
      return result;
    },
    enabled: !!selectedCategory
  });
  
  // Also keep the filtered trend data for comparison
  const { data: filteredTrendData, isLoading: isFilteredTrendLoading } = useQuery({
    queryKey: ['/api/taxes/trend', selectedCategory, isMonthlyView, date?.from, date?.to],
    queryFn: async () => {
      if (!selectedCategory || !date?.from || !date?.to) {
        return { data: [] };
      }
      
      const fromDateStr = formatDateParam(date.from);
      const toDateStr = formatDateParam(date.to);
      
      // Use the filtered tax trend endpoint
      const response = await fetch(
        `/api/taxes/trend?category=${selectedCategory}&startDate=${fromDateStr}&endDate=${toDateStr}&groupBy=${isMonthlyView ? 'month' : 'week'}`
      );
      
      if (!response.ok) {
        throw new Error('Failed to fetch filtered trend data');
      }
      
      return response.json();
    },
    enabled: !!selectedCategory && !!date?.from && !!date?.to
  });
  
  // Process ALL trend data for the chart with highlighting for selected date range
  const processedTrendData = useMemo(() => {
    if (!trendAllData || !trendAllData.data || trendAllData.data.length === 0) {
      return [];
    }
    
    // Get periods within the selected date range for highlighting
    const selectedPeriods = new Set<string>();
    if (filteredTrendData?.data && filteredTrendData.data.length > 0) {
      filteredTrendData.data.forEach((item: any) => {
        selectedPeriods.add(item.period);
      });
    }
    
    // Process all historical data and mark if in selected range
    return trendAllData.data.map((item: any) => ({
      period: item.period,
      amount: typeof item.amount === 'string' ? parseFloat(item.amount) : item.amount,
      inSelectedRange: selectedPeriods.has(item.period)
    }));
  }, [trendAllData, filteredTrendData]);
  
  // Format date range for display
  const formattedDateRange = useMemo(() => {
    if (!date?.from || !date?.to) return "";
    
    const formatDate = (d: Date) => {
      return d.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    };
    
    return `${formatDate(date.from)} - ${formatDate(date.to)}`;
  }, [date]);

  return (
    <PageLayout title="Tax Analytics" navItems={items}>
      <div className="container mx-auto p-6">
        <div className="mb-6 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Tax Analytics</h1>
            <p className="text-muted-foreground">
              Analyze tax payments and distribution across procedures.
            </p>
          </div>
          
          <div className="flex flex-col sm:flex-row gap-3">
            <Link href="/reports">
              <Button variant="outline" className="whitespace-nowrap">
                Back to Reports
              </Button>
            </Link>
          </div>
        </div>
        
        <div className="grid grid-cols-1 gap-6">
          {/* Filters Card */}
          <Card>
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
          
          {/* Summary Cards - Horizontal Layout */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle>Total Taxes</CardTitle>
                <CardDescription>
                  Total taxes for the selected period
                </CardDescription>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <Skeleton className="h-12 w-32" />
                ) : (
                  <div className="text-3xl font-bold">
                    {formatAmount(totalTaxAmount)}
                  </div>
                )}
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="pb-2">
                <CardTitle>Tax Count</CardTitle>
                <CardDescription>
                  Number of tax transactions
                </CardDescription>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <Skeleton className="h-12 w-32" />
                ) : (
                  <div className="text-3xl font-bold">
                    {formattedData.reduce((sum: number, item: {count: number}) => sum + parseInt(String(item.count), 10), 0).toLocaleString()}
                  </div>
                )}
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="pb-2">
                <CardTitle>Largest Tax Category</CardTitle>
                <CardDescription>
                  Highest tax payment category
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
          
          {/* Charts - Stacked Vertical Layout */}
          <div className="space-y-6">
            {/* Bar Chart */}
            <Card>
              <CardHeader>
                <CardTitle>Tax Distribution by Category</CardTitle>
                <CardDescription>
                  Breakdown of taxes across different categories
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
                              const total = totalTaxAmount;
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
                              x1="0" y1="0" 
                              x2="0" y2="1"
                            >
                              <stop 
                                offset="0%" 
                                stopColor={entry.color} 
                                stopOpacity={0.9}
                              />
                              <stop 
                                offset="100%" 
                                stopColor={entry.color} 
                                stopOpacity={0.7}
                              />
                            </linearGradient>
                          ))}
                          
                          {/* Shadow filters for 3D effect */}
                          {formattedData.map((entry, index) => (
                            <filter
                              key={`shadow-${index}`}
                              id={`shadow-${index}`}
                              height="130%"
                            >
                              <feDropShadow 
                                dx="0" 
                                dy="3" 
                                stdDeviation="3"
                                floodColor="#000"
                                floodOpacity="0.15"
                              />
                            </filter>
                          ))}
                        </defs>
                      </RechartsBarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-[350px]">
                    <p className="text-muted-foreground">No data available</p>
                  </div>
                )}
              </CardContent>
            </Card>
            
            {/* Trend Analysis */}
            <Card>
              <CardHeader>
                <CardTitle>Tax Trend Analysis</CardTitle>
                <CardDescription>
                  View tax payment trends over time for specific categories
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="category-select" className="mb-2 block">Select Tax Category</Label>
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
                        {formattedData?.map((item: {category: string, name: string}) => (
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
                
                {/* Selected date range indicator */}
                <div className="mt-4 text-sm text-gray-500">
                  <span>Selected period: </span>
                  <span className="font-medium">{formattedDateRange}</span>
                  <span className="text-gray-400 ml-2">(Showing all historical data with selected period highlighted)</span>
                </div>
                
                <div className="mt-4">
                  {isTrendAllLoading ? (
                    <div className="flex items-center justify-center h-[350px]">
                      <Skeleton className="h-[300px] w-full" />
                    </div>
                  ) : processedTrendData.length > 0 ? (
                    <div>
                      {/* Chart */}
                      <div className="h-[300px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <RechartsBarChart
                            data={processedTrendData}
                            margin={{
                              top: 20,
                              right: 30,
                              left: 20,
                              bottom: 50
                            }}
                          >
                            <CartesianGrid 
                              strokeDasharray="3 3" 
                              vertical={false}
                              stroke="#f0f0f0"
                            />
                            <XAxis 
                              dataKey="period" 
                              angle={-45} 
                              textAnchor="end"
                              height={70}
                              interval={0}
                              axisLine={false}
                              tickLine={false}
                              tick={{ fill: '#666', fontSize: 12 }}
                              dy={10}
                            />
                            <YAxis 
                              axisLine={false}
                              tickLine={false}
                              tick={{ fill: '#666', fontSize: 12 }}
                              width={60}
                            />
                            <RechartsTooltip 
                              content={({ active, payload, label }) => {
                                if (active && payload && payload.length) {
                                  const data = payload[0].payload;
                                  const value = data.amount;
                                  const isInSelectedRange = data.inSelectedRange;
                                  
                                  return (
                                    <div className="bg-white p-3 shadow-md rounded-md border border-gray-100">
                                      <p className="text-gray-600 mb-1">
                                        {data.period}
                                        {isInSelectedRange && <span className="ml-1 text-blue-600 font-medium">(Selected Period)</span>}
                                      </p>
                                      <p className="text-gray-800 font-semibold">{formatAmount(value)} ₺</p>
                                    </div>
                                  );
                                }
                                return null;
                              }}
                              cursor={{ fill: 'rgba(0, 0, 0, 0.05)' }}
                            />
                            <Bar 
                              dataKey="amount" 
                              name="Tax Amount" 
                              radius={[4, 4, 0, 0]}
                            >
                              {processedTrendData.map((entry, index) => (
                                <Cell 
                                  key={`cell-${index}`} 
                                  fill={entry.inSelectedRange ? "url(#selectedGradient)" : "url(#regularGradient)"}
                                  filter={entry.inSelectedRange ? "url(#selectedShadow)" : "url(#regularShadow)"}
                                />
                              ))}
                            </Bar>
                            <defs>
                              {/* Gradient for selected period */}
                              <linearGradient id="selectedGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.8}/>
                                <stop offset="100%" stopColor="#60a5fa" stopOpacity={0.6}/>
                              </linearGradient>
                              
                              {/* Gradient for non-selected periods */}
                              <linearGradient id="regularGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#93c5fd" stopOpacity={0.8}/>
                                <stop offset="100%" stopColor="#bfdbfe" stopOpacity={0.6}/>
                              </linearGradient>
                              
                              {/* Shadow for selected periods */}
                              <filter id="selectedShadow" height="130%">
                                <feDropShadow dx="0" dy="3" stdDeviation="3" floodColor="#3b82f6" floodOpacity="0.3"/>
                              </filter>
                              
                              {/* Shadow for non-selected periods */}
                              <filter id="regularShadow" height="130%">
                                <feDropShadow dx="0" dy="2" stdDeviation="2" floodColor="#000" floodOpacity="0.1"/>
                              </filter>
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
                  ) : selectedCategory ? (
                    <div className="flex items-center justify-center h-[350px]">
                      <p className="text-muted-foreground">No trend data available for this category</p>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-[350px]">
                      <p className="text-muted-foreground">Select a tax category to view trends</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
          
          {/* Tax List Section */}
          <Card>
            <CardHeader>
              <CardTitle>Detailed Tax Breakdown</CardTitle>
              <CardDescription>
                List of all taxes in the selected period by category
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-64 w-full" />
              ) : formattedData.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Category</th>
                        <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Amount</th>
                        <th className="px-4 py-3 text-center text-sm font-medium text-gray-500">Count</th>
                        <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">% of Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {formattedData.sort((a: {totalAmount: number}, b: {totalAmount: number}) => 
                        b.totalAmount - a.totalAmount
                      ).map((tax: any, index: number) => (
                        <tr key={index} className="hover:bg-gray-50">
                          <td className="px-4 py-4 text-sm text-gray-800">{tax.name}</td>
                          <td className="px-4 py-4 text-sm text-gray-800 text-right">
                            {formatAmount(tax.totalAmount)}
                          </td>
                          <td className="px-4 py-4 text-sm text-gray-800 text-center">
                            {tax.count}
                          </td>
                          <td className="px-4 py-4 text-sm text-gray-800 text-right">
                            {((tax.totalAmount / totalTaxAmount) * 100).toFixed(1)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-gray-50">
                        <td className="px-4 py-3 text-sm font-medium text-gray-800">Total</td>
                        <td className="px-4 py-3 text-sm font-medium text-gray-800 text-right">
                          {formatAmount(totalTaxAmount)}
                        </td>
                        <td className="px-4 py-3 text-sm font-medium text-gray-800 text-center">
                          {formattedData.reduce((sum: number, item: {count: number}) => sum + parseInt(String(item.count), 10), 0).toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-sm font-medium text-gray-800 text-right">100%</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  No tax data available for the selected period
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </PageLayout>
  )
}