/**
 * Helper functions for date calculations in analytics
 */

/**
 * Get the ISO week number for a given date
 */
export function getWeekNumber(date: Date): number {
  const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
  const pastDaysOfYear = (date.getTime() - firstDayOfYear.getTime()) / 86400000;
  return Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
}

/**
 * Get a Date object for the first day of a given week number in a year
 */
export function getDateOfWeek(year: number, week: number): Date {
  const firstDayOfYear = new Date(year, 0, 1);
  const daysOffset = firstDayOfYear.getDay() > 0 ? 7 - firstDayOfYear.getDay() : 0;
  
  // Add days until we're at the first day of the week (Monday)
  const firstMonday = new Date(year, 0, 1 + daysOffset);
  
  // Add (week - 1) * 7 days to get to the target week
  return new Date(firstMonday.getTime() + (week - 1) * 7 * 86400000);
}

/**
 * Format a period string into a human-readable label
 */
export function formatPeriodLabel(period: string, groupBy: 'week' | 'month'): string {
  if (groupBy === 'week') {
    // Format: YYYY-WNN -> "Week NN, MMM YYYY"
    const [year, weekPart] = period.split('-');
    const weekNum = parseInt(weekPart.substring(1));
    const weekDate = getDateOfWeek(parseInt(year), weekNum);
    
    return `Week ${weekNum}, ${weekDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`;
  } else {
    // Format: YYYY-MM -> "MMM YYYY"
    const [year, month] = period.split('-');
    const date = new Date(parseInt(year), parseInt(month) - 1, 1);
    
    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }
}