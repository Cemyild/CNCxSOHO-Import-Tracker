import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Format a number as currency with the specified currency code
 * @param amount - The amount to format
 * @param currencyCode - The currency code (e.g., 'USD', 'TRY')
 * @param options - Additional Intl.NumberFormat options
 * @returns Formatted currency string
 */
export function formatCurrency(
  amount: number, 
  currencyCode: string = 'TRY',
  options: Intl.NumberFormatOptions = {}
): string {
  const defaultOptions: Intl.NumberFormatOptions = {
    style: 'currency',
    currency: currencyCode,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  };
  
  try {
    // For TRY, we'll use a custom format that shows the symbol at the end
    if (currencyCode === 'TRY') {
      return new Intl.NumberFormat('tr-TR', {
        ...defaultOptions,
        ...options,
        // Override the currency display to not include the currency symbol
        style: 'decimal',
      }).format(amount) + ' ₺';
    }
    
    // For USD and other currencies, use the standard format
    return new Intl.NumberFormat('en-US', {
      ...defaultOptions,
      ...options,
    }).format(amount);
  } catch (error) {
    console.error('Error formatting currency:', error);
    return `${amount.toFixed(2)} ${currencyCode}`;
  }
}

/**
 * Format a date string to a localized format
 * @param dateString - The date string to format
 * @param locale - The locale to use for formatting
 * @returns Formatted date string
 */
export function formatDate(dateString: string | Date, locale: string = 'tr-TR'): string {
  if (!dateString) return '';
  
  try {
    const date = typeof dateString === 'string' ? new Date(dateString) : dateString;
    return new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    }).format(date);
  } catch (error) {
    console.error('Error formatting date:', error);
    return String(dateString);
  }
}
