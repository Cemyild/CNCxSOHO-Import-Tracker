
import { pgTable, text, serial, integer, boolean, timestamp, pgEnum, decimal, unique, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const userRoleEnum = pgEnum('user_role', ['admin', 'user', 'accountant']);
export const procedureStatusEnum = pgEnum('procedure_status', ['draft', 'pending', 'approved', 'rejected', 'completed']);

// Status category enums for detailed status tracking
export const shipmentStatusOptionsEnum = pgEnum('shipment_status_options', [
  'created',
  'tareks_application',
  'tareks_approved',
  'import_started',
  'import_finished',
  'arrived',
  'delivered',
  'closed'
]);

export const paymentStatusOptionsEnum = pgEnum('payment_status_options', [
  'prepayment_invoice_sent',
  'advance_payment_received',
  'final_balance_letter_sent',
  'balance_received',
  'closed'
]);

export const paymentTypeEnum = pgEnum('payment_type', [
  'advance',
  'balance'
]);

export const distributionStatusEnum = pgEnum('distribution_status', [
  'pending_distribution',
  'partially_distributed',
  'fully_distributed'
]);

export const documentStatusOptionsEnum = pgEnum('document_status_options', [
  'import_doc_pending',
  'import_doc_received',
  'pod_sent',
  'expense_documents_sent',
  'closed'
]);

export const expenseCategoryEnum = pgEnum('expense_category', [
  'export_registry_fee',
  'insurance',
  'awb_fee',
  'airport_storage_fee', 
  'bonded_warehouse_storage_fee',
  'transportation',
  'international_transportation',
  'tareks_fee',
  'customs_inspection',
  'azo_test',
  'other' // Keeping 'other' for flexibility
]);
export const expenseTypeEnum = pgEnum('expense_type', [
  'tax',
  'import_expense',
  'service_invoice',
  'import_document'
]);

// Import document types enum
export const importDocumentTypeEnum = pgEnum('import_document_type', [
  'tax_calculation_spreadsheet',
  'advance_taxletter',
  'invoice',
  'packing_list',
  'insurance',
  'awb',
  'import_declaration',
  'transit_declaration',
  'pod',
  'expense_receipt',
  'final_balance_letter',
  'bonded_warehouse_declaration'
]);

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  email: text("email"),
  password: text("password").notNull(),
  role: userRoleEnum("role").notNull().default('user'),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  lastLogin: timestamp("last_login"),
});

// Sessions table for express-session store
export const sessions = pgTable("sessions", {
  sid: text("sid").primaryKey(),
  sess: text("sess").notNull(), // JSON session data
  expire: timestamp("expire").notNull(),
});

export const procedures = pgTable("procedures", {
  // Primary fields as requested
  id: serial("id").primaryKey(),
  reference: text("reference"),
  shipper: text("shipper"),
  invoice_no: text("invoice_no"),
  invoice_date: text("invoice_date"),
  amount: decimal("amount", { precision: 10, scale: 2 }).default('0'),
  currency: text("currency"),
  package: text("package"),
  kg: decimal("kg", { precision: 10, scale: 2 }),
  piece: integer("piece"),
  arrival_date: text("arrival_date"),
  awb_number: text("awb_number"),
  carrier: text("carrier"),
  customs: text("customs"),
  import_dec_number: text("import_dec_number"),
  import_dec_date: text("import_dec_date"),
  usdtl_rate: decimal("usdtl_rate", { precision: 10, scale: 4 }),
  
  // Status fields
  payment_status: text("payment_status"),
  document_status: text("document_status"),
  shipment_status: text("shipment_status"),
  
  // Additional financial fields
  freight_amount: decimal("freight_amount", { precision: 15, scale: 2 }).default('0'),
  
  // Required relationship fields
  assignedTo: integer("assigned_to").references(() => users.id),
  createdBy: integer("created_by").references(() => users.id).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const taxes = pgTable("taxes", {
  id: serial("id").primaryKey(),
  
  // Foreign key linking to procedures table via reference
  procedureReference: text("procedure_reference").notNull(),
  
  // Tax categories
  customsTax: decimal("customs_tax", { precision: 10, scale: 2 }).default('0'),
  additionalCustomsTax: decimal("additional_customs_tax", { precision: 10, scale: 2 }).default('0'),
  kkdf: decimal("kkdf", { precision: 10, scale: 2 }).default('0'),
  vat: decimal("vat", { precision: 10, scale: 2 }).default('0'),
  stampTax: decimal("stamp_tax", { precision: 10, scale: 2 }).default('0'),
  
  // Metadata
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => {
  return {
    // Ensure each procedure reference can only have one tax record
    procedureReferenceUnique: unique().on(table.procedureReference),
    // The foreign key constraint will be enforced at the application level
    // since we're referencing a non-primary key field (reference) in procedures
  }
});

export const procedureDocuments = pgTable("procedure_documents", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  path: text("path").notNull(),
  uploadedBy: integer("uploaded_by").references(() => users.id),
  procedureId: integer("procedure_id").references(() => procedures.id).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const documentTypes = pgTable("document_types", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
});

export const procedureComments = pgTable("procedure_comments", {
  id: serial("id").primaryKey(),
  content: text("content").notNull(),
  procedureId: integer("procedure_id").references(() => procedures.id).notNull(),
  createdBy: integer("created_by").references(() => users.id).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const procedureActivities = pgTable("procedure_activities", {
  id: serial("id").primaryKey(),
  procedureId: integer("procedure_id").references(() => procedures.id).notNull(),
  userId: integer("user_id").references(() => users.id).notNull(),
  action: text("action").notNull(),
  details: text("details"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const importExpenses = pgTable("import_expenses", {
  id: serial("id").primaryKey(),
  
  // Foreign key linking to procedures table via reference
  procedureReference: text("procedure_reference").notNull(),
  
  // Expense details
  category: expenseCategoryEnum("category").notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull().default('0'),
  currency: text("currency").default('USD'),
  invoiceNumber: text("invoice_number"),
  invoiceDate: text("invoice_date"),
  
  // New fields for business requirements
  documentNumber: text("document_number"), // For export registry fee
  policyNumber: text("policy_number"),     // For insurance
  issuer: text("issuer"),                  // For multiple categories
  
  // Metadata
  notes: text("notes"),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Schema definitions
export const insertUserSchema = createInsertSchema(users);
export const insertProcedureSchema = createInsertSchema(procedures);
export const insertTaxSchema = createInsertSchema(taxes);
export const insertProcedureDocumentSchema = createInsertSchema(procedureDocuments);
export const insertDocumentTypeSchema = createInsertSchema(documentTypes);
export const insertProcedureCommentSchema = createInsertSchema(procedureComments);
export const insertProcedureActivitySchema = createInsertSchema(procedureActivities);
// Import Service Invoice table
export const importServiceInvoices = pgTable("import_service_invoices", {
  id: serial("id").primaryKey(),
  
  // Foreign key linking to procedures table via reference
  procedureReference: text("procedure_reference").notNull(),
  
  // Required invoice details
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("USD"),
  invoiceNumber: text("invoice_number").notNull(),
  date: text("date").notNull(),
  
  // Metadata
  notes: text("notes"),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Expense Documents table for storing documents related to expenses
export const expenseDocuments = pgTable("expense_documents", {
  id: serial("id").primaryKey(),
  
  // Reference to the expense
  expenseType: expenseTypeEnum("expense_type").notNull(),
  expenseId: integer("expense_id").notNull(),
  
  // Document info
  originalFilename: text("original_filename").notNull(),
  objectKey: text("object_key").notNull(), // Cloud storage object key
  fileSize: integer("file_size").notNull(),
  fileType: text("file_type").notNull(),
  
  // Import document specific type (only used when expenseType is 'import_document')
  importDocumentType: importDocumentTypeEnum("import_document_type"),
  
  // Legacy fields (keeping for compatibility with existing data)
  storedFilename: text("stored_filename"),
  filePath: text("file_path"),
  
  // Metadata
  uploadedBy: integer("uploaded_by").references(() => users.id),
  procedureReference: text("procedure_reference").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Procedure Status Details table for storing detailed status options
export const procedureStatusDetails = pgTable("procedure_status_details", {
  id: serial("id").primaryKey(),
  
  // Foreign key linking to procedures table via reference
  procedureReference: text("procedure_reference").notNull(),
  
  // Status category (shipment, payment, document)
  category: text("category").notNull(),
  
  // Status option name
  status: text("status").notNull(),
  
  // Whether the status is checked/active
  isActive: boolean("is_active").notNull().default(false),
  
  // Metadata
  updatedBy: integer("updated_by").references(() => users.id),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Payments table for tracking payments related to procedures
export const payments = pgTable("payments", {
  id: serial("id").primaryKey(),
  
  // Foreign key linking to procedures table via reference
  procedureReference: text("procedure_reference").notNull(),
  
  // Payment details
  paymentType: paymentTypeEnum("payment_type").notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  paymentDate: text("payment_date").notNull(),
  notes: text("notes"),
  
  // Metadata
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Invoice Line Items table for tracking items in invoices with cost calculations
export const invoiceLineItems = pgTable("invoice_line_items", {
  id: serial("id").primaryKey(),
  
  // Foreign key linking to procedures table via reference
  procedureReference: text("procedure_reference").notNull(),
  
  // Item details
  styleNo: text("style_no"),
  description: text("description"),
  quantity: integer("quantity").notNull(),
  unitPrice: decimal("unit_price", { precision: 10, scale: 2 }).notNull(),
  totalPrice: decimal("total_price", { precision: 10, scale: 2 }).notNull(),
  
  // Calculated fields
  finalCost: decimal("final_cost", { precision: 10, scale: 2 }),
  finalCostPerItem: decimal("final_cost_per_item", { precision: 10, scale: 2 }),
  costMultiplier: decimal("cost_multiplier", { precision: 10, scale: 4 }),
  
  // Ordering field to preserve original position
  sortOrder: integer("sort_order"), 
  
  // Source tracking
  source: text("source").default('manual'), // 'manual', 'excel', 'csv', 'pdf'
  
  // Metadata
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Cost distribution methods enum
export const costDistributionMethodEnum = pgEnum('cost_distribution_method', [
  'proportional', // Distribution based on item price proportion
  'equal'         // Equal distribution across all items
]);

// Invoice line items configuration per procedure
export const invoiceLineItemsConfig = pgTable("invoice_line_items_config", {
  id: serial("id").primaryKey(),
  
  // Foreign key linking to procedures table via reference
  procedureReference: text("procedure_reference").notNull().unique(),
  
  // Configuration
  distributionMethod: costDistributionMethodEnum("distribution_method").default('proportional'),
  isVisible: boolean("is_visible").default(true),
  
  // Metadata
  updatedBy: integer("updated_by").references(() => users.id),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Incoming Payments table for the new payment system
export const incomingPayments = pgTable("incoming_payments", {
  id: serial("id").primaryKey(),
  
  // Payment details
  paymentId: text("payment_id").notNull().unique(), // Unique identifier for each payment transaction (e.g., PAY-2024-001)
  dateReceived: timestamp("date_received").notNull(),
  payerInfo: text("payer_info").notNull(),
  totalAmount: decimal("total_amount", { precision: 15, scale: 2 }).notNull(),
  amountDistributed: decimal("amount_distributed", { precision: 15, scale: 2 }).default('0'),
  remainingBalance: decimal("remaining_balance", { precision: 15, scale: 2 }),
  distributionStatus: distributionStatusEnum("distribution_status").default('pending_distribution'),
  currency: text("currency").default('TL').notNull(),
  notes: text("notes"),
  
  // Metadata
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Payment Distributions table to link payments to procedures
export const paymentDistributions = pgTable("payment_distributions", {
  id: serial("id").primaryKey(),
  
  // Relationships
  incomingPaymentId: integer("incoming_payment_id").references(() => incomingPayments.id).notNull(),
  procedureReference: text("procedure_reference").notNull(),
  
  // Distribution details
  distributedAmount: decimal("distributed_amount", { precision: 15, scale: 2 }).notNull(),
  distributionDate: timestamp("distribution_date").notNull().defaultNow(),
  paymentType: paymentTypeEnum("payment_type").notNull(), // Whether this is an 'advance' or 'balance' payment for the procedure
  
  // Metadata
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const products = pgTable("products", {
  id: serial("id").primaryKey(),
  brand: text("brand"),
  style: text("style").unique(),
  category: text("category"),
  color: text("color"),
  item_description: text("item_description"),
  fabric_content: text("fabric_content"),
  country_of_origin: text("country_of_origin"),
  hts_code: text("hts_code"),
  tr_hs_code: text("tr_hs_code"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const hsCodes = pgTable("hs_codes", {
  tr_hs_code: text("tr_hs_code").primaryKey(),
  ex_registry_form: boolean("ex_registry_form").default(false),
  azo_dye_test: boolean("azo_dye_test").default(false),
  customs_tax_percent: decimal("customs_tax_percent", { precision: 5, scale: 4 }),
  additional_customs_tax_percent: decimal("additional_customs_tax_percent", { precision: 5, scale: 4 }),
  kkdf_percent: decimal("kkdf_percent", { precision: 5, scale: 4 }),
  vat_percent: decimal("vat_percent", { precision: 5, scale: 4 }),
  special_custom: boolean("special_custom").default(false),
  description_tr: text("description_tr"),
  unit: text("unit"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const taxCalculations = pgTable("tax_calculations", {
  id: serial("id").primaryKey(),
  reference: text("reference").notNull().unique(),
  invoice_no: text("invoice_no"),
  invoice_date: text("invoice_date"),
  total_value: decimal("total_value", { precision: 12, scale: 2 }).default('0'),
  total_quantity: integer("total_quantity").default(0),
  transport_cost: decimal("transport_cost", { precision: 12, scale: 2 }).default('0'),
  insurance_cost: decimal("insurance_cost", { precision: 12, scale: 2 }).default('0'),
  storage_cost: decimal("storage_cost", { precision: 12, scale: 2 }).default('0'),
  currency_rate: decimal("currency_rate", { precision: 8, scale: 4 }).default('0'),
  is_prepaid: boolean("is_prepaid").default(false),
  is_atr: boolean("is_atr").default(false),
  status: text("status").default('draft'),
  procedure_id: integer("procedure_id").references(() => procedures.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const taxCalculationItems = pgTable("tax_calculation_items", {
  id: serial("id").primaryKey(),
  tax_calculation_id: integer("tax_calculation_id").references(() => taxCalculations.id, { onDelete: 'cascade' }).notNull(),
  product_id: integer("product_id").references(() => products.id),
  line_number: integer("line_number").notNull(),
  style: text("style").notNull(),
  color: text("color"),
  category: text("category"),
  description: text("description"),
  fabric_content: text("fabric_content"),
  country_of_origin: text("country_of_origin"),
  hts_code: text("hts_code"),
  cost: decimal("cost", { precision: 10, scale: 2 }).notNull(),
  unit_count: integer("unit_count").notNull(),
  total_value: decimal("total_value", { precision: 12, scale: 2 }).notNull(),
  tr_hs_code: text("tr_hs_code"),
  transport_share: decimal("transport_share", { precision: 12, scale: 2 }).default('0'),
  insurance_share: decimal("insurance_share", { precision: 12, scale: 2 }).default('0'),
  storage_share: decimal("storage_share", { precision: 12, scale: 2 }).default('0'),
  cif_value: decimal("cif_value", { precision: 12, scale: 2 }).default('0'),
  customs_tax: decimal("customs_tax", { precision: 12, scale: 2 }).default('0'),
  additional_customs_tax: decimal("additional_customs_tax", { precision: 12, scale: 2 }).default('0'),
  kkdf: decimal("kkdf", { precision: 12, scale: 2 }).default('0'),
  vat_base: decimal("vat_base", { precision: 12, scale: 2 }).default('0'),
  vat: decimal("vat", { precision: 12, scale: 2 }).default('0'),
  total_tax_usd: decimal("total_tax_usd", { precision: 12, scale: 2 }).default('0'),
  total_tax_tl: decimal("total_tax_tl", { precision: 12, scale: 2 }).default('0'),
  requirements: text("requirements"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertImportExpenseSchema = createInsertSchema(importExpenses);
export const insertImportServiceInvoiceSchema = createInsertSchema(importServiceInvoices);
export const insertExpenseDocumentSchema = createInsertSchema(expenseDocuments);
export const insertProcedureStatusDetailSchema = createInsertSchema(procedureStatusDetails);
export const insertPaymentSchema = createInsertSchema(payments);
export const insertInvoiceLineItemSchema = createInsertSchema(invoiceLineItems).omit({ 
  finalCost: true, 
  finalCostPerItem: true, 
  costMultiplier: true 
});
export const insertInvoiceLineItemsConfigSchema = createInsertSchema(invoiceLineItemsConfig);
export const insertIncomingPaymentSchema = createInsertSchema(incomingPayments).omit({
  remainingBalance: true,
  amountDistributed: true,
  distributionStatus: true
});
export const insertPaymentDistributionSchema = createInsertSchema(paymentDistributions);
export const insertProductSchema = createInsertSchema(products);
export const insertHsCodeSchema = createInsertSchema(hsCodes);
export const insertTaxCalculationSchema = createInsertSchema(taxCalculations);
export const insertTaxCalculationItemSchema = createInsertSchema(taxCalculationItems).omit({
  transport_share: true,
  insurance_share: true,
  storage_share: true,
  cif_value: true,
  customs_tax: true,
  additional_customs_tax: true,
  kkdf: true,
  vat_base: true,
  vat: true,
  total_tax_usd: true,
  total_tax_tl: true,
  requirements: true
});

// Type definitions
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export type InsertProcedure = z.infer<typeof insertProcedureSchema>;
export type Procedure = typeof procedures.$inferSelect;

export type InsertTax = z.infer<typeof insertTaxSchema>;
export type Tax = typeof taxes.$inferSelect;

export type InsertProcedureDocument = z.infer<typeof insertProcedureDocumentSchema>;
export type ProcedureDocument = typeof procedureDocuments.$inferSelect;

export type InsertDocumentType = z.infer<typeof insertDocumentTypeSchema>;
export type DocumentType = typeof documentTypes.$inferSelect;

export type InsertProcedureComment = z.infer<typeof insertProcedureCommentSchema>;
export type ProcedureComment = typeof procedureComments.$inferSelect;

export type InsertProcedureActivity = z.infer<typeof insertProcedureActivitySchema>;
export type ProcedureActivity = typeof procedureActivities.$inferSelect;

export type InsertImportExpense = z.infer<typeof insertImportExpenseSchema>;
export type ImportExpense = typeof importExpenses.$inferSelect;

export type InsertImportServiceInvoice = z.infer<typeof insertImportServiceInvoiceSchema>;
export type ImportServiceInvoice = typeof importServiceInvoices.$inferSelect;

export type InsertExpenseDocument = z.infer<typeof insertExpenseDocumentSchema>;
export type ExpenseDocument = typeof expenseDocuments.$inferSelect;

export type InsertProcedureStatusDetail = z.infer<typeof insertProcedureStatusDetailSchema>;
export type ProcedureStatusDetail = typeof procedureStatusDetails.$inferSelect;

export type InsertPayment = z.infer<typeof insertPaymentSchema>;
export type Payment = typeof payments.$inferSelect;

export type InsertInvoiceLineItem = z.infer<typeof insertInvoiceLineItemSchema>;
export type InvoiceLineItem = typeof invoiceLineItems.$inferSelect;

export type InsertInvoiceLineItemsConfig = z.infer<typeof insertInvoiceLineItemsConfigSchema>;
export type InvoiceLineItemsConfig = typeof invoiceLineItemsConfig.$inferSelect;

export type InsertIncomingPayment = z.infer<typeof insertIncomingPaymentSchema>;
export type IncomingPayment = typeof incomingPayments.$inferSelect;

export type InsertPaymentDistribution = z.infer<typeof insertPaymentDistributionSchema>;
export type PaymentDistribution = typeof paymentDistributions.$inferSelect;

export type InsertProduct = z.infer<typeof insertProductSchema>;
export type Product = typeof products.$inferSelect;

export type InsertHsCode = z.infer<typeof insertHsCodeSchema>;
export type HsCode = typeof hsCodes.$inferSelect;

export type InsertTaxCalculation = z.infer<typeof insertTaxCalculationSchema>;
export type TaxCalculation = typeof taxCalculations.$inferSelect;

export type InsertTaxCalculationItem = z.infer<typeof insertTaxCalculationItemSchema>;
export type TaxCalculationItem = typeof taxCalculationItems.$inferSelect;

// Country code mappings table for beyanname export
export const countryCodeMappings = pgTable("country_code_mappings", {
  id: serial("id").primaryKey(),
  country_code_2: text("country_code_2").notNull().unique(),
  country_code_3: text("country_code_3").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCountryCodeMappingSchema = createInsertSchema(countryCodeMappings).omit({ id: true, createdAt: true });
export type InsertCountryCodeMapping = z.infer<typeof insertCountryCodeMappingSchema>;
export type CountryCodeMapping = typeof countryCodeMappings.$inferSelect;

// ATR customs rates table - stores customs tax percentages for HS codes when ATR is used
export const atrCustomsRates = pgTable("atr_customs_rates", {
  id: serial("id").primaryKey(),
  tr_hs_code: text("tr_hs_code").notNull().unique(),
  customs_tax_percent: decimal("customs_tax_percent", { precision: 5, scale: 4 }).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertAtrCustomsRateSchema = createInsertSchema(atrCustomsRates).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAtrCustomsRate = z.infer<typeof insertAtrCustomsRateSchema>;
export type AtrCustomsRate = typeof atrCustomsRates.$inferSelect;
