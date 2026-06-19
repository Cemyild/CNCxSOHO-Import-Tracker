// server/ai-ask-schema.ts
// Compact schema summary handed to the model so it can write ad-hoc read-only
// SELECTs via the run_sql tool. Column names are ACTUAL Postgres column names.
export const SCHEMA_SUMMARY = `Database schema (PostgreSQL) for run_sql. Use EXACT table/column names below. All date columns are stored as TEXT in 'YYYY-MM-DD' form (filter/compare as text; group via SUBSTRING(col,1,7) for month, SUBSTRING(col,1,4) for year).

procedures (one row per import procedure)
  reference (text, PK-like), shipper (text), invoice_no (text),
  invoice_date (text date), arrival_date (text date), import_dec_date (text date),
  amount (numeric), currency (text: USD/EUR/TL), piece (numeric), kg (numeric),
  shipment_status (text), payment_status (text), document_status (text),
  created_at (timestamp)

taxes (one row per procedure; join via procedure_reference = procedures.reference)
  procedure_reference (text), customs_tax (numeric), additional_customs_tax (numeric),
  kkdf (numeric), vat (numeric), stamp_tax (numeric)

import_expenses (categorized fees)
  procedure_reference (text), category (text enum: export_registry_fee, insurance,
  awb_fee, airport_storage_fee, bonded_warehouse_storage_fee, transportation,
  international_transportation, tareks_fee, customs_inspection, azo_test, other),
  amount (numeric), currency (text), invoice_number (text), invoice_date (text date),
  issuer (text), document_number (text), policy_number (text), notes (text)
  NOTE: amounts in different currencies cannot be summed — group by currency.

import_service_invoices (CNC service fees)
  procedure_reference (text), amount (numeric), currency (text),
  invoice_number (text), date (text date)

payments (legacy)
  procedure_reference (text), payment_date (text date), payment_type (text: advance/balance),
  amount (numeric), notes (text)
  NOTE: no currency column — currency lives on the parent procedure.

payment_distributions (newer)
  procedure_reference (text), payment_type (text), distributed_amount (numeric),
  incoming_payment_id (integer FK → incoming_payments.id), distribution_date (timestamp)

products
  style (text), brand (text), category (text), hts_code (text), tr_hs_code (text),
  country_of_origin (text)

hs_codes (Turkish HS codes)
  tr_hs_code (text PK), description_tr (text), ex_registry_form (bool),
  azo_dye_test (bool), special_custom (bool),
  customs_tax_percent (numeric), additional_customs_tax_percent (numeric),
  kkdf_percent (numeric), vat_percent (numeric)

Rules for run_sql: SELECT-only, single statement, ALWAYS add a LIMIT (<=200).
Prefer the dedicated tools (query_procedures etc.) for common aggregates; use
run_sql only when the question needs joins/derived metrics/rankings/comparisons
the fixed tools can't express.`;
