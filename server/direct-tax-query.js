/**
 * This file contains direct database queries for tax analytics 
 * to work around parameter binding issues
 */

// Import the database pool directly to avoid any ORM-related issues
import pg from '@neondatabase/serverless';
import ws from 'ws';

// Configure neon for WebSockets
pg.neonConfig.webSocketConstructor = ws;

// Create a direct connection to the database
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

/**
 * Get tax totals by category in a date range
 * Using direct query approach to avoid parameter binding issues
 */
const getTaxAnalytics = async (startDate, endDate, procedureRefs = []) => {
  try {
    console.log(`[Direct Tax Query] Getting tax data for date range: ${startDate} to ${endDate}`);
    
    // Validate date strings to ensure they are in YYYY-MM-DD format to prevent SQL injection
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      throw new Error('Invalid date format. Dates must be in YYYY-MM-DD format.');
    }
    
    // First get all procedures in the date range
    let proceduresQuery = `
      SELECT 
        reference 
      FROM 
        procedures 
      WHERE 
        import_dec_date::date BETWEEN '${startDate}'::date AND '${endDate}'::date
    `;
    
    // Add procedure filter if specified
    if (procedureRefs && procedureRefs.length > 0) {
      // Validate procedure references to prevent SQL injection
      for (const ref of procedureRefs) {
        if (!/^[A-Za-z0-9\-\/]+$/.test(ref)) {
          throw new Error(`Invalid procedure reference format: ${ref}`);
        }
      }
      
      // Use direct string interpolation for IN clause
      const refsString = procedureRefs.map(ref => `'${ref}'`).join(',');
      proceduresQuery += ` AND reference IN (${refsString})`;
    }
    
    console.log(`[Direct Tax Query] Executing procedures query:`, proceduresQuery);
    
    // Execute the query directly with the client
    const proceduresResult = await pool.query(proceduresQuery);
    const procedures = proceduresResult.rows || [];
    
    // If no procedures found, return empty result
    if (procedures.length === 0) {
      console.log("[Direct Tax Query] No procedures found in date range");
      return {
        categories: 0,
        totalTaxAmount: 0,
        totalTaxCount: 0,
        data: []
      };
    }
    
    console.log(`[Direct Tax Query] Found ${procedures.length} procedures in date range ${startDate} to ${endDate}`);
    const procedureReferences = procedures.map(p => p.reference);
    
    // Build safe IN clause with procedure references
    const refsString = procedureReferences.map(ref => `'${ref}'`).join(',');
    
    // One unified query with direct category selection approach
    const taxQuery = `
      WITH tax_data AS (
        SELECT 
          'customs_tax' as category,
          customs_tax as amount
        FROM 
          taxes
        WHERE 
          procedure_reference IN (${refsString})
          AND customs_tax > 0
        
        UNION ALL
        
        SELECT 
          'additional_customs_tax' as category,
          additional_customs_tax as amount
        FROM 
          taxes
        WHERE 
          procedure_reference IN (${refsString})
          AND additional_customs_tax > 0
        
        UNION ALL
        
        SELECT 
          'kkdf' as category,
          kkdf as amount
        FROM 
          taxes
        WHERE 
          procedure_reference IN (${refsString})
          AND kkdf > 0
        
        UNION ALL
        
        SELECT 
          'vat' as category,
          vat as amount
        FROM 
          taxes
        WHERE 
          procedure_reference IN (${refsString})
          AND vat > 0
        
        UNION ALL
        
        SELECT 
          'stamp_tax' as category,
          stamp_tax as amount
        FROM 
          taxes
        WHERE 
          procedure_reference IN (${refsString})
          AND stamp_tax > 0
      )
      SELECT 
        category,
        SUM(amount) as "totalAmount",
        COUNT(*) as count
      FROM 
        tax_data
      GROUP BY 
        category
      ORDER BY 
        "totalAmount" DESC
    `;
    
    console.log(`[Direct Tax Query] Executing tax category query`);
    
    // Execute the query directly
    const taxResult = await pool.query(taxQuery);
    const taxData = taxResult.rows || [];
    
    console.log(`[Direct Tax Query] Found ${taxData.length} tax categories`);
    
    // Calculate totals
    let totalTaxAmount = 0;
    let totalTaxCount = 0;
    
    taxData.forEach(item => {
      totalTaxAmount += parseFloat(item.totalAmount || '0');
      totalTaxCount += parseInt(item.count || '0');
    });
    
    return {
      categories: taxData.length,
      totalTaxAmount,
      totalTaxCount,
      data: taxData
    };
  } catch (error) {
    console.error('[Direct Tax Query] Error getting tax analytics:', error);
    throw error;
  }
};

/**
 * Get tax trend data over time for a specific category
 */
const getTaxTrend = async (category, startDate, endDate, groupBy = 'week') => {
  try {
    console.log(`[Direct Tax Query] Getting tax trend for category: ${category}`);
    console.log(`Date range: ${startDate} to ${endDate}, grouping by: ${groupBy}`);
    
    // Validate date strings to ensure they are in YYYY-MM-DD format to prevent SQL injection
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      throw new Error('Invalid date format. Dates must be in YYYY-MM-DD format.');
    }
    
    // First get all procedures in the date range using direct string interpolation
    const proceduresQuery = `
      SELECT 
        reference, 
        import_dec_date 
      FROM 
        procedures 
      WHERE 
        import_dec_date::date BETWEEN '${startDate}'::date AND '${endDate}'::date
      ORDER BY 
        import_dec_date
    `;
    
    console.log(`[Direct Tax Query] Executing procedures query:`, proceduresQuery);
    const proceduresResult = await pool.query(proceduresQuery);
    const procedures = proceduresResult.rows || [];
    
    if (procedures.length === 0) {
      console.log("[Direct Tax Query] No procedures found in date range");
      return [];
    }
    
    const procedureReferences = procedures.map(p => p.reference);
    
    // Map the database column name based on the category parameter
    let columnName = '';
    let taxQueryTemplate = '';
    
    if (category === 'total') {
      // Special case for total tax
      taxQueryTemplate = `
        SELECT 
          (COALESCE(t.customs_tax, 0) + 
           COALESCE(t.additional_customs_tax, 0) + 
           COALESCE(t.kkdf, 0) + 
           COALESCE(t.vat, 0) + 
           COALESCE(t.stamp_tax, 0)) as amount,
          p.import_dec_date as date
        FROM 
          taxes t
        JOIN 
          procedures p ON t.procedure_reference = p.reference
        WHERE 
          t.procedure_reference IN (PROCEDURE_REFS)
        ORDER BY 
          p.import_dec_date
      `;
    } else {
      // Validate category to prevent SQL injection
      switch (category) {
        case 'customs_tax':
          columnName = 'customs_tax';
          break;
        case 'additional_customs_tax':
          columnName = 'additional_customs_tax';
          break;
        case 'kkdf':
          columnName = 'kkdf';
          break;
        case 'vat':
          columnName = 'vat';
          break;
        case 'stamp_tax':
          columnName = 'stamp_tax';
          break;
        default:
          throw new Error(`Invalid tax category: ${category}`);
      }
      
      taxQueryTemplate = `
        SELECT 
          t.${columnName} as amount,
          p.import_dec_date as date
        FROM 
          taxes t
        JOIN 
          procedures p ON t.procedure_reference = p.reference
        WHERE 
          t.procedure_reference IN (PROCEDURE_REFS)
          AND t.${columnName} > 0
        ORDER BY 
          p.import_dec_date
      `;
    }
    
    // Build procedure reference placeholders for IN clause (safely)
    const refsString = procedureReferences.map(ref => `'${ref}'`).join(',');
    const taxQuery = taxQueryTemplate.replace('PROCEDURE_REFS', refsString);
    
    console.log(`[Direct Tax Query] Executing tax trend query for category ${category}`);
    
    // Execute query directly
    const taxResult = await pool.query(taxQuery);
    const taxRecords = taxResult.rows || [];
    
    console.log(`[Direct Tax Query] Found ${taxRecords.length} records for category ${category}`);
    
    // If no records, return empty result
    if (taxRecords.length === 0) {
      return [];
    }
    
    // Calculate week number properly
    const getWeekNumber = (date) => {
      const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
      const pastDaysOfYear = (date.getTime() - firstDayOfYear.getTime()) / 86400000;
      return Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
    };
    
    // Group the data by week or month using standardized format
    const groupedData = {};
    
    taxRecords.forEach(record => {
      const date = new Date(record.date);
      let periodKey = '';
      
      if (groupBy === 'week') {
        // Format for readable display
        const weekNumber = getWeekNumber(date);
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        periodKey = `Week ${weekNumber} ${monthNames[date.getMonth()]}`;
      } else {
        // Format as Month Year for display
        periodKey = date.toLocaleString('default', { month: 'long', year: 'numeric' });
      }
      
      if (!groupedData[periodKey]) {
        groupedData[periodKey] = 0;
      }
      
      groupedData[periodKey] += parseFloat(record.amount || '0');
    });
    
    // Convert to array format expected by frontend
    const result = Object.entries(groupedData).map(([period, amount]) => ({
      period,
      amount
    }));
    
    return { data: result };
  } catch (error) {
    console.error('[Direct Tax Query] Error getting tax trend:', error);
    throw error;
  }
};

export {
  getTaxAnalytics,
  getTaxTrend
};