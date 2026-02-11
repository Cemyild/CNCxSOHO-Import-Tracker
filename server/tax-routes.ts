import express from 'express';
import { storage } from './storage';
import { pool } from './db';

const router = express.Router();

// Tax analytics endpoint with direct SQL implementation
router.get('/taxes/analytics', async (req, res) => {
  try {
    const { startDate, endDate, procedureRefs } = req.query;
    
    console.log('[/api/taxes/analytics] Request query params:', {
      startDate,
      endDate,
      procedureRefs
    });
    
    if (!startDate || !endDate) {
      console.log('[/api/taxes/analytics] Missing required date parameters');
      return res.status(400).json({ message: 'Start date and end date are required' });
    }
    
    // Check that startDate and endDate are valid strings formatted as ISO dates
    if (!(typeof startDate === 'string') || 
        !(typeof endDate === 'string') ||
        !startDate.match(/^\d{4}-\d{2}-\d{2}/) ||
        !endDate.match(/^\d{4}-\d{2}-\d{2}/)) {
      console.log('[/api/taxes/analytics] Invalid date format');
      return res.status(400).json({ message: 'Invalid date format' });
    }
    
    const start = startDate as string;
    const end = endDate as string;
    
    console.log('[/api/taxes/analytics] Date range:', { start, end });
    
    // Parse procedure references if provided
    let procedureReferences: string[] | undefined;
    if (procedureRefs && typeof procedureRefs === 'string') {
      procedureReferences = procedureRefs.split(',');
      console.log('[/api/taxes/analytics] Procedure references:', procedureReferences);
    }
    
    // DIRECT SQL IMPLEMENTATION - avoiding Drizzle ORM and parameter bindings
    
    // 1. First get all procedures in the date range
    let proceduresQuery = `
      SELECT 
        reference 
      FROM 
        procedures 
      WHERE 
        import_dec_date::date BETWEEN '${start}'::date AND '${end}'::date
    `;
    
    // Add procedure filter if specified
    if (procedureReferences && procedureReferences.length > 0) {
      // Use direct string interpolation for IN clause (with validation)
      const refsString = procedureReferences
        .filter(ref => /^[A-Za-z0-9\-\/]+$/.test(ref)) // Validate format for safety
        .map(ref => `'${ref}'`)
        .join(',');
      
      if (refsString) {
        proceduresQuery += ` AND reference IN (${refsString})`;
      }
    }
    
    console.log('[TaxAPI] Procedures query:', proceduresQuery);
    
    // Execute procedure query
    const proceduresResult = await pool.query(proceduresQuery);
    const procedures = proceduresResult.rows || [];
    
    // If no procedures found, return empty result
    if (procedures.length === 0) {
      console.log("[TaxAPI] No procedures found in date range");
      return res.json({ 
        data: []
      });
    }
    
    // 2. Build tax data query with procedure references
    const procedureRefsList = procedures.map(p => p.reference);
    const refsString = procedureRefsList.map(ref => `'${ref}'`).join(',');
    
    // Single query to get all tax categories with their amounts
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
    
    // Execute tax query
    const taxResult = await pool.query(taxQuery);
    const taxData = taxResult.rows || [];
    
    console.log('[TaxAPI] Found tax data:', taxData);
    
    res.json({ data: taxData });
    
  } catch (error) {
    console.error('[/api/taxes/analytics] Error:', error);
    res.status(500).json({ 
      message: 'Failed to fetch tax analytics data', 
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

// Tax trend data endpoint with direct SQL implementation
router.get('/taxes/trend', async (req, res) => {
  try {
    const { category, startDate, endDate, groupBy } = req.query;
    
    console.log('[Trend API] Request for', category, 'date range:', startDate, 'to', endDate);
    
    // Parameter validation
    if (!category || !startDate || !endDate) {
      return res.status(400).json({ 
        message: 'Category, start date, and end date are required',
        params: { category, startDate, endDate }
      });
    }
    
    // Validate date strings to ensure they are in YYYY-MM-DD format
    if (!(typeof startDate === 'string') || 
        !(typeof endDate === 'string') ||
        !startDate.match(/^\d{4}-\d{2}-\d{2}/) ||
        !endDate.match(/^\d{4}-\d{2}-\d{2}/)) {
      return res.status(400).json({ message: 'Invalid date format' });
    }
    
    const start = startDate as string;
    const end = endDate as string;
    
    // Validate and map tax category
    const validCategories = ['customs_tax', 'additional_customs_tax', 'kkdf', 'vat', 'stamp_tax', 'total'];
    const taxCategory = String(category);
    
    if (!validCategories.includes(taxCategory)) {
      return res.status(400).json({ 
        message: 'Invalid tax category', 
        valid: validCategories
      });
    }
    
    // First get procedures in date range
    const proceduresQuery = `
      SELECT 
        reference, 
        import_dec_date 
      FROM 
        procedures 
      WHERE 
        import_dec_date::date BETWEEN '${start}'::date AND '${end}'::date
      ORDER BY 
        import_dec_date
    `;
    
    const proceduresResult = await pool.query(proceduresQuery);
    const procedures = proceduresResult.rows || [];
    
    if (procedures.length === 0) {
      return res.json({ data: [] });
    }
    
    // Build query based on category
    const procRefsString = procedures.map(p => `'${p.reference}'`).join(',');
    let taxQuery = '';
    
    if (taxCategory === 'total') {
      // Query for total taxes (all categories combined)
      taxQuery = `
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
          t.procedure_reference IN (${procRefsString})
        ORDER BY 
          p.import_dec_date
      `;
    } else {
      // Query for specific tax category
      taxQuery = `
        SELECT 
          t.${taxCategory} as amount,
          p.import_dec_date as date
        FROM 
          taxes t
        JOIN 
          procedures p ON t.procedure_reference = p.reference
        WHERE 
          t.procedure_reference IN (${procRefsString})
          AND t.${taxCategory} > 0
        ORDER BY 
          p.import_dec_date
      `;
    }
    
    // Execute tax trend query
    const taxResult = await pool.query(taxQuery);
    const taxRecords = taxResult.rows || [];
    
    // Group data by week or month
    const groupingPeriod = groupBy === 'month' ? 'month' : 'week';
    const groupedData: Record<string, number> = {};
    
    // Group function helper
    const getWeekNumber = (date: Date): number => {
      const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
      const pastDaysOfYear = (date.getTime() - firstDayOfYear.getTime()) / 86400000;
      return Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
    };
    
    // Process each tax record and group by period
    taxRecords.forEach(record => {
      const date = new Date(record.date);
      let periodKey = '';
      
      if (groupingPeriod === 'week') {
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
    
    // Convert to array format for frontend
    const result = Object.entries(groupedData).map(([period, amount]) => ({
      period,
      amount
    }));
    
    res.json({ data: result });
  } catch (error) {
    console.error('[Trend API] Error:', error);
    res.status(500).json({ 
      message: 'Failed to fetch tax trend data', 
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

// New endpoint for retrieving ALL historical tax trend data (not filtered by date range)
router.get('/taxes/trend-all', async (req, res) => {
  try {
    const { category, groupBy } = req.query;
    
    console.log('[Trend All API] Request for complete history of', category);
    
    // Parameter validation
    if (!category) {
      return res.status(400).json({ 
        message: 'Category is required',
        params: { category }
      });
    }
    
    // Validate and map tax category
    const validCategories = ['customs_tax', 'additional_customs_tax', 'kkdf', 'vat', 'stamp_tax', 'total'];
    const taxCategory = String(category);
    
    if (!validCategories.includes(taxCategory)) {
      return res.status(400).json({ 
        message: 'Invalid tax category', 
        valid: validCategories
      });
    }
    
    // Build query based on category - NO date filtering
    let taxQuery = '';
    
    if (taxCategory === 'total') {
      // Query for total taxes (all categories combined)
      taxQuery = `
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
        ORDER BY 
          p.import_dec_date
      `;
    } else {
      // Query for specific tax category
      taxQuery = `
        SELECT 
          t.${taxCategory} as amount,
          p.import_dec_date as date
        FROM 
          taxes t
        JOIN 
          procedures p ON t.procedure_reference = p.reference
        WHERE 
          t.${taxCategory} > 0
        ORDER BY 
          p.import_dec_date
      `;
    }
    
    // Execute tax trend query
    const taxResult = await pool.query(taxQuery);
    const taxRecords = taxResult.rows || [];
    
    // Group data by week or month
    const groupingPeriod = groupBy === 'month' ? 'month' : 'week';
    const groupedData: Record<string, number> = {};
    
    // Group function helper
    const getWeekNumber = (date: Date): number => {
      const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
      const pastDaysOfYear = (date.getTime() - firstDayOfYear.getTime()) / 86400000;
      return Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
    };
    
    // Process each tax record and group by period
    taxRecords.forEach(record => {
      const date = new Date(record.date);
      let periodKey = '';
      
      if (groupingPeriod === 'week') {
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
    
    // Convert to array format for frontend
    const result = Object.entries(groupedData).map(([period, amount]) => ({
      period,
      amount,
      // Add raw date information for easier comparison on frontend
      rawDate: Object.keys(groupedData).indexOf(period) // Use index as a proxy for chronological order
    }));
    
    res.json({ data: result });
  } catch (error) {
    console.error('[Trend All API] Error:', error);
    res.status(500).json({ 
      message: 'Failed to fetch complete tax trend data', 
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

export default router;