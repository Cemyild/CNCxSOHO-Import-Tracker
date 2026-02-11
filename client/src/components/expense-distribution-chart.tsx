import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { formatAmount } from "@/utils/formatters";

// Type definitions for expenses data
type ExpenseData = {
  category: string;
  name: string;
  value: number;
  color: string;
};

interface ExpenseDistributionChartProps {
  data: ExpenseData[];
}

const ExpenseDistributionChart: React.FC<ExpenseDistributionChartProps> = ({ data }) => {
  // Sort data by value in descending order
  const sortedData = [...data].sort((a, b) => b.value - a.value);
  
  // Calculate total for percentages and summary
  const total = sortedData.reduce((sum, item) => sum + item.value, 0);
  
  // Format percentage
  const formatPercentage = (value: number) => {
    return (value / total * 100).toFixed(1) + '%';
  };

  // Shorten category names for better display in vertical layout
  const shortenCategory = (category: string) => {
    // Display first 12 characters and add ellipsis if longer
    if (category.length > 12) {
      return category.substring(0, 12) + '...';
    }
    return category;
  };

  // Custom tooltip
  const CustomTooltip = (props: any) => {
    const { active, payload } = props;
    
    if (active && payload && payload.length) {
      const value = payload[0].value;
      const percentage = (value / total * 100).toFixed(1);
      
      return (
        <div className="bg-white p-3 shadow-md rounded-md border border-gray-100">
          <p className="text-gray-600 mb-1">{payload[0].payload.name}</p>
          <p className="text-gray-800 font-semibold">{formatAmount(value)} ₺</p>
          <p className="text-gray-500 text-sm">{percentage}% of total</p>
        </div>
      );
    }
    return null;
  };

  // Category colors mapping (fallback colors if not provided in data)
  const categoryColors = {
    'airport_storage_fee': '#3b82f6', // Blue
    'transportation': '#22c55e',      // Green
    'international_transportation': '#8b5cf6', // Purple
    'bonded_warehouse_storage_fee': '#ef4444', // Red
    'insurance': '#f97316',           // Orange
    'azo_test': '#14b8a6',            // Teal
    'tareks_fee': '#eab308',          // Yellow
    'awb_fee': '#ec4899',             // Pink
    'export_registry_fee': '#64748b', // Slate
    'customs_inspection': '#0ea5e9',  // Sky Blue
    'other': '#94a3b8',               // Default
  };

  // Ensure all data items have a color assigned
  const dataWithColors = sortedData.map(item => ({
    ...item,
    color: item.color || (categoryColors as Record<string, string>)[item.category] || categoryColors.other
  }));

  // Check if we have data to display
  if (dataWithColors.length === 0) {
    return (
      <div className="h-80 min-h-[300px] w-full flex items-center justify-center text-gray-500">
        No expense data available
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="h-80 min-h-[300px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={dataWithColors}
            margin={{ top: 10, right: 10, left: 10, bottom: 60 }}
            barSize={38}
          >
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
            <XAxis 
              dataKey="name"
              axisLine={false}
              tickLine={false}
              tick={{ fill: '#666', fontSize: 12 }}
              tickFormatter={shortenCategory}
              angle={-45}
              textAnchor="end"
              height={60}
            />
            <YAxis 
              axisLine={false}
              tickLine={false}
              tick={{ fill: '#666', fontSize: 12 }}
              tickFormatter={(value) => value >= 1000 ? `${(value/1000).toFixed(0)}k` : value}
              width={50}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(0, 0, 0, 0.05)' }} />
            <Bar 
              dataKey="value" 
              name="Expense Amount" 
              radius={[4, 4, 0, 0]}
            >
              {dataWithColors.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      
      <div className="flex justify-between mt-6 pt-4 border-t border-gray-100">
        <div>
          <p className="text-sm text-gray-500">Total Expenses</p>
          <p className="text-lg font-semibold text-gray-800">{formatAmount(total)} ₺</p>
        </div>
        <div>
          <p className="text-sm text-gray-500">Top Category</p>
          <p className="text-lg font-semibold text-gray-800">
            {dataWithColors.length > 0 ? dataWithColors[0].name.split(' ')[0] : 'N/A'}
          </p>
        </div>
        <div>
          <p className="text-sm text-gray-500">Top Category %</p>
          <p className="text-lg font-semibold text-gray-800">
            {dataWithColors.length > 0 ? formatPercentage(dataWithColors[0].value) : '0%'}
          </p>
        </div>
      </div>
    </div>
  );
};

export default ExpenseDistributionChart;