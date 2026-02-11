/**
 * Utility functions for formatting values in the application
 */

/**
 * Format a number with thousand separators and specified decimal places
 * @param value The number to format
 * @param decimalPlaces Number of decimal places to show (default: 2)
 * @returns Formatted number string
 */
export function formatNumber(value: string | number | null | undefined, decimalPlaces: number = 2): string {
  // Handle null or undefined values
  if (value === null || value === undefined) return '0';
  
  // Convert to number if it's a string
  const num = typeof value === 'string' ? parseFloat(value) : value;
  
  // Check if it's a valid number
  if (isNaN(num)) return '0';
  
  // Format with thousand separators and specified decimal places
  return num.toLocaleString('en-US', {
    minimumFractionDigits: decimalPlaces,
    maximumFractionDigits: decimalPlaces
  });
}

/**
 * Format a tax value with Turkish Lira symbol (₺)
 * Used specifically for tax amounts which are always in Turkish Lira
 * @param value The tax amount to format
 * @returns Formatted tax value with Turkish Lira symbol
 */
export function formatTaxAmount(value: string | number | null | undefined): string {
  return `${formatNumber(value, 2)} ₺`;
}

/**
 * Format a currency value with thousand separators, 2 decimal places, and currency symbol
 * @param amount Amount as string or number
 * @param currency Currency code (e.g., 'USD', 'EUR', 'TRY')
 * @returns Formatted currency string
 */
export function formatCurrency(amount: string | number | null | undefined, currency: string): string {
  // Handle null or undefined currency
  if (!currency) {
    currency = 'TRY'; // Default to Turkish Lira
  }
  
  // Return special formatting for Turkish Lira
  if (currency === 'TRY') {
    return `${formatNumber(amount, 2)} ₺`;
  }
  
  // Handle other common currencies with symbols
  switch (currency) {
    case 'USD':
      return `$ ${formatNumber(amount, 2)}`;
    case 'EUR':
      return `€ ${formatNumber(amount, 2)}`;
    case 'GBP':
      return `£ ${formatNumber(amount, 2)}`;
    default:
      return `${formatNumber(amount, 2)} ${currency}`;
  }
}

/**
 * Format a date string to a consistent date representation (DD.MM.YYYY format)
 * This function ensures dates are always displayed in the same format regardless of timezone
 * @param dateString Date string in any valid date format (ISO, etc.)
 * @returns Formatted date string in DD.MM.YYYY format
 */
export function formatDate(dateString: string): string {
  if (!dateString) return "";
  
  // Create a date object from the string
  const date = new Date(dateString);
  
  // Check if date is valid
  if (isNaN(date.getTime())) return "";
  
  // Get date parts - using UTC methods to avoid timezone issues
  const day = date.getUTCDate().toString().padStart(2, '0');
  const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const year = date.getUTCFullYear();
  
  // Return in DD.MM.YYYY format - consistent with the app's formatting standard
  return `${day}.${month}.${year}`;
}

/**
 * Format category name to display properly capitalized with spaces
 * @param category Category value from database (snake_case)
 * @returns Formatted category name with proper capitalization
 */
export function formatCategoryName(category: string): string {
  if (!category) return "";
  
  // Replace underscores with spaces and split into words
  const words = category.split('_');
  
  // Capitalize first letter of each word
  return words
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Format an amount value with Turkish Lira symbol (₺) by default
 * This is a primary function used for displaying monetary amounts in the application
 * @param value The amount to format
 * @param currency Currency code (optional, defaults to 'TRY')
 * @returns Formatted amount string with appropriate currency symbol
 */
export function formatAmount(value: string | number | null | undefined, currency: string = 'TRY'): string {
  return formatCurrency(value, currency);
}