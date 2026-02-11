import { storage } from "./storage";
import type { TaxCalculation, TaxCalculationItem, HsCode, AtrCustomsRate } from "@shared/schema";

export interface TaxCalculationResult {
  transport_share: number;
  insurance_share: number;
  storage_share: number;
  cif_value: number;
  customs_tax: number;
  additional_customs_tax: number;
  kkdf: number;
  vat_base: number;
  vat: number;
  total_tax_usd: number;
  total_tax_tl: number;
}

export interface AtrContext {
  isAtr: boolean;
  atrRatesMap: Map<string, AtrCustomsRate>;
}

export const ATR_EXEMPT_COUNTRIES = ['IT', 'TR', 'PT', 'TN', 'BA'];

export function isAtrExemptCountry(countryCode: string | null | undefined): boolean {
  if (!countryCode) return false;
  return ATR_EXEMPT_COUNTRIES.includes(countryCode.toUpperCase());
}

export async function calculateItemTax(
  item: TaxCalculationItem,
  invoice: TaxCalculation,
  hsCode: HsCode,
  atrContext?: AtrContext
): Promise<TaxCalculationResult> {
  const itemTotalValue = parseFloat(item.total_value || '0');
  const invoiceTotalValue = parseFloat(invoice.total_value || '0');
  const transportCost = parseFloat(invoice.transport_cost || '0');
  const insuranceCost = parseFloat(invoice.insurance_cost || '0');
  const storageCost = parseFloat(invoice.storage_cost || '0');
  const currencyRate = parseFloat(invoice.currency_rate || '0');
  const isPrepaid = invoice.is_prepaid || false;

  let customsTaxPercent = parseFloat(hsCode.customs_tax_percent || '0');
  let additionalCustomsTaxPercent = parseFloat(hsCode.additional_customs_tax_percent || '0');
  const kkdfPercent = parseFloat(hsCode.kkdf_percent || '0');
  const vatPercent = parseFloat(hsCode.vat_percent || '0');

  if (atrContext?.isAtr) {
    const countryCode = item.country_of_origin;
    
    console.log(`[ATR CALC] Item ${item.style}: country=${countryCode}, isExempt=${isAtrExemptCountry(countryCode)}`);
    
    if (isAtrExemptCountry(countryCode)) {
      // Exempt countries (IT, TR, PT, TN, BA): Both Customs Tax = 0% and Additional Customs Tax = 0%
      customsTaxPercent = 0;
      additionalCustomsTaxPercent = 0;
      console.log(`[ATR CALC] Exempt country - customs=0%, additional=0%`);
    } else {
      // Non-exempt countries: Customs Tax = ATR rate, Additional Customs Tax = normal rate (unchanged)
      const atrRate = item.tr_hs_code ? atrContext.atrRatesMap.get(item.tr_hs_code) : null;
      if (atrRate) {
        customsTaxPercent = parseFloat(atrRate.customs_tax_percent || '0');
        console.log(`[ATR CALC] Non-exempt - Using ATR rate: customs=${customsTaxPercent}, additional=${additionalCustomsTaxPercent} (normal)`);
      } else {
        console.log(`[ATR CALC] Non-exempt - No ATR rate found for ${item.tr_hs_code}, keeping original customs=${customsTaxPercent}`);
      }
      // additionalCustomsTaxPercent stays as the normal rate from HS code
    }
  }

  const ratio = invoiceTotalValue > 0 ? itemTotalValue / invoiceTotalValue : 0;
  const transport_share = ratio * transportCost;
  const insurance_share = ratio * insuranceCost;
  const storage_share = ratio * storageCost;

  const cif_value = itemTotalValue + transport_share + insurance_share;

  const customs_tax = cif_value * customsTaxPercent;
  const additional_customs_tax = cif_value * additionalCustomsTaxPercent;

  const kkdf = !isPrepaid ? itemTotalValue * kkdfPercent : 0;

  const vat_base = isPrepaid
    ? cif_value + storage_share + customs_tax + additional_customs_tax
    : cif_value + storage_share + customs_tax + additional_customs_tax + kkdf;

  const vat = vat_base * vatPercent;

  const total_tax_usd = customs_tax + additional_customs_tax + kkdf + vat;
  const total_tax_tl = total_tax_usd * currencyRate;

  return {
    transport_share,
    insurance_share,
    storage_share,
    cif_value,
    customs_tax,
    additional_customs_tax,
    kkdf,
    vat_base,
    vat,
    total_tax_usd,
    total_tax_tl,
  };
}

export async function calculateAllItems(taxCalculationId: number): Promise<void> {
  const calculation = await storage.getTaxCalculation(taxCalculationId);
  if (!calculation) {
    throw new Error('Tax calculation not found');
  }

  const items = await storage.getTaxCalculationItems(taxCalculationId);

  const uniqueHsCodesSet = new Set<string>();
  items.forEach(item => {
    if (item.tr_hs_code) {
      uniqueHsCodesSet.add(item.tr_hs_code);
    }
  });
  const uniqueHsCodes = Array.from(uniqueHsCodesSet);
  
  const hsCodesData = await storage.getHsCodesBatch(uniqueHsCodes);
  const hsCodeMap = new Map(hsCodesData.map(hs => [hs.tr_hs_code, hs]));

  let atrContext: AtrContext | undefined;
  if (calculation.is_atr) {
    console.log(`[ATR] Calculation ${taxCalculationId} has ATR enabled, loading ATR rates for ${uniqueHsCodes.length} HS codes`);
    const atrRates = await storage.getAtrCustomsRates(uniqueHsCodes);
    console.log(`[ATR] Found ${atrRates.length} ATR rates in database`);
    const atrRatesMap = new Map(atrRates.map(rate => [rate.tr_hs_code, rate]));
    atrContext = { isAtr: true, atrRatesMap };
  } else {
    console.log(`[ATR] Calculation ${taxCalculationId} does NOT have ATR enabled`);
  }

  const updates = [];

  for (const item of items) {
    if (!item.tr_hs_code) {
      continue;
    }

    const hsCode = hsCodeMap.get(item.tr_hs_code);
    if (!hsCode) {
      continue;
    }

    const result = await calculateItemTax(item, calculation, hsCode, atrContext);

    const requirements = [];
    if (hsCode.ex_registry_form) requirements.push('EX REGISTRY FORM');
    if (hsCode.azo_dye_test) requirements.push('AZO DYE TEST');
    if (hsCode.special_custom) requirements.push('SPECIAL CUSTOM');

    updates.push({
      id: item.id,
      data: {
        transport_share: result.transport_share.toString(),
        insurance_share: result.insurance_share.toString(),
        storage_share: result.storage_share.toString(),
        cif_value: result.cif_value.toString(),
        customs_tax: result.customs_tax.toString(),
        additional_customs_tax: result.additional_customs_tax.toString(),
        kkdf: result.kkdf.toString(),
        vat_base: result.vat_base.toString(),
        vat: result.vat.toString(),
        total_tax_usd: result.total_tax_usd.toString(),
        total_tax_tl: result.total_tax_tl.toString(),
        requirements: requirements.length > 0 ? requirements.join(', ') : null,
      }
    });
  }

  await storage.batchUpdateTaxCalculationItems(updates);

  await storage.updateTaxCalculation(taxCalculationId, {
    status: 'calculated',
  });
}

export interface MissingAtrRatesResult {
  missingHsCodes: Array<{
    tr_hs_code: string;
    country_of_origin: string;
  }>;
  hasMissingRates: boolean;
}

export async function checkMissingAtrRates(taxCalculationId: number): Promise<MissingAtrRatesResult> {
  const calculation = await storage.getTaxCalculation(taxCalculationId);
  if (!calculation) {
    throw new Error('Tax calculation not found');
  }

  if (!calculation.is_atr) {
    return { missingHsCodes: [], hasMissingRates: false };
  }

  const items = await storage.getTaxCalculationItems(taxCalculationId);
  
  const hsCodeCountryPairs = new Map<string, Set<string>>();
  
  for (const item of items) {
    if (!item.tr_hs_code || !item.country_of_origin) continue;
    if (isAtrExemptCountry(item.country_of_origin)) continue;
    
    if (!hsCodeCountryPairs.has(item.tr_hs_code)) {
      hsCodeCountryPairs.set(item.tr_hs_code, new Set());
    }
    hsCodeCountryPairs.get(item.tr_hs_code)!.add(item.country_of_origin);
  }
  
  if (hsCodeCountryPairs.size === 0) {
    return { missingHsCodes: [], hasMissingRates: false };
  }

  const hsCodesToCheck = Array.from(hsCodeCountryPairs.keys());
  const existingRates = await storage.getAtrCustomsRates(hsCodesToCheck);
  const existingHsCodes = new Set(existingRates.map(r => r.tr_hs_code));
  
  const missingHsCodes: Array<{ tr_hs_code: string; country_of_origin: string }> = [];
  
  for (const [hsCode, countries] of hsCodeCountryPairs) {
    if (!existingHsCodes.has(hsCode)) {
      for (const country of countries) {
        missingHsCodes.push({ tr_hs_code: hsCode, country_of_origin: country });
      }
    }
  }
  
  return {
    missingHsCodes,
    hasMissingRates: missingHsCodes.length > 0
  };
}
