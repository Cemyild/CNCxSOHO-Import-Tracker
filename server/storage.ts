import { 
  users, documentTypes, procedureDocuments, procedures, procedureComments, procedureActivities, taxes, 
  importExpenses, importServiceInvoices, expenseDocuments, procedureStatusDetails, payments,
  invoiceLineItems, invoiceLineItemsConfig, costDistributionMethodEnum, incomingPayments, paymentDistributions,
  products, hsCodes, taxCalculations, taxCalculationItems, atrCustomsRates,
  type User, type InsertUser, 
  type Procedure, type InsertProcedure,
  type ProcedureDocument, type InsertProcedureDocument,
  type DocumentType, type InsertDocumentType,
  type ProcedureComment, type InsertProcedureComment,
  type ProcedureActivity, type InsertProcedureActivity,
  type Tax, type InsertTax,
  type ImportExpense, type InsertImportExpense,
  type ImportServiceInvoice, type InsertImportServiceInvoice,
  type ExpenseDocument, type InsertExpenseDocument,
  type ProcedureStatusDetail, type InsertProcedureStatusDetail,
  type Payment, type InsertPayment,
  type InvoiceLineItem, type InsertInvoiceLineItem,
  type InvoiceLineItemsConfig, type InsertInvoiceLineItemsConfig,
  type IncomingPayment, type InsertIncomingPayment,
  type PaymentDistribution, type InsertPaymentDistribution,
  type Product, type InsertProduct,
  type HsCode, type InsertHsCode,
  type TaxCalculation, type InsertTaxCalculation,
  type TaxCalculationItem, type InsertTaxCalculationItem,
  type AtrCustomsRate, type InsertAtrCustomsRate
} from "@shared/schema";

import { eq, and, or, SQL, inArray, sql, gte, lte, isNull, isNotNull, desc, asc, sum } from "drizzle-orm";
import { db } from "./db";

export interface IStorage {
  // User operations
  getUser(id: number): Promise<User | undefined>;
  getUserById(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getAllUsers(): Promise<User[]>;
  authenticateUser(username: string, password: string): Promise<User | null>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: number, user: Partial<InsertUser>): Promise<User | undefined>;
  updateUserLastLogin(id: number): Promise<void>;
  changeUserPassword(id: number, currentPassword: string, newPassword: string): Promise<boolean>;
  deleteUser(id: number): Promise<boolean>;
  
  // Procedure operations
  getProcedure(id: number): Promise<Procedure | undefined>;
  getAllProcedures(): Promise<Procedure[]>;
  getProceduresByUser(userId: number): Promise<Procedure[]>;
  getProceduresByStatus(statusType: string, statusValue: string): Promise<Procedure[]>;
  getProcedureByReference(reference: string): Promise<Procedure[]>;
  createProcedure(procedure: InsertProcedure): Promise<Procedure>;
  updateProcedure(id: number, procedure: Partial<InsertProcedure>): Promise<Procedure | undefined>;
  updateFreightAmount(reference: string, freightAmount: number): Promise<Procedure | undefined>;
  deleteProcedure(id: number): Promise<boolean>;
  
  // Procedure Status Details operations
  getProcedureStatusDetails(procedureReference: string): Promise<ProcedureStatusDetail[]>;
  getProcedureStatusDetailsByCategory(procedureReference: string, category: string): Promise<ProcedureStatusDetail[]>;
  upsertProcedureStatusDetail(statusDetail: InsertProcedureStatusDetail): Promise<ProcedureStatusDetail>;
  updateProcedureStatusDetails(procedureReference: string, category: string, statusList: InsertProcedureStatusDetail[]): Promise<ProcedureStatusDetail[]>;
  deleteProcedureStatusDetail(id: number): Promise<boolean>;
  
  // Tax operations
  getTax(id: number): Promise<Tax | undefined>;
  getTaxByProcedureReference(reference: string): Promise<Tax | undefined>;
  getAllTaxes(): Promise<Tax[]>;
  createTax(tax: InsertTax): Promise<Tax>;
  updateTax(id: number, tax: Partial<InsertTax>): Promise<Tax | undefined>;
  deleteTax(id: number): Promise<boolean>;
  
  // Import Expense operations
  getImportExpense(id: number): Promise<ImportExpense | undefined>;
  getImportExpensesByReference(reference: string): Promise<ImportExpense[]>;
  getImportExpensesByCategory(reference: string, category: string): Promise<ImportExpense[]>;
  createImportExpense(expense: InsertImportExpense): Promise<ImportExpense>;
  updateImportExpense(id: number, expense: Partial<InsertImportExpense>): Promise<ImportExpense | undefined>;
  deleteImportExpense(id: number): Promise<boolean>;
  getAllImportExpenses(): Promise<ImportExpense[]>;
  getExpensesByDateRange(startDate: Date, endDate: Date): Promise<ImportExpense[]>;
  getExpensesByCategoryAndDateRange(
    startDate: string | Date, 
    endDate: string | Date,
    procedureReferences?: string[]
  ): Promise<{ category: string; totalAmount: number; count: number; }[]>;
  
  // Import Service Invoice operations
  getImportServiceInvoice(id: number): Promise<ImportServiceInvoice | undefined>;
  getAllImportServiceInvoices(): Promise<ImportServiceInvoice[]>;
  getImportServiceInvoicesByReference(reference: string): Promise<ImportServiceInvoice[]>;
  createImportServiceInvoice(invoice: InsertImportServiceInvoice): Promise<ImportServiceInvoice>;
  updateImportServiceInvoice(id: number, invoice: Partial<InsertImportServiceInvoice>): Promise<ImportServiceInvoice | undefined>;
  deleteImportServiceInvoice(id: number): Promise<boolean>;
  
  // Expense Document operations
  getExpenseDocument(id: number): Promise<ExpenseDocument | undefined>;
  getExpenseDocumentsByExpense(expenseType: string, expenseId: number): Promise<ExpenseDocument[]>;
  getExpenseDocumentsByReference(reference: string): Promise<ExpenseDocument[]>;
  uploadExpenseDocument(document: InsertExpenseDocument): Promise<ExpenseDocument>;
  deleteExpenseDocument(id: number): Promise<boolean>;
  
  // Document operations
  getDocumentType(id: number): Promise<DocumentType | undefined>;
  getAllDocumentTypes(): Promise<DocumentType[]>;
  createDocumentType(documentType: InsertDocumentType): Promise<DocumentType>;
  deleteDocumentType(id: number): Promise<boolean>;
  
  uploadDocument(document: InsertProcedureDocument): Promise<ProcedureDocument>;
  getDocuments(procedureId: number): Promise<ProcedureDocument[]>;
  getDocument(id: number): Promise<ProcedureDocument | undefined>;
  deleteDocument(id: number): Promise<boolean>;
  
  // Comment operations
  createComment(comment: InsertProcedureComment): Promise<ProcedureComment>;
  getComments(procedureId: number): Promise<ProcedureComment[]>;
  deleteComment(id: number): Promise<boolean>;
  
  // Activity operations
  logActivity(activity: InsertProcedureActivity): Promise<ProcedureActivity>;
  getActivities(procedureId: number): Promise<ProcedureActivity[]>;
  
  // Payment operations
  getPayment(id: number): Promise<Payment | undefined>;
  getAllPayments(): Promise<Payment[]>;
  getPaymentsByProcedureReference(reference: string): Promise<Payment[]>;
  getPaymentsByType(paymentType: string): Promise<Payment[]>;
  createPayment(payment: InsertPayment): Promise<Payment>;
  updatePayment(id: number, payment: Partial<InsertPayment>): Promise<Payment | undefined>;
  deletePayment(id: number): Promise<boolean>;
  deleteAllPayments(): Promise<{ count: number; deletedPayments: Payment[] }>;
  calculateFinancialSummary(reference: string): Promise<{
    totalExpenses: number;
    advancePayments: number;
    balancePayments: number;
    totalPayments: number;
    remainingBalance: number;
  }>;

  // Invoice Line Item operations
  getInvoiceLineItemsByReference(reference: string): Promise<InvoiceLineItem[]>;
  getInvoiceLineItem(id: number): Promise<InvoiceLineItem | undefined>;
  createInvoiceLineItem(lineItem: InsertInvoiceLineItem): Promise<InvoiceLineItem>;
  createInvoiceLineItems(lineItems: InsertInvoiceLineItem[]): Promise<InvoiceLineItem[]>;
  bulkCreateInvoiceLineItems(lineItems: InsertInvoiceLineItem[]): Promise<InvoiceLineItem[]>;
  updateInvoiceLineItem(id: number, lineItem: Partial<InsertInvoiceLineItem>): Promise<InvoiceLineItem | undefined>;
  deleteInvoiceLineItem(id: number): Promise<boolean>;
  deleteAllInvoiceLineItems(reference: string): Promise<number>;
  
  // Calculate and update the cost factors for all line items
  calculateInvoiceLineItemCosts(reference: string): Promise<{
    totalLineItems: number;
    costMultiplier: number;
    success: boolean;
  }>;
  
  // Invoice Line Item Config operations
  getInvoiceLineItemsConfig(reference: string): Promise<InvoiceLineItemsConfig | undefined>;
  createOrUpdateInvoiceLineItemsConfig(config: InsertInvoiceLineItemsConfig): Promise<InvoiceLineItemsConfig>;
  
  // New Payment System - Incoming Payments Methods
  getAllIncomingPayments(): Promise<IncomingPayment[]>;
  getIncomingPayment(id: number): Promise<IncomingPayment | undefined>;
  getIncomingPaymentByPaymentId(paymentId: string): Promise<IncomingPayment | undefined>;
  createIncomingPayment(payment: InsertIncomingPayment): Promise<IncomingPayment>;
  updateIncomingPayment(id: number, payment: Partial<InsertIncomingPayment>): Promise<IncomingPayment | undefined>;
  deleteIncomingPayment(id: number): Promise<boolean>;
  
  // Payment Distribution Methods
  createPaymentDistribution(distribution: InsertPaymentDistribution): Promise<PaymentDistribution>;
  getPaymentDistributions(incomingPaymentId: number): Promise<PaymentDistribution[]>;
  getPaymentDistributionsByProcedure(procedureReference: string): Promise<PaymentDistribution[]>;
  deletePaymentDistribution(id: number): Promise<boolean>;
  deleteAllPaymentDistributions(): Promise<{ count: number }>;

  // Product operations
  getAllProducts(): Promise<Product[]>;
  getProduct(id: number): Promise<Product | undefined>;
  getProductByStyle(style: string): Promise<Product | undefined>;
  getProductByHtsCode(htsCode: string): Promise<Product[]>;
  createProduct(product: InsertProduct): Promise<Product>;
  updateProduct(id: number, product: Partial<InsertProduct>): Promise<Product | undefined>;
  deleteProduct(id: number): Promise<boolean>;

  // HS Code operations
  getAllHsCodes(): Promise<HsCode[]>;
  getHsCode(code: string): Promise<HsCode | undefined>;
  getHsCodesBatch(codes: string[]): Promise<HsCode[]>;
  createHsCode(hsCode: InsertHsCode): Promise<HsCode>;
  updateHsCode(code: string, hsCode: Partial<InsertHsCode>): Promise<HsCode | undefined>;
  deleteHsCode(code: string): Promise<boolean>;

  // Tax Calculation operations
  getAllTaxCalculations(): Promise<TaxCalculation[]>;
  getTaxCalculation(id: number): Promise<TaxCalculation | undefined>;
  createTaxCalculation(calculation: InsertTaxCalculation): Promise<TaxCalculation>;
  updateTaxCalculation(id: number, calculation: Partial<InsertTaxCalculation>): Promise<TaxCalculation | undefined>;
  deleteTaxCalculation(id: number): Promise<boolean>;

  // Tax Calculation Item operations
  getTaxCalculationItems(taxCalculationId: number): Promise<TaxCalculationItem[]>;
  getTaxCalculationItem(id: number): Promise<TaxCalculationItem | undefined>;
  createTaxCalculationItem(item: InsertTaxCalculationItem): Promise<TaxCalculationItem>;
  batchCreateTaxCalculationItems(items: InsertTaxCalculationItem[]): Promise<TaxCalculationItem[]>;
  updateTaxCalculationItem(id: number, item: Partial<TaxCalculationItem>): Promise<TaxCalculationItem | undefined>;
  batchUpdateTaxCalculationItems(updates: Array<{ id: number; data: Partial<TaxCalculationItem> }>): Promise<void>;
  deleteTaxCalculationItem(id: number): Promise<boolean>;

  // ATR Customs Rate operations
  getAtrCustomsRates(hsCodes: string[]): Promise<AtrCustomsRate[]>;
  getAtrCustomsRate(hsCode: string): Promise<AtrCustomsRate | undefined>;
  saveAtrCustomsRates(rates: InsertAtrCustomsRate[]): Promise<AtrCustomsRate[]>;
}

/**
 * PostgreSQL database storage implementation
 */
export class DatabaseStorage implements IStorage {
  async updateFreightAmount(reference: string, freightAmount: number): Promise<Procedure | undefined> {
    console.log("[DatabaseStorage.updateFreightAmount] Updating freight amount for procedure:", reference, "to", freightAmount);
    
    try {
      // First get the procedure to ensure it exists
      const procedureResult = await db.select().from(procedures).where(eq(procedures.reference, reference)).limit(1);
      
      if (!procedureResult || procedureResult.length === 0) {
        console.log("[DatabaseStorage.updateFreightAmount] ERROR: Cannot find procedure with reference:", reference);
        return undefined;
      }
      
      const currentProcedure = procedureResult[0];
      
      // Execute the update query
      const result = await db.update(procedures)
        .set({ 
          freight_amount: freightAmount.toString(),
          updatedAt: new Date()
        })
        .where(eq(procedures.reference, reference))
        .returning();
      
      if (result.length > 0) {
        console.log("[DatabaseStorage.updateFreightAmount] Update successful for procedure:", reference);
        
        await this.logActivity({
          procedureId: currentProcedure.id,
          userId: currentProcedure.createdBy,
          action: 'update',
          details: `Updated freight amount to ${freightAmount}`
        });
        
        return result[0];
      } else {
        console.log("[DatabaseStorage.updateFreightAmount] No rows updated or rows not returned");
        return undefined;
      }
    } catch (error) {
      console.error('[DatabaseStorage.updateFreightAmount] Error:', error);
      throw error;
    }
  }

  // User operations
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserById(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async createUser(user: InsertUser): Promise<User> {
    const [result] = await db.insert(users).values(user).returning();
    return result;
  }

  async updateUser(id: number, userData: Partial<InsertUser>): Promise<User | undefined> {
    const [result] = await db.update(users)
      .set({ ...userData, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return result;
  }

  async deleteUser(id: number): Promise<boolean> {
    const result = await db.delete(users).where(eq(users.id, id)).returning();
    return result.length > 0;
  }

  async getAllUsers(): Promise<User[]> {
    const result = await db.select().from(users).orderBy(users.createdAt);
    return result;
  }

  async authenticateUser(username: string, password: string): Promise<User | null> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    if (user && user.password === password) {
      return user;
    }
    return null;
  }

  async updateUserLastLogin(id: number): Promise<void> {
    await db.update(users)
      .set({ lastLogin: new Date() })
      .where(eq(users.id, id));
  }

  async changeUserPassword(id: number, currentPassword: string, newPassword: string): Promise<boolean> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    if (user && user.password === currentPassword) {
      await db.update(users)
        .set({ password: newPassword, updatedAt: new Date() })
        .where(eq(users.id, id));
      return true;
    }
    return false;
  }

  // Procedure operations
  async getProcedure(id: number): Promise<Procedure | undefined> {
    const [procedure] = await db.select().from(procedures).where(eq(procedures.id, id));
    return procedure;
  }

  async getAllProcedures(): Promise<Procedure[]> {
    return await db.select().from(procedures)
      .orderBy(
        // First order by: NULL dates come first (IS NULL DESC puts NULLs at top)
        sql`${procedures.import_dec_date} IS NULL DESC`,
        // Second order by: Non-NULL dates sorted newest to oldest (DESC)
        desc(procedures.import_dec_date)
      );
  }

  async getProceduresByUser(userId: number): Promise<Procedure[]> {
    return await db.select().from(procedures)
      .where(or(eq(procedures.assignedTo, userId), eq(procedures.createdBy, userId)));
  }

  async getProceduresByStatus(statusType: string, statusValue: string): Promise<Procedure[]> {
    if (statusType === 'document') {
      return await db.select().from(procedures)
        .where(eq(procedures.document_status, statusValue));
    } else if (statusType === 'payment') {
      return await db.select().from(procedures)
        .where(eq(procedures.payment_status, statusValue));
    } else if (statusType === 'shipment') {
      return await db.select().from(procedures)
        .where(eq(procedures.shipment_status, statusValue));
    }
    
    return [];
  }
  
  async getProcedureByReference(reference: string): Promise<Procedure[]> {
    return await db.select().from(procedures)
      .where(eq(procedures.reference, reference));
  }

  // Reset sequence helper function
  private async resetProcedureSequence(): Promise<void> {
    try {
      // Execute SQL to reset sequence to max id + 1
      await db.execute(`SELECT setval('procedures_id_seq', (SELECT MAX(id) FROM procedures) + 1, false)`);
      console.log("[storage] Procedures sequence has been reset successfully");
    } catch (error) {
      console.error("[storage] Error resetting procedures sequence:", error);
    }
  }

  async createProcedure(procedure: InsertProcedure): Promise<Procedure> {
    // Make sure we don't include id in the insert values to allow auto-increment
    const { id, ...procedureWithoutId } = procedure as InsertProcedure & { id?: number };
    
    try {
      // Ensure sequence is properly set before inserting
      await this.resetProcedureSequence();
      
      console.log("[storage.createProcedure] Creating procedure with data:", JSON.stringify(procedureWithoutId));
      const [result] = await db.insert(procedures).values(procedureWithoutId).returning();
      
      await this.logActivity({
        procedureId: result.id,
        userId: procedure.createdBy,
        action: 'create',
        details: `Procedure created: ${result.reference}`
      });
      
      return result;
    } catch (error) {
      console.error("[storage.createProcedure] Error creating procedure:", error);
      
      // Check if it's a duplicate key error
      if (error instanceof Error && error.message.includes('duplicate key')) {
        console.log("[storage.createProcedure] Duplicate key error detected, trying to reset sequence");
        await this.resetProcedureSequence();
      }
      
      throw error;
    }
  }

  async updateProcedure(id: number, procedureData: Partial<InsertProcedure>): Promise<Procedure | undefined> {
    console.log("[storage.updateProcedure] Updating procedure with ID:", id, "and data:", JSON.stringify(procedureData));
    
    try {
      // First, always get the procedure using the ID to ensure we have the right one
      const [currentProcedure] = await db.select().from(procedures).where(eq(procedures.id, id));
      
      if (!currentProcedure) {
        console.log("[storage.updateProcedure] ERROR: Cannot find procedure with ID:", id);
        return undefined;
      }
      
      console.log("[storage.updateProcedure] Found procedure to update:", JSON.stringify({
        id: currentProcedure.id,
        reference: currentProcedure.reference,
        shipment_status: currentProcedure.shipment_status,
        payment_status: currentProcedure.payment_status,
        document_status: currentProcedure.document_status
      }));
      
      // Create update data
      const updateData = { ...procedureData, updatedAt: new Date() };
      console.log("[storage.updateProcedure] Final update data:", JSON.stringify(updateData));
      
      // Execute the update query with explicit ID equality
      const [result] = await db.update(procedures)
        .set(updateData)
        .where(eq(procedures.id, id))
        .returning();
      
      if (result) {
        console.log("[storage.updateProcedure] Update successful, returned:", JSON.stringify({
          id: result.id,
          reference: result.reference,
          shipment_status: result.shipment_status,
          payment_status: result.payment_status,
          document_status: result.document_status
        }));
        
        await this.logActivity({
          procedureId: id,
          userId: procedureData.createdBy || currentProcedure.createdBy || 1,
          action: 'update',
          details: `Procedure updated: ${Object.keys(procedureData).join(', ')}`
        });
        
        // Compare old and new values for debug
        console.log("[storage.updateProcedure] Status changes:");
        if (procedureData.shipment_status) {
          console.log("  shipment_status:", currentProcedure.shipment_status, "->", procedureData.shipment_status);
        }
        if (procedureData.payment_status) {
          console.log("  payment_status:", currentProcedure.payment_status, "->", procedureData.payment_status);
        }
        if (procedureData.document_status) {
          console.log("  document_status:", currentProcedure.document_status, "->", procedureData.document_status);
        }
      } else {
        console.log("[storage.updateProcedure] No rows updated or rows not returned");
      }
      
      return result;
    } catch (error) {
      console.error("[storage.updateProcedure] Error:", error);
      throw error;
    }
  }

  async deleteProcedure(id: number): Promise<boolean> {
    // First get the procedure to log who deleted it (cache this info)
    const proc = await this.getProcedure(id);
    if (!proc) return false;
    
    // Manual Cascade Delete - Delete all related records first
    // 1. Delete procedure status details
    await db.delete(procedureStatusDetails).where(eq(procedureStatusDetails.procedureReference, proc.reference));

    // 2. Delete procedure documents
    await db.delete(procedureDocuments).where(eq(procedureDocuments.procedureId, id));

    // 3. Delete procedure comments
    await db.delete(procedureComments).where(eq(procedureComments.procedureId, id));

    // 4. Delete procedure activities
    await db.delete(procedureActivities).where(eq(procedureActivities.procedureId, id));

    // 5. Delete tax calculations and their items
    // First get related tax calculations to delete their items
    const taxCalcs = await db.select().from(taxCalculations).where(eq(taxCalculations.procedure_id, id));
    for (const calc of taxCalcs) {
      await db.delete(taxCalculationItems).where(eq(taxCalculationItems.tax_calculation_id, calc.id));
    }
    await db.delete(taxCalculations).where(eq(taxCalculations.procedure_id, id));

    // 6. Delete taxes (linked via reference)
    await db.delete(taxes).where(eq(taxes.procedureReference, proc.reference));

    // 7. Delete import expenses (linked via reference)
    // Also delete linked expense documents
    const expenses = await db.select().from(importExpenses).where(eq(importExpenses.procedureReference, proc.reference));
    for (const expense of expenses) {
       await db.delete(expenseDocuments).where(and(
         eq(expenseDocuments.expenseType, 'import_expense'),
         eq(expenseDocuments.expenseId, expense.id)
       ));
    }
    await db.delete(importExpenses).where(eq(importExpenses.procedureReference, proc.reference));
    
    // 8. Delete service invoices (linked via reference)
    const serviceInvoices = await db.select().from(importServiceInvoices).where(eq(importServiceInvoices.procedureReference, proc.reference));
    for (const invoice of serviceInvoices) {
       await db.delete(expenseDocuments).where(and(
         eq(expenseDocuments.expenseType, 'service_invoice'),
         eq(expenseDocuments.expenseId, invoice.id)
       ));
    }
    await db.delete(importServiceInvoices).where(eq(importServiceInvoices.procedureReference, proc.reference));

    // 9. Delete payments (linked via reference)
    await db.delete(payments).where(eq(payments.procedureReference, proc.reference));

    // 10. Delete payment distributions
    await db.delete(paymentDistributions).where(eq(paymentDistributions.procedureReference, proc.reference));

    // 11. Delete invoice line items and config
    await db.delete(invoiceLineItems).where(eq(invoiceLineItems.procedureReference, proc.reference));
    await db.delete(invoiceLineItemsConfig).where(eq(invoiceLineItemsConfig.procedureReference, proc.reference));

    // Finally, remove the procedure itself
    const result = await db.delete(procedures).where(eq(procedures.id, id)).returning();
    
    // We CANNOT log activity for a deleted procedure if the log relies on foreign key to procedure table.
    // So we skip logging to procedureActivities for this action.
    
    return result.length > 0;
  }
  
  // Procedure Status Details operations
  async getProcedureStatusDetails(procedureReference: string): Promise<ProcedureStatusDetail[]> {
    return db.select().from(procedureStatusDetails)
      .where(eq(procedureStatusDetails.procedureReference, procedureReference));
  }
  
  async getProcedureStatusDetailsByCategory(procedureReference: string, category: string): Promise<ProcedureStatusDetail[]> {
    return db.select().from(procedureStatusDetails)
      .where(and(
        eq(procedureStatusDetails.procedureReference, procedureReference),
        eq(procedureStatusDetails.category, category)
      ));
  }
  
  async upsertProcedureStatusDetail(statusDetail: InsertProcedureStatusDetail): Promise<ProcedureStatusDetail> {
    // Check if status already exists
    const [existing] = await db.select().from(procedureStatusDetails)
      .where(and(
        eq(procedureStatusDetails.procedureReference, statusDetail.procedureReference),
        eq(procedureStatusDetails.category, statusDetail.category),
        eq(procedureStatusDetails.status, statusDetail.status)
      ));
    
    if (existing) {
      // Update existing status
      const [result] = await db.update(procedureStatusDetails)
        .set({ 
          isActive: statusDetail.isActive,
          updatedBy: statusDetail.updatedBy,
          updatedAt: new Date()
        })
        .where(eq(procedureStatusDetails.id, existing.id))
        .returning();
      
      return result;
    } else {
      // Insert new status
      const [result] = await db.insert(procedureStatusDetails)
        .values({
          ...statusDetail,
          updatedAt: new Date()
        })
        .returning();
      
      return result;
    }
  }
  
  async updateProcedureStatusDetails(
    procedureReference: string, 
    category: string, 
    statusList: InsertProcedureStatusDetail[]
  ): Promise<ProcedureStatusDetail[]> {
    const results: ProcedureStatusDetail[] = [];
    
    // Process each status in the list
    for (const statusDetail of statusList) {
      const result = await this.upsertProcedureStatusDetail(statusDetail);
      results.push(result);
    }
    
    // Get all current statuses for this category and reference
    const [proc] = await db.select().from(procedures)
      .where(eq(procedures.reference, procedureReference));
    
    if (proc) {
      // Log activity
      await this.logActivity({
        procedureId: proc.id,
        userId: statusList[0]?.updatedBy || 1,
        action: 'status_update',
        details: `${category} status options updated for procedure ${procedureReference}`
      });
    }
    
    return results;
  }
  
  async deleteProcedureStatusDetail(id: number): Promise<boolean> {
    const [status] = await db.select().from(procedureStatusDetails)
      .where(eq(procedureStatusDetails.id, id));
    
    if (!status) return false;
    
    const result = await db.delete(procedureStatusDetails)
      .where(eq(procedureStatusDetails.id, id))
      .returning();
    
    if (result.length > 0 && status) {
      // Get procedure for activity logging
      const [proc] = await db.select().from(procedures)
        .where(eq(procedures.reference, status.procedureReference));
      
      if (proc) {
        await this.logActivity({
          procedureId: proc.id,
          userId: status.updatedBy || 1,
          action: 'status_delete',
          details: `Status '${status.status}' deleted from ${status.category} category`
        });
      }
    }
    
    return result.length > 0;
  }

  // Tax operations
  async getTax(id: number): Promise<Tax | undefined> {
    const [tax] = await db.select().from(taxes).where(eq(taxes.id, id));
    return tax;
  }

  async getTaxByProcedureReference(reference: string): Promise<Tax | undefined> {
    console.log(`[storage.getTaxByProcedureReference] Looking up tax for procedure reference: ${reference}`);
    
    // Use raw SQL query for consistency with our other tax-related queries
    const sqlQuery = `
      SELECT 
        id,
        customs_tax as "customsTax", 
        additional_customs_tax as "additionalCustomsTax", 
        kkdf, 
        vat, 
        stamp_tax as "stampTax", 
        procedure_reference as "procedureReference"
      FROM 
        taxes
      WHERE 
        procedure_reference = '${reference}'
    `;
    
    try {
      const rawResult = await db.execute(sql.raw(sqlQuery));
      console.log(`[storage.getTaxByProcedureReference] Raw SQL results structure:`, {
        hasRows: Boolean(rawResult.rows),
        rowsIsArray: Array.isArray(rawResult.rows),
        resultKeys: Object.keys(rawResult)
      });
      
      // The raw SQL result contains a rows property with the actual results
      const taxResults = rawResult.rows || [];
      
      // Check if we found any tax records
      if (taxResults.length === 0) {
        console.log(`[storage.getTaxByProcedureReference] No tax record found for procedure reference: ${reference}`);
        return undefined;
      }
      
      // Return the first tax record
      console.log(`[storage.getTaxByProcedureReference] Found tax record:`, taxResults[0]);
      return taxResults[0] as Tax;
    } catch (error) {
      console.error(`[storage.getTaxByProcedureReference] Error retrieving tax:`, error);
      throw error;
    }
  }
  
  async getAllTaxes(): Promise<Tax[]> {
    console.log(`[storage.getAllTaxes] Getting all tax records`);
    
    // Use a raw SQL query to be consistent with getTaxByProcedureReference
    const sqlQuery = `
      SELECT 
        id,
        customs_tax as "customsTax", 
        additional_customs_tax as "additionalCustomsTax", 
        kkdf, 
        vat, 
        stamp_tax as "stampTax", 
        procedure_reference as "procedureReference"
      FROM 
        taxes
    `;
    
    try {
      const rawResult = await db.execute(sql.raw(sqlQuery));
      
      // The raw SQL result contains a rows property with the actual results
      const taxResults = rawResult.rows || [];
      console.log(`[storage.getAllTaxes] Retrieved ${taxResults.length} tax records`);
      
      return taxResults as Tax[];
    } catch (error) {
      console.error(`[storage.getAllTaxes] Error retrieving all taxes:`, error);
      throw error;
    }
  }

  // Reset tax sequence helper function
  private async resetTaxSequence(): Promise<void> {
    try {
      // Execute SQL to reset sequence to max id + 1
      await db.execute(`SELECT setval('taxes_id_seq', (SELECT MAX(id) FROM taxes) + 1, false)`);
      console.log("[storage] Taxes sequence has been reset successfully");
    } catch (error) {
      console.error("[storage] Error resetting taxes sequence:", error);
    }
  }
  
  // Get tax analytics data
  async getTaxesByCategoryAndDateRange(startDate: string, endDate: string, procedureRefs?: string[]): Promise<any> {
    console.log(`[DatabaseStorage.getTaxesByCategoryAndDateRange] Getting tax totals by category`);
    console.log(`Date range: ${startDate} to ${endDate}`);
    console.log(`Procedure references: ${procedureRefs?.join(', ') || ''}`);
    
    try {
      // Import pool directly to avoid scope issues
      const { pool } = await import('./db');
      
      // Simpler approach - use direct string interpolation for dates
      // Validate date strings to ensure they are in YYYY-MM-DD format to prevent SQL injection
      if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
        throw new Error('Invalid date format. Dates must be in YYYY-MM-DD format.');
      }
      
      // Use direct string interpolation for dates to avoid parameter binding issues
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
      
      console.log(`[DEBUG] Executing procedures query:`, proceduresQuery);
      
      // Execute the query directly with the client
      const proceduresResult = await pool.query(proceduresQuery);
      const procedures = proceduresResult.rows || [];
      
      // If no procedures found, return empty result
      if (procedures.length === 0) {
        console.log("[DEBUG] No procedures found in date range");
        return {
          categories: 0,
          totalTaxAmount: 0,
          totalTaxCount: 0,
          data: []
        };
      }
      
      console.log(`[DEBUG] Found ${procedures.length} procedures with import_dec_date in range ${startDate} to ${endDate}`);
      const procedureReferences = procedures.map(p => p.reference);
      console.log(`[DEBUG] Querying taxes for ${procedureReferences.length} procedures: ${procedureReferences.join(', ')}`);
      
      // Safety check - if no procedures found, return empty result
      if (procedureReferences.length === 0) {
        return {
          categories: 0,
          totalTaxAmount: 0,
          totalTaxCount: 0,
          data: []
        };
      }
      
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
      
      console.log(`[DEBUG] Executing tax query for ${procedureReferences.length} procedures`);
      
      // Execute the query directly with the client
      const taxResult = await pool.query(taxQuery);
      const taxData = taxResult.rows || [];
      
      console.log(`[DEBUG] Found ${taxData.length} tax categories:`, taxData);
      
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
      console.error('[DatabaseStorage.getTaxesByCategoryAndDateRange] Error:', error);
      throw error;
    }
  }
  
  // Get tax trend data over time
  async getTaxTrendByCategory(category: string, startDate: string, endDate: string, groupBy: 'week' | 'month' = 'week'): Promise<any> {
    console.log(`[DatabaseStorage.getTaxTrendByCategory] Getting tax trend for category: ${category}`);
    console.log(`Date range: ${startDate} to ${endDate}, grouping by: ${groupBy}`);
    
    try {
      // Import pool directly to avoid scope issues
      const { pool } = await import('./db');
      
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
      
      console.log(`[DEBUG] Executing procedures query:`, proceduresQuery);
      const proceduresResult = await pool.query(proceduresQuery);
      const procedures = proceduresResult.rows || [];
      
      if (procedures.length === 0) {
        console.log("[DatabaseStorage.getTaxTrendByCategory] No procedures found in date range");
        return [];
      }
      
      const procedureReferences = procedures.map(p => p.reference);
      
      console.log(`[Trend API] Using procedure import declaration dates for ${procedureReferences.length} taxes in ${category} category`);
      
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
      
      console.log(`[DEBUG] Executing tax trend query for category ${category} with ${procedureReferences.length} references`);
      
      // Execute query directly with the pool
      const taxResult = await pool.query(taxQuery);
      const taxRecords = taxResult.rows || [];
      
      console.log(`[Trend API] Found ${taxRecords.length} taxes for category ${category}`);
      
      // If no records, return empty result
      if (taxRecords.length === 0) {
        return [];
      }
      
      // Calculate week number properly
      const getWeekNumber = (date: Date): number => {
        const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
        const pastDaysOfYear = (date.getTime() - firstDayOfYear.getTime()) / 86400000;
        return Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
      };
      
      // Group the data by week or month using standardized format
      const groupedData: Record<string, number> = {};
      
      taxRecords.forEach(record => {
        const date = new Date(record.date);
        let periodKey = '';
        
        if (groupBy === 'week') {
          // Use ISO week format: YYYY-Wnn
          const weekNumber = getWeekNumber(date);
          periodKey = `${date.getFullYear()}-W${weekNumber.toString().padStart(2, '0')}`;
        } else {
          // Use YYYY-MM format for months
          const month = date.getMonth() + 1;
          periodKey = `${date.getFullYear()}-${month.toString().padStart(2, '0')}`;
        }
        
        if (!groupedData[periodKey]) {
          groupedData[periodKey] = 0;
        }
        
        groupedData[periodKey] += parseFloat(record.amount || '0');
      });
      
      // Convert to array format expected by frontend
      const result = Object.entries(groupedData).map(([period, amount]) => ({
        period,
        amount,
        date: new Date() // Will be calculated correctly by the frontend
      }));
      
      return result;
    } catch (error) {
      console.error('[DatabaseStorage.getTaxTrendByCategory] Error:', error);
      throw error;
    }
  }

  async createTax(tax: InsertTax): Promise<Tax> {
    // Verify that the procedure reference exists first
    const [proc] = await db.select().from(procedures)
      .where(eq(procedures.reference, tax.procedureReference));
    
    if (!proc) {
      throw new Error(`Procedure with reference ${tax.procedureReference} does not exist`);
    }
    
    // First check if a tax record already exists for this procedure
    const existingTax = await this.getTaxByProcedureReference(tax.procedureReference);
    if (existingTax) {
      throw new Error(`Tax record already exists for procedure ${tax.procedureReference}. Use update instead.`);
    }
    
    try {
      // Reset sequence before insertion to avoid primary key conflicts
      await this.resetTaxSequence();
      
      // Make sure we don't include id in the insert values
      const { id, ...taxWithoutId } = tax as InsertTax & { id?: number };
      
      console.log("[storage.createTax] Creating tax record with data:", JSON.stringify(taxWithoutId));
      const [result] = await db.insert(taxes).values(taxWithoutId).returning();
      
      // Log activity
      await this.logActivity({
        procedureId: proc.id,
        userId: tax.createdBy || 1,
        action: 'tax_create',
        details: `Tax information added for procedure ${tax.procedureReference}`
      });
      
      return result;
    } catch (error) {
      console.error("[storage.createTax] Error creating tax record:", error);
      
      // Check if it's a duplicate key error
      if (error instanceof Error && error.message.includes('duplicate key')) {
        console.log("[storage.createTax] Duplicate key error detected, trying to reset sequence");
        await this.resetTaxSequence();
      }
      
      throw error;
    }
  }

  async updateTax(id: number, taxData: Partial<InsertTax>): Promise<Tax | undefined> {
    const [tax] = await db.select().from(taxes).where(eq(taxes.id, id));
    if (!tax) return undefined;
    
    const [result] = await db.update(taxes)
      .set({ ...taxData, updatedAt: new Date() })
      .where(eq(taxes.id, id))
      .returning();
    
    // Get procedure for activity logging
    const [proc] = await db.select().from(procedures)
      .where(eq(procedures.reference, tax.procedureReference));
    
    if (proc) {
      await this.logActivity({
        procedureId: proc.id,
        userId: taxData.createdBy || tax.createdBy || 1,
        action: 'tax_update',
        details: `Tax information updated for procedure ${tax.procedureReference}`
      });
    }
    
    return result;
  }

  async deleteTax(id: number): Promise<boolean> {
    const [tax] = await db.select().from(taxes).where(eq(taxes.id, id));
    if (!tax) return false;
    
    const result = await db.delete(taxes).where(eq(taxes.id, id)).returning();
    
    if (result.length > 0) {
      // Get procedure for activity logging
      const [proc] = await db.select().from(procedures)
        .where(eq(procedures.reference, tax.procedureReference));
      
      if (proc) {
        await this.logActivity({
          procedureId: proc.id,
          userId: tax.createdBy || 1,
          action: 'tax_delete',
          details: `Tax information deleted for procedure ${tax.procedureReference}`
        });
      }
    }
    
    return result.length > 0;
  }

  // Import Expense operations
  async getImportExpense(id: number): Promise<ImportExpense | undefined> {
    const [expense] = await db.select().from(importExpenses).where(eq(importExpenses.id, id));
    return expense;
  }

  async getImportExpensesByReference(reference: string): Promise<ImportExpense[]> {
    return db.select().from(importExpenses)
      .where(eq(importExpenses.procedureReference, reference));
  }

  async getImportExpensesByCategory(reference: string, category: string): Promise<ImportExpense[]> {
    return db.select().from(importExpenses)
      .where(and(
        eq(importExpenses.procedureReference, reference),
        eq(importExpenses.category, category)
      ));
  }

  async getAllImportExpenses(): Promise<ImportExpense[]> {
    try {
      console.log('[DatabaseStorage.getAllImportExpenses] Retrieving all import expenses');
      const result = await db.select().from(importExpenses);
      console.log(`[DatabaseStorage.getAllImportExpenses] Retrieved ${result.length} expenses`);
      return result;
    } catch (error) {
      console.error('[DatabaseStorage.getAllImportExpenses] Error retrieving import expenses:', error);
      // Return empty array instead of throwing to avoid breaking batch operations
      return [];
    }
  }

  async getExpensesByDateRange(startDate: Date, endDate: Date): Promise<ImportExpense[]> {
    return db.select().from(importExpenses)
      .where(and(
        gte(importExpenses.createdAt, startDate),
        lte(importExpenses.createdAt, endDate)
      ));
  }

  async getExpenseTrendData(
    category: string,
    startDate: string | Date,
    endDate: string | Date,
    groupBy: 'week' | 'month'
  ): Promise<{ period: string; amount: number; date: Date }[]> {
    console.log(`[getExpenseTrendData] Starting with category: ${category}, groupBy: ${groupBy}, date range: ${startDate} to ${endDate}`);
    
    // Helper functions defined inline to avoid import issues
    const getWeekNumber = (date: Date): number => {
      const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
      const pastDaysOfYear = (date.getTime() - firstDayOfYear.getTime()) / 86400000;
      return Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
    };
    
    const getDateOfWeek = (year: number, week: number): Date => {
      const firstDayOfYear = new Date(year, 0, 1);
      const daysOffset = firstDayOfYear.getDay() > 0 ? 7 - firstDayOfYear.getDay() : 0;
      const firstMonday = new Date(year, 0, 1 + daysOffset);
      return new Date(firstMonday.getTime() + (week - 1) * 7 * 86400000);
    };
    
    const formatPeriodLabel = (period: string, groupBy: 'week' | 'month'): string => {
      if (groupBy === 'week') {
        const [year, weekPart] = period.split('-');
        const weekNum = parseInt(weekPart.substring(1));
        const weekDate = getDateOfWeek(parseInt(year), weekNum);
        return `Week ${weekNum}, ${weekDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`;
      } else {
        const [year, month] = period.split('-');
        const date = new Date(parseInt(year), parseInt(month) - 1, 1);
        return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      }
    };
    
    try {
      // Convert dates to proper format if they're strings
      const start = typeof startDate === 'string' ? new Date(startDate) : startDate;
      const end = typeof endDate === 'string' ? new Date(endDate) : endDate;
      
      console.log(`[getExpenseTrendData] Converted date range: ${start.toISOString()} to ${end.toISOString()}`);
      
      // Get all expenses for this category within date range
      // Use drizzle query instead of raw SQL to ensure proper parameter handling
      console.log(`[getExpenseTrendData] Executing drizzle query for expenses with category: ${category}`);
      
      const expenses = await db.select({
        id: importExpenses.id,
        amount: importExpenses.amount,
        invoiceDate: importExpenses.invoiceDate,
        createdAt: importExpenses.createdAt
      })
      .from(importExpenses)
      .where(
        and(
          eq(importExpenses.category, category),
          or(
            and(
              isNotNull(importExpenses.invoiceDate),
              gte(importExpenses.invoiceDate, start),
              lte(importExpenses.invoiceDate, end)
            ),
            and(
              isNull(importExpenses.invoiceDate),
              gte(importExpenses.createdAt, start),
              lte(importExpenses.createdAt, end)
            )
          )
        )
      )
      .orderBy(asc(sql`COALESCE(${importExpenses.invoiceDate}, ${importExpenses.createdAt})`));
      
      // Map expenses array to the format we need for grouping
      const expensesFormatted = expenses.map(exp => {
        // Handle date safely
        let expenseDate = null;
        
        if (exp.invoiceDate) {
          expenseDate = new Date(exp.invoiceDate);
        } else if (exp.createdAt) {
          expenseDate = new Date(exp.createdAt);
        } else {
          console.log(`[getExpenseTrendData] Expense ${exp.id} has no valid date, skipping`);
        }
        
        return {
          id: exp.id,
          amount: exp.amount,
          date: expenseDate 
        };
      });
      
      console.log(`[getExpenseTrendData] Found ${expenses.length} expenses for category ${category}`);
      
      // Group by week or month
      const groupedData: Record<string, number> = {};
      
      expensesFormatted.forEach(expense => {
        // Skip if date is invalid
        if (!expense.date || isNaN(expense.date.getTime())) {
          console.log(`[getExpenseTrendData] Skipping expense with invalid date`);
          return;
        }
        
        let periodKey = '';
        
        if (groupBy === 'week') {
          // Get the week number
          const weekNum = getWeekNumber(expense.date);
          periodKey = `${expense.date.getFullYear()}-W${weekNum < 10 ? '0' + weekNum : weekNum}`;
        } else {
          // Format as YYYY-MM
          periodKey = `${expense.date.getFullYear()}-${(expense.date.getMonth() + 1).toString().padStart(2, '0')}`;
        }
        
        // Initialize if not already in the map
        if (!groupedData[periodKey]) {
          groupedData[periodKey] = 0;
        }
        
        // Add expense amount to the running total for this period
        const numericAmount = typeof expense.amount === 'string' 
          ? parseFloat(expense.amount) 
          : expense.amount;
        
        groupedData[periodKey] += numericAmount;
      });
      
      // Convert to array format needed for chart
      const resultData = Object.keys(groupedData)
        .sort() // Ensure chronological order
        .map(period => {
          // Parse the period string back to a Date
          let date;
          if (groupBy === 'week') {
            // Week format: YYYY-WNN
            const [year, weekPart] = period.split('-');
            const weekNum = parseInt(weekPart.substring(1));
            date = getDateOfWeek(parseInt(year), weekNum);
          } else {
            // Month format: YYYY-MM
            const [year, month] = period.split('-');
            date = new Date(parseInt(year), parseInt(month) - 1, 1);
          }
          
          return {
            period: formatPeriodLabel(period, groupBy),
            amount: groupedData[period],
            date: date
          };
        });
      
      console.log(`[getExpenseTrendData] Returning ${resultData.length} data points`);
      return resultData;
    } catch (error) {
      console.error('[getExpenseTrendData] Error retrieving expense trend data:', error);
      throw error; // Let the caller handle the error
    }
  }
  
  async getExpensesByCategoryAndDateRange(
    startDate: string | Date, 
    endDate: string | Date,
    procedureReferences?: string[]
  ): Promise<{ category: string; totalAmount: number; count: number; }[]> {
    try {
      console.log(`[DatabaseStorage.getExpensesByCategoryAndDateRange] Getting expense totals by category`);
      console.log(`Date range: ${startDate} to ${endDate}`);
      console.log(`Procedure references: ${procedureReferences ? procedureReferences.join(', ') : ''}`);
      
      // Convert dates to proper format if they're strings
      const start = typeof startDate === 'string' ? new Date(startDate) : startDate;
      const end = typeof endDate === 'string' ? new Date(endDate) : endDate;
      
      // Step 1: Get all procedures with import declaration dates in the selected range
      const proceduresInRange = await db.select({
        reference: procedures.reference
      })
      .from(procedures)
      .where(and(
        isNotNull(procedures.import_dec_date),
        gte(procedures.import_dec_date, start),
        lte(procedures.import_dec_date, end)
      ));
      
      console.log(`[DEBUG] Found ${proceduresInRange.length} procedures with import_dec_date in range ${start.toISOString()} to ${end.toISOString()}`);
      
      // Extract procedure references
      const procedureRefsInDateRange = proceduresInRange.map(p => p.reference);
      
      // If no procedures in range, return empty result
      if (procedureRefsInDateRange.length === 0) {
        console.log('[DEBUG] No procedures found in date range. Returning empty result.');
        return [];
      }
      
      // Step 2: Filter expense data based on the procedures we found
      // Additional procedure references filter if provided
      const finalProcedureRefs = procedureReferences && procedureReferences.length > 0 
        ? procedureRefsInDateRange.filter(ref => procedureReferences.includes(ref))
        : procedureRefsInDateRange;
      
      if (finalProcedureRefs.length === 0) {
        console.log('[DEBUG] No matching procedures after applying additional filters. Returning empty result.');
        return [];
      }
      
      console.log(`[DEBUG] Querying expenses for ${finalProcedureRefs.length} procedures: ${finalProcedureRefs.join(', ')}`);
      
      // Query expenses for these procedures
      const expensesQuery = await db
        .select({
          category: importExpenses.category,
          totalAmount: sql<string>`SUM(CAST(${importExpenses.amount} AS NUMERIC))`,
          count: sql<string>`COUNT(*)`
        })
        .from(importExpenses)
        .where(
          inArray(importExpenses.procedureReference, finalProcedureRefs)
        )
        .groupBy(importExpenses.category);
      
      console.log(`[DEBUG] Found ${expensesQuery.length} expense categories`);
      
      // Convert string amounts to numbers for consistent interface
      return expensesQuery.map(expense => ({
        category: expense.category,
        totalAmount: parseFloat(expense.totalAmount || '0'),
        count: parseInt(expense.count || '0', 10)
      }));
    } catch (error) {
      console.error(`[DatabaseStorage.getExpensesByCategoryAndDateRange] Error retrieving expense categories:`, error);
      return []; // Return empty array instead of throwing
    }
  }

  async createImportExpense(expense: InsertImportExpense): Promise<ImportExpense> {
    // Verify that the procedure reference exists first
    const [proc] = await db.select().from(procedures)
      .where(eq(procedures.reference, expense.procedureReference));
    
    if (!proc) {
      throw new Error(`Procedure with reference ${expense.procedureReference} does not exist`);
    }
    
    const [result] = await db.insert(importExpenses).values(expense).returning();
    
    // Log activity
    await this.logActivity({
      procedureId: proc.id,
      userId: expense.createdBy || 1,
      action: 'expense_create',
      details: `Import expense added: ${expense.category} - ${expense.amount} ${expense.currency}`
    });
    
    return result;
  }

  async updateImportExpense(id: number, expenseData: Partial<InsertImportExpense>): Promise<ImportExpense | undefined> {
    const [expense] = await db.select().from(importExpenses).where(eq(importExpenses.id, id));
    if (!expense) return undefined;
    
    const [result] = await db.update(importExpenses)
      .set({ ...expenseData, updatedAt: new Date() })
      .where(eq(importExpenses.id, id))
      .returning();
    
    // Get procedure for activity logging
    const [proc] = await db.select().from(procedures)
      .where(eq(procedures.reference, expense.procedureReference));
    
    if (proc) {
      await this.logActivity({
        procedureId: proc.id,
        userId: expenseData.createdBy || expense.createdBy || 1,
        action: 'expense_update',
        details: `Import expense updated: ${expense.category} - ${expense.amount} ${expense.currency}`
      });
    }
    
    return result;
  }

  async deleteImportExpense(id: number): Promise<boolean> {
    const [expense] = await db.select().from(importExpenses).where(eq(importExpenses.id, id));
    if (!expense) return false;
    
    const result = await db.delete(importExpenses).where(eq(importExpenses.id, id)).returning();
    
    if (result.length > 0) {
      // Get procedure for activity logging
      const [proc] = await db.select().from(procedures)
        .where(eq(procedures.reference, expense.procedureReference));
      
      if (proc) {
        await this.logActivity({
          procedureId: proc.id,
          userId: expense.createdBy || 1,
          action: 'expense_delete',
          details: `Import expense deleted: ${expense.category} - ${expense.amount} ${expense.currency}`
        });
      }
    }
    
    return result.length > 0;
  }

  // Import Service Invoice operations
  async getImportServiceInvoice(id: number): Promise<ImportServiceInvoice | undefined> {
    const [invoice] = await db.select().from(importServiceInvoices).where(eq(importServiceInvoices.id, id));
    return invoice;
  }

  async getAllImportServiceInvoices(): Promise<ImportServiceInvoice[]> {
    return db.select().from(importServiceInvoices);
  }

  async getImportServiceInvoicesByReference(reference: string): Promise<ImportServiceInvoice[]> {
    return db.select().from(importServiceInvoices)
      .where(eq(importServiceInvoices.procedureReference, reference));
  }

  async createImportServiceInvoice(invoice: InsertImportServiceInvoice): Promise<ImportServiceInvoice> {
    // Verify that the procedure reference exists first
    const [proc] = await db.select().from(procedures)
      .where(eq(procedures.reference, invoice.procedureReference));
    
    if (!proc) {
      throw new Error(`Procedure with reference ${invoice.procedureReference} does not exist`);
    }
    
    const [result] = await db.insert(importServiceInvoices).values(invoice).returning();
    
    // Log activity
    await this.logActivity({
      procedureId: proc.id,
      userId: invoice.createdBy || 1,
      action: 'invoice_create',
      details: `Import service invoice added: ${invoice.description} (${invoice.invoiceNumber})`
    });
    
    return result;
  }

  async updateImportServiceInvoice(id: number, invoiceData: Partial<InsertImportServiceInvoice>): Promise<ImportServiceInvoice | undefined> {
    const [invoice] = await db.select().from(importServiceInvoices).where(eq(importServiceInvoices.id, id));
    if (!invoice) return undefined;
    
    const [result] = await db.update(importServiceInvoices)
      .set({ ...invoiceData, updatedAt: new Date() })
      .where(eq(importServiceInvoices.id, id))
      .returning();
    
    // Get procedure for activity logging
    const [proc] = await db.select().from(procedures)
      .where(eq(procedures.reference, invoice.procedureReference));
    
    if (proc) {
      await this.logActivity({
        procedureId: proc.id,
        userId: invoiceData.createdBy || invoice.createdBy || 1,
        action: 'invoice_update',
        details: `Import service invoice updated: ${invoice.description} (${invoice.invoiceNumber})`
      });
    }
    
    return result;
  }

  async deleteImportServiceInvoice(id: number): Promise<boolean> {
    const [invoice] = await db.select().from(importServiceInvoices).where(eq(importServiceInvoices.id, id));
    if (!invoice) return false;
    
    const result = await db.delete(importServiceInvoices).where(eq(importServiceInvoices.id, id)).returning();
    
    if (result.length > 0) {
      // Get procedure for activity logging
      const [proc] = await db.select().from(procedures)
        .where(eq(procedures.reference, invoice.procedureReference));
      
      if (proc) {
        await this.logActivity({
          procedureId: proc.id,
          userId: invoice.createdBy || 1,
          action: 'invoice_delete',
          details: `Import service invoice deleted: ${invoice.description} (${invoice.invoiceNumber})`
        });
      }
    }
    
    return result.length > 0;
  }

  // Expense Document operations
  async getExpenseDocument(id: number): Promise<ExpenseDocument | undefined> {
    const [document] = await db.select().from(expenseDocuments).where(eq(expenseDocuments.id, id));
    return document;
  }

  async getExpenseDocumentsByExpense(expenseType: string, expenseId: number): Promise<ExpenseDocument[]> {
    return db.select().from(expenseDocuments)
      .where(and(
        eq(expenseDocuments.expenseType, expenseType),
        eq(expenseDocuments.expenseId, expenseId)
      ));
  }

  async getExpenseDocumentsByReference(reference: string): Promise<ExpenseDocument[]> {
    return db.select().from(expenseDocuments)
      .where(eq(expenseDocuments.procedureReference, reference));
  }

  async uploadExpenseDocument(document: InsertExpenseDocument): Promise<ExpenseDocument> {
    // Verify that the procedure reference exists first
    const [proc] = await db.select().from(procedures)
      .where(eq(procedures.reference, document.procedureReference));
    
    if (!proc) {
      throw new Error(`Procedure with reference ${document.procedureReference} does not exist`);
    }
    
    const [result] = await db.insert(expenseDocuments).values(document).returning();
    
    // Log activity
    await this.logActivity({
      procedureId: proc.id,
      userId: document.uploadedBy || 1,
      action: 'document_upload',
      details: `Expense document uploaded: ${document.filename}, type: ${document.expenseType}`
    });
    
    return result;
  }

  async deleteExpenseDocument(id: number): Promise<boolean> {
    const [document] = await db.select().from(expenseDocuments).where(eq(expenseDocuments.id, id));
    if (!document) return false;
    
    const result = await db.delete(expenseDocuments).where(eq(expenseDocuments.id, id)).returning();
    
    if (result.length > 0) {
      // Get procedure for activity logging
      const [proc] = await db.select().from(procedures)
        .where(eq(procedures.reference, document.procedureReference));
      
      if (proc) {
        await this.logActivity({
          procedureId: proc.id,
          userId: document.uploadedBy || 1,
          action: 'document_delete',
          details: `Expense document deleted: ${document.filename}, type: ${document.expenseType}`
        });
      }
    }
    
    return result.length > 0;
  }

  // Document operations
  async getDocumentType(id: number): Promise<DocumentType | undefined> {
    const [docType] = await db.select().from(documentTypes).where(eq(documentTypes.id, id));
    return docType;
  }

  async getAllDocumentTypes(): Promise<DocumentType[]> {
    return db.select().from(documentTypes);
  }

  async createDocumentType(documentType: InsertDocumentType): Promise<DocumentType> {
    const [result] = await db.insert(documentTypes).values(documentType).returning();
    return result;
  }

  async deleteDocumentType(id: number): Promise<boolean> {
    const result = await db.delete(documentTypes).where(eq(documentTypes.id, id)).returning();
    return result.length > 0;
  }

  async uploadDocument(document: InsertProcedureDocument): Promise<ProcedureDocument> {
    const [result] = await db.insert(procedureDocuments).values(document).returning();
    
    await this.logActivity({
      procedureId: document.procedureId,
      userId: document.uploadedBy,
      action: 'document_upload',
      details: `Procedure document uploaded: ${document.filename}`
    });
    
    return result;
  }

  async getDocuments(procedureId: number): Promise<ProcedureDocument[]> {
    return db.select().from(procedureDocuments).where(eq(procedureDocuments.procedureId, procedureId));
  }

  async getDocument(id: number): Promise<ProcedureDocument | undefined> {
    const [document] = await db.select().from(procedureDocuments).where(eq(procedureDocuments.id, id));
    return document;
  }

  async deleteDocument(id: number): Promise<boolean> {
    const [document] = await db.select().from(procedureDocuments).where(eq(procedureDocuments.id, id));
    if (!document) return false;
    
    const result = await db.delete(procedureDocuments).where(eq(procedureDocuments.id, id)).returning();
    
    if (result.length > 0) {
      await this.logActivity({
        procedureId: document.procedureId,
        userId: document.uploadedBy,
        action: 'document_delete',
        details: `Procedure document deleted: ${document.filename}`
      });
    }
    
    return result.length > 0;
  }

  // Comment operations
  async createComment(comment: InsertProcedureComment): Promise<ProcedureComment> {
    const [result] = await db.insert(procedureComments).values(comment).returning();
    
    await this.logActivity({
      procedureId: comment.procedureId,
      userId: comment.userId,
      action: 'comment_add',
      details: `Comment added to procedure`
    });
    
    return result;
  }

  async getComments(procedureId: number): Promise<ProcedureComment[]> {
    return db.select().from(procedureComments)
      .where(eq(procedureComments.procedureId, procedureId))
      .orderBy(desc(procedureComments.createdAt));
  }

  async deleteComment(id: number): Promise<boolean> {
    const [comment] = await db.select().from(procedureComments).where(eq(procedureComments.id, id));
    if (!comment) return false;
    
    const result = await db.delete(procedureComments).where(eq(procedureComments.id, id)).returning();
    
    if (result.length > 0) {
      await this.logActivity({
        procedureId: comment.procedureId,
        userId: comment.userId,
        action: 'comment_delete',
        details: `Comment deleted from procedure`
      });
    }
    
    return result.length > 0;
  }

  // Activity operations
  async logActivity(activity: InsertProcedureActivity): Promise<ProcedureActivity> {
    const [result] = await db.insert(procedureActivities).values(activity).returning();
    return result;
  }

  async getActivities(procedureId: number): Promise<ProcedureActivity[]> {
    return db.select().from(procedureActivities)
      .where(eq(procedureActivities.procedureId, procedureId))
      .orderBy(desc(procedureActivities.createdAt));
  }

  // Payment operations
  async getPayment(id: number): Promise<Payment | undefined> {
    const [payment] = await db.select().from(payments).where(eq(payments.id, id));
    return payment;
  }

  async getAllPayments(): Promise<Payment[]> {
    return db.select().from(payments);
  }

  async getPaymentsByProcedureReference(reference: string): Promise<Payment[]> {
    return db.select().from(payments)
      .where(eq(payments.procedureReference, reference));
  }

  async getPaymentsByType(paymentType: string): Promise<Payment[]> {
    return db.select().from(payments)
      .where(eq(payments.paymentType, paymentType));
  }

  async createPayment(payment: InsertPayment): Promise<Payment> {
    // Verify that the procedure reference exists first
    const [proc] = await db.select().from(procedures)
      .where(eq(procedures.reference, payment.procedureReference));
    
    if (!proc) {
      throw new Error(`Procedure with reference ${payment.procedureReference} does not exist`);
    }
    
    const [result] = await db.insert(payments).values(payment).returning();
    
    // Log activity
    await this.logActivity({
      procedureId: proc.id,
      userId: payment.createdBy || 1,
      action: 'payment_create',
      details: `Payment added: ${payment.description}, ${payment.amount} ${payment.paymentType}`
    });
    
    return result;
  }

  async updatePayment(id: number, paymentData: Partial<InsertPayment>): Promise<Payment | undefined> {
    const [payment] = await db.select().from(payments).where(eq(payments.id, id));
    if (!payment) return undefined;
    
    const [result] = await db.update(payments)
      .set({ ...paymentData, updatedAt: new Date() })
      .where(eq(payments.id, id))
      .returning();
    
    // Get procedure for activity logging
    const [proc] = await db.select().from(procedures)
      .where(eq(procedures.reference, payment.procedureReference));
    
    if (proc) {
      await this.logActivity({
        procedureId: proc.id,
        userId: paymentData.createdBy || payment.createdBy || 1,
        action: 'payment_update',
        details: `Payment updated: ${payment.description}, ${paymentData.amount || payment.amount} ${paymentData.paymentType || payment.paymentType}`
      });
    }
    
    return result;
  }

  async deletePayment(id: number): Promise<boolean> {
    const [payment] = await db.select().from(payments).where(eq(payments.id, id));
    if (!payment) return false;
    
    const result = await db.delete(payments).where(eq(payments.id, id)).returning();
    
    if (result.length > 0) {
      // Get procedure for activity logging
      const [proc] = await db.select().from(procedures)
        .where(eq(procedures.reference, payment.procedureReference));
      
      if (proc) {
        await this.logActivity({
          procedureId: proc.id,
          userId: payment.createdBy || 1,
          action: 'payment_delete',
          details: `Payment deleted: ${payment.description}, ${payment.amount} ${payment.paymentType}`
        });
      }
    }
    
    return result.length > 0;
  }
  
  async deleteAllPayments(): Promise<{ count: number; deletedPayments: Payment[] }> {
    try {
      console.log("[DatabaseStorage.deleteAllPayments] Starting deletion of all payments...");
      
      // First get all payments for logging purposes
      const allPayments = await db.select().from(payments);
      
      if (allPayments.length === 0) {
        console.log("[DatabaseStorage.deleteAllPayments] No payments found to delete");
        return { count: 0, deletedPayments: [] };
      }
      
      console.log(`[DatabaseStorage.deleteAllPayments] Found ${allPayments.length} payments to delete`);
      
      // Delete all payments
      const result = await db.delete(payments).returning();
      
      // Log activity for each procedure that had payments
      const procedureReferences = new Set<string>();
      allPayments.forEach(payment => procedureReferences.add(payment.procedureReference));
      
      // Get procedure IDs for all affected procedures
      const procedureList = await db.select().from(procedures)
        .where(inArray(procedures.reference, Array.from(procedureReferences)));
      
      // Create a map of procedure references to procedure IDs for quick lookup
      const procRefToIdMap = new Map<string, number>();
      procedureList.forEach(proc => procRefToIdMap.set(proc.reference, proc.id));
      
      // Log activity for each affected procedure
      for (const reference of procedureReferences) {
        const procId = procRefToIdMap.get(reference);
        if (procId) {
          const paymentsForProc = allPayments.filter(p => p.procedureReference === reference);
          
          await this.logActivity({
            procedureId: procId,
            userId: 1, // Admin user
            action: 'payment_delete_all',
            details: `All payments deleted (${paymentsForProc.length}) for procedure ${reference}`
          });
        }
      }
      
      console.log(`[DatabaseStorage.deleteAllPayments] Successfully deleted ${result.length} payments`);
      
      return { 
        count: result.length,
        deletedPayments: allPayments
      };
    } catch (error) {
      console.error("[DatabaseStorage.deleteAllPayments] Error deleting all payments:", error);
      throw error;
    }
  }
  
  // New Payment System - Incoming Payments Methods
  
  async getAllIncomingPayments(): Promise<IncomingPayment[]> {
    console.log('[storage] Getting all incoming payments');
    const payments = await db.select().from(incomingPayments).orderBy(desc(incomingPayments.dateReceived));
    console.log(`[storage] Found ${payments.length} incoming payments`);
    return payments;
  }
  
  async getIncomingPayment(id: number): Promise<IncomingPayment | undefined> {
    console.log(`[storage] Getting incoming payment with ID: ${id}`);
    const [payment] = await db.select().from(incomingPayments).where(eq(incomingPayments.id, id));
    console.log(`[storage] Payment found: ${payment ? 'Yes' : 'No'}`);
    return payment;
  }
  
  async getIncomingPaymentByPaymentId(paymentId: string): Promise<IncomingPayment | undefined> {
    console.log(`[storage] Getting incoming payment with payment ID: ${paymentId}`);
    const [payment] = await db.select().from(incomingPayments).where(eq(incomingPayments.paymentId, paymentId));
    console.log(`[storage] Payment found by payment ID: ${payment ? 'Yes' : 'No'}`);
    return payment;
  }
  
  async createIncomingPayment(payment: InsertIncomingPayment): Promise<IncomingPayment> {
    console.log('[storage] Creating new incoming payment:', payment);
    
    try {
      // Generate the remaining balance based on total amount
      const paymentData = {
        ...payment,
        remainingBalance: payment.totalAmount,
        amountDistributed: '0',
        distributionStatus: 'pending_distribution' as const
      };
      
      console.log('[storage] Prepared payment data:', paymentData);
      
      const result = await db.insert(incomingPayments).values(paymentData).returning();
      
      console.log('[storage] Insert result:', result);
      
      if (!result || result.length === 0) {
        console.error('[storage] ERROR: No result returned from insert operation');
        throw new Error('Failed to insert new payment - no result returned');
      }
      
      console.log('[storage] Successfully created incoming payment:', result[0]);
      
      // Skip activity logging for now since it requires a valid procedure ID
      // and incoming payments are not tied to specific procedures initially
      
      return result[0];
    } catch (error) {
      console.error('[storage] ERROR creating incoming payment:', error);
      throw error;
    }
  }
  
  async updateIncomingPayment(id: number, paymentData: Partial<IncomingPayment>): Promise<IncomingPayment | undefined> {
    const [payment] = await db.select().from(incomingPayments).where(eq(incomingPayments.id, id));
    if (!payment) return undefined;
    
    // Don't allow direct updates to these calculated fields
    delete paymentData.amountDistributed;
    delete paymentData.remainingBalance;
    delete paymentData.distributionStatus;
    
    const [result] = await db.update(incomingPayments)
      .set({ ...paymentData, updatedAt: new Date() })
      .where(eq(incomingPayments.id, id))
      .returning();
    
    // Skip activity logging for now since it requires a valid procedure ID
    
    return result;
  }
  
  async deleteIncomingPayment(id: number): Promise<boolean> {
    // First check if there are any distributions for this payment
    const distributions = await db.select().from(paymentDistributions)
      .where(eq(paymentDistributions.incomingPaymentId, id));
    
    if (distributions.length > 0) {
      throw new Error(`Cannot delete payment with ID ${id} because it has ${distributions.length} distributions. You must delete the distributions first.`);
    }
    
    const [payment] = await db.select().from(incomingPayments).where(eq(incomingPayments.id, id));
    if (!payment) return false;
    
    const result = await db.delete(incomingPayments).where(eq(incomingPayments.id, id)).returning();
    
    // Skip activity logging for now since it requires a valid procedure ID
    
    return result.length > 0;
  }
  
  // Payment Distributions Methods
  
  async getPaymentDistributions(incomingPaymentId: number): Promise<PaymentDistribution[]> {
    return db.select().from(paymentDistributions)
      .where(eq(paymentDistributions.incomingPaymentId, incomingPaymentId))
      .orderBy(desc(paymentDistributions.distributionDate));
  }
  
  async getPaymentDistributionsByProcedure(procedureReference: string): Promise<PaymentDistribution[]> {
    return db.select().from(paymentDistributions)
      .where(eq(paymentDistributions.procedureReference, procedureReference))
      .orderBy(desc(paymentDistributions.distributionDate));
  }
  
  async createPaymentDistribution(distribution: InsertPaymentDistribution): Promise<PaymentDistribution> {
    // First verify the procedure reference exists
    const [proc] = await db.select().from(procedures)
      .where(eq(procedures.reference, distribution.procedureReference));
    
    if (!proc) {
      throw new Error(`Procedure with reference ${distribution.procedureReference} does not exist`);
    }
    
    // Then verify the incoming payment exists
    const payment = await this.getIncomingPayment(distribution.incomingPaymentId);
    if (!payment) {
      throw new Error(`Incoming payment with ID ${distribution.incomingPaymentId} does not exist`);
    }
    
    // Insert the distribution
    const [result] = await db.insert(paymentDistributions).values(distribution).returning();
    
    // Update the incoming payment's distributed amount and status
    await this.updatePaymentDistributionStatus(payment.id);
    
    // Log activity
    await this.logActivity({
      procedureId: proc.id,
      userId: distribution.createdBy || 1,
      action: 'payment_distribution_create',
      details: `Payment distribution created: ${distribution.distributedAmount} distributed to procedure ${distribution.procedureReference} as ${distribution.paymentType} payment`
    });
    
    return result;
  }
  
  async updatePaymentDistributionStatus(paymentId: number): Promise<IncomingPayment | undefined> {
    // Get the payment
    const payment = await this.getIncomingPayment(paymentId);
    if (!payment) return undefined;
    
    // Get all distributions for this payment
    const distributions = await this.getPaymentDistributions(paymentId);
    
    // Calculate total distributed amount
    const totalDistributed = distributions.reduce((sum, dist) => {
      const amount = typeof dist.distributedAmount === 'string' 
        ? parseFloat(dist.distributedAmount) 
        : Number(dist.distributedAmount);
      return sum + amount;
    }, 0);
    
    // Convert payment.totalAmount to a number for comparison
    const totalAmount = typeof payment.totalAmount === 'string'
      ? parseFloat(payment.totalAmount)
      : Number(payment.totalAmount);
    
    // Calculate remaining balance
    const remainingBalance = Math.max(0, totalAmount - totalDistributed);
    
    // Determine distribution status
    let distributionStatus: 'pending_distribution' | 'partially_distributed' | 'fully_distributed';
    
    if (totalDistributed <= 0) {
      distributionStatus = 'pending_distribution';
    } else if (Math.abs(remainingBalance) < 0.01) { // Using a small epsilon to handle floating point errors
      distributionStatus = 'fully_distributed';
    } else {
      distributionStatus = 'partially_distributed';
    }
    
    // Update the payment
    const [result] = await db.update(incomingPayments)
      .set({
        amountDistributed: totalDistributed.toFixed(2),
        remainingBalance: remainingBalance.toFixed(2),
        distributionStatus,
        updatedAt: new Date()
      })
      .where(eq(incomingPayments.id, paymentId))
      .returning();
    
    return result;
  }
  
  async deletePaymentDistribution(id: number): Promise<boolean> {
    console.log(`[storage.deletePaymentDistribution] Attempting to delete distribution with ID: ${id}`);
    
    // First get the distribution to be deleted
    const [distribution] = await db.select().from(paymentDistributions).where(eq(paymentDistributions.id, id));
    
    if (!distribution) {
      console.log(`[storage.deletePaymentDistribution] Distribution with ID ${id} not found`);
      return false;
    }
    
    console.log(`[storage.deletePaymentDistribution] Found distribution:`, distribution);
    
    try {
      // Delete the distribution
      const result = await db.delete(paymentDistributions).where(eq(paymentDistributions.id, id)).returning();
      
      console.log(`[storage.deletePaymentDistribution] Deletion result:`, result);
      
      if (result.length > 0) {
        console.log(`[storage.deletePaymentDistribution] Successfully deleted distribution, updating payment status...`);
        
        // Update the incoming payment's distributed amount and status
        const updatedPayment = await this.updatePaymentDistributionStatus(distribution.incomingPaymentId);
        console.log(`[storage.deletePaymentDistribution] Updated payment status:`, updatedPayment);
        
        // Get procedure for activity logging
        const [proc] = await db.select().from(procedures)
          .where(eq(procedures.reference, distribution.procedureReference));
        
        if (proc) {
          await this.logActivity({
            procedureId: proc.id,
            userId: distribution.createdBy || 1,
            action: 'payment_distribution_delete',
            details: `Payment distribution deleted: ${distribution.distributedAmount} was withdrawn from procedure ${distribution.procedureReference}`
          });
          console.log(`[storage.deletePaymentDistribution] Activity logged for procedure ${distribution.procedureReference}`);
        }
        
        return true;
      } else {
        console.log(`[storage.deletePaymentDistribution] No rows were deleted. Delete operation failed.`);
        return false;
      }
    } catch (error) {
      console.error(`[storage.deletePaymentDistribution] Error deleting distribution:`, error);
      throw error;
    }
  }
  
  // Method to delete all payment distributions and reset incoming payments
  async deleteAllPaymentDistributions(): Promise<{ count: number; deletedDistributions: PaymentDistribution[] }> {
    try {
      console.log("[DatabaseStorage.deleteAllPaymentDistributions] Starting deletion of all payment distributions...");
      
      // First get all distributions for logging purposes
      const allDistributions = await db.select().from(paymentDistributions);
      
      if (allDistributions.length === 0) {
        console.log("[DatabaseStorage.deleteAllPaymentDistributions] No payment distributions found to delete");
        return { count: 0, deletedDistributions: [] };
      }
      
      // Delete all distributions
      const result = await db.delete(paymentDistributions).returning();
      
      console.log(`[DatabaseStorage.deleteAllPaymentDistributions] Deleted ${result.length} payment distributions`);
      
      // Get all incoming payments and reset their distribution status
      const allPayments = await db.select().from(incomingPayments);
      
      for (const payment of allPayments) {
        await db.update(incomingPayments)
          .set({
            amountDistributed: '0',
            remainingBalance: payment.totalAmount,
            distributionStatus: 'pending_distribution',
            updatedAt: new Date()
          })
          .where(eq(incomingPayments.id, payment.id));
      }
      
      // Collect procedure references for logging purposes
      const procedureRefs = new Set<string>();
      allDistributions.forEach(d => procedureRefs.add(d.procedureReference));
      
      // Skip activity logging for reset since it's a system-wide operation
      // and doesn't need to be attached to specific procedures
      
      return { 
        count: result.length, 
        deletedDistributions: allDistributions 
      };
    } catch (error) {
      console.error("[DatabaseStorage.deleteAllPaymentDistributions] Error deleting payment distributions:", error);
      throw error;
    }
  }

  async calculateFinancialSummary(reference: string): Promise<{
    totalExpenses: number;
    importExpenses: number;
    serviceInvoices: number;
    taxes: number;
    advancePayments: number;
    balancePayments: number;
    totalPayments: number;
    remainingBalance: number;
    distributedPayments?: number; // New field for tracking distributions
  }> {
    try {
      console.log(`[calculateFinancialSummary] Calculating financial summary for ${reference}`);
      
      // 1. Get import expenses for this procedure
      const expenses = await this.getImportExpensesByReference(reference);
      const importExpenses = expenses.reduce((sum, expense) => sum + parseFloat(expense.amount), 0);
      
      // 2. Get service invoices for this procedure
      const serviceInvoices = await this.getImportServiceInvoicesByReference(reference);
      const totalServiceInvoices = serviceInvoices.reduce((sum, invoice) => sum + parseFloat(invoice.amount), 0);
      
      // 3. Get tax data for this procedure
      const taxData = await this.getTaxByProcedureReference(reference);
      let totalTaxes = 0;
      
      if (taxData) {
        totalTaxes = 
          parseFloat(taxData.customsTax || '0') + 
          parseFloat(taxData.additionalCustomsTax || '0') + 
          parseFloat(taxData.kkdf || '0') + 
          parseFloat(taxData.vat || '0') + 
          parseFloat(taxData.stampTax || '0');
      }
      
      // 4. Calculate total expenses (sum of all three categories)
      const totalExpenses = importExpenses + totalServiceInvoices + totalTaxes;
      
      // 5. Get all payments for this procedure from both the traditional payments table
      //    and the new payment distributions system
      const traditionalPayments = await this.getPaymentsByProcedureReference(reference);
      
      // Get distributed payments for this procedure
      const distributions = await this.getPaymentDistributionsByProcedure(reference);
      
      console.log(`[calculateFinancialSummary] Found ${traditionalPayments.length} traditional payments and ${distributions.length} payment distributions for ${reference}`);
      
      // 6. Calculate advance payments (type === 'advance')
      const traditionalAdvancePayments = traditionalPayments
        .filter(payment => payment.paymentType === 'advance')
        .reduce((sum, payment) => sum + parseFloat(payment.amount), 0);
      
      const distributedAdvancePayments = distributions
        .filter(dist => dist.paymentType === 'advance')
        .reduce((sum, dist) => {
          const amount = typeof dist.distributedAmount === 'string'
            ? parseFloat(dist.distributedAmount)
            : Number(dist.distributedAmount);
          return sum + amount;
        }, 0);
      
      const advancePayments = traditionalAdvancePayments + distributedAdvancePayments;
      
      // 7. Calculate balance payments (type === 'balance')
      const traditionalBalancePayments = traditionalPayments
        .filter(payment => payment.paymentType === 'balance')
        .reduce((sum, payment) => sum + parseFloat(payment.amount), 0);
      
      const distributedBalancePayments = distributions
        .filter(dist => dist.paymentType === 'balance')
        .reduce((sum, dist) => {
          const amount = typeof dist.distributedAmount === 'string'
            ? parseFloat(dist.distributedAmount)
            : Number(dist.distributedAmount);
          return sum + amount;
        }, 0);
      
      const balancePayments = traditionalBalancePayments + distributedBalancePayments;
      
      // 8. Calculate total payments (including distributions)
      const totalTraditionalPayments = traditionalAdvancePayments + traditionalBalancePayments;
      const totalDistributedPayments = distributedAdvancePayments + distributedBalancePayments;
      const totalPayments = totalTraditionalPayments + totalDistributedPayments;
      
      // 9. Calculate remaining balance
      const remainingBalance = totalExpenses - totalPayments;
      
      console.log(`[calculateFinancialSummary] Financial summary for ${reference}:`, {
        totalExpenses,
        importExpenses,
        totalServiceInvoices,
        totalTaxes,
        traditionalAdvancePayments,
        traditionalBalancePayments,
        distributedAdvancePayments,
        distributedBalancePayments,
        totalTraditionalPayments,
        totalDistributedPayments,
        totalPayments,
        remainingBalance
      });
      
      return {
        totalExpenses,
        importExpenses,
        serviceInvoices: totalServiceInvoices,
        taxes: totalTaxes,
        advancePayments,
        balancePayments,
        totalPayments,
        remainingBalance,
        distributedPayments: totalDistributedPayments // Include distributed payments total
      };
    } catch (error) {
      console.error(`[calculateFinancialSummary] Error calculating financial summary for ${reference}:`, error);
      // Return zeros if calculation fails
      return {
        totalExpenses: 0,
        importExpenses: 0,
        serviceInvoices: 0,
        taxes: 0,
        advancePayments: 0,
        balancePayments: 0,
        totalPayments: 0,
        remainingBalance: 0
      };
    }
  }

  // Invoice Line Item operations
  async getInvoiceLineItemsByReference(reference: string): Promise<InvoiceLineItem[]> {
    try {
      console.log(`[DatabaseStorage.getInvoiceLineItemsByReference] Getting line items for procedure ${reference}`);
      
      // Explicitly order by sortOrder if available
      const result = await db.select().from(invoiceLineItems)
        .where(eq(invoiceLineItems.procedureReference, reference))
        .orderBy(
          // Use a compound ordering that respects sortOrder if available, then falls back to createdAt, then id
          sql`COALESCE(${invoiceLineItems.sortOrder}, 9999999)`,
          invoiceLineItems.createdAt,
          invoiceLineItems.id
        );
      
      // For debugging purposes, log the item order
      if (result.length > 0 && result.length < 20) { // Only log if there's a reasonable number of items
        console.log(`[ORDER_DEBUG] getInvoiceLineItemsByReference returned items in order: ${result.map(item => `ID:${item.id}, sortOrder:${item.sortOrder}, desc:${item.description?.substring(0, 15)}`).join(' -> ')}`);
      } else {
        console.log(`[DatabaseStorage.getInvoiceLineItemsByReference] Found ${result.length} line items for procedure ${reference}`);
      }
      
      return result;
    } catch (error) {
      console.error(`[DatabaseStorage.getInvoiceLineItemsByReference] Error getting line items for procedure ${reference}:`, error);
      return [];
    }
  }

  async getInvoiceLineItem(id: number): Promise<InvoiceLineItem | undefined> {
    try {
      console.log(`[DatabaseStorage.getInvoiceLineItem] Getting line item with ID ${id}`);
      const [result] = await db.select().from(invoiceLineItems).where(eq(invoiceLineItems.id, id));
      return result;
    } catch (error) {
      console.error(`[DatabaseStorage.getInvoiceLineItem] Error getting line item:`, error);
      return undefined;
    }
  }

  async createInvoiceLineItem(lineItem: InsertInvoiceLineItem): Promise<InvoiceLineItem> {
    try {
      console.log(`[DatabaseStorage.createInvoiceLineItem] Creating new line item for procedure ${lineItem.procedureReference}`);
      
      // Verify the procedure exists
      const [proc] = await db.select().from(procedures)
        .where(eq(procedures.reference, lineItem.procedureReference));
      
      if (!proc) {
        throw new Error(`Procedure with reference ${lineItem.procedureReference} does not exist`);
      }
      
      // Get the highest sort order for this procedure to ensure new items are added at the end
      const existingItems = await this.getInvoiceLineItemsByReference(lineItem.procedureReference);
      let maxSortOrder = 0;
      
      if (existingItems.length > 0) {
        // Find the highest sortOrder value
        maxSortOrder = existingItems.reduce((max, item) => {
          const sortOrder = item.sortOrder !== null ? item.sortOrder : 0;
          return sortOrder > max ? sortOrder : max;
        }, 0);
      }
      
      // Set sort order one higher than the current max
      const nextSortOrder = maxSortOrder + 1;
      
      // Create the line item
      const [result] = await db.insert(invoiceLineItems)
        .values({
          ...lineItem,
          sortOrder: nextSortOrder,
          createdAt: new Date(),
          updatedAt: new Date()
        })
        .returning();
      
      console.log(`[DatabaseStorage.createInvoiceLineItem] Created line item with ID ${result.id} and sortOrder ${nextSortOrder}`);
      return result;
    } catch (error) {
      console.error(`[DatabaseStorage.createInvoiceLineItem] Error creating line item:`, error);
      throw error;
    }
  }

  async createInvoiceLineItems(lineItems: InsertInvoiceLineItem[]): Promise<InvoiceLineItem[]> {
    try {
      console.log(`[DatabaseStorage.createInvoiceLineItems] Creating ${lineItems.length} new line items`);
      
      if (lineItems.length === 0) {
        return [];
      }
      
      // All items should have the same procedure reference
      const procedureReference = lineItems[0].procedureReference;
      
      // Get the highest sort order for this procedure to ensure new items are added sequentially
      const existingItems = await this.getInvoiceLineItemsByReference(procedureReference);
      let maxSortOrder = 0;
      
      if (existingItems.length > 0) {
        // Find the highest sortOrder value
        maxSortOrder = existingItems.reduce((max, item) => {
          const sortOrder = item.sortOrder !== null ? item.sortOrder : 0;
          return sortOrder > max ? sortOrder : max;
        }, 0);
      }
      
      // Prepare the items with timestamps and sequential sort orders
      const itemsWithSortOrder = lineItems.map((item, index) => ({
        ...item,
        sortOrder: maxSortOrder + index + 1, // Start from maxSortOrder + 1 and increment
        createdAt: new Date(),
        updatedAt: new Date()
      }));
      
      // Insert all items
      const result = await db.insert(invoiceLineItems)
        .values(itemsWithSortOrder)
        .returning();
      
      console.log(`[DatabaseStorage.createInvoiceLineItems] Created ${result.length} line items with sequential sort orders starting at ${maxSortOrder + 1}`);
      return result;
    } catch (error) {
      console.error(`[DatabaseStorage.createInvoiceLineItems] Error creating line items:`, error);
      throw error;
    }
  }
  
  // Alias for createInvoiceLineItems to support existing code using bulkCreateInvoiceLineItems
  async bulkCreateInvoiceLineItems(lineItems: InsertInvoiceLineItem[]): Promise<InvoiceLineItem[]> {
    try {
      console.log(`[DatabaseStorage.bulkCreateInvoiceLineItems] Bulk creating ${lineItems.length} line items`);
      
      // Validate that we have all required fields for each item
      for (const item of lineItems) {
        if (!item.procedureReference) {
          throw new Error("Each line item must have a procedureReference");
        }
        
        if (!item.description) {
          throw new Error("Each line item must have a description");
        }
        
        if (!item.quantity || !item.unitPrice) {
          throw new Error("Each line item must have quantity and unitPrice");
        }
        
        // Calculate totalPrice if not provided
        if (!item.totalPrice) {
          item.totalPrice = (parseFloat(item.quantity) * parseFloat(item.unitPrice)).toString();
        }
      }
      
      // Use the existing createInvoiceLineItems method to handle the bulk creation
      return await this.createInvoiceLineItems(lineItems);
    } catch (error) {
      console.error(`[DatabaseStorage.bulkCreateInvoiceLineItems] Error bulk creating line items:`, error);
      throw error;
    }
  }

  async updateInvoiceLineItem(id: number, lineItem: Partial<InsertInvoiceLineItem>): Promise<InvoiceLineItem | undefined> {
    try {
      console.log(`[DatabaseStorage.updateInvoiceLineItem] Updating line item with ID ${id}`);
      
      // Get the existing line item
      const [existing] = await db.select().from(invoiceLineItems).where(eq(invoiceLineItems.id, id));
      
      if (!existing) {
        console.log(`[DatabaseStorage.updateInvoiceLineItem] Line item with ID ${id} not found`);
        return undefined;
      }
      
      // Update the line item
      const [result] = await db.update(invoiceLineItems)
        .set({
          ...lineItem,
          updatedAt: new Date()
        })
        .where(eq(invoiceLineItems.id, id))
        .returning();
      
      console.log(`[DatabaseStorage.updateInvoiceLineItem] Updated line item with ID ${id}`);
      return result;
    } catch (error) {
      console.error(`[DatabaseStorage.updateInvoiceLineItem] Error updating line item:`, error);
      return undefined;
    }
  }

  async deleteInvoiceLineItem(id: number): Promise<boolean> {
    try {
      console.log(`[DatabaseStorage.deleteInvoiceLineItem] Deleting line item with ID ${id}`);
      
      const result = await db.delete(invoiceLineItems)
        .where(eq(invoiceLineItems.id, id))
        .returning();
      
      return result.length > 0;
    } catch (error) {
      console.error(`[DatabaseStorage.deleteInvoiceLineItem] Error deleting line item:`, error);
      return false;
    }
  }
  
  async deleteAllInvoiceLineItems(reference: string): Promise<number> {
    try {
      console.log(`[DatabaseStorage.deleteAllInvoiceLineItems] Deleting all line items for procedure ${reference}`);
      
      const result = await db.delete(invoiceLineItems)
        .where(eq(invoiceLineItems.procedureReference, reference))
        .returning();
      
      const deletedCount = result.length;
      console.log(`[DatabaseStorage.deleteAllInvoiceLineItems] Deleted ${deletedCount} line items for procedure ${reference}`);
      return deletedCount;
    } catch (error) {
      console.error(`[DatabaseStorage.deleteAllInvoiceLineItems] Error deleting line items for procedure ${reference}:`, error);
      throw error;
    }
  }

  async getInvoiceLineItemsConfig(reference: string): Promise<InvoiceLineItemsConfig | undefined> {
    try {
      console.log(`[DatabaseStorage.getInvoiceLineItemsConfig] Getting config for procedure ${reference}`);
      const [result] = await db.select().from(invoiceLineItemsConfig)
        .where(eq(invoiceLineItemsConfig.procedureReference, reference));
      
      return result; 
    } catch (error) {
      console.error(`[DatabaseStorage.getInvoiceLineItemsConfig] Error getting config for procedure ${reference}:`, error);
      return undefined;
    }
  }

  async createOrUpdateInvoiceLineItemsConfig(config: InsertInvoiceLineItemsConfig): Promise<InvoiceLineItemsConfig> {
    try {
      console.log(`[DatabaseStorage.createOrUpdateInvoiceLineItemsConfig] Creating/updating config for procedure ${config.procedureReference}`);
      
      // Check if config already exists
      const [existing] = await db.select().from(invoiceLineItemsConfig)
        .where(eq(invoiceLineItemsConfig.procedureReference, config.procedureReference));
      
      if (existing) {
        // Update existing config
        const [result] = await db.update(invoiceLineItemsConfig)
          .set({
            distributionMethod: config.distributionMethod,
            updatedBy: config.updatedBy,
            updatedAt: new Date()
          })
          .where(eq(invoiceLineItemsConfig.id, existing.id))
          .returning();
        
        return result;
      } else {
        // Create new config
        const [result] = await db.insert(invoiceLineItemsConfig)
          .values({
            ...config,
            updatedAt: new Date()
          })
          .returning();
        
        return result;
      }
    } catch (error) {
      console.error(`[DatabaseStorage.createOrUpdateInvoiceLineItemsConfig] Error creating/updating config:`, error);
      throw error;
    }
  }

  async calculateInvoiceLineItemCosts(reference: string): Promise<any> {
    try {
      console.log(`[DatabaseStorage.calculateInvoiceLineItemCosts] Calculating costs for procedure ${reference}`);
      
      // Get the procedure
      const [procedure] = await db.select().from(procedures)
        .where(eq(procedures.reference, reference));
      
      if (!procedure) {
        throw new Error(`Procedure with reference ${reference} not found`);
      }
      
      // Check if usdtl_rate is available for currency conversion
      if (!procedure.usdtl_rate) {
        throw new Error(`Procedure ${reference} does not have a USD/TL rate defined. Cannot calculate costs.`);
      }
      
      const usdtlRate = parseFloat(procedure.usdtl_rate);
      
      // Get the line items with explicit ordering by sortOrder field
      const lineItems = await db.select()
        .from(invoiceLineItems)
        .where(eq(invoiceLineItems.procedureReference, reference))
        .orderBy(
          sql`COALESCE(${invoiceLineItems.sortOrder}, 9999999)`,
          invoiceLineItems.createdAt,
          invoiceLineItems.id
        );
      
      console.log(`[calculateInvoiceLineItemCosts] Retrieved ${lineItems.length} items for procedure ${reference} in following order:`);
      console.log(`[ORDER_DEBUG] Items before calculation: ${lineItems.map(item => `ID:${item.id}, sortOrder:${item.sortOrder}, desc:${item.description?.substring(0, 15)}`).join(' -> ')}`);
      
      if (lineItems.length === 0) {
        throw new Error(`No line items found for procedure ${reference}`);
      }
      
      // Get the config
      const config = await this.getInvoiceLineItemsConfig(reference);
      const distributionMethod = config?.distributionMethod || 'proportional';
      
      // Calculate the total line item value in USD
      const totalLineItemValueUSD = lineItems.reduce((sum, item) => sum + parseFloat(item.totalPrice), 0);
      
      // Convert to TL for calculations
      const totalLineItemValueTL = totalLineItemValueUSD * usdtlRate;
      
      // Get all expenses (already in TL)
      const importExpenses = await this.getImportExpensesByReference(reference);
      const totalImportExpenses = importExpenses.reduce((sum, expense) => sum + parseFloat(expense.amount), 0);
      
      const serviceInvoices = await this.getImportServiceInvoicesByReference(reference);
      const totalServiceInvoices = serviceInvoices.reduce((sum, invoice) => sum + parseFloat(invoice.amount), 0);
      
      const [tax] = await db.select().from(taxes).where(eq(taxes.procedureReference, reference));
      let totalTaxes = 0;
      
      if (tax) {
        totalTaxes = 
          parseFloat(tax.customsTax || '0') + 
          parseFloat(tax.additionalCustomsTax || '0') + 
          parseFloat(tax.kkdf || '0') + 
          parseFloat(tax.vat || '0') + 
          parseFloat(tax.stampTax || '0');
      }
      
      // Calculate freight if applicable (already in TL)
      const freightAmount = procedure.freight_amount ? parseFloat(procedure.freight_amount) : 0;
      
      // Total all expenses in TL
      const totalExpensesTL = totalImportExpenses + totalServiceInvoices + totalTaxes + freightAmount;
      
      // Calculate total cost in TL
      const totalCostTL = totalLineItemValueTL + totalExpensesTL;
      
      // Convert back to USD for display
      const totalCostUSD = totalCostTL / usdtlRate;
      
      // Calculate the cost multiplier in TL
      const costMultiplier = totalLineItemValueTL > 0 ? totalCostTL / totalLineItemValueTL : 1;
      
      console.log(`[calculateInvoiceLineItemCosts] Cost summary for ${reference}:
        - Total Line Item Value (USD): ${totalLineItemValueUSD}
        - Total Line Item Value (TL): ${totalLineItemValueTL}
        - Total Expenses (TL): ${totalExpensesTL}
        - Total Cost (TL): ${totalCostTL}
        - Total Cost (USD): ${totalCostUSD}
        - Cost Multiplier: ${costMultiplier}
        - Distribution Method: ${distributionMethod}
      `);
      
      // Update each line item IN THEIR ORIGINAL ORDER
      // We create a map of IDs to updates to avoid reordering
      const updatedItems = [];
      const itemMap = new Map();
      
      // First calculate all the costs without applying updates
      for (const item of lineItems) {
        const originalPriceUSD = parseFloat(item.totalPrice);
        const originalPriceTL = originalPriceUSD * usdtlRate;
        let finalCostTL = 0;
        
        if (distributionMethod === 'proportional') {
          // Each item gets expenses proportional to its price
          const proportion = totalLineItemValueTL > 0 ? (originalPriceTL / totalLineItemValueTL) : 0;
          finalCostTL = originalPriceTL + (totalExpensesTL * proportion);
        } else {
          // Each item gets an equal share of expenses
          const equalShare = lineItems.length > 0 ? (totalExpensesTL / lineItems.length) : 0;
          finalCostTL = originalPriceTL + equalShare;
        }
        
        // Convert back to USD for storage
        const finalCostUSD = finalCostTL / usdtlRate;
        
        // Calculate unit cost
        const unitCount = parseFloat(item.quantity);
        const finalCostPerItemUSD = unitCount > 0 ? (finalCostUSD / unitCount) : 0;
        
        // Store the calculated values in our map
        itemMap.set(item.id, {
          finalCost: finalCostUSD.toString(),
          finalCostPerItem: finalCostPerItemUSD.toString(),
          costMultiplier: costMultiplier.toString(),
        });
      }
      
      // Now update each item in the original order
      for (let i = 0; i < lineItems.length; i++) {
        const item = lineItems[i];
        const updates = itemMap.get(item.id);
        
        // Update the line item
        const [updatedItem] = await db.update(invoiceLineItems)
          .set({
            ...updates,
            updatedAt: new Date()
          })
          .where(eq(invoiceLineItems.id, item.id))
          .returning();
        
        // Add to result array in the same original order
        updatedItems.push(updatedItem);
      }
      
      // Log the order of updated items
      console.log(`[ORDER_DEBUG] Items after calculation: ${updatedItems.map(item => `ID:${item.id}, sortOrder:${item.sortOrder}, desc:${item.description?.substring(0, 15)}`).join(' -> ')}`);
      
      // Verify the sum of all finalCost values matches the total cost
      const sumOfFinalCosts = updatedItems.reduce((sum, item) => sum + parseFloat(item.finalCost), 0);
      console.log(`[calculateInvoiceLineItemCosts] Sum of final costs (USD): ${sumOfFinalCosts}, Total Cost (USD): ${totalCostUSD}`);
      
      // Sort the updated items by sortOrder before returning
      const sortedUpdatedItems = [...updatedItems].sort((a, b) => {
        const aSortOrder = a.sortOrder !== null ? a.sortOrder : 9999999;
        const bSortOrder = b.sortOrder !== null ? b.sortOrder : 9999999;
        return aSortOrder - bSortOrder;
      });
      
      return {
        totalLineItems: lineItems.length,
        costMultiplier,
        success: true,
        totalLineItemValueUSD,
        totalExpensesTL,
        totalCostTL,
        totalCostUSD,
        distributionMethod,
        updatedItems: sortedUpdatedItems  // Return items in consistent order
      };
    } catch (error) {
      console.error(`[DatabaseStorage.calculateInvoiceLineItemCosts] Error calculating costs:`, error);
      throw error;
    }
  }

  async getAllProducts(): Promise<Product[]> {
    return await db.select().from(products).orderBy(products.createdAt);
  }

  async getProduct(id: number): Promise<Product | undefined> {
    const [product] = await db.select().from(products).where(eq(products.id, id));
    return product;
  }

  async getProductByStyle(style: string): Promise<Product | undefined> {
    const [product] = await db.select().from(products).where(eq(products.style, style));
    return product;
  }

  async getProductByHtsCode(htsCode: string): Promise<Product[]> {
    return await db.select().from(products).where(eq(products.hts_code, htsCode));
  }

  async createProduct(product: InsertProduct): Promise<Product> {
    const [result] = await db.insert(products).values(product).returning();
    return result;
  }

  async updateProduct(id: number, productData: Partial<InsertProduct>): Promise<Product | undefined> {
    const [result] = await db.update(products)
      .set({ ...productData, updatedAt: new Date() })
      .where(eq(products.id, id))
      .returning();
    return result;
  }

  async deleteProduct(id: number): Promise<boolean> {
    const result = await db.delete(products).where(eq(products.id, id)).returning();
    return result.length > 0;
  }

  async getAllHsCodes(): Promise<HsCode[]> {
    return await db.select().from(hsCodes).orderBy(hsCodes.tr_hs_code);
  }

  async getHsCode(code: string): Promise<HsCode | undefined> {
    const [hsCode] = await db.select().from(hsCodes).where(eq(hsCodes.tr_hs_code, code));
    return hsCode;
  }

  async getHsCodesBatch(codes: string[]): Promise<HsCode[]> {
    if (codes.length === 0) return [];
    return await db.select().from(hsCodes).where(inArray(hsCodes.tr_hs_code, codes));
  }

  async createHsCode(hsCode: InsertHsCode): Promise<HsCode> {
    const [result] = await db.insert(hsCodes).values(hsCode).returning();
    return result;
  }

  async updateHsCode(code: string, hsCodeData: Partial<InsertHsCode>): Promise<HsCode | undefined> {
    const [result] = await db.update(hsCodes)
      .set({ ...hsCodeData, updatedAt: new Date() })
      .where(eq(hsCodes.tr_hs_code, code))
      .returning();
    return result;
  }

  async deleteHsCode(code: string): Promise<boolean> {
    const result = await db.delete(hsCodes).where(eq(hsCodes.tr_hs_code, code)).returning();
    return result.length > 0;
  }

  async getAllTaxCalculations(): Promise<TaxCalculation[]> {
    return await db.select().from(taxCalculations).orderBy(desc(taxCalculations.createdAt));
  }

  async getTaxCalculation(id: number): Promise<TaxCalculation | undefined> {
    const [calculation] = await db.select().from(taxCalculations).where(eq(taxCalculations.id, id));
    return calculation;
  }

  async createTaxCalculation(calculation: InsertTaxCalculation): Promise<TaxCalculation> {
    const [result] = await db.insert(taxCalculations).values(calculation).returning();
    return result;
  }

  async updateTaxCalculation(id: number, calculationData: Partial<InsertTaxCalculation>): Promise<TaxCalculation | undefined> {
    const [result] = await db.update(taxCalculations)
      .set({ ...calculationData, updatedAt: new Date() })
      .where(eq(taxCalculations.id, id))
      .returning();
    return result;
  }

  async deleteTaxCalculation(id: number): Promise<boolean> {
    const result = await db.delete(taxCalculations).where(eq(taxCalculations.id, id)).returning();
    return result.length > 0;
  }

  async getTaxCalculationItems(taxCalculationId: number): Promise<TaxCalculationItem[]> {
    return await db.select().from(taxCalculationItems)
      .where(eq(taxCalculationItems.tax_calculation_id, taxCalculationId))
      .orderBy(taxCalculationItems.line_number);
  }

  async getTaxCalculationItem(id: number): Promise<TaxCalculationItem | undefined> {
    const [item] = await db.select().from(taxCalculationItems).where(eq(taxCalculationItems.id, id));
    return item;
  }

  async createTaxCalculationItem(item: InsertTaxCalculationItem): Promise<TaxCalculationItem> {
    const [result] = await db.insert(taxCalculationItems).values(item).returning();
    return result;
  }

  async batchCreateTaxCalculationItems(items: InsertTaxCalculationItem[]): Promise<TaxCalculationItem[]> {
    if (items.length === 0) return [];
    
    return await db.transaction(async (tx) => {
      const results = await tx.insert(taxCalculationItems).values(items).returning();
      return results;
    });
  }

  async updateTaxCalculationItem(id: number, itemData: Partial<TaxCalculationItem>): Promise<TaxCalculationItem | undefined> {
    const [result] = await db.update(taxCalculationItems)
      .set({ ...itemData, updatedAt: new Date() })
      .where(eq(taxCalculationItems.id, id))
      .returning();
    return result;
  }

  async batchUpdateTaxCalculationItems(updates: Array<{ id: number; data: Partial<TaxCalculationItem> }>): Promise<void> {
    if (updates.length === 0) return;

    await db.transaction(async (tx) => {
      const batchSize = 50;
      
      for (let i = 0; i < updates.length; i += batchSize) {
        const batch = updates.slice(i, i + batchSize);
        
        await Promise.all(
          batch.map(update => 
            tx.update(taxCalculationItems)
              .set({ ...update.data, updatedAt: new Date() })
              .where(eq(taxCalculationItems.id, update.id))
          )
        );
      }
    });
  }

  async deleteTaxCalculationItem(id: number): Promise<boolean> {
    const result = await db.delete(taxCalculationItems).where(eq(taxCalculationItems.id, id)).returning();
    return result.length > 0;
  }

  async getAtrCustomsRates(hsCodes?: string[]): Promise<AtrCustomsRate[]> {
    if (!hsCodes) {
      // Return all ATR rates if no hsCodes specified
      return await db.select().from(atrCustomsRates);
    }
    if (hsCodes.length === 0) return [];
    return await db.select().from(atrCustomsRates).where(inArray(atrCustomsRates.tr_hs_code, hsCodes));
  }

  async getAtrCustomsRate(hsCode: string): Promise<AtrCustomsRate | undefined> {
    const [rate] = await db.select().from(atrCustomsRates).where(eq(atrCustomsRates.tr_hs_code, hsCode));
    return rate;
  }

  async saveAtrCustomsRates(rates: InsertAtrCustomsRate[]): Promise<AtrCustomsRate[]> {
    if (rates.length === 0) return [];
    
    const results: AtrCustomsRate[] = [];
    
    for (const rate of rates) {
      const existing = await this.getAtrCustomsRate(rate.tr_hs_code);
      
      if (existing) {
        const [updated] = await db.update(atrCustomsRates)
          .set({ 
            customs_tax_percent: rate.customs_tax_percent,
            updatedAt: new Date()
          })
          .where(eq(atrCustomsRates.tr_hs_code, rate.tr_hs_code))
          .returning();
        results.push(updated);
      } else {
        const [created] = await db.insert(atrCustomsRates)
          .values(rate)
          .returning();
        results.push(created);
      }
    }
    
    return results;
  }
}

// Create and export the storage instance
export const storage = new DatabaseStorage();