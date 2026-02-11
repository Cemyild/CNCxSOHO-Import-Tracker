import { Router } from 'express';
import { storage } from './storage';
import { db } from './db';
import { products, countryCodeMappings } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';

const execAsync = promisify(exec);
const router = Router();

// Default known country code mappings (2-letter to 3-digit)
const DEFAULT_COUNTRY_CODES: Record<string, string> = {
  'CN': '720',
  'ID': '700',
  'KH': '696',
  'VN': '690',
  'US': '400',
  'TW': '736',
  'IT': '005',
  'RO': '066',
  'JO': '628',
  'NI': '432',
  'AQ': '891',
  'TH': '680',
  'LK': '669',
  'AL': '070',
  'SG': '706',
  'GT': '416',
  'CO': '480',
  'CM': '302',
  'PH': '708',
  'TR': '052',
  'CA': '404',
  'SV': '428',
  'HK': '740',
};

// Helper function to get all country code mappings (default + database)
async function getAllCountryCodeMappings(): Promise<Record<string, string>> {
  const dbMappings = await db.select().from(countryCodeMappings);
  const mappings = { ...DEFAULT_COUNTRY_CODES };
  for (const mapping of dbMappings) {
    mappings[mapping.country_code_2.toUpperCase()] = mapping.country_code_3;
  }
  return mappings;
}

// Check for missing country codes before export
router.get('/:id/check-country-codes', async (req, res) => {
  try {
    const calculationId = parseInt(req.params.id);
    const items = await storage.getTaxCalculationItems(calculationId);
    
    // Get all known mappings (default + from database)
    const allMappings = await getAllCountryCodeMappings();
    
    const missingCodes: string[] = [];
    
    for (const item of items) {
      if (item.product_id) {
        const [product] = await db.select().from(products).where(eq(products.id, item.product_id));
        if (product?.country_of_origin) {
          const countryCode = product.country_of_origin.toUpperCase();
          if (!allMappings[countryCode] && !missingCodes.includes(countryCode)) {
            missingCodes.push(countryCode);
          }
        }
      }
    }
    
    res.json({ missingCodes });
  } catch (error) {
    console.error('[BEYANNAME] Check country codes error:', error);
    res.status(500).json({ error: 'Failed to check country codes' });
  }
});

router.post('/:id/export/beyanname', async (req, res) => {
  try {
    const calculationId = parseInt(req.params.id);
    const customMappings: Record<string, string> = req.body?.customMappings || {};
    
    console.log(`[BEYANNAME] Generating BEYANNAME Excel for calculation ID: ${calculationId}`);
    console.log(`[BEYANNAME] Custom mappings received:`, customMappings);
    
    // Save new custom mappings to the database
    for (const [code2, code3] of Object.entries(customMappings)) {
      if (code2 && code3) {
        try {
          await db.insert(countryCodeMappings)
            .values({ country_code_2: code2.toUpperCase(), country_code_3: code3 })
            .onConflictDoUpdate({
              target: countryCodeMappings.country_code_2,
              set: { country_code_3: code3 }
            });
          console.log(`[BEYANNAME] Saved country code mapping: ${code2} -> ${code3}`);
        } catch (e) {
          console.error(`[BEYANNAME] Failed to save mapping ${code2} -> ${code3}:`, e);
        }
      }
    }
    
    // Get all mappings (default + database) for the export
    const allMappings = await getAllCountryCodeMappings();
    
    const calculation = await storage.getTaxCalculation(calculationId);
    if (!calculation) {
      return res.status(404).json({ error: 'Calculation not found' });
    }
    
    const items = await storage.getTaxCalculationItems(calculationId);
    console.log(`[BEYANNAME] Found ${items.length} items`);
    
    // Fetch product data and HS code data for each item
    const itemsWithFullData = await Promise.all(
      items.map(async (item) => {
        // Get HS Code data
        let hsCodeData = null;
        if (item.tr_hs_code) {
          const rawHsCode = await storage.getHsCode(item.tr_hs_code);
          if (rawHsCode) {
            hsCodeData = {
              description_tr: rawHsCode.description_tr || '',
              unit: rawHsCode.unit || '',
              vat_percent: rawHsCode.vat_percent || '0',
            };
          }
        }
        
        // Get Product data (brand, item_description) - country_of_origin comes from the item itself
        let productData = null;
        if (item.product_id) {
          const [product] = await db.select().from(products).where(eq(products.id, item.product_id));
          if (product) {
            productData = {
              brand: product.brand || '',
              item_description: product.item_description || '',
            };
          }
        }
        
        // Use country_of_origin from the tax calculation item, NOT from the products table
        // This ensures we use the country specified during this calculation, not the default product country
        const itemCountryOfOrigin = item.country_of_origin || '';
        console.log(`[BEYANNAME] Item ${item.style}: country_of_origin="${itemCountryOfOrigin}" (from tax_calculation_items)`);
        
        return {
          style: item.style || '',
          cost: item.cost || '0',
          unit_count: item.unit_count || 0,
          tr_hs_code: item.tr_hs_code || '',
          fabric_content: item.fabric_content || '',
          hs_code_data: hsCodeData,
          product_data: productData,
          country_of_origin: itemCountryOfOrigin,
        };
      })
    );
    
    const data = {
      calculation: {
        reference: calculation.reference || '',
      },
      items: itemsWithFullData,
      customMappings: allMappings,
      timestamp: Date.now(),
    };
    
    const jsonData = JSON.stringify(data);
    const tempJsonFile = `/tmp/beyanname_calc_${calculationId}_${Date.now()}.json`;
    
    try {
      fs.writeFileSync(tempJsonFile, jsonData);
      
      console.log('[BEYANNAME] Calling Python script...');
      const { stdout, stderr } = await execAsync(
        `cat ${tempJsonFile} | python3 server/excel_beyanname_export.py`,
        { maxBuffer: 10 * 1024 * 1024 }
      );
      
      if (stderr) {
        console.error('[BEYANNAME] Python stderr:', stderr);
      }
      
      const outputPath = stdout.trim();
      console.log('[BEYANNAME] Python generated file at:', outputPath);
      
      if (!fs.existsSync(outputPath)) {
        throw new Error('Python script did not generate output file');
      }
      
      const fileBuffer = fs.readFileSync(outputPath);
      
      fs.unlinkSync(outputPath);
      
      const filename = `BEYANNAME_${calculation.reference}.xlsx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(fileBuffer);
      
      console.log(`[BEYANNAME] Successfully generated Excel file: ${filename}`);
    } finally {
      if (fs.existsSync(tempJsonFile)) {
        fs.unlinkSync(tempJsonFile);
      }
    }
    
  } catch (error) {
    console.error('[BEYANNAME] Excel export error:', error);
    res.status(500).json({ 
      error: 'Export failed', 
      details: error instanceof Error ? error.message : 'Unknown error' 
    });
  }
});

router.get('/:id/export/beyanname', async (req, res) => {
  try {
    const calculationId = parseInt(req.params.id);
    console.log(`[BEYANNAME] Generating BEYANNAME Excel for calculation ID: ${calculationId}`);
    
    const calculation = await storage.getTaxCalculation(calculationId);
    if (!calculation) {
      return res.status(404).json({ error: 'Calculation not found' });
    }
    
    const items = await storage.getTaxCalculationItems(calculationId);
    console.log(`[BEYANNAME] Found ${items.length} items`);
    
    // Fetch product data and HS code data for each item
    const itemsWithFullData = await Promise.all(
      items.map(async (item) => {
        // Get HS Code data
        let hsCodeData = null;
        if (item.tr_hs_code) {
          const rawHsCode = await storage.getHsCode(item.tr_hs_code);
          if (rawHsCode) {
            hsCodeData = {
              description_tr: rawHsCode.description_tr || '',
              unit: rawHsCode.unit || '',
              vat_percent: rawHsCode.vat_percent || '0',
            };
          }
        }
        
        // Get Product data (brand, item_description) - country_of_origin comes from the item itself
        let productData = null;
        if (item.product_id) {
          const [product] = await db.select().from(products).where(eq(products.id, item.product_id));
          if (product) {
            productData = {
              brand: product.brand || '',
              item_description: product.item_description || '',
            };
          }
        }
        
        // Use country_of_origin from the tax calculation item, NOT from the products table
        // This ensures we use the country specified during this calculation, not the default product country
        const itemCountryOfOrigin = item.country_of_origin || '';
        console.log(`[BEYANNAME] Item ${item.style}: country_of_origin="${itemCountryOfOrigin}" (from tax_calculation_items)`);
        
        return {
          style: item.style || '',
          cost: item.cost || '0',
          unit_count: item.unit_count || 0,
          tr_hs_code: item.tr_hs_code || '',
          fabric_content: item.fabric_content || '',
          hs_code_data: hsCodeData,
          product_data: productData,
          country_of_origin: itemCountryOfOrigin,
        };
      })
    );
    
    const data = {
      calculation: {
        reference: calculation.reference || '',
      },
      items: itemsWithFullData,
      timestamp: Date.now(),
    };
    
    const jsonData = JSON.stringify(data);
    const tempJsonFile = `/tmp/beyanname_calc_${calculationId}_${Date.now()}.json`;
    
    try {
      fs.writeFileSync(tempJsonFile, jsonData);
      
      console.log('[BEYANNAME] Calling Python script...');
      const { stdout, stderr } = await execAsync(
        `cat ${tempJsonFile} | python3 server/excel_beyanname_export.py`,
        { maxBuffer: 10 * 1024 * 1024 }
      );
      
      if (stderr) {
        console.error('[BEYANNAME] Python stderr:', stderr);
      }
      
      const outputPath = stdout.trim();
      console.log('[BEYANNAME] Python generated file at:', outputPath);
      
      if (!fs.existsSync(outputPath)) {
        throw new Error('Python script did not generate output file');
      }
      
      const fileBuffer = fs.readFileSync(outputPath);
      
      fs.unlinkSync(outputPath);
      
      const filename = `BEYANNAME_${calculation.reference}.xlsx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(fileBuffer);
      
      console.log(`[BEYANNAME] Successfully generated Excel file: ${filename}`);
    } finally {
      if (fs.existsSync(tempJsonFile)) {
        fs.unlinkSync(tempJsonFile);
      }
    }
    
  } catch (error) {
    console.error('[BEYANNAME] Excel export error:', error);
    res.status(500).json({ 
      error: 'Export failed', 
      details: error instanceof Error ? error.message : 'Unknown error' 
    });
  }
});

export default router;
