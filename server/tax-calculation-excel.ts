import { Router } from 'express';
import { storage } from './storage';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';

const execAsync = promisify(exec);
const router = Router();

router.get('/:id/export/excel', async (req, res) => {
  try {
    const calculationId = parseInt(req.params.id);
    console.log(`[TAX-EXCEL] Generating Excel for calculation ID: ${calculationId}`);
    
    const calculation = await storage.getTaxCalculation(calculationId);
    if (!calculation) {
      return res.status(404).json({ error: 'Calculation not found' });
    }
    
    const items = await storage.getTaxCalculationItems(calculationId);
    console.log(`[TAX-EXCEL] Found ${items.length} items`);
    
    const itemsWithHsCodes = await Promise.all(
      items.map(async (item) => {
        let hsCodeData = null;
        if (item.tr_hs_code) {
          const rawHsCode = await storage.getHsCode(item.tr_hs_code);
          if (rawHsCode) {
            hsCodeData = {
              ...rawHsCode,
              customs_tax_percent: rawHsCode.customs_tax_percent || '0',
              additional_customs_tax_percent: rawHsCode.additional_customs_tax_percent || '0',
              kkdf_percent: rawHsCode.kkdf_percent || '0',
              vat_percent: rawHsCode.vat_percent || '0',
            };
          }
        }
        return {
          ...item,
          hs_code_data: hsCodeData
        };
      })
    );
    
    const data = {
      calculation: {
        reference: calculation.reference || '',
        invoice_no: calculation.invoice_no || '',
        invoice_date: calculation.invoice_date || '',
        total_value: calculation.total_value || '0',
        total_quantity: calculation.total_quantity || 0,
        transport_cost: calculation.transport_cost || '0',
        insurance_cost: calculation.insurance_cost || '0',
        storage_cost: calculation.storage_cost || '0',
        currency_rate: calculation.currency_rate || '0',
      },
      items: itemsWithHsCodes.map(item => ({
        hts_code: item.hts_code || '',
        country_of_origin: item.country_of_origin || '',
        style: item.style || '',
        color: item.color || '',
        category: item.category || '',
        description: item.description || '',
        fabric_content: item.fabric_content || '',
        cost: item.cost || '0',
        unit_count: item.unit_count || 0,
        total_value: item.total_value || '0',
        tr_hs_code: item.tr_hs_code || '',
        requirements: item.requirements || '',
        transport_share: item.transport_share || '0',
        insurance_share: item.insurance_share || '0',
        storage_share: item.storage_share || '0',
        cif_value: item.cif_value || '0',
        customs_tax: item.customs_tax || '0',
        additional_customs_tax: item.additional_customs_tax || '0',
        kkdf: item.kkdf || '0',
        vat: item.vat || '0',
        vat_base: item.vat_base || '0',
        total_tax_usd: item.total_tax_usd || '0',
        total_tax_tl: item.total_tax_tl || '0',
        hs_code_data: item.hs_code_data,
      }))
    };
    
    const jsonData = JSON.stringify(data);
    const tempJsonFile = `/tmp/tax_calc_${calculationId}_${Date.now()}.json`;
    
    try {
      fs.writeFileSync(tempJsonFile, jsonData);
      
      console.log('[TAX-EXCEL] Calling Python script...');
      const { stdout, stderr } = await execAsync(
        `cat ${tempJsonFile} | python3 server/excel_export.py`,
        { maxBuffer: 10 * 1024 * 1024 }
      );
      
      if (stderr) {
        console.error('[TAX-EXCEL] Python stderr:', stderr);
      }
      
      const outputPath = stdout.trim();
      console.log('[TAX-EXCEL] Python generated file at:', outputPath);
      
      if (!fs.existsSync(outputPath)) {
        throw new Error('Python script did not generate output file');
      }
      
      const fileBuffer = fs.readFileSync(outputPath);
      
      fs.unlinkSync(outputPath);
      
      const filename = `Tax_Calculation_${calculation.reference}.xlsx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(fileBuffer);
      
      console.log(`[TAX-EXCEL] Successfully generated Excel file: ${filename}`);
    } finally {
      if (fs.existsSync(tempJsonFile)) {
        fs.unlinkSync(tempJsonFile);
      }
    }
    
  } catch (error) {
    console.error('[TAX-EXCEL] Excel export error:', error);
    res.status(500).json({ 
      error: 'Export failed', 
      details: error instanceof Error ? error.message : 'Unknown error' 
    });
  }
});

export default router;
