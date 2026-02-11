import * as React from "react";
import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ResponsiveContainer,
  BarChart as RechartsBarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  Cell,
} from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { 
  ChevronDown, 
  RefreshCw,
  AlertTriangle 
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// Define the expense data structure
interface ExpenseData {
  category: string;
  totalAmount: number;
  count: number;
}

interface TaxData {
  customsTax: number;
  additionalCustomsTax: number;
  kkdf: number;
  vat: number;
  stampTax: number;
}

// Define expense categories
enum ExpenseCategory {
  // Import expenses
  EXPORT_REGISTRY_FEE = "export_registry_fee",
  INSURANCE = "insurance",
  AWB_FEE = "awb_fee",
  AIRPORT_STORAGE_FEE = "airport_storage_fee",
  BONDED_WAREHOUSE_STORAGE_FEE = "bonded_warehouse_storage_fee",
  TRANSPORTATION = "transportation",
  INTERNATIONAL_TRANSPORTATION = "international_transportation",
  TAREKS_FEE = "tareks_fee",
  CUSTOMS_INSPECTION = "customs_inspection",
  AZO_TEST = "azo_test",
  OTHER = "other",
  
  // Taxes
  CUSTOMS_TAX = "customsTax",
  ADDITIONAL_CUSTOMS_TAX = "additionalCustomsTax",
  KKDF = "kkdf",
  VAT = "vat",
  STAMP_TAX = "stampTax",
  
  // Service
  SERVICE_INVOICE = "service_invoice"
}

// Category colors with more variations
const CATEGORY_COLORS: Record<string, string> = {
  // Import expenses - Blues to Purples
  [ExpenseCategory.EXPORT_REGISTRY_FEE]: "#69a3ff",
  [ExpenseCategory.INSURANCE]: "#829ae3",
  [ExpenseCategory.AWB_FEE]: "#65c3e8",
  [ExpenseCategory.AIRPORT_STORAGE_FEE]: "#5d8fdd",
  [ExpenseCategory.BONDED_WAREHOUSE_STORAGE_FEE]: "#4b79c1",
  [ExpenseCategory.TRANSPORTATION]: "#38b6ff",
  [ExpenseCategory.INTERNATIONAL_TRANSPORTATION]: "#4671c6",
  [ExpenseCategory.TAREKS_FEE]: "#7891d9",
  [ExpenseCategory.CUSTOMS_INSPECTION]: "#5b77e8",
  [ExpenseCategory.AZO_TEST]: "#3d62b3",
  [ExpenseCategory.OTHER]: "#86a8e7",
  
  // Taxes - Greens
  [ExpenseCategory.CUSTOMS_TAX]: "#a1c89f",
  [ExpenseCategory.ADDITIONAL_CUSTOMS_TAX]: "#8eb68c",
  [ExpenseCategory.KKDF]: "#66a968",
  [ExpenseCategory.VAT]: "#7bbf7c",
  [ExpenseCategory.STAMP_TAX]: "#b3d9a3",
  
  // Service - Yellows/Oranges
  [ExpenseCategory.SERVICE_INVOICE]: "#fad779"
};

// Category groupings for legend display
const CATEGORY_GROUPS = {
  importExpenses: [
    ExpenseCategory.EXPORT_REGISTRY_FEE,
    ExpenseCategory.INSURANCE,
    ExpenseCategory.AWB_FEE,
    ExpenseCategory.AIRPORT_STORAGE_FEE,
    ExpenseCategory.BONDED_WAREHOUSE_STORAGE_FEE,
    ExpenseCategory.TRANSPORTATION,
    ExpenseCategory.INTERNATIONAL_TRANSPORTATION,
    ExpenseCategory.TAREKS_FEE,
    ExpenseCategory.CUSTOMS_INSPECTION,
    ExpenseCategory.AZO_TEST,
    ExpenseCategory.OTHER,
  ],
  taxExpenses: [
    ExpenseCategory.CUSTOMS_TAX,
    ExpenseCategory.ADDITIONAL_CUSTOMS_TAX,
    ExpenseCategory.KKDF,
    ExpenseCategory.VAT,
    ExpenseCategory.STAMP_TAX,
  ],
  serviceExpenses: [
    ExpenseCategory.SERVICE_INVOICE
  ]
};

// Helper function to get the category group
const getCategoryGroup = (category: string): string => {
  if (CATEGORY_GROUPS.importExpenses.includes(category as ExpenseCategory)) {
    return 'importExpenses';
  } else if (CATEGORY_GROUPS.taxExpenses.includes(category as ExpenseCategory)) {
    return 'taxExpenses';
  } else if (CATEGORY_GROUPS.serviceExpenses.includes(category as ExpenseCategory)) {
    return 'serviceExpenses';
  }
  return 'other';
};

// Helper function to format category names for display
const formatCategoryName = (category: string): string => {
  return category
    .replace(/([A-Z])/g, ' $1') // Add space before capital letters for camelCase
    .replace(/_/g, " ")         // Replace underscores with spaces
    .split(" ")
    .filter(Boolean)            // Remove empty strings from double spaces
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
};

// Helper function to format currency values
const formatCurrency = (amount: number, currency: string = "TRY") => {
  if (isNaN(amount) || amount === undefined) {
    return "N/A";
  }
  
  const formattedNumber = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
  
  const currencySymbol = currency === "TRY" || currency === "₺" ? "₺" : "$";
  return `${formattedNumber} ${currencySymbol}`;
};

// Combine and organize data for detailed subcategory visualization
const organizeDataByCategory = (data: any[]) => {
  console.log('Input data to organizeDataByCategory:', data);
  
  if (!data || !Array.isArray(data) || data.length === 0) {
    console.warn('No data or empty data provided to organizeDataByCategory');
    return [];
  }
  
  // Group by category
  const categoryMap = new Map();
  
  // Process and combine all data
  data.forEach(item => {
    if (!item) {
      console.warn('Null or undefined item in data array');
      return;
    }
    
    const category = item.category;
    if (!category) {
      console.warn('Item missing category:', item);
      return;
    }
    
    let amount = 0;
    
    // Safely parse amount from different possible formats
    if (typeof item.totalAmount === 'string') {
      amount = parseFloat(item.totalAmount);
    } else if (typeof item.totalAmount === 'number') {
      amount = item.totalAmount;
    } else if (typeof item.value === 'number') {
      amount = item.value;
    } else {
      console.warn('Unable to determine amount for item:', item);
      return;
    }
    
    if (!isNaN(amount) && amount > 0) {
      // Add or update the amount for this category
      if (categoryMap.has(category)) {
        categoryMap.set(category, categoryMap.get(category) + amount);
      } else {
        categoryMap.set(category, amount);
      }
    }
  });
  
  console.log('Category map after processing:', Array.from(categoryMap.entries()));
  
  if (categoryMap.size === 0) {
    console.warn('No valid categories found in data');
    return [];
  }
  
  // Sort categories by groups and then by amount (descending)
  const sortedEntries = Array.from(categoryMap.entries())
    .sort((a, b) => {
      const groupA = getCategoryGroup(a[0]);
      const groupB = getCategoryGroup(b[0]);
      
      // First sort by group
      if (groupA !== groupB) {
        // Define group order: tax, service, import
        const groupOrder: Record<string, number> = { 
          taxExpenses: 1, 
          serviceExpenses: 2, 
          importExpenses: 3, 
          other: 4 
        };
        return groupOrder[groupA as keyof typeof groupOrder] - groupOrder[groupB as keyof typeof groupOrder];
      }
      
      // Then by amount (highest first)
      return b[1] - a[1];
    });
  
  console.log('Sorted entries:', sortedEntries);
  
  // Create the final data structure
  const result = sortedEntries.map(([category, amount]) => ({
    category,
    value: amount,
    formattedCategory: formatCategoryName(category),
    color: CATEGORY_COLORS[category as ExpenseCategory] || '#CCCCCC', // Fallback color
    group: getCategoryGroup(category)
  }));
  
  console.log('Final organized data:', result);
  return result;
};

interface ExpenseTrendsChartProps {
  procedureReference: string;
  currency?: string;
  exchangeRate?: number;
}

export default function ExpenseTrendsChart({
  procedureReference,
  currency: initialCurrency = "TRY",
  exchangeRate = 1,
}: ExpenseTrendsChartProps) {
  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string>("all");
  
  // Add state for currency toggle (with localStorage persistence)
  const [activeCurrency, setActiveCurrency] = useState<string>(() => {
    // Try to retrieve from localStorage
    const saved = localStorage.getItem('preferred-currency');
    return saved && (saved === "TRY" || saved === "USD") ? saved : initialCurrency;
  });
  
  // Category filter options
  const categoryOptions = [
    { value: "all", label: "All Categories" },
    { value: "taxExpenses", label: "Taxes" },
    { value: "importExpenses", label: "Import Expenses" },
    { value: "serviceExpenses", label: "Service Invoices" }
  ];
  
  // Function to filter data by category group
  const filterDataByCategory = (data: any[], category: string) => {
    if (category === "all") return data;
    
    return data.filter(item => getCategoryGroup(item.category) === category);
  };

  // Function to toggle currency and save preference
  const toggleCurrency = () => {
    const newCurrency = activeCurrency === "TRY" ? "USD" : "TRY";
    setActiveCurrency(newCurrency);
    // Save to localStorage for persistence
    localStorage.setItem('preferred-currency', newCurrency);
  };
  
  // Function to refresh the data
  const refreshData = async () => {
    setIsRefreshing(true);
    try {
      await queryClient.invalidateQueries({ queryKey: ['/api/expenses/analytics', procedureReference] });
      await queryClient.invalidateQueries({ queryKey: ['/api/taxes/procedure', procedureReference] });
      await queryClient.invalidateQueries({ queryKey: ['/api/service-invoices/procedure', procedureReference] });
    } catch (error) {
      console.error('Error refreshing data:', error);
    } finally {
      setTimeout(() => setIsRefreshing(false), 500);
    }
  };

  // Fetch expense data from API
  const { data: expenseData, isLoading: isLoadingExpenses, error: expenseError } = useQuery<{ data: ExpenseData[] }>({
    queryKey: ['/api/expenses/analytics', procedureReference],
    queryFn: async () => {
      try {
        // Get expenses for the last year to ensure we have comprehensive data
        const startDate = new Date();
        startDate.setFullYear(startDate.getFullYear() - 1);
        
        const endDate = new Date();
        
        // Format dates as YYYY-MM-DD
        const formattedStartDate = startDate.toISOString().split("T")[0];
        const formattedEndDate = endDate.toISOString().split("T")[0];
        
        // Create URLSearchParams for proper parameter encoding
        const params = new URLSearchParams();
        params.append('startDate', formattedStartDate);
        params.append('endDate', formattedEndDate);
        
        if (procedureReference) {
          // Ensure correct format for procedureRefs parameter
          params.append('procedureRefs', procedureReference);
        }
        
        console.log(`Fetching expense data for ${procedureReference} from ${formattedStartDate} to ${formattedEndDate}`);
        console.log(`Params: ${params.toString()}`);
        
        const res = await fetch(`/api/expenses/analytics?${params.toString()}`);
        
        if (!res.ok) {
          const errorText = await res.text();
          console.error(`Error response from analytics API:`, {
            status: res.status,
            statusText: res.statusText,
            body: errorText.substring(0, 1000) // Only show first 1000 chars in case it's very long
          });
          throw new Error(`Failed to fetch expense data: ${res.status} ${res.statusText}`);
        }
        
        const jsonData = await res.json();
        console.log('Received expense analytics data:', jsonData);
        return jsonData;
      } catch (err) {
        console.error('Error in expense analytics data fetch:', err);
        throw err;
      }
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
    retry: 1, // Only retry once to avoid excessive failed requests
  });
  
  // Fetch tax data
  const { data: taxData, isLoading: isLoadingTax, error: taxError } = useQuery({
    queryKey: ['/api/taxes/procedure', procedureReference],
    queryFn: async () => {
      try {
        console.log(`Fetching tax data for procedure ${procedureReference}`);
        const res = await fetch(`/api/taxes/procedure/${encodeURIComponent(procedureReference)}`);
        
        if (!res.ok) {
          const errorText = await res.text();
          console.error(`Error response from taxes API:`, {
            status: res.status,
            statusText: res.statusText,
            body: errorText.substring(0, 1000)
          });
          throw new Error(`Failed to fetch tax data: ${res.status} ${res.statusText}`);
        }
        
        const data = await res.json();
        console.log('Received tax data:', data);
        return data.tax;
      } catch (err) {
        console.error('Error in tax data fetch:', err);
        throw err;
      }
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
    retry: 1, // Only retry once
  });
  
  // Fetch service invoice data
  const { data: serviceInvoiceData, isLoading: isLoadingService, error: serviceError } = useQuery({
    queryKey: ['/api/service-invoices/procedure', procedureReference],
    queryFn: async () => {
      try {
        console.log(`Fetching service invoice data for procedure ${procedureReference}`);
        const res = await fetch(`/api/service-invoices/procedure/${encodeURIComponent(procedureReference)}`);
        
        if (!res.ok) {
          const errorText = await res.text();
          console.error(`Error response from service invoices API:`, {
            status: res.status,
            statusText: res.statusText,
            body: errorText.substring(0, 1000)
          });
          throw new Error(`Failed to fetch service invoice data: ${res.status} ${res.statusText}`);
        }
        
        const data = await res.json();
        console.log('Received service invoice data:', data);
        return data.invoices;
      } catch (err) {
        console.error('Error in service invoice data fetch:', err);
        throw err;
      }
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
    retry: 1, // Only retry once
  });

  // Combine all data for chart display
  const prepareChartData = () => {
    const combinedData = [];
    
    // Add expense data
    if (expenseData?.data) {
      console.log('Processing expense data:', expenseData.data);
      combinedData.push(...expenseData.data);
    } else {
      console.warn('No expense data available');
    }
    
    // Add tax data if available
    if (taxData) {
      console.log('Processing tax data:', taxData);
      
      if (taxData.customsTax) {
        combinedData.push({ 
          category: 'customsTax', 
          totalAmount: parseFloat(taxData.customsTax), 
          count: 1 
        });
      }
      if (taxData.additionalCustomsTax) {
        combinedData.push({ 
          category: 'additionalCustomsTax', 
          totalAmount: parseFloat(taxData.additionalCustomsTax), 
          count: 1 
        });
      }
      if (taxData.kkdf) {
        combinedData.push({ 
          category: 'kkdf', 
          totalAmount: parseFloat(taxData.kkdf), 
          count: 1 
        });
      }
      if (taxData.vat) {
        combinedData.push({ 
          category: 'vat', 
          totalAmount: parseFloat(taxData.vat), 
          count: 1 
        });
      }
      if (taxData.stampTax) {
        combinedData.push({ 
          category: 'stampTax', 
          totalAmount: parseFloat(taxData.stampTax), 
          count: 1 
        });
      }
    } else {
      console.warn('No tax data available');
    }
    
    // Add service invoice data
    if (serviceInvoiceData && serviceInvoiceData.length > 0) {
      console.log('Processing service invoice data:', serviceInvoiceData);
      
      serviceInvoiceData.forEach((invoice: any) => {
        combinedData.push({
          category: 'service_invoice',
          totalAmount: parseFloat(invoice.amount),
          count: 1
        });
      });
    } else {
      console.warn('No service invoice data available');
    }
    
    // Convert to USD if needed
    const finalData = activeCurrency === "USD" && exchangeRate
      ? combinedData.map(item => ({
          ...item,
          totalAmount: item.totalAmount / exchangeRate
        }))
      : combinedData;
    
    console.log('Combined chart data:', finalData);
    return finalData;
  };
  
  // Process the data for display
  const chartData = prepareChartData();
  
  // Create detailed subcategory data
  const detailedCategoryData = organizeDataByCategory(chartData);
  console.log('Detailed category data for rendering chart:', detailedCategoryData);
  
  // Check for loading state
  const isLoading = isLoadingExpenses || isLoadingTax || isLoadingService || isRefreshing;
  
  // Check for errors and determine if we have at least some data to display
  const hasAnyError = expenseError || taxError || serviceError;
  const hasCompleteFailure = 
    (expenseError && !expenseData?.data) && 
    (taxError && !taxData) && 
    (serviceError && !serviceInvoiceData);
  
  const errors = [
    expenseError ? { type: 'Import expenses', error: String(expenseError) } : null,
    taxError ? { type: 'Tax expenses', error: String(taxError) } : null,
    serviceError ? { type: 'Service invoices', error: String(serviceError) } : null
  ].filter(Boolean);
  
  const errorMessage = hasAnyError
    ? hasCompleteFailure
      ? "We couldn't load any expense data. Please try again later."
      : "Some expense data couldn't be loaded. The chart shows partial data."
    : "";
  
  const detailedError = errors.map(e => `${e?.type}: ${e?.error}`).join("\n\n");
  
  // If there's a complete failure with no data to display
  if (hasCompleteFailure || detailedCategoryData.length === 0) {
    console.error("Error loading expense data:", { expenseError, taxError, serviceError });
    return (
      <Card className="mt-8">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <div>
            <CardTitle className="text-base font-medium">EXPENSES BY TYPE</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            {/* Currency toggle button */}
            <Button
              variant="outline"
              size="sm"
              onClick={toggleCurrency}
              className={`h-8 ${
                activeCurrency === "USD" 
                  ? "bg-emerald-50 text-emerald-900 border-emerald-200 hover:bg-emerald-100" 
                  : "bg-sky-50 text-sky-900 border-sky-200 hover:bg-sky-100"
              }`}
            >
              {activeCurrency === "USD" ? "$ USD" : "₺ TL"}
            </Button>
            
            <Button 
              variant="outline" 
              size="sm"
              onClick={refreshData}
              disabled={isRefreshing}
              className="h-8"
            >
              <RefreshCw className={`h-4 w-4 mr-1 ${isRefreshing ? 'animate-spin' : ''}`} />
              {isRefreshing ? "Refreshing..." : "Refresh"}
            </Button>
            <div className="text-sm text-muted-foreground">
              All categories
              <ChevronDown className="ml-1 h-4 w-4 inline" />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-[350px] flex items-center justify-center">
            <div className="text-center px-6 py-10 max-w-md">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                className="h-12 w-12 text-gray-400 mx-auto mb-4"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
              <h3 className="text-lg font-medium text-gray-900 mb-2">Unable to load chart data</h3>
              <p className="text-gray-500">{errorMessage}</p>
            </div>
          </div>
          
          {/* Still show the legend at the bottom */}
          <div className="mt-3 text-xs text-center text-muted-foreground">
            <span className="ml-4 inline-flex items-center mr-6">
              <span className="w-3 h-3 inline-block mr-2 rounded-sm" style={{ backgroundColor: "#a1c89f" }}></span>
              Tax expenses
            </span>
            <span className="ml-4 inline-flex items-center mr-6">
              <span className="w-3 h-3 inline-block mr-2 rounded-sm" style={{ backgroundColor: "#fad779" }}></span>
              Service expenses
            </span>
            <span className="ml-4 inline-flex items-center">
              <span className="w-3 h-3 inline-block mr-2 rounded-sm" style={{ backgroundColor: "#65c3e8" }}></span>
              Import expenses
            </span>
          </div>
          
          {/* Add a collapsible technical details section for developers */}
          <details className="mt-6 text-xs">
            <summary className="cursor-pointer text-muted-foreground">Technical details</summary>
            <pre className="mt-2 p-2 bg-gray-100 rounded text-xs overflow-auto max-h-32">
              {detailedError}
            </pre>
          </details>
        </CardContent>
      </Card>
    );
  }

  // Filter the data based on selected category
  const filteredCategoryData = activeCategory === "all" 
    ? detailedCategoryData 
    : detailedCategoryData.filter(item => item.group === activeCategory);
  
  return (
    <Card className="mt-8">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div>
          <CardTitle className="text-base font-medium">EXPENSES BY TYPE</CardTitle>
        </div>
        <div className="flex items-center gap-2">
          {/* Currency toggle button */}
          <Button
            variant="outline"
            size="sm"
            onClick={toggleCurrency}
            className={`h-8 ${
              activeCurrency === "USD" 
                ? "bg-emerald-50 text-emerald-900 border-emerald-200 hover:bg-emerald-100" 
                : "bg-sky-50 text-sky-900 border-sky-200 hover:bg-sky-100"
            }`}
          >
            {activeCurrency === "USD" ? "$ USD" : "₺ TL"}
          </Button>
          
          {/* Refresh button */}
          <Button 
            variant="outline" 
            size="sm"
            onClick={refreshData}
            disabled={isRefreshing}
            className="h-8"
          >
            <RefreshCw className={`h-4 w-4 mr-1 ${isRefreshing ? 'animate-spin' : ''}`} />
            {isRefreshing ? "Refreshing..." : "Refresh"}
          </Button>
          
          {/* Category filter dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button 
                variant="outline" 
                size="sm"
                className="h-8 bg-amber-50 text-amber-900 border-amber-200 hover:bg-amber-100"
              >
                {categoryOptions.find(opt => opt.value === activeCategory)?.label || "All Categories"}
                <ChevronDown className="ml-1 h-4 w-4 inline" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {categoryOptions.map(option => (
                <DropdownMenuItem 
                  key={option.value}
                  onClick={() => setActiveCategory(option.value)}
                  className={activeCategory === option.value ? "bg-amber-50 font-medium" : ""}
                >
                  {option.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="h-[350px] flex items-center justify-center">
            <Skeleton className="h-[300px] w-full" />
          </div>
        ) : filteredCategoryData.length === 0 ? (
          <div className="h-[350px] flex items-center justify-center">
            <p className="text-muted-foreground">No expense data available for the selected category</p>
          </div>
        ) : (
          <div className="h-[350px]">
            <ResponsiveContainer width="100%" height="100%">
              <RechartsBarChart
                data={filteredCategoryData}
                margin={{
                  top: 10,
                  right: 30,
                  left: 40,
                  bottom: 80,
                }}
                barCategoryGap="10%"
                layout="horizontal"
              >
                <CartesianGrid vertical={true} strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis 
                  dataKey="formattedCategory"
                  type="category"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#666', fontSize: 11 }}
                  angle={-45}
                  textAnchor="end"
                  height={70}
                  interval={0}
                />
                <YAxis 
                  type="number"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#666', fontSize: 12 }}
                  tickFormatter={(value) => {
                    // Abbreviate large numbers
                    if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M ${activeCurrency === 'USD' ? '$' : '₺'}`;
                    if (value >= 1000) return `${(value / 1000).toFixed(1)}K ${activeCurrency === 'USD' ? '$' : '₺'}`;
                    return `${value} ${activeCurrency === 'USD' ? '$' : '₺'}`;
                  }}
                />
                <RechartsTooltip
                  formatter={(value: number, name: string, props: any) => {
                    // Format currency in tooltip
                    const formattedValue = formatCurrency(value, activeCurrency);
                    return [formattedValue, props.payload.formattedCategory];
                  }}
                  labelFormatter={() => ''}
                />
                <Bar 
                  dataKey="value" 
                  name="Amount" 
                  radius={[4, 4, 0, 0]}
                >
                  {filteredCategoryData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Bar>
              </RechartsBarChart>
            </ResponsiveContainer>
          </div>
        )}
        
        {/* Category group legends */}
        <div className="mt-3 text-xs flex flex-wrap justify-center text-muted-foreground">
          <span className="ml-4 inline-flex items-center mr-6 mb-2">
            <span className="w-3 h-3 inline-block mr-2 rounded-sm" style={{ backgroundColor: "#a1c89f" }}></span>
            Tax expenses
          </span>
          <span className="ml-4 inline-flex items-center mr-6 mb-2">
            <span className="w-3 h-3 inline-block mr-2 rounded-sm" style={{ backgroundColor: "#fad779" }}></span>
            Service expenses
          </span>
          <span className="ml-4 inline-flex items-center mb-2">
            <span className="w-3 h-3 inline-block mr-2 rounded-sm" style={{ backgroundColor: "#65c3e8" }}></span>
            Import expenses
          </span>
        </div>
        
        {/* Show partial data warning if there were errors but we still have some data */}
        {hasAnyError && !hasCompleteFailure && (
          <div className="mt-4 px-4 py-3 bg-amber-50 text-amber-800 rounded-md text-xs">
            <AlertTriangle className="h-4 w-4 inline-block mr-2" />
            Some data sources couldn't be loaded. The chart shows partial data.
          </div>
        )}
      </CardContent>
    </Card>
  );
}