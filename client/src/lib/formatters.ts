/**
 * Format a number or string as currency
 * @param amount The amount to format (number or string or null or undefined)
 * @param currency The currency code (default: TL)
 * @returns Formatted currency string
 */
export const formatCurrency = (amount: number | string | null | undefined, currency: string = 'TL'): string => {
  // Handle null or undefined
  if (amount === null || amount === undefined) {
    return '₺0,00';
  }
  
  // Convert string to number if needed
  const numericAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
  
  // Handle NaN
  if (isNaN(numericAmount)) {
    return '₺0,00';
  }

  try {
    // Always use Turkish formatting for TL currency
    if (currency === 'TL') {
      // Turkish formatting uses comma as decimal separator
      return new Intl.NumberFormat('tr-TR', {
        style: 'currency',
        currency: 'TRY', // ISO code for Turkish Lira
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(numericAmount);
    }
    
    // For other currencies, use standard formatting
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(numericAmount);
  } catch (error) {
    console.error('Error formatting currency:', error);
    // Fallback to basic formatting with Turkish Lira symbol for TL
    if (currency === 'TL') {
      return `₺${numericAmount.toFixed(2).replace('.', ',')}`;
    }
    return `${numericAmount.toFixed(2)} ${currency}`;
  }
};

/**
 * Format a date to a string
 * @param date The date to format (Date object, string, or null/undefined)
 * @returns Formatted date string
 */
export const formatDate = (date: Date | string | null | undefined): string => {
  if (!date) {
    return '—';
  }
  
  try {
    // Convert string to Date object if necessary
    const dateObj = date instanceof Date ? date : new Date(date);
    
    // Check if date is valid
    if (isNaN(dateObj.getTime())) {
      console.warn('Invalid date value:', date);
      return '—';
    }
    
    // Format using Turkish locale for consistency with currency
    return new Intl.DateTimeFormat('tr-TR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(dateObj);
  } catch (error) {
    console.error('Error formatting date:', error, date);
    return '—';
  }
};

/**
 * Format a date to include time
 * @param date The date to format (Date object, string, or null/undefined)
 * @returns Formatted date and time string
 */
export const formatDateTime = (date: Date | string | null | undefined): string => {
  if (!date) {
    return '—';
  }
  
  try {
    // Convert string to Date object if necessary
    const dateObj = date instanceof Date ? date : new Date(date);
    
    // Check if date is valid
    if (isNaN(dateObj.getTime())) {
      console.warn('Invalid date value for formatDateTime:', date);
      return '—';
    }
    
    // Format using Turkish locale for consistency with currency and dates
    return new Intl.DateTimeFormat('tr-TR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(dateObj);
  } catch (error) {
    console.error('Error formatting date and time:', error, date);
    return '—';
  }
};

/**
 * Format a file size in bytes to a human-readable string
 * @param bytes The file size in bytes
 * @returns Formatted file size string
 */
export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';
  if (!bytes || isNaN(bytes)) return 'Unknown size';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

/**
 * Truncate a string if it exceeds a maximum length
 * @param str The string to truncate
 * @param maxLength The maximum length before truncation
 * @returns The truncated string with ellipsis if necessary
 */
export const truncateString = (str: string, maxLength: number = 50): string => {
  if (!str) return '';
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength) + '...';
};