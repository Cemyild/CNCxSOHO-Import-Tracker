import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import path from "path";
import fs from "fs";
import mime from "mime-types";
import ExcelJS from "exceljs";
import { storage } from "./storage";
import {
  uploadFile,
  getFile,
  deleteFile,
  createSignedUrl,
  listAllKeys,
} from "./object-storage";
import { db, rawDb } from "./db";
import { eq, inArray, and, isNotNull, sql, ne, or, like } from "drizzle-orm";
import {
  procedures,
  invoiceLineItems,
  invoiceLineItemsConfig,
  products,
  hsCodes,
  taxes,
  importExpenses,
  importServiceInvoices,
  paymentDistributions,
} from "@shared/schema";
import { calculateAllItems, checkMissingAtrRates } from "./tax-calculation-service";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
// Import pre-converted Inter font for jsPDF
import "./fonts/Inter_18pt-Regular-normal.js";
import "./fonts/Inter_18pt-Bold-normal.js";
// Import Excel Report Routes
import excelReportRoute from "./excel-report";
import templateExcelReportRoute from "./excel-template-report";
// Import Tax Analytics routes
import taxRoutes from "./tax-routes";
// Import Custom Report routes (Excel export removed, will be rebuilt)
import customReportRoutes from "./custom-report";
// Import Tax Calculation Excel Export
import taxCalculationExcelRoute from "./tax-calculation-excel";
import taxCalculationExcelRoute from "./tax-calculation-excel";
import taxCalculationBeyannameRoute from "./tax-calculation-beyanname";
import excelEnrichmentRouter from "./excel-enrichment";
// Import Claude AI utilities
import claude from "./claude";
// Import rate limiting
import rateLimit from "express-rate-limit";
// Import Zod for validation
import { z } from "zod";

// Configure multer for memory storage (for cloud uploads)
// This stores files in memory instead of on disk so we can upload to object storage
const memoryStorage = multer.memoryStorage();

// Configure file filter
const fileFilter = (
  req: any,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback,
) => {
  const allowedTypes = [
    "application/pdf",
    "image/jpeg",
    "image/png",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ];

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(
      new Error("Invalid file type. Only PDF, JPG, PNG, and DOCX are allowed."),
    );
  }
};

const upload = multer({
  storage: memoryStorage, // Use memory storage instead of disk storage
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
});

// Configure multer for Excel file uploads (disk storage for processing)
const excelStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadsDir = path.join(process.cwd(), 'uploads');
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const excelUpload = multer({
  storage: excelStorage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'application/vnd.ms-excel' // .xls
    ];
    if (allowedTypes.includes(file.mimetype) || file.originalname.match(/\.(xlsx|xls)$/)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only Excel files (.xlsx, .xls) are allowed.'));
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

// Configure multer for PDF analysis uploads (memory storage, 20MB limit)
const pdfUpload = multer({
  storage: memoryStorage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed for analysis'));
    }
  },
  limits: {
    fileSize: 20 * 1024 * 1024 // 20MB limit for PDF analysis
  }
});

export async function registerRoutes(app: Express): Promise<Server> {
  // Adobe PDF Services removed - now using jsPDF for PDF generation
  
  // Register Excel Enrichment Router
  app.use("/api/enrichment", excelEnrichmentRouter);

  // Route to upload PDF template - DEPRECATED (keeping for backward compatibility)
  app.post(
    "/api/pdf/upload-template-deprecated",
    upload.single("template"),
    async (req, res) => {
      console.log("==================================");
      console.log("TEMPLATE UPLOAD PROCESS STARTED");
      console.log("==================================");

      console.log("Template upload request received");
      console.log("Request has file:", !!req.file);
      if (req.file) {
        console.log("File details:", {
          originalname: req.file.originalname,
          mimetype: req.file.mimetype,
          size: req.file.size,
          buffer: req.file.buffer ? "Buffer exists" : "No buffer",
          bufferLength: req.file.buffer ? req.file.buffer.length : 0,
        });

        // Check first few bytes to validate it's actually a DOCX/ZIP file
        if (req.file.buffer && req.file.buffer.length > 4) {
          const firstBytes = req.file.buffer.slice(0, 4);
          console.log("First 4 bytes of file:", firstBytes.toString("hex"));

          // DOCX files start with PK (ZIP format)
          const isPKZip = firstBytes[0] === 0x50 && firstBytes[1] === 0x4b;
          console.log(
            `File format check: ${isPKZip ? "Valid DOCX/ZIP format" : "NOT a valid DOCX format"}`,
          );

          if (!isPKZip) {
            return res.status(400).json({
              error: "Invalid file format",
              message:
                "The uploaded file does not appear to be a valid DOCX file. Please ensure you are uploading a Word document properly tagged with Adobe Document Generation Tagger.",
            });
          }
        }
      } else {
        console.log("Form data keys:", Object.keys(req.body));
        console.log("Headers:", req.headers);
      }

      if (!req.file) {
        return res.status(400).json({ error: "No template file uploaded" });
      }

      // Handle the uploaded template
      try {
        // Check if it's a DOCX file
        if (
          req.file.mimetype !==
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        ) {
          return res.status(400).json({
            error: "Invalid file type",
            message:
              "Template must be a DOCX file (Word document) tagged with Adobe Document Generation Tagger",
          });
        }

        // Save to templates directory
        const templatesDir = path.join(process.cwd(), "assets", "templates");

        // Create directory if it doesn't exist
        if (!fs.existsSync(templatesDir)) {
          fs.mkdirSync(templatesDir, { recursive: true });
        }

        console.log("Templates directory created/confirmed at:", templatesDir);

        // First, backup any existing template just in case
        const templatePath = path.join(
          templatesDir,
          "procedure-report-template.docx",
        );
        if (fs.existsSync(templatePath)) {
          const backupPath = path.join(
            templatesDir,
            `procedure-report-template.backup-${Date.now()}.docx`,
          );
          fs.copyFileSync(templatePath, backupPath);
          console.log("Created backup of existing template at:", backupPath);
        }

        // Save the file
        console.log("Writing template file to:", templatePath);
        fs.writeFileSync(templatePath, req.file.buffer);

        // Verify the file was written correctly
        if (fs.existsSync(templatePath)) {
          const stats = fs.statSync(templatePath);
          console.log("Template file saved successfully:", {
            path: templatePath,
            size: stats.size,
            created: stats.birthtime,
            permissions: stats.mode.toString(8).slice(-3),
          });

          // Double-check file contents by reading first few bytes
          const fd = fs.openSync(templatePath, "r");
          const buffer = Buffer.alloc(4);
          fs.readSync(fd, buffer, 0, 4, 0);
          fs.closeSync(fd);

          console.log("Saved file first 4 bytes:", buffer.toString("hex"));

          // DOCX files should begin with PK (it's a ZIP format)
          const isPKZip = buffer[0] === 0x50 && buffer[1] === 0x4b;
          if (!isPKZip) {
            console.warn(
              "WARNING: Saved template does not have proper DOCX header!",
            );
          }
        } else {
          console.error("Template file was not found after saving!");
        }

        console.log("==================================");
        console.log("TEMPLATE UPLOAD PROCESS COMPLETED");
        console.log("==================================");

        return res.json({
          success: true,
          message: "PDF template uploaded successfully",
          path: templatePath,
          fileSize: req.file.size,
          fileType: req.file.mimetype,
        });
      } catch (error) {
        console.error("Error uploading template:", error);
        return res.status(500).json({
          error: "Failed to save template file",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    },
  );
  // Authentication routes
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { username, password } = req.body;
      console.log("[AUTH] Login attempt for username:", username);

      const user = await storage.authenticateUser(username, password);
      if (user) {
        console.log("[AUTH] User authenticated successfully:", user.id);

        // Store user in session
        (req.session as any).userId = user.id;
        (req.session as any).user = { ...user, password: undefined };

        // Save session explicitly
        req.session.save((err) => {
          if (err) {
            console.error("[AUTH] Session save error:", err);
            return res.status(500).json({ message: "Session save failed" });
          }

          console.log("[AUTH] Session data stored and saved:", {
            userId: (req.session as any).userId,
            sessionID: req.sessionID,
          });

          // Update last login and respond
          const loginTime = new Date();
          storage
            .updateUserLastLogin(user.id)
            .then(() => {
              res.json({
                user: { ...user, password: undefined, lastLogin: loginTime },
                token: user.id.toString(), // Simple token for authentication
              });
            })
            .catch((updateError) => {
              console.error("[AUTH] Last login update error:", updateError);
              res.json({
                user: { ...user, password: undefined, lastLogin: loginTime },
                token: user.id.toString(),
              });
            });
        });
      } else {
        console.log("[AUTH] Invalid credentials for username:", username);
        res.status(401).json({ message: "Invalid credentials" });
      }
    } catch (error) {
      console.error("[AUTH] Login error:", error);
      res
        .status(500)
        .json({ message: "Authentication failed", error: String(error) });
    }
  });

  app.get("/api/auth/me", async (req, res) => {
    // Check session first
    const sessionUser = (req.session as any)?.user;
    const userId = (req.session as any)?.userId;

    // Check Authorization header as fallback
    const authHeader = req.headers.authorization;
    let headerUserId = null;

    if (authHeader && authHeader.startsWith("Bearer ")) {
      try {
        const token = authHeader.substring(7);
        headerUserId = parseInt(token); // Simple token for now (user ID)
      } catch (error) {
        // Invalid token format
      }
    }

    const effectiveUserId = userId || headerUserId;

    console.log("[AUTH] /api/auth/me called:", {
      sessionID: req.sessionID,
      hasSessionUser: !!sessionUser,
      sessionUserId: userId,
      headerUserId: headerUserId,
      effectiveUserId: effectiveUserId,
    });

    if (effectiveUserId) {
      try {
        const user = await storage.getUserById(effectiveUserId);
        if (user) {
          console.log("[AUTH] User found in database:", user.id);
          res.json({ ...user, password: undefined });
        } else {
          console.log(
            "[AUTH] User not found in database for ID:",
            effectiveUserId,
          );
          res.status(401).json({ message: "User not found" });
        }
      } catch (error) {
        console.error("[AUTH] Error fetching user data:", error);
        res.status(500).json({ message: "Failed to fetch user data" });
      }
    } else {
      console.log("[AUTH] No valid authentication found");
      res.status(401).json({ message: "Not authenticated" });
    }
  });

  app.post("/api/auth/logout", async (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        res.status(500).json({ message: "Failed to logout" });
      } else {
        res.json({ message: "Logged out successfully" });
      }
    });
  });

  app.post("/api/auth/change-password", async (req, res) => {
    try {
      const { currentPassword, newPassword } = req.body;
      const userId = (req.session as any)?.userId;

      if (!userId) {
        return res.status(401).json({ message: "Not authenticated" });
      }

      const success = await storage.changeUserPassword(
        userId,
        currentPassword,
        newPassword,
      );
      if (success) {
        res.json({ message: "Password changed successfully" });
      } else {
        res.status(400).json({ message: "Current password is incorrect" });
      }
    } catch (error) {
      res
        .status(500)
        .json({ message: "Failed to change password", error: String(error) });
    }
  });

  // User management routes
  app.get("/api/users", async (req, res) => {
    try {
      const users = await storage.getAllUsers();
      res.json({
        users: users.map((user) => ({ ...user, password: undefined })),
      });
    } catch (error) {
      res
        .status(500)
        .json({ message: "Failed to retrieve users", error: String(error) });
    }
  });

  app.post("/api/users", async (req, res) => {
    try {
      const { username, email, password, role } = req.body;
      const user = await storage.createUser({
        username,
        email,
        password,
        role,
      });
      res.json({ user: { ...user, password: undefined } });
    } catch (error) {
      res
        .status(500)
        .json({ message: "Failed to create user", error: String(error) });
    }
  });

  app.put("/api/users/:id", async (req, res) => {
    try {
      const userId = parseInt(req.params.id);
      const userData = req.body;
      const user = await storage.updateUser(userId, userData);
      res.json({ user: { ...user, password: undefined } });
    } catch (error) {
      res
        .status(500)
        .json({ message: "Failed to update user", error: String(error) });
    }
  });

  app.delete("/api/users/:id", async (req, res) => {
    try {
      const userId = parseInt(req.params.id);
      const success = await storage.deleteUser(userId);
      res.json({ success });
    } catch (error) {
      res
        .status(500)
        .json({ message: "Failed to delete user", error: String(error) });
    }
  });

  // Admin only routes - authentication disabled
  app.use("/api/admin/*", async (req, res, next) => {
    next();
  });

  app.post("/api/admin/users", async (req, res) => {
    const user = await storage.createUser(req.body);
    res.json({ user: { ...user, password: undefined } });
  });

  app.delete("/api/admin/users/:id", async (req, res) => {
    const success = await storage.deleteUser(parseInt(req.params.id));
    res.json({ success });
  });

  app.post("/api/admin/document-types", async (req, res) => {
    const { name } = req.body;
    const docType = await storage.createDocumentType({
      name,
      createdBy: req.body.user?.id,
    });
    res.json({ documentType: docType });
  });

  // ==========================================
  // TR HS CODES MANAGEMENT ROUTES
  // ==========================================
  
  // Get all TR HS Codes
  app.get("/api/hs-codes", async (req, res) => {
    try {
      const allHsCodes = await db.select().from(hsCodes).orderBy(hsCodes.tr_hs_code);
      res.json({ hsCodes: allHsCodes });
    } catch (error) {
      console.error("Error fetching HS codes:", error);
      res.status(500).json({ message: "Failed to fetch HS codes", error: String(error) });
    }
  });

  // Get single TR HS Code
  app.get("/api/hs-codes/:trHsCode", async (req, res) => {
    try {
      const trHsCode = decodeURIComponent(req.params.trHsCode);
      const [hsCode] = await db.select().from(hsCodes).where(eq(hsCodes.tr_hs_code, trHsCode));
      if (!hsCode) {
        return res.status(404).json({ message: "HS Code not found" });
      }
      res.json({ hsCode });
    } catch (error) {
      console.error("Error fetching HS code:", error);
      res.status(500).json({ message: "Failed to fetch HS code", error: String(error) });
    }
  });

  // Create TR HS Code
  app.post("/api/hs-codes", async (req, res) => {
    try {
      const { tr_hs_code, ex_registry_form, azo_dye_test, special_custom, 
              customs_tax_percent, additional_customs_tax_percent, kkdf_percent, vat_percent, 
              description_tr, unit } = req.body;
      
      if (!tr_hs_code) {
        return res.status(400).json({ message: "TR HS Code is required" });
      }

      const [existingCode] = await db.select().from(hsCodes).where(eq(hsCodes.tr_hs_code, tr_hs_code));
      if (existingCode) {
        return res.status(409).json({ message: "TR HS Code already exists" });
      }

      const [newHsCode] = await db.insert(hsCodes).values({
        tr_hs_code,
        ex_registry_form: ex_registry_form ?? false,
        azo_dye_test: azo_dye_test ?? false,
        special_custom: special_custom ?? false,
        customs_tax_percent: customs_tax_percent ?? null,
        additional_customs_tax_percent: additional_customs_tax_percent ?? null,
        kkdf_percent: kkdf_percent ?? null,
        vat_percent: vat_percent ?? null,
        description_tr: description_tr ?? null,
        unit: unit ?? null,
      }).returning();

      res.status(201).json({ hsCode: newHsCode });
    } catch (error) {
      console.error("Error creating HS code:", error);
      res.status(500).json({ message: "Failed to create HS code", error: String(error) });
    }
  });

  // Update TR HS Code
  app.put("/api/hs-codes/:trHsCode", async (req, res) => {
    try {
      const trHsCode = decodeURIComponent(req.params.trHsCode);
      const { ex_registry_form, azo_dye_test, special_custom, 
              customs_tax_percent, additional_customs_tax_percent, kkdf_percent, vat_percent, 
              description_tr, unit } = req.body;

      const [updatedHsCode] = await db.update(hsCodes)
        .set({
          ex_registry_form,
          azo_dye_test,
          special_custom,
          customs_tax_percent,
          additional_customs_tax_percent,
          kkdf_percent,
          vat_percent,
          description_tr,
          unit,
          updatedAt: new Date(),
        })
        .where(eq(hsCodes.tr_hs_code, trHsCode))
        .returning();

      if (!updatedHsCode) {
        return res.status(404).json({ message: "HS Code not found" });
      }

      res.json({ hsCode: updatedHsCode });
    } catch (error) {
      console.error("Error updating HS code:", error);
      res.status(500).json({ message: "Failed to update HS code", error: String(error) });
    }
  });

  // Delete TR HS Code
  app.delete("/api/hs-codes/:trHsCode", async (req, res) => {
    try {
      const trHsCode = decodeURIComponent(req.params.trHsCode);
      const [deletedHsCode] = await db.delete(hsCodes)
        .where(eq(hsCodes.tr_hs_code, trHsCode))
        .returning();

      if (!deletedHsCode) {
        return res.status(404).json({ message: "HS Code not found" });
      }

      res.json({ success: true, deletedHsCode });
    } catch (error) {
      console.error("Error deleting HS code:", error);
      res.status(500).json({ message: "Failed to delete HS code", error: String(error) });
    }
  });

  // ==========================================
  // PRODUCTS MANAGEMENT ROUTES
  // ==========================================
  
  // Get all Products
  app.get("/api/products", async (req, res) => {
    try {
      const allProducts = await db.select().from(products).orderBy(products.style);
      res.json({ products: allProducts });
    } catch (error) {
      console.error("Error fetching products:", error);
      res.status(500).json({ message: "Failed to fetch products", error: String(error) });
    }
  });

  // Get single Product
  app.get("/api/products/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid product ID" });
      }
      const [product] = await db.select().from(products).where(eq(products.id, id));
      if (!product) {
        return res.status(404).json({ message: "Product not found" });
      }
      res.json({ product });
    } catch (error) {
      console.error("Error fetching product:", error);
      res.status(500).json({ message: "Failed to fetch product", error: String(error) });
    }
  });

  // Create Product
  app.post("/api/products", async (req, res) => {
    try {
      const { style, hts_code, tr_hs_code, item_description, brand, category, color, 
              fabric_content, country_of_origin } = req.body;
      
      if (!style) {
        return res.status(400).json({ message: "Style is required" });
      }

      const [existingProduct] = await db.select().from(products).where(eq(products.style, style));
      if (existingProduct) {
        return res.status(409).json({ message: "Product with this style already exists" });
      }

      const [newProduct] = await db.insert(products).values({
        style,
        hts_code: hts_code ?? null,
        tr_hs_code: tr_hs_code ?? null,
        item_description: item_description ?? null,
        brand: brand ?? null,
        category: category ?? null,
        color: color ?? null,
        fabric_content: fabric_content ?? null,
        country_of_origin: country_of_origin ?? null,
      }).returning();

      res.status(201).json({ product: newProduct });
    } catch (error) {
      console.error("Error creating product:", error);
      res.status(500).json({ message: "Failed to create product", error: String(error) });
    }
  });

  // Update Product
  app.put("/api/products/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid product ID" });
      }
      
      const { style, hts_code, tr_hs_code, item_description, brand, category, color, 
              fabric_content, country_of_origin } = req.body;

      const [updatedProduct] = await db.update(products)
        .set({
          style,
          hts_code,
          tr_hs_code,
          item_description,
          brand,
          category,
          color,
          fabric_content,
          country_of_origin,
          updatedAt: new Date(),
        })
        .where(eq(products.id, id))
        .returning();

      if (!updatedProduct) {
        return res.status(404).json({ message: "Product not found" });
      }

      res.json({ product: updatedProduct });
    } catch (error) {
      console.error("Error updating product:", error);
      res.status(500).json({ message: "Failed to update product", error: String(error) });
    }
  });

  // Delete Product
  app.delete("/api/products/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid product ID" });
      }
      
      const [deletedProduct] = await db.delete(products)
        .where(eq(products.id, id))
        .returning();

      if (!deletedProduct) {
        return res.status(404).json({ message: "Product not found" });
      }

      res.json({ success: true, deletedProduct });
    } catch (error) {
      console.error("Error deleting product:", error);
      res.status(500).json({ message: "Failed to delete product", error: String(error) });
    }
  });

  // Procedure routes
  app.get("/api/procedures", async (req, res) => {
    // Check if reference parameter is provided
    const reference = req.query.reference as string;

    if (reference) {
      // Filter procedures by reference
      const allProcedures = await storage.getAllProcedures();
      const filteredProcedures = allProcedures.filter(
        (p) => p.reference === reference,
      );
      res.json({ procedures: filteredProcedures });
    } else {
      // Return all procedures if no reference is provided
      const procedures = await storage.getAllProcedures();
      res.json({ procedures });
    }
  });

  // Get procedure by reference - this more specific route must come before the generic :id route
  app.get("/api/procedures/reference/:reference", async (req, res) => {
    try {
      const reference = decodeURIComponent(req.params.reference);
      if (!reference) {
        return res
          .status(400)
          .json({ message: "Procedure reference is required" });
      }

      const procedures = await storage.getProcedureByReference(reference);
      if (!procedures || procedures.length === 0) {
        return res.status(404).json({ message: "Procedure not found" });
      }

      res.json({ procedure: procedures[0] });
    } catch (error) {
      console.error("Error fetching procedure by reference:", error);
      res
        .status(500)
        .json({ message: "Failed to fetch procedure", error: String(error) });
    }
  });

  // Get procedure by ID - this generic route must come after the more specific routes
  app.get("/api/procedures/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid procedure ID" });
      }
      const procedure = await storage.getProcedure(id);
      if (!procedure) {
        return res.status(404).json({ message: "Procedure not found" });
      }
      res.json({ procedure });
    } catch (error) {
      console.error("Error fetching procedure by ID:", error);
      res
        .status(500)
        .json({ message: "Failed to fetch procedure", error: String(error) });
    }
  });

  app.post("/api/procedures", async (req, res) => {
    try {
      // Safe date parsing function that returns YYYY-MM-DD string to avoid timezone issues
      const safeParseDate = (dateStr: string | null | undefined): string | null => {
        if (!dateStr) return null;

        try {
          // Validate and normalize to YYYY-MM-DD format
          const date = new Date(dateStr);
          if (!isNaN(date.getTime())) {
            // Return as YYYY-MM-DD string to avoid timezone conversion
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
          }
          console.log("Invalid date format received:", dateStr);
          return null;
        } catch (e) {
          console.error("Error parsing date:", e);
          return null;
        }
      };

      // Process the request data to ensure correct date handling and remove id if present
      const { id, ...dataWithoutId } = req.body; // Remove ID to let DB auto-generate it

      console.log(
        "[routes] Creating procedure, removing id from input data:",
        id,
      );

      const processedData = {
        ...dataWithoutId,
        // Safely parse date fields using our utility function
        invoice_date: safeParseDate(dataWithoutId.invoice_date),
        arrival_date: safeParseDate(dataWithoutId.arrival_date),
        import_dec_date: safeParseDate(dataWithoutId.import_dec_date),
        createdBy: dataWithoutId.user?.id || 3, // Using admin user ID 3 instead of 1
      };

      // First, try to reset the sequence to prevent PK violations
      try {
        await db.execute(
          `SELECT setval('procedures_id_seq', (SELECT MAX(id) FROM procedures) + 1, false)`,
        );
        console.log(
          "[routes] Successfully reset procedures_id_seq before creation",
        );
      } catch (seqError) {
        console.error(
          "[routes] Error resetting sequence before procedure creation:",
          seqError,
        );
        // Continue execution even if sequence reset fails
      }

      const procedure = await storage.createProcedure(processedData);
      res.json({ procedure });
    } catch (error) {
      console.error("Procedure creation error:", error);

      // Handle specific error types
      let errorMessage = "Failed to create procedure";

      // Check for duplicate key error
      if (
        error instanceof Error &&
        (error.message.includes("duplicate key") ||
          error.message.includes("unique constraint"))
      ) {
        errorMessage = "Database sequence error occurred. Please try again.";

        // Try to fix the sequence in the background
        try {
          await db.execute(
            `SELECT setval('procedures_id_seq', (SELECT MAX(id) FROM procedures) + 1, false)`,
          );
          console.log("[routes] Reset sequence after error");
        } catch (seqError) {
          console.error(
            "[routes] Failed to reset sequence after error:",
            seqError,
          );
        }
      }

      res.status(400).json({
        message: errorMessage,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.patch("/api/procedures/:id", async (req, res) => {
    try {
      // Process date fields - dates are now stored as simple text (DD/MM/YYYY)
      const processedData = { ...req.body };

      // Handle empty strings for date fields - convert to null
      if (processedData.invoice_date === '') {
        processedData.invoice_date = null;
      }
      if (processedData.arrival_date === '') {
        processedData.arrival_date = null;
      }
      if (processedData.import_dec_date === '') {
        processedData.import_dec_date = null;
      }

      const procedure = await storage.updateProcedure(
        parseInt(req.params.id),
        processedData,
      );

      if (!procedure) {
        return res.status(404).json({ message: "Procedure not found" });
      }

      res.json({ procedure });
    } catch (error) {
      console.error("Procedure update error:", error);
      res
        .status(400)
        .json({ message: "Failed to update procedure", error: String(error) });
    }
  });

  // Update procedure by reference (for edit form)
  app.put("/api/procedures/:reference", async (req, res) => {
    try {
      const reference = decodeURIComponent(req.params.reference);

      console.log(
        "[PUT /api/procedures/:reference] Request body:",
        JSON.stringify(req.body, null, 2),
      );

      // Process the request data - dates are now stored as simple text (DD/MM/YYYY)
      const processedData = { ...req.body };

      // Handle empty strings for date fields - convert to null
      if (processedData.invoice_date === '') {
        processedData.invoice_date = null;
      }
      if (processedData.arrival_date === '') {
        processedData.arrival_date = null;
      }
      if (processedData.import_dec_date === '') {
        processedData.import_dec_date = null;
      }

      // Handle legacy field name if it exists
      if (req.body.import_declaration_date) {
        processedData.import_dec_date = req.body.import_declaration_date || null;
        delete processedData.import_declaration_date;
      }

      console.log(
        "[PUT /api/procedures/:reference] Processed data:",
        JSON.stringify(processedData, null, 2),
      );

      // First find the procedure by reference to get its ID
      const existingProcedures =
        await storage.getProcedureByReference(reference);
      if (!existingProcedures || existingProcedures.length === 0) {
        return res.status(404).json({ message: "Procedure not found" });
      }

      const procedureId = existingProcedures[0].id;

      // Update the procedure using its ID
      const procedure = await storage.updateProcedure(
        procedureId,
        processedData,
      );

      if (!procedure) {
        return res.status(404).json({ message: "Failed to update procedure" });
      }

      res.json({ procedure });
    } catch (error) {
      console.error("Procedure update by reference error:", error);
      res.status(400).json({
        message: "Failed to update procedure",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.delete("/api/procedures/:id", async (req, res) => {
    const success = await storage.deleteProcedure(parseInt(req.params.id));
    res.json({ success });
  });

  // Update freight amount
  app.post("/api/procedures/:reference/freight", async (req, res) => {
    try {
      const { reference } = req.params;
      const { freightAmount } = req.body;

      if (reference === undefined || freightAmount === undefined) {
        return res.status(400).json({
          message: "Missing required parameters",
          details: "Both procedure reference and freight amount are required",
        });
      }

      // Convert freightAmount to a number and validate
      const freightAmountNum = parseFloat(freightAmount);
      if (isNaN(freightAmountNum)) {
        return res.status(400).json({
          message: "Invalid freight amount",
          details: "Freight amount must be a valid number",
        });
      }

      const procedure = await storage.updateFreightAmount(
        reference,
        freightAmountNum,
      );

      if (!procedure) {
        return res.status(404).json({
          message: "Procedure not found",
          details: `No procedure found with reference: ${reference}`,
        });
      }

      res.json({
        success: true,
        procedure,
        message: "Freight amount updated successfully",
      });
    } catch (error) {
      // Log the full error with stack trace
      console.error("Error updating freight amount:", error);

      // Log the request body for debugging
      console.log("Request body:", req.body);

      // Check if it's a specific type of error we can handle
      if (error instanceof Error) {
        // Return a more detailed error message
        return res.status(500).json({
          message: "Failed to update freight amount",
          error: error.message,
          details:
            "There was an error updating the freight amount in the database. Please try again or contact support if the issue persists.",
          code: "FREIGHT_UPDATE_ERROR",
        });
      }

      // Generic error handling if not a standard Error object
      res.status(500).json({
        message: "Failed to update freight amount",
        error: String(error),
        details: "An unexpected error occurred while processing your request.",
      });
    }
  });

  // Export procedure to Excel with all details
  app.get("/api/procedures/:reference/export/excel", async (req, res) => {
    try {
      const reference = decodeURIComponent(req.params.reference);
      console.log(`[Excel Export] Starting export for procedure: ${reference}`);

      // 1. Get the procedure
      const procedureResults = await storage.getProcedureByReference(reference);
      if (!procedureResults || procedureResults.length === 0) {
        return res.status(404).json({ message: "Procedure not found" });
      }
      const procedure = procedureResults[0];

      // 2. Get taxes for this procedure
      const taxResults = await db.select().from(taxes).where(eq(taxes.procedureReference, reference));
      const tax = taxResults[0] || null;

      // 3. Get all import expenses for this procedure
      const expenses = await db.select().from(importExpenses).where(eq(importExpenses.procedureReference, reference));
      
      // 4. Get all service invoices for this procedure
      const serviceInvoices = await db.select().from(importServiceInvoices).where(eq(importServiceInvoices.procedureReference, reference));

      // Helper function to parse date and return JavaScript Date object for Excel
      // Returns null for invalid/empty dates
      const parseDate = (date: any): Date | null => {
        if (!date) return null;
        
        // Only accept strings in exact YYYY-MM-DD format from database
        if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
          const [year, month, day] = date.split('-').map(Number);
          return new Date(year, month - 1, day);
        }
        
        // For any other format or invalid data, return null
        return null;
      };
      
      // Helper to format date for display (dd/mm/yyyy) - used for text fallback
      const formatDateString = (date: any): string => {
        const parsed = parseDate(date);
        if (!parsed) return '';
        const day = String(parsed.getDate()).padStart(2, '0');
        const month = String(parsed.getMonth() + 1).padStart(2, '0');
        const year = parsed.getFullYear();
        return `${day}/${month}/${year}`;
      };

      // Group expenses by category
      const expensesByCategory = {
        export_registry_fee: expenses.filter(e => e.category === 'export_registry_fee'),
        insurance: expenses.filter(e => e.category === 'insurance'),
        awb_fee: expenses.filter(e => e.category === 'awb_fee'),
        airport_storage_fee: expenses.filter(e => e.category === 'airport_storage_fee'),
        bonded_warehouse_storage_fee: expenses.filter(e => e.category === 'bonded_warehouse_storage_fee'),
        transportation: expenses.filter(e => e.category === 'transportation'),
        tareks_fee: expenses.filter(e => e.category === 'tareks_fee'),
        international_transportation: expenses.filter(e => e.category === 'international_transportation'),
        customs_inspection: expenses.filter(e => e.category === 'customs_inspection'),
      };

      // Generate all combinations of expenses for row expansion
      // When multiple expenses exist in any category, create separate rows
      const generateRowCombinations = () => {
        const categories = Object.keys(expensesByCategory);
        const rows: any[] = [];
        
        // Get max count across all categories to determine number of rows needed
        // Always ensure at least 1 row is generated (for procedures with no expenses/invoices)
        const expenseCounts = categories.map(cat => expensesByCategory[cat as keyof typeof expensesByCategory].length);
        const maxCount = Math.max(
          ...expenseCounts,
          serviceInvoices.length,
          1 // At least one row (even if no expenses/invoices exist)
        );
        
        // Generate rows (one per expense/invoice combination)
        for (let i = 0; i < maxCount; i++) {
          const rowData: any = {};
          
          // Map each category to the i-th expense (or null if none)
          categories.forEach(category => {
            const categoryExpenses = expensesByCategory[category as keyof typeof expensesByCategory];
            rowData[category] = categoryExpenses[i] || null;
          });
          
          // Add service invoice for this row
          rowData.serviceInvoice = serviceInvoices[i] || null;
          
          rows.push(rowData);
        }
        
        return rows;
      };

      const rowCombinations = generateRowCombinations();

      // Create Excel workbook
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Procedure Export');

      // Define the 80+ columns with headers (A to BBB)
      const headers = [
        'REFERENCE', // A
        'SHIPPER', // B
        'INVOICE NO', // C
        'STATUS', // D
        'INVOICE DATE', // E
        'INVOICE AMOUNT', // F
        'CURRENCY', // G
        'NO OF PIECES', // H
        'KG', // I
        'ARRIVAL DATE', // J
        'AWB / PLATE NMBR', // K
        'CARRIER', // L
        'CUSTOMS', // M
        'IMPORT DEC NUMBER', // N
        'IMPORT DEC DATE', // O
        'CUSTOMS TAX', // P
        'ADD. CUSTOMS TAX', // Q
        'KKDF', // R
        'VAT', // S
        'STAMP TAX', // T
        'TOTAL TAX', // U
        'EXPORT REGISTRY FORM', // V
        'INSURANCE', // W
        'POLICY NO', // X
        'DATE', // Y
        'AWB FEE', // Z
        'ISSUER', // AA
        'INVOICE NO2', // BB
        'DATE2', // CC
        'AIRPORT STORAGE FEE', // DD
        'ISSUER2', // EE
        'INVOICE NO5', // FF
        'DATE6', // GG
        'BONDED WAREHOUSE STORAGE FEE', // HH
        'ISSUER3', // II
        'INVOICE NO4', // JJ
        'DATE5', // KK
        'TRANSPORT', // LL
        'ISSUER6', // MM
        'INVOICE NO7', // NN
        'DATE8', // OO
        'TAREKS FEE', // PP
        'INVOICE', // QQ
        'DATE3', // RR
        'INTERNATIONAL TRANSPORT', // SS
        'INVOICE NO3', // TT
        'DATE4', // UU
        'CUSTOMS INSPECTION FEE', // VV
        'DATE42', // WW
        'DATE43', // XX
        'TOTAL FEES PAID', // YY
        'CNC SERVICE FEE', // ZZ
        'INVOICE NO9', // AAA
        'DATE10', // BBB
      ];

      // Add headers to worksheet
      worksheet.addRow(headers);

      // Generate data rows (one per expense combination)
      rowCombinations.forEach((row) => {
        const exportRegistry = row.export_registry_fee;
        const insurance = row.insurance;
        const awbFee = row.awb_fee;
        const airportStorage = row.airport_storage_fee;
        const bondedWarehouse = row.bonded_warehouse_storage_fee;
        const transportation = row.transportation;
        const tareksFee = row.tareks_fee;
        const intlTransport = row.international_transportation;
        const customsInspection = row.customs_inspection;
        const serviceFee = row.serviceInvoice;

        const dataRow = [
          procedure.reference || '', // A
          procedure.shipper || '', // B
          procedure.invoice_no || '', // C
          '', // D - STATUS (empty as requested)
          parseDate(procedure.invoice_date), // E - Date
          procedure.amount ? Number(procedure.amount) : null, // F - Number
          procedure.currency || '', // G
          procedure.piece || '', // H
          procedure.kg || '', // I
          parseDate(procedure.arrival_date), // J - Date
          procedure.awb_number || '', // K
          procedure.carrier || '', // L
          procedure.customs || '', // M
          procedure.import_dec_number || '', // N
          parseDate(procedure.import_dec_date), // O - Date
          tax?.customsTax ? Number(tax.customsTax) : null, // P - Number
          tax?.additionalCustomsTax ? Number(tax.additionalCustomsTax) : null, // Q - Number
          tax?.kkdf ? Number(tax.kkdf) : null, // R - Number
          tax?.vat ? Number(tax.vat) : null, // S - Number
          tax?.stampTax ? Number(tax.stampTax) : null, // T - Number
          null, // U - TOTAL TAX (empty as requested)
          exportRegistry?.amount ? Number(exportRegistry.amount) : null, // V - Number
          insurance?.amount ? Number(insurance.amount) : null, // W - Number
          insurance?.policyNumber || insurance?.invoiceNumber || insurance?.documentNumber || '', // X
          parseDate(insurance?.invoiceDate), // Y - Date
          awbFee?.amount ? Number(awbFee.amount) : null, // Z - Number
          awbFee?.issuer || '', // AA
          awbFee?.invoiceNumber || '', // AB
          parseDate(awbFee?.invoiceDate), // AC - Date
          airportStorage?.amount ? Number(airportStorage.amount) : null, // AD - Number
          airportStorage?.issuer || '', // AE
          airportStorage?.invoiceNumber || '', // AF
          parseDate(airportStorage?.invoiceDate), // AG - Date
          bondedWarehouse?.amount ? Number(bondedWarehouse.amount) : null, // AH - Number
          bondedWarehouse?.issuer || '', // AI
          bondedWarehouse?.invoiceNumber || '', // AJ
          parseDate(bondedWarehouse?.invoiceDate), // AK - Date
          transportation?.amount ? Number(transportation.amount) : null, // AL - Number
          transportation?.issuer || '', // AM
          transportation?.invoiceNumber || '', // AN
          parseDate(transportation?.invoiceDate), // AO - Date
          tareksFee?.amount ? Number(tareksFee.amount) : null, // AP - Number
          tareksFee?.invoiceNumber || '', // AQ
          parseDate(tareksFee?.invoiceDate), // AR - Date
          intlTransport?.amount ? Number(intlTransport.amount) : null, // AS - Number
          intlTransport?.invoiceNumber || '', // AT
          parseDate(intlTransport?.invoiceDate), // AU - Date
          customsInspection?.amount ? Number(customsInspection.amount) : null, // AV - Number
          parseDate(customsInspection?.invoiceDate), // AW - Date
          null, // AX - DATE43 (empty)
          null, // AY - TOTAL FEES PAID (empty as requested)
          serviceFee?.amount ? Number(serviceFee.amount) : null, // AZ - Number
          serviceFee?.invoiceNumber || '', // BA
          parseDate(serviceFee?.date), // BB - Date
        ];

        // Add data row
        worksheet.addRow(dataRow);
      });
      
      // Define date columns (1-indexed for ExcelJS) based on user specification: E, J, O, Y, AC, AG, AK, AO, AR, AU, AX, BB
      // E=5, J=10, O=15, Y=25, AC=29, AG=33, AK=37, AO=41, AR=44, AU=47, AX=50, BB=54
      const dateColumns = [5, 10, 15, 25, 29, 33, 37, 41, 44, 47, 50, 54];
      
      // Define number columns for expense/tax values (1-indexed)
      // F=6, P=16, Q=17, R=18, S=19, T=20, U=21, V=22, W=23, Z=26, AD=30, AH=34, AL=38, AP=42, AS=45, AV=48, AY=51, AZ=52
      const numberColumns = [6, 16, 17, 18, 19, 20, 21, 22, 23, 26, 30, 34, 38, 42, 45, 48, 51, 52];
      
      // Apply formatting to all data rows (starting from row 2)
      const totalRows = worksheet.rowCount;
      for (let rowNum = 2; rowNum <= totalRows; rowNum++) {
        // Apply date formatting (dd/mm/yyyy) - need to convert string dates to actual Date objects
        dateColumns.forEach(colNum => {
          const cell = worksheet.getCell(rowNum, colNum);
          const cellValue = cell.value;
          
          // Check if it's a Date object or a date string (YYYY-MM-DD format)
          if (cellValue instanceof Date) {
            cell.value = cellValue;
            cell.numFmt = 'DD/MM/YYYY';
          } else if (typeof cellValue === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(cellValue)) {
            // Convert ISO date string to Date object
            const [year, month, day] = cellValue.split('-').map(Number);
            cell.value = new Date(year, month - 1, day);
            cell.numFmt = 'DD/MM/YYYY';
          }
        });
        
        // Apply number formatting - convert string numbers to actual numbers
        numberColumns.forEach(colNum => {
          const cell = worksheet.getCell(rowNum, colNum);
          const cellValue = cell.value;
          
          if (typeof cellValue === 'number') {
            cell.numFmt = '#,##0.00';
          } else if (typeof cellValue === 'string' && cellValue !== '' && !isNaN(Number(cellValue))) {
            // Convert string to number
            cell.value = Number(cellValue);
            cell.numFmt = '#,##0.00';
          }
        });
      }

      // Format the header row (bold)
      worksheet.getRow(1).font = { bold: true };

      // Auto-size columns
      worksheet.columns.forEach((column) => {
        if (column && column.eachCell) {
          let maxLength = 0;
          column.eachCell({ includeEmpty: true }, (cell) => {
            const cellValue = cell.value ? cell.value.toString() : '';
            maxLength = Math.max(maxLength, cellValue.length);
          });
          column.width = Math.min(Math.max(maxLength + 2, 10), 50);
        }
      });

      // Set response headers for file download
      const filename = `procedure_${reference.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.xlsx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

      // Write to response
      await workbook.xlsx.write(res);
      res.end();

      console.log(`[Excel Export] Successfully exported procedure: ${reference}`);
    } catch (error) {
      console.error('[Excel Export] Error:', error);
      res.status(500).json({
        message: 'Failed to export Excel file',
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Update procedure status
  app.post("/api/procedures/update-status", async (req, res) => {
    try {
      console.log("[update-status] Received request body:", req.body);
      const { reference, shipment_status, payment_status, document_status } =
        req.body;

      if (!reference) {
        console.log("[update-status] Error: No reference provided");
        return res
          .status(400)
          .json({ error: "Procedure reference is required" });
      }

      // Use direct query with eq() to get procedure by reference
      console.log(
        "[update-status] Finding procedure with reference:",
        reference,
      );
      const procedureList = await storage.getProcedureByReference(reference);

      if (!procedureList || procedureList.length === 0) {
        console.log(
          "[update-status] Error: No procedure found with reference:",
          reference,
        );
        return res.status(404).json({ error: "Procedure not found" });
      }

      console.log("[update-status] Found procedure:", procedureList[0]);
      const procedureId = procedureList[0].id;

      // Prepare update data based on which status is being updated
      const updateData: any = {};

      if (shipment_status) {
        console.log(
          "[update-status] Updating shipment_status to:",
          shipment_status,
        );
        updateData.shipment_status = shipment_status;
      }

      if (payment_status) {
        console.log(
          "[update-status] Updating payment_status to:",
          payment_status,
        );
        updateData.payment_status = payment_status;
      }

      if (document_status) {
        console.log(
          "[update-status] Updating document_status to:",
          document_status,
        );
        updateData.document_status = document_status;
      }

      // Only update if status fields are provided
      if (Object.keys(updateData).length === 0) {
        console.log(
          "[update-status] Error: No status fields provided in request",
        );
        return res
          .status(400)
          .json({ error: "No status fields provided for update" });
      }

      console.log(
        "[update-status] Updating procedure:",
        procedureId,
        "with data:",
        updateData,
      );

      // Update the procedure status
      const procedure = await storage.updateProcedure(procedureId, updateData);
      console.log("[update-status] Update result:", procedure);

      res.json({ success: true, procedure });
    } catch (error) {
      console.error("[update-status] Error updating procedure status:", error);
      res.status(500).json({ error: "Failed to update procedure status" });
    }
  });

  // User routes for document operations
  app.post("/api/documents/:procedureId", async (req, res) => {
    if (req.body.user.role === "accountant") {
      return res.status(403).json({ message: "Insufficient permissions" });
    }
    const document = await storage.uploadDocument({
      ...req.body,
      procedureId: parseInt(req.params.procedureId),
      uploadedBy: req.body.user.id,
    });
    res.json({ document });
  });

  app.get("/api/documents/:procedureId", async (req, res) => {
    const documents = await storage.getDocuments(
      parseInt(req.params.procedureId),
    );
    res.json({ documents });
  });

  // Import Service Invoice routes
  // GET all invoices
  app.get("/api/service-invoices", async (req, res) => {
    try {
      const invoices = await storage.getAllImportServiceInvoices();
      res.json({ invoices });
    } catch (error) {
      res
        .status(500)
        .json({
          message: "Failed to retrieve service invoices",
          error: String(error),
        });
    }
  });

  // GET all invoices for a specific procedure reference
  app.get("/api/service-invoices/procedure/:reference", async (req, res) => {
    try {
      // Decode the reference parameter to handle forward slashes properly
      const reference = decodeURIComponent(req.params.reference);
      if (!reference) {
        return res
          .status(400)
          .json({ message: "Procedure reference is required" });
      }

      const invoices =
        await storage.getImportServiceInvoicesByReference(reference);
      res.json({ invoices });
    } catch (error) {
      res
        .status(500)
        .json({
          message: "Failed to retrieve service invoices",
          error: String(error),
        });
    }
  });

  // GET a specific invoice by ID
  app.get("/api/service-invoices/:id", async (req, res) => {
    try {
      const invoice = await storage.getImportServiceInvoice(
        parseInt(req.params.id),
      );
      if (!invoice) {
        return res.status(404).json({ message: "Service invoice not found" });
      }
      res.json({ invoice });
    } catch (error) {
      res
        .status(500)
        .json({
          message: "Failed to retrieve service invoice",
          error: String(error),
        });
    }
  });

  // POST create a new invoice
  app.post("/api/service-invoices", async (req, res) => {
    try {
      // Validate required fields
      const { procedureReference, amount, invoiceNumber, date } = req.body;

      if (!procedureReference) {
        return res
          .status(400)
          .json({ message: "Procedure reference is required" });
      }

      if (!amount) {
        return res.status(400).json({ message: "Amount is required" });
      }

      if (!invoiceNumber) {
        return res.status(400).json({ message: "Invoice number is required" });
      }

      if (!date) {
        return res.status(400).json({ message: "Date is required" });
      }

      // We'll use a known existing user ID (3 is the admin user)
      const adminUserId = 3; // Admin user ID from the database

      // Helper to convert date to YYYY-MM-DD string
      const formatDateString = (dateInput: string): string => {
        const d = new Date(dateInput);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      };

      // Create the invoice with a valid user ID to avoid foreign key constraint issues
      // A real application would use the authenticated user's ID
      const newInvoice = await storage.createImportServiceInvoice({
        procedureReference,
        amount,
        currency: req.body.currency || "USD",
        invoiceNumber,
        date: formatDateString(date), // Store as YYYY-MM-DD string to avoid timezone issues
        notes: req.body.notes,
        createdBy: adminUserId, // Using admin user ID from const above
      });

      res.status(201).json({ invoice: newInvoice });
    } catch (error) {
      res
        .status(400)
        .json({
          message: "Failed to create service invoice",
          error: String(error),
        });
    }
  });

  // PUT update an existing invoice
  app.put("/api/service-invoices/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);

      // Check if invoice exists
      const existingInvoice = await storage.getImportServiceInvoice(id);
      if (!existingInvoice) {
        return res.status(404).json({ message: "Service invoice not found" });
      }

      // Helper to convert date to YYYY-MM-DD string
      const formatDateString = (dateInput: string): string => {
        const d = new Date(dateInput);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      };

      // Process date if provided
      const updateData: any = {}; // Safe updateData object

      // Only include fields that are provided and valid
      if (req.body.amount !== undefined) updateData.amount = req.body.amount;
      if (req.body.currency) updateData.currency = req.body.currency;
      if (req.body.invoiceNumber)
        updateData.invoiceNumber = req.body.invoiceNumber;
      if (req.body.notes !== undefined) updateData.notes = req.body.notes;

      // Process date if provided
      if (req.body.date) {
        updateData.date = formatDateString(req.body.date);
      }

      // Update the invoice
      const updatedInvoice = await storage.updateImportServiceInvoice(
        id,
        updateData,
      );

      res.json({ invoice: updatedInvoice });
    } catch (error) {
      res
        .status(400)
        .json({
          message: "Failed to update service invoice",
          error: String(error),
        });
    }
  });

  // DELETE remove an invoice
  app.delete("/api/service-invoices/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);

      // Check if invoice exists
      const existingInvoice = await storage.getImportServiceInvoice(id);
      if (!existingInvoice) {
        return res.status(404).json({ message: "Service invoice not found" });
      }

      // Delete the invoice
      const success = await storage.deleteImportServiceInvoice(id);

      res.json({ success });
    } catch (error) {
      res
        .status(500)
        .json({
          message: "Failed to delete service invoice",
          error: String(error),
        });
    }
  });

  // Payment routes
  // DELETE all payments (admin operation) - LEGACY ENDPOINT
  app.delete("/api/payments/reset-all", async (req, res) => {
    try {
      console.log(
        "[routes] Received request to delete all payments (legacy endpoint)",
      );

      // Execute the delete operation
      const result = await storage.deleteAllPayments();

      console.log(`[routes] Successfully deleted ${result.count} payments`);

      // Return success with count and deleted payment IDs for logging
      res.json({
        success: true,
        count: result.count,
        deletedPaymentIds: result.deletedPayments.map((p) => p.id),
      });
    } catch (error) {
      console.error("[routes] Error deleting all payments:", error);
      res.status(500).json({
        message: "Failed to delete all payments",
        error: String(error),
      });
    }
  });

  // DELETE all payments (admin operation) - NEW ENDPOINT (avoids route conflicts)
  app.delete("/api/all-payments/reset", async (req, res) => {
    try {
      console.log(
        "[routes] Received request to delete all payments (new endpoint)",
      );

      // Execute the delete operation
      const result = await storage.deleteAllPayments();

      console.log(`[routes] Successfully deleted ${result.count} payments`);

      // Return success with count and deleted payment IDs for logging
      res.json({
        success: true,
        count: result.count,
        deletedPaymentIds: result.deletedPayments.map((p) => p.id),
      });
    } catch (error) {
      console.error("[routes] Error deleting all payments:", error);
      res.status(500).json({
        message: "Failed to delete all payments",
        error: String(error),
      });
    }
  });

  // New Payment System Routes

  // GET all incoming payments
  app.get("/api/incoming-payments", async (req, res) => {
    try {
      const payments = await storage.getAllIncomingPayments();

      // Include distributions for each payment
      const paymentsWithDistributions = await Promise.all(
        payments.map(async (payment) => {
          const distributions = await storage.getPaymentDistributions(
            payment.id,
          );
          return {
            ...payment,
            distributions,
          };
        }),
      );

      res.json({ payments: paymentsWithDistributions });
    } catch (error) {
      res
        .status(500)
        .json({
          message: "Failed to retrieve incoming payments",
          error: String(error),
        });
    }
  });

  // GET a specific incoming payment by ID
  app.get("/api/incoming-payments/:id", async (req, res) => {
    try {
      const payment = await storage.getIncomingPayment(parseInt(req.params.id));
      if (!payment) {
        return res.status(404).json({ message: "Incoming payment not found" });
      }
      res.json({ payment });
    } catch (error) {
      res
        .status(500)
        .json({
          message: "Failed to retrieve incoming payment",
          error: String(error),
        });
    }
  });

  // GET a specific incoming payment by payment ID
  app.get("/api/incoming-payments/payment-id/:paymentId", async (req, res) => {
    try {
      const payment = await storage.getIncomingPaymentByPaymentId(
        req.params.paymentId,
      );
      if (!payment) {
        return res.status(404).json({ message: "Incoming payment not found" });
      }
      res.json({ payment });
    } catch (error) {
      res
        .status(500)
        .json({
          message: "Failed to retrieve incoming payment",
          error: String(error),
        });
    }
  });

  // POST create a new incoming payment
  app.post("/api/incoming-payments", async (req, res) => {
    try {
      console.log(
        "[routes] POST /api/incoming-payments - Request body:",
        req.body,
      );

      // Validate required fields
      const { paymentId, dateReceived, payerInfo, totalAmount, currency } =
        req.body;

      if (!paymentId) {
        console.log("[routes] ERROR: Missing payment ID");
        return res.status(400).json({ message: "Payment ID is required" });
      }

      if (!dateReceived) {
        console.log("[routes] ERROR: Missing date received");
        return res.status(400).json({ message: "Date received is required" });
      }

      if (!payerInfo) {
        console.log("[routes] ERROR: Missing payer information");
        return res
          .status(400)
          .json({ message: "Payer information is required" });
      }

      if (!totalAmount) {
        console.log("[routes] ERROR: Missing total amount");
        return res.status(400).json({ message: "Total amount is required" });
      }

      // Use the admin user with ID 3, which we know exists in the database
      const adminUserId = 3;

      // Check if a payment with the same ID already exists
      const existingPayment =
        await storage.getIncomingPaymentByPaymentId(paymentId);
      if (existingPayment) {
        console.log("[routes] ERROR: Payment ID already exists:", paymentId);
        return res
          .status(400)
          .json({ message: `Payment ID "${paymentId}" already exists` });
      }

      // Log the data before creating the payment
      // Always enforce TL as currency regardless of what was sent
      console.log("[routes] Creating new incoming payment with data:", {
        paymentId,
        dateReceived: new Date(dateReceived),
        payerInfo,
        totalAmount,
        currency: "TL", // Always enforce TL as currency regardless of input
        createdBy: adminUserId,
        notes: req.body.notes || null,
      });

      // Create the payment
      const newPayment = await storage.createIncomingPayment({
        paymentId,
        dateReceived: new Date(dateReceived),
        payerInfo,
        totalAmount,
        currency: "TL", // Always enforce TL as currency regardless of input
        createdBy: adminUserId,
        notes: req.body.notes || null,
      });

      console.log(
        "[routes] Successfully created incoming payment:",
        newPayment,
      );
      res.status(201).json({ payment: newPayment });
    } catch (error) {
      console.error("[routes] ERROR creating incoming payment:", error);
      res
        .status(400)
        .json({
          message: "Failed to create incoming payment",
          error: String(error),
        });
    }
  });

  // PUT update an existing incoming payment
  app.put("/api/incoming-payments/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);

      // Check if payment exists
      const existingPayment = await storage.getIncomingPayment(id);
      if (!existingPayment) {
        return res.status(404).json({ message: "Incoming payment not found" });
      }

      // Process date if provided
      const updateData: any = {}; // Safe updateData object

      // Only include fields that are provided and valid
      if (req.body.paymentId !== undefined)
        updateData.paymentId = req.body.paymentId;
      if (req.body.payerInfo !== undefined)
        updateData.payerInfo = req.body.payerInfo;
      // Always ensure currency is TL, ignore any incoming currency value
      if (req.body.currency !== undefined) updateData.currency = "TL";
      if (req.body.notes !== undefined) updateData.notes = req.body.notes;

      // Only update total amount if there are no distributions yet
      if (req.body.totalAmount !== undefined) {
        if (existingPayment.distributionStatus === "pending_distribution") {
          updateData.totalAmount = req.body.totalAmount;
          updateData.remainingBalance = req.body.totalAmount;
        } else {
          return res.status(400).json({
            message:
              "Cannot update total amount on a payment that has already been distributed",
            currentStatus: existingPayment.distributionStatus,
          });
        }
      }

      // Process date if provided
      if (req.body.dateReceived) {
        updateData.dateReceived = new Date(req.body.dateReceived);
      }

      // Update the payment
      const updatedPayment = await storage.updateIncomingPayment(
        id,
        updateData,
      );

      res.json({ payment: updatedPayment });
    } catch (error) {
      res
        .status(400)
        .json({
          message: "Failed to update incoming payment",
          error: String(error),
        });
    }
  });

  // DELETE remove an incoming payment
  app.delete("/api/incoming-payments/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);

      // Check if payment exists
      const existingPayment = await storage.getIncomingPayment(id);
      if (!existingPayment) {
        return res.status(404).json({ message: "Incoming payment not found" });
      }

      // Delete the payment (this will throw an error if there are distributions)
      const success = await storage.deleteIncomingPayment(id);

      res.json({ success });
    } catch (error) {
      res
        .status(500)
        .json({
          message: "Failed to delete incoming payment",
          error: String(error),
        });
    }
  });

  // Payment Distributions Routes

  // GET distributions for a specific incoming payment
  app.get("/api/payment-distributions/payment/:paymentId", async (req, res) => {
    try {
      const paymentId = parseInt(req.params.paymentId);
      if (isNaN(paymentId)) {
        return res.status(400).json({ message: "Invalid payment ID" });
      }

      const distributions = await storage.getPaymentDistributions(paymentId);
      res.json({ distributions });
    } catch (error) {
      res
        .status(500)
        .json({
          message: "Failed to retrieve payment distributions",
          error: String(error),
        });
    }
  });

  // GET distributions for a specific payment
  app.get("/api/payment-distributions/payment/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res
          .status(400)
          .json({ message: "Valid payment ID is required" });
      }

      // Get the payment first to include its data in the response
      const payment = await storage.getIncomingPayment(id);
      if (!payment) {
        return res.status(404).json({ message: "Payment not found" });
      }

      // Get the distributions
      const distributions = await storage.getPaymentDistributions(id);

      // Add payment data to each distribution
      const enhancedDistributions = distributions.map((dist) => ({
        ...dist,
        paymentId: payment.paymentId,
        payerInfo: payment.payerInfo,
      }));

      res.json({
        distributions: enhancedDistributions,
        payment: {
          id: payment.id,
          paymentId: payment.paymentId,
          payerInfo: payment.payerInfo,
          totalAmount: payment.totalAmount,
          amountDistributed: payment.amountDistributed,
          remainingBalance: payment.remainingBalance,
          distributionStatus: payment.distributionStatus,
        },
      });
    } catch (error) {
      res
        .status(500)
        .json({
          message: "Failed to retrieve payment distributions",
          error: String(error),
        });
    }
  });

  // GET distributions for a specific procedure
  app.get(
    "/api/payment-distributions/procedure/:reference",
    async (req, res) => {
      try {
        // Decode the reference parameter to handle forward slashes properly
        const reference = decodeURIComponent(req.params.reference);
        if (!reference) {
          return res
            .status(400)
            .json({ message: "Procedure reference is required" });
        }

        const distributions =
          await storage.getPaymentDistributionsByProcedure(reference);

        // For each distribution, get the payment info
        const enhancedDistributions = await Promise.all(
          distributions.map(async (dist) => {
            const payment = await storage.getIncomingPayment(
              dist.incomingPaymentId,
            );
            return {
              ...dist,
              paymentId: payment ? payment.paymentId : "Unknown",
              payerInfo: payment ? payment.payerInfo : "Unknown",
              totalPaymentAmount: payment ? payment.totalAmount : "0",
            };
          }),
        );

        res.json({ distributions: enhancedDistributions });
      } catch (error) {
        res
          .status(500)
          .json({
            message: "Failed to retrieve payment distributions",
            error: String(error),
          });
      }
    },
  );

  // POST create a new payment distribution
  app.post("/api/payment-distributions", async (req, res) => {
    try {
      // Validate required fields
      const {
        incomingPaymentId,
        procedureReference,
        distributedAmount,
        paymentType,
      } = req.body;

      if (!incomingPaymentId) {
        return res
          .status(400)
          .json({ message: "Incoming payment ID is required" });
      }

      if (!procedureReference) {
        return res
          .status(400)
          .json({ message: "Procedure reference is required" });
      }

      if (!distributedAmount) {
        return res
          .status(400)
          .json({ message: "Distributed amount is required" });
      }

      if (!paymentType) {
        return res.status(400).json({ message: "Payment type is required" });
      }

      // Use the admin user with ID 3, which we know exists in the database
      const adminUserId = 3;

      // Convert incoming payment ID to a number if it's a string
      const paymentId =
        typeof incomingPaymentId === "string"
          ? parseInt(incomingPaymentId)
          : incomingPaymentId;

      // Create the distribution
      const newDistribution = await storage.createPaymentDistribution({
        incomingPaymentId: paymentId,
        procedureReference,
        distributedAmount,
        paymentType,
        distributionDate: new Date(),
        createdBy: adminUserId,
      });

      res.status(201).json({ distribution: newDistribution });
    } catch (error) {
      res
        .status(400)
        .json({
          message: "Failed to create payment distribution",
          error: String(error),
        });
    }
  });

  // DELETE remove a payment distribution
  app.delete("/api/payment-distributions/:id", async (req, res) => {
    // Create a timeout promise to prevent hanging operations
    const timeoutPromise = new Promise((_, reject) => {
      const timeoutId = setTimeout(() => {
        console.log(
          `[routes] DELETE operation for payment distribution timed out after 5 seconds`,
        );
        reject(new Error("Operation timed out after 5 seconds"));
      }, 5000);

      // Store the timeout ID in the request object so we can clear it later
      (req as any)._timeoutId = timeoutId;
    });

    try {
      const id = parseInt(req.params.id);
      console.log(
        `[routes] DELETE /api/payment-distributions/${id} - Attempting to delete payment distribution`,
      );

      if (isNaN(id)) {
        console.log(
          `[routes] Invalid payment distribution ID: ${req.params.id}`,
        );
        clearTimeout((req as any)._timeoutId);
        return res
          .status(400)
          .json({ message: "Invalid payment distribution ID", success: false });
      }

      // Delete the distribution with a timeout
      console.log(
        `[routes] Calling storage.deletePaymentDistribution with ID: ${id}`,
      );

      const deletePromise = storage.deletePaymentDistribution(id);

      // Race the delete operation against the timeout
      const success = (await Promise.race([
        deletePromise,
        timeoutPromise.then(() => {
          throw new Error("Delete operation timed out");
        }),
      ])) as boolean;

      console.log(`[routes] Delete operation result: ${success}`);

      // Clear the timeout since operation completed successfully
      clearTimeout((req as any)._timeoutId);

      if (!success) {
        console.log(
          `[routes] Payment distribution with ID ${id} not found or could not be deleted`,
        );
        return res
          .status(404)
          .json({
            message: "Payment distribution not found or could not be deleted",
            success: false,
          });
      }

      console.log(
        `[routes] Successfully deleted payment distribution with ID ${id}`,
      );
      res.json({ success: true });
    } catch (error) {
      // Clear the timeout to prevent memory leaks
      if ((req as any)._timeoutId) {
        clearTimeout((req as any)._timeoutId);
      }

      console.error(
        `[routes] Error deleting payment distribution with ID ${req.params.id}:`,
        error,
      );

      // Check if this was a timeout error
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const isTimeout =
        errorMessage &&
        (errorMessage.includes("timed out") ||
          errorMessage.includes("timeout"));

      res.status(isTimeout ? 504 : 500).json({
        message: isTimeout
          ? "Operation timed out while deleting payment distribution"
          : "Failed to delete payment distribution",
        error: String(error),
        success: false,
      });
    }
  });

  // DELETE all payment distributions (admin operation)
  app.delete("/api/all-payment-distributions/reset", async (req, res) => {
    // Create a timeout promise to prevent hanging operations (10 seconds for bulk operation)
    const timeoutPromise = new Promise((_, reject) => {
      const timeoutId = setTimeout(() => {
        console.log(
          `[routes] Reset operation for payment distributions timed out after 10 seconds`,
        );
        reject(new Error("Operation timed out after 10 seconds"));
      }, 10000);

      // Store the timeout ID in the request object so we can clear it later
      (req as any)._timeoutId = timeoutId;
    });

    try {
      console.log(
        "[routes] Received request to delete all payment distributions",
      );

      // Execute the delete operation with a timeout
      const deletePromise = storage.deleteAllPaymentDistributions();

      // Race the delete operation against the timeout
      const result = await Promise.race([
        deletePromise,
        timeoutPromise.then(() => {
          throw new Error("Reset operation timed out");
        }),
      ]);

      // Clear the timeout since operation completed successfully
      clearTimeout((req as any)._timeoutId);

      console.log(
        `[routes] Successfully deleted ${result.count} payment distributions`,
      );

      // Return success with count and deleted distribution IDs for logging
      res.json({
        success: true,
        count: result.count,
        deletedDistributionIds: result.deletedDistributions.map((d) => d.id),
      });
    } catch (error) {
      // Clear the timeout to prevent memory leaks
      if ((req as any)._timeoutId) {
        clearTimeout((req as any)._timeoutId);
      }

      console.error(
        "[routes] Error deleting all payment distributions:",
        error,
      );

      // Check if this was a timeout error
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const isTimeout =
        errorMessage &&
        (errorMessage.includes("timed out") ||
          errorMessage.includes("timeout"));

      res.status(isTimeout ? 504 : 500).json({
        message: isTimeout
          ? "Operation timed out while resetting payment distributions"
          : "Failed to delete all payment distributions",
        error: String(error),
        success: false,
      });
    }
  });

  // GET all payments
  app.get("/api/payments", async (req, res) => {
    try {
      const payments = await storage.getAllPayments();
      res.json({ payments });
    } catch (error) {
      res
        .status(500)
        .json({ message: "Failed to retrieve payments", error: String(error) });
    }
  });

  // GET payments for a specific procedure reference
  app.get("/api/payments/procedure/:reference", async (req, res) => {
    try {
      // Decode the reference parameter to handle forward slashes properly
      const reference = decodeURIComponent(req.params.reference);
      if (!reference) {
        return res
          .status(400)
          .json({ message: "Procedure reference is required" });
      }

      const payments = await storage.getPaymentsByProcedureReference(reference);
      res.json({ payments });
    } catch (error) {
      res
        .status(500)
        .json({ message: "Failed to retrieve payments", error: String(error) });
    }
  });

  // GET payments by payment type
  app.get("/api/payments/type/:paymentType", async (req, res) => {
    try {
      const paymentType = req.params.paymentType;
      if (!paymentType) {
        return res.status(400).json({ message: "Payment type is required" });
      }

      const payments = await storage.getPaymentsByType(paymentType);
      res.json({ payments });
    } catch (error) {
      res
        .status(500)
        .json({ message: "Failed to retrieve payments", error: String(error) });
    }
  });

  // GET a specific payment by ID
  app.get("/api/payments/:id", async (req, res) => {
    try {
      const payment = await storage.getPayment(parseInt(req.params.id));
      if (!payment) {
        return res.status(404).json({ message: "Payment not found" });
      }
      res.json({ payment });
    } catch (error) {
      res
        .status(500)
        .json({ message: "Failed to retrieve payment", error: String(error) });
    }
  });

  // POST create a new payment
  app.post("/api/payments", async (req, res) => {
    try {
      // Validate required fields
      const { procedureReference, paymentType, amount, paymentDate } = req.body;

      if (!procedureReference) {
        return res
          .status(400)
          .json({ message: "Procedure reference is required" });
      }

      if (!paymentType) {
        return res.status(400).json({ message: "Payment type is required" });
      }

      if (!amount) {
        return res.status(400).json({ message: "Amount is required" });
      }

      if (!paymentDate) {
        return res.status(400).json({ message: "Payment date is required" });
      }

      // Helper to convert date to YYYY-MM-DD string
      const formatDateString = (dateInput: string): string => {
        const d = new Date(dateInput);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      };

      // Use the admin user with ID 3, which we know exists in the database
      const adminUserId = 3;

      // Create the payment
      const newPayment = await storage.createPayment({
        procedureReference,
        paymentType,
        amount,
        paymentDate: formatDateString(paymentDate), // Keep as YYYY-MM-DD string to avoid timezone issues
        notes: req.body.notes || null,
        createdBy: adminUserId, // Using admin user ID we verified exists
      });

      res.status(201).json({ payment: newPayment });
    } catch (error) {
      res
        .status(400)
        .json({ message: "Failed to create payment", error: String(error) });
    }
  });

  // PUT update an existing payment
  app.put("/api/payments/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);

      // Check if payment exists
      const existingPayment = await storage.getPayment(id);
      if (!existingPayment) {
        return res.status(404).json({ message: "Payment not found" });
      }

      // Helper to convert date to YYYY-MM-DD string
      const formatDateString = (dateInput: string): string => {
        const d = new Date(dateInput);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      };

      // Process date if provided
      const updateData: any = {}; // Safe updateData object

      // Only include fields that are provided and valid
      if (req.body.amount !== undefined) updateData.amount = req.body.amount;
      if (req.body.paymentType) updateData.paymentType = req.body.paymentType;
      if (req.body.notes !== undefined) updateData.notes = req.body.notes;

      // Process date if provided
      if (req.body.paymentDate) {
        updateData.paymentDate = formatDateString(req.body.paymentDate);
      }

      // Update the payment
      const updatedPayment = await storage.updatePayment(id, updateData);

      res.json({ payment: updatedPayment });
    } catch (error) {
      res
        .status(400)
        .json({ message: "Failed to update payment", error: String(error) });
    }
  });

  // DELETE remove a payment
  app.delete("/api/payments/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);

      // Check if payment exists
      const existingPayment = await storage.getPayment(id);
      if (!existingPayment) {
        return res.status(404).json({ message: "Payment not found" });
      }

      // Delete the payment
      const success = await storage.deletePayment(id);

      res.json({ success });
    } catch (error) {
      res
        .status(500)
        .json({ message: "Failed to delete payment", error: String(error) });
    }
  });

  // GET financial summary for all procedures
  app.get("/api/financial-summary", async (req, res) => {
    try {
      // Get all procedures
      const allProcedures = await storage.getAllProcedures();

      // Calculate financial summary for each procedure
      const financialSummaries = await Promise.all(
        allProcedures.map(async (procedure) => {
          try {
            // Get the financial summary for this procedure
            const summary = await storage.calculateFinancialSummary(
              procedure.reference,
            );

            // Log the results for debugging
            console.log(
              `Financial summary for ${procedure.reference}:`,
              JSON.stringify(summary),
            );

            // Make sure we have numeric values
            const normalizedSummary = {
              procedureReference: procedure.reference,
              totalExpenses: parseFloat(
                summary.totalExpenses?.toString() || "0",
              ),
              advancePayments: parseFloat(
                summary.advancePayments?.toString() || "0",
              ),
              balancePayments: parseFloat(
                summary.balancePayments?.toString() || "0",
              ),
              totalPayments: parseFloat(
                summary.totalPayments?.toString() || "0",
              ),
              remainingBalance: parseFloat(
                summary.remainingBalance?.toString() || "0",
              ),
            };

            return normalizedSummary;
          } catch (err) {
            console.error(
              `Error calculating financial summary for procedure ${procedure.reference}:`,
              err,
            );
            // Return a default object with procedure reference but zero values
            return {
              procedureReference: procedure.reference,
              totalExpenses: 0,
              advancePayments: 0,
              balancePayments: 0,
              totalPayments: 0,
              remainingBalance: 0,
            };
          }
        }),
      );

      res.json({ financialSummaries });
    } catch (error) {
      console.error("Error getting all financial summaries:", error);
      res
        .status(500)
        .json({
          message: "Failed to retrieve financial summaries",
          error: String(error),
        });
    }
  });

  // GET financial summary for a specific procedure
  app.get("/api/financial-summary/:reference", async (req, res) => {
    try {
      // Decode the reference parameter to handle forward slashes properly
      const reference = decodeURIComponent(req.params.reference);
      if (!reference) {
        return res
          .status(400)
          .json({ message: "Procedure reference is required" });
      }

      // Get the financial summary
      try {
        const summaryData = await storage.calculateFinancialSummary(reference);

        // Log the results for debugging
        console.log(
          `Financial summary for specific procedure ${reference}:`,
          JSON.stringify(summaryData),
        );

        // Normalize values to ensure they're proper numbers
        const normalizedSummary = {
          totalExpenses: parseFloat(
            summaryData.totalExpenses?.toString() || "0",
          ),
          importExpenses: parseFloat(
            summaryData.importExpenses?.toString() || "0",
          ),
          serviceInvoices: parseFloat(
            summaryData.serviceInvoices?.toString() || "0",
          ),
          taxes: parseFloat(summaryData.taxes?.toString() || "0"),
          advancePayments: parseFloat(
            summaryData.advancePayments?.toString() || "0",
          ),
          balancePayments: parseFloat(
            summaryData.balancePayments?.toString() || "0",
          ),
          totalPayments: parseFloat(
            summaryData.totalPayments?.toString() || "0",
          ),
          remainingBalance: parseFloat(
            summaryData.remainingBalance?.toString() || "0",
          ),
        };

        res.json({ summary: normalizedSummary });
      } catch (err) {
        console.error(
          `Error calculating financial summary for procedure ${reference}:`,
          err,
        );
        // Return zeros if calculation fails
        res.json({
          summary: {
            totalExpenses: 0,
            importExpenses: 0,
            serviceInvoices: 0,
            taxes: 0,
            advancePayments: 0,
            balancePayments: 0,
            totalPayments: 0,
            remainingBalance: 0,
          },
        });
      }
    } catch (error) {
      console.error("Error in financial summary endpoint:", error);
      res
        .status(500)
        .json({
          message: "Failed to retrieve financial summary",
          error: String(error),
        });
    }
  });

  // GET batch financial summaries endpoint - returns all financial data in a single request
  app.get("/api/financial-summaries/batch", async (req, res) => {
    try {
      console.log("Batch financial summaries request received");
      const startTime = Date.now();

      // Get all procedures
      const procedures = await storage.getAllProcedures();
      console.log(
        `Retrieved ${procedures.length} procedures for batch financial processing`,
      );

      // Get all taxes in a single query for better performance
      const allTaxes = await storage.getAllTaxes();
      console.log(
        `Retrieved ${allTaxes.length} tax records for batch processing`,
      );

      // Get all import expenses in a single query
      const allImportExpenses = await storage.getAllImportExpenses();
      console.log(
        `Retrieved ${allImportExpenses.length} import expense records for batch processing`,
      );

      // Get all service invoices in a single query
      const allServiceInvoices = await storage.getAllImportServiceInvoices();
      console.log(
        `Retrieved ${allServiceInvoices.length} service invoice records for batch processing`,
      );

      // Get all payments in a single query
      const allPayments = await storage.getAllPayments();
      console.log(
        `Retrieved ${allPayments.length} payment records for batch processing`,
      );

      // Process all procedures
      const financialSummaries: Record<
        string,
        {
          totalTax: number;
          importExpenses: number;
          serviceInvoices: number;
          totalExpenses: number;
          advancePayments: number;
          balancePayments: number;
          remainingBalance: number;
        }
      > = {};

      // Process all procedures
      for (const procedure of procedures) {
        if (!procedure.reference) continue;

        try {
          // Find tax for this procedure
          const taxForProcedure = allTaxes.find(
            (tax) => tax.procedureReference === procedure.reference,
          );
          let totalTax = 0;

          if (taxForProcedure) {
            // Calculate total tax
            totalTax =
              parseFloat(String(taxForProcedure.customsTax || "0")) +
              parseFloat(String(taxForProcedure.additionalCustomsTax || "0")) +
              parseFloat(String(taxForProcedure.kkdf || "0")) +
              parseFloat(String(taxForProcedure.vat || "0")) +
              parseFloat(String(taxForProcedure.stampTax || "0"));
          }

          // Find import expenses for this procedure
          const expensesForProcedure = allImportExpenses.filter(
            (expense) => expense.procedureReference === procedure.reference,
          );

          // Calculate total import expenses
          let importExpenses = 0;
          for (const expense of expensesForProcedure) {
            importExpenses += parseFloat(String(expense.amount || "0"));
          }

          // Find service invoices for this procedure
          const invoicesForProcedure = allServiceInvoices.filter(
            (invoice) => invoice.procedureReference === procedure.reference,
          );

          // Calculate total service invoices
          let serviceInvoices = 0;
          for (const invoice of invoicesForProcedure) {
            serviceInvoices += parseFloat(String(invoice.amount || "0"));
          }

          // Calculate total expenses
          const totalExpenses = totalTax + importExpenses + serviceInvoices;

          // Find payments for this procedure
          const paymentsForProcedure = allPayments.filter(
            (payment) => payment.procedureReference === procedure.reference,
          );

          // Calculate payment totals
          let advancePayments = 0;
          let balancePayments = 0;

          for (const payment of paymentsForProcedure) {
            const amount = parseFloat(String(payment.amount || "0"));
            if (payment.paymentType === "advance") {
              advancePayments += amount;
            } else if (payment.paymentType === "balance") {
              balancePayments += amount;
            }
          }

          // Calculate remaining balance
          const remainingBalance =
            totalExpenses - advancePayments - balancePayments;

          // Add to the result object
          financialSummaries[procedure.reference] = {
            totalTax,
            importExpenses,
            serviceInvoices,
            totalExpenses,
            advancePayments,
            balancePayments,
            remainingBalance,
          };
        } catch (error) {
          console.error(
            `Error processing financial data for ${procedure.reference}:`,
            error,
          );
          // Add default zeroes for procedures with errors
          financialSummaries[procedure.reference] = {
            totalTax: 0,
            importExpenses: 0,
            serviceInvoices: 0,
            totalExpenses: 0,
            advancePayments: 0,
            balancePayments: 0,
            remainingBalance: 0,
          };
        }
      }

      const endTime = Date.now();
      console.log(
        `Batch financial summaries completed in ${endTime - startTime}ms`,
      );

      res.json({ financialSummaries });
    } catch (error) {
      console.error("Error in batch financial summaries endpoint:", error);
      res
        .status(500)
        .json({
          message: "Failed to retrieve batch financial summaries",
          error: String(error),
        });
    }
  });

  // Tax routes
  // GET tax by procedure reference
  app.get("/api/taxes/procedure/:reference", async (req, res) => {
    try {
      // Decode the reference parameter to handle forward slashes properly
      const reference = decodeURIComponent(req.params.reference);
      if (!reference) {
        return res
          .status(400)
          .json({ message: "Procedure reference is required" });
      }

      const tax = await storage.getTaxByProcedureReference(reference);
      console.log(
        "GET /api/taxes/procedure/:reference - Database returned tax data:",
        JSON.stringify(tax),
      );
      res.json({ tax });
    } catch (error) {
      console.error("Error in GET /api/taxes/procedure/:reference:", error);
      res
        .status(500)
        .json({
          message: "Failed to retrieve tax information",
          error: String(error),
        });
    }
  });

  // POST create tax
  app.post("/api/taxes", async (req, res) => {
    try {
      // Validate required fields
      const { procedureReference } = req.body;

      if (!procedureReference) {
        return res
          .status(400)
          .json({ message: "Procedure reference is required" });
      }

      // First, try to reset the tax sequence to prevent PK violations
      try {
        await db.execute(
          `SELECT setval('taxes_id_seq', (SELECT MAX(id) FROM taxes) + 1, false)`,
        );
        console.log("[routes] Successfully reset taxes_id_seq before creation");
      } catch (seqError) {
        console.error(
          "[routes] Error resetting tax sequence before creation:",
          seqError,
        );
        // Continue execution even if sequence reset fails
      }

      // Remove any ID from the request if it exists
      const { id, ...dataWithoutId } = req.body;
      console.log("[routes] Creating tax, removing id from input data:", id);

      // Create the tax record with a valid user ID
      const newTax = await storage.createTax({
        procedureReference,
        customsTax: dataWithoutId.customsTax || 0,
        additionalCustomsTax: dataWithoutId.additionalCustomsTax || 0,
        kkdf: dataWithoutId.kkdf || 0,
        vat: dataWithoutId.vat || 0,
        stampTax: dataWithoutId.stampTax || 0,
        createdBy: dataWithoutId.user?.id || 3, // Using admin user ID 3 instead of 1
      });

      res.status(201).json({ tax: newTax });
    } catch (error) {
      console.error("Error creating tax record:", error);

      // Handle specific error types
      let errorMessage = "Failed to create tax record";

      // Check for duplicate key error
      if (
        error instanceof Error &&
        (error.message.includes("duplicate key") ||
          error.message.includes("unique constraint"))
      ) {
        // Check for exact error message related to tax record already existing
        if (error.message.includes("Tax record already exists")) {
          errorMessage = error.message;
        } else {
          errorMessage = "Database sequence error occurred. Please try again.";

          // Try to fix the sequence in the background
          try {
            await db.execute(
              `SELECT setval('taxes_id_seq', (SELECT MAX(id) FROM taxes) + 1, false)`,
            );
            console.log("[routes] Reset tax sequence after error");
          } catch (seqError) {
            console.error(
              "[routes] Failed to reset tax sequence after error:",
              seqError,
            );
          }
        }
      }

      res.status(400).json({
        message: errorMessage,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // PUT update tax
  app.put("/api/taxes/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      console.log(
        "PUT /api/taxes/:id - Received update request for tax ID:",
        id,
      );
      console.log(
        "PUT /api/taxes/:id - Request body:",
        JSON.stringify(req.body),
      );

      // Check if tax exists
      const existingTax = await storage.getTax(id);
      console.log(
        "PUT /api/taxes/:id - Existing tax data:",
        JSON.stringify(existingTax),
      );

      if (!existingTax) {
        return res.status(404).json({ message: "Tax record not found" });
      }

      // Update the tax record
      const updateData: any = {}; // Safe updateData object

      // Only include fields that are provided and valid
      if (req.body.customsTax !== undefined)
        updateData.customsTax = req.body.customsTax;
      if (req.body.additionalCustomsTax !== undefined)
        updateData.additionalCustomsTax = req.body.additionalCustomsTax;
      if (req.body.kkdf !== undefined) updateData.kkdf = req.body.kkdf;
      if (req.body.vat !== undefined) updateData.vat = req.body.vat;
      if (req.body.stampTax !== undefined)
        updateData.stampTax = req.body.stampTax;

      console.log(
        "PUT /api/taxes/:id - Update data to be applied:",
        JSON.stringify(updateData),
      );

      const updatedTax = await storage.updateTax(id, updateData);
      console.log(
        "PUT /api/taxes/:id - Updated tax data returned:",
        JSON.stringify(updatedTax),
      );

      res.json({ tax: updatedTax });
    } catch (error) {
      console.error("Error in PUT /api/taxes/:id:", error);
      res
        .status(400)
        .json({ message: "Failed to update tax record", error: String(error) });
    }
  });

  // Import Expenses routes
  // GET expenses by procedure reference
  app.get("/api/import-expenses/procedure/:reference", async (req, res) => {
    try {
      // Decode the reference parameter to handle forward slashes properly
      const reference = decodeURIComponent(req.params.reference);
      if (!reference) {
        return res
          .status(400)
          .json({ message: "Procedure reference is required" });
      }

      const expenses = await storage.getImportExpensesByReference(reference);
      res.json({ expenses });
    } catch (error) {
      res
        .status(500)
        .json({
          message: "Failed to retrieve import expenses",
          error: String(error),
        });
    }
  });

  // GET expenses by procedure reference and category
  app.get(
    "/api/import-expenses/procedure/:reference/category/:category",
    async (req, res) => {
      try {
        // Decode the reference parameter to handle forward slashes properly
        const reference = decodeURIComponent(req.params.reference);
        const { category } = req.params;
        if (!reference || !category) {
          return res
            .status(400)
            .json({ message: "Procedure reference and category are required" });
        }

        const expenses = await storage.getImportExpensesByCategory(
          reference,
          category,
        );
        res.json({ expenses });
      } catch (error) {
        res
          .status(500)
          .json({
            message: "Failed to retrieve import expenses",
            error: String(error),
          });
      }
    },
  );

  // POST new import expense
  app.post("/api/import-expenses", async (req, res) => {
    try {
      // Validate and sanitize input data
      const {
        procedureReference,
        category,
        amount,
        currency,
        invoiceNumber,
        invoiceDate,
        documentNumber,
        policyNumber,
        issuer,
        notes,
      } = req.body;

      // Helper to convert date to YYYY-MM-DD string
      const formatDateString = (dateInput: string): string => {
        const d = new Date(dateInput);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      };

      // Safe data conversion with null checks
      const validatedExpense = {
        procedureReference: procedureReference
          ? String(procedureReference)
          : "",
        category: category ? String(category) : "",
        amount: amount ? String(amount) : "0",
        currency: currency ? String(currency) : "TRY",
        invoiceNumber: invoiceNumber ? String(invoiceNumber) : null,
        invoiceDate: invoiceDate ? formatDateString(invoiceDate) : null,
        documentNumber: documentNumber ? String(documentNumber) : null,
        policyNumber: policyNumber ? String(policyNumber) : null,
        issuer: issuer ? String(issuer) : null,
        notes: notes ? String(notes) : null,
        createdBy: 3, // Admin user ID
      };

      console.log(
        "Creating import expense with validated data:",
        validatedExpense,
      );
      const expense = await storage.createImportExpense(validatedExpense);
      res.json({ expense });
    } catch (error) {
      console.error("Error creating import expense:", error);
      res
        .status(500)
        .json({
          message: "Failed to create import expense",
          error: String(error),
        });
    }
  });

  // PUT update import expense
  app.put("/api/import-expenses/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid expense ID" });
      }

      // Validate and sanitize input data (same as POST route)
      const {
        procedureReference,
        category,
        amount,
        currency,
        invoiceNumber,
        invoiceDate,
        documentNumber,
        policyNumber,
        issuer,
        notes,
      } = req.body;

      // Helper to convert date to YYYY-MM-DD string
      const formatDateString = (dateInput: string): string => {
        const d = new Date(dateInput);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      };

      // Safe data conversion with null checks
      const validatedExpense = {
        procedureReference: procedureReference
          ? String(procedureReference)
          : undefined,
        category: category ? String(category) : undefined,
        amount: amount ? String(amount) : undefined,
        currency: currency ? String(currency) : undefined,
        invoiceNumber: invoiceNumber ? String(invoiceNumber) : null,
        invoiceDate: invoiceDate ? formatDateString(invoiceDate) : null,
        documentNumber: documentNumber ? String(documentNumber) : null,
        policyNumber: policyNumber ? String(policyNumber) : null,
        issuer: issuer ? String(issuer) : null,
        notes: notes ? String(notes) : null,
      };

      console.log(
        "Updating import expense with validated data:",
        validatedExpense,
      );
      const expense = await storage.updateImportExpense(id, validatedExpense);
      if (!expense) {
        return res.status(404).json({ message: "Import expense not found" });
      }

      res.json({ expense });
    } catch (error) {
      console.error("Error updating import expense:", error);
      res
        .status(500)
        .json({
          message: "Failed to update import expense",
          error: String(error),
        });
    }
  });

  // DELETE import expense
  app.delete("/api/import-expenses/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid expense ID" });
      }

      const success = await storage.deleteImportExpense(id);
      if (!success) {
        return res.status(404).json({ message: "Import expense not found" });
      }

      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting import expense:", error);
      res
        .status(500)
        .json({
          message: "Failed to delete import expense",
          error: String(error),
        });
    }
  });

  // GET expense analytics data by date range and optional procedure references
  app.get("/api/expenses/analytics", async (req, res) => {
    try {
      const { startDate, endDate, procedureRefs } = req.query;

      console.log("[/api/expenses/analytics] Request query params:", {
        startDate,
        endDate,
        procedureRefs,
      });

      if (!startDate || !endDate) {
        console.log(
          "[/api/expenses/analytics] Missing required date parameters",
        );
        return res
          .status(400)
          .json({ message: "Start date and end date are required" });
      }

      // Check that startDate and endDate are valid strings formatted as ISO dates
      if (
        !(typeof startDate === "string") ||
        !(typeof endDate === "string") ||
        !startDate.match(/^\d{4}-\d{2}-\d{2}/) ||
        !endDate.match(/^\d{4}-\d{2}-\d{2}/)
      ) {
        console.log("[/api/expenses/analytics] Invalid date format");
        return res.status(400).json({ message: "Invalid date format" });
      }

      const start = startDate as string;
      const end = endDate as string;

      console.log("[/api/expenses/analytics] Date range:", {
        start,
        end,
      });

      // Parse the procedure references if provided
      let procedureReferences: string[] = [];
      if (procedureRefs) {
        try {
          // Handle three possible cases:
          // 1. Array of strings already (from server-side call)
          // 2. JSON string of array (from client-side call)
          // 3. Single string value (from simple form submission)
          if (Array.isArray(procedureRefs)) {
            procedureReferences = procedureRefs as string[];
          } else if (typeof procedureRefs === "string") {
            // Try to parse as JSON first
            try {
              const parsed = JSON.parse(procedureRefs);
              if (Array.isArray(parsed)) {
                procedureReferences = parsed;
              } else {
                procedureReferences = [String(parsed)];
              }
            } catch (jsonError) {
              // Not JSON, treat as single string value
              procedureReferences = [procedureRefs];
            }
          }

          console.log(
            "[/api/expenses/analytics] Parsed procedure references:",
            procedureReferences,
          );
        } catch (e) {
          console.log(
            "[/api/expenses/analytics] Error parsing procedure references:",
            e,
          );
          return res
            .status(400)
            .json({ message: "Invalid procedure references format" });
        }
      }

      // Get data from storage
      console.log("[/api/expenses/analytics] Requesting data from storage...");
      try {
        const analyticsData = await storage.getExpensesByCategoryAndDateRange(
          start,
          end,
          procedureReferences,
        );

        // Ensure we're working with numerical values for reduction
        const totalAmount = analyticsData.reduce((sum, item) => {
          const amount =
            typeof item.totalAmount === "string"
              ? parseFloat(item.totalAmount)
              : Number(item.totalAmount);
          return sum + (isNaN(amount) ? 0 : amount);
        }, 0);

        const totalCount = analyticsData.reduce((sum, item) => {
          const count =
            typeof item.count === "string"
              ? parseInt(item.count)
              : Number(item.count);
          return sum + (isNaN(count) ? 0 : count);
        }, 0);

        console.log("[/api/expenses/analytics] Received data from storage:", {
          categories: analyticsData.length,
          totalExpenseAmount: totalAmount,
          totalExpenseCount: totalCount,
          data: analyticsData,
        });

        // Ensure we're setting proper Content-Type header
        res.setHeader("Content-Type", "application/json");
        // Send properly formatted JSON response with 200 status
        return res.status(200).json({ data: analyticsData });
      } catch (storageError) {
        console.error("[/api/expenses/analytics] Storage error:", storageError);
        return res.status(500).json({
          message: "Failed to retrieve expense data from storage",
          error: String(storageError),
        });
      }
    } catch (error) {
      console.error(
        "[/api/expenses/analytics] Error retrieving expense analytics:",
        error,
      );
      // Ensure we're setting proper Content-Type header
      res.setHeader("Content-Type", "application/json");
      return res.status(500).json({
        message: "Failed to retrieve expense analytics",
        error: String(error),
      });
    }
  });

  // Fixed expense trend chart API - Always showing all historical data
  app.get("/api/expenses/trend", async (req, res) => {
    // Get query parameters with defaults
    const category = req.query.category as string;
    const groupBy = (req.query.groupBy as string) || "month";

    // Date range parameters are received but not used for filtering
    // We'll include them in the response for reference only
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;

    if (!category) {
      return res.status(400).json({ message: "Category is required" });
    }

    // Log the request
    console.log(
      `[Trend API] Request for ${category}, date range: ${startDate} to ${endDate}`,
    );

    try {
      // Import the correct pool from db.ts
      const { pool } = await import("./db");

      // Query the database using pool.query - get ALL expense data for the selected category
      // Join with procedures to get import_dec_date instead of expense date
      const result = await pool.query(`
        SELECT 
          e.id, 
          e.amount::numeric as amount,
          e.category,
          p.import_dec_date as date,
          e.procedure_reference
        FROM 
          import_expenses e
        JOIN
          procedures p ON e.procedure_reference = p.reference
        WHERE 
          e.category = '${category}'
        ORDER BY
          p.import_dec_date ASC
      `);

      // Process the results directly with the async/await approach
      // No date filtering - include all expenses for a complete history
      // Using import declaration date instead of expense date
      const expenses = result.rows
        .map((row) => ({
          id: row.id,
          amount: parseFloat(row.amount?.toString() || "0"),
          date: row.date ? new Date(row.date) : null,
          procedureReference: row.procedure_reference,
        }))
        .filter((expense) => expense.date !== null);

      console.log(
        `[Trend API] Using procedure import declaration dates for ${expenses.length} expenses in ${category} category`,
      );

      console.log(
        `[Trend API] Found ${expenses.length} expenses for category ${category}`,
      );

      // Create periods for the chart based on the actual expense data, not the query parameters
      const periods = [];

      // Use the actual min and max dates from the data itself for a complete history
      let start, end;

      if (expenses.length > 0) {
        // Find the earliest and latest expense dates
        const dates = expenses.map((exp) => exp.date).filter((d) => d !== null);
        start = new Date(Math.min(...dates.map((d) => d.getTime())));
        end = new Date(Math.max(...dates.map((d) => d.getTime())));
      } else {
        // Fallback if no data
        const now = new Date();
        start = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000); // 1 year ago
        end = now;
      }

      if (groupBy === "week") {
        // Generate better weekly periods with month name included
        let current = new Date(start);
        while (current <= end) {
          // Get ISO week number (more standard way to get week)
          const d = new Date(current);
          d.setHours(0, 0, 0, 0);
          d.setDate(d.getDate() + 4 - (d.getDay() || 7)); // Set to Thursday of this week
          const yearStart = new Date(d.getFullYear(), 0, 1);
          const weekNum = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);

          // Get month name for better labeling
          const monthName = current.toLocaleString("default", {
            month: "short",
          });
          const year = current.getFullYear();

          periods.push({
            period: `Week ${weekNum} (${monthName}), ${year}`,
            amount: 0,
            date: new Date(current),
          });

          // Move to next week
          current.setDate(current.getDate() + 7);
        }
      } else {
        // Generate monthly periods
        let year = start.getFullYear();
        let month = start.getMonth();

        while (new Date(year, month, 1) <= end) {
          const periodDate = new Date(year, month, 1);

          periods.push({
            period: periodDate.toLocaleDateString("en-US", {
              month: "long",
              year: "numeric",
            }),
            amount: 0,
            date: new Date(periodDate),
          });

          month++;
          if (month > 11) {
            month = 0;
            year++;
          }
        }
      }

      // Add expense amounts to the appropriate periods
      expenses.forEach((expense) => {
        if (!expense.date) return;

        const expDate = expense.date;

        if (groupBy === "week") {
          // Find the matching week using ISO week calculation
          const expD = new Date(expDate);
          expD.setHours(0, 0, 0, 0);
          expD.setDate(expD.getDate() + 4 - (expD.getDay() || 7)); // Set to Thursday of this week
          const expYearStart = new Date(expD.getFullYear(), 0, 1);
          const expWeek = Math.ceil(((expD - expYearStart) / 86400000 + 1) / 7);
          const expYear = expD.getFullYear();

          const matchingPeriod = periods.find((p) => {
            // Get the ISO week for the period date
            const periodD = new Date(p.date);
            periodD.setHours(0, 0, 0, 0);
            periodD.setDate(periodD.getDate() + 4 - (periodD.getDay() || 7)); // Set to Thursday of this week
            const periodYearStart = new Date(periodD.getFullYear(), 0, 1);
            const periodWeek = Math.ceil(
              ((periodD - periodYearStart) / 86400000 + 1) / 7,
            );
            const periodYear = periodD.getFullYear();

            return periodYear === expYear && periodWeek === expWeek;
          });

          if (matchingPeriod) {
            matchingPeriod.amount += expense.amount;
          }
        } else {
          // Find the matching month
          const expYear = expDate.getFullYear();
          const expMonth = expDate.getMonth();

          const matchingPeriod = periods.find((p) => {
            const periodDate = new Date(p.date);
            return (
              periodDate.getFullYear() === expYear &&
              periodDate.getMonth() === expMonth
            );
          });

          if (matchingPeriod) {
            matchingPeriod.amount += expense.amount;
          }
        }
      });

      // Return the data
      return res.json({
        data: periods,
        category,
        dateRange: { start: startDate, end: endDate },
        groupBy,
      });
    } catch (error) {
      console.error("[Trend API] Error:", error);
      return res.status(500).json({
        message: "Unexpected error in expense trend API",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
  app.get("/api/expense-documents/:id", async (req, res) => {
    try {
      const document = await storage.getExpenseDocument(
        parseInt(req.params.id),
      );
      if (!document) {
        return res.status(404).json({ message: "Document not found" });
      }
      res.json({ document });
    } catch (error) {
      res
        .status(500)
        .json({ message: "Failed to retrieve document", error: String(error) });
    }
  });

  // GET documents by expense type and ID
  app.get("/api/expense-documents/expense/:type/:id", async (req, res) => {
    try {
      const { type, id } = req.params;
      if (!type || !id) {
        return res
          .status(400)
          .json({ message: "Expense type and ID are required" });
      }

      const documents = await storage.getExpenseDocumentsByExpense(
        type,
        parseInt(id),
      );
      res.json({ documents });
    } catch (error) {
      res
        .status(500)
        .json({
          message: "Failed to retrieve documents",
          error: String(error),
        });
    }
  });

  // GET documents by procedure reference
  app.get("/api/expense-documents/procedure/:reference", async (req, res) => {
    try {
      // Decode the reference parameter to handle forward slashes properly
      const reference = decodeURIComponent(req.params.reference);
      if (!reference) {
        return res
          .status(400)
          .json({ message: "Procedure reference is required" });
      }

      const documents = await storage.getExpenseDocumentsByReference(reference);
      res.json({ documents });
    } catch (error) {
      res
        .status(500)
        .json({
          message: "Failed to retrieve documents",
          error: String(error),
        });
    }
  });

  // Debug endpoint to check stored objects in Replit Object Storage
  app.get("/api/debug/storage-keys", async (req, res) => {
    try {
      const prefix = (req.query.prefix as string) || "";
      console.log(
        `Listing all objects in Replit Object Storage with prefix: "${prefix}"`,
      );
      const keys = await listAllKeys(prefix);
      console.log("Found objects:", keys);
      res.json({ prefix, keys });
    } catch (error) {
      console.error("Error listing objects:", error);
      res
        .status(500)
        .json({
          message: "Failed to list storage objects",
          error: String(error),
        });
    }
  });

  // Download a document from cloud storage
  app.get("/api/expense-documents/:id/download", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      // Check if this is a preview request or a download request
      const isPreview = req.query.preview === "true";

      // Get document metadata from database
      const document = await storage.getExpenseDocument(id);
      if (!document) {
        return res.status(404).json({ message: "Document not found" });
      }

      // Log the document info for debugging
      console.log(
        `Document requested: ID ${id}, Filename: ${document.originalFilename}, Type: ${document.fileType}, Object Key: ${document.objectKey || "N/A"}`,
      );

      // If document is in Replit Object Storage
      if (document.objectKey) {
        // Get the file from storage
        try {
          console.log(
            `Retrieving file from Replit Object Storage, key: ${document.objectKey}`,
          );
          const { buffer, contentType } = await getFile(document.objectKey);

          // Verify buffer contents
          console.log("Download result:", {
            ok: !!buffer,
            valueType: typeof buffer,
            isArray: Array.isArray(buffer),
            valueLength: buffer ? buffer.length : 0,
            valueBufferCheck: Buffer.isBuffer(buffer),
          });

          if (!buffer || buffer.length === 0) {
            console.error("Retrieved empty buffer from storage");
            return res
              .status(404)
              .json({ message: "Empty file or file not found" });
          }

          console.log(
            `File retrieved successfully, size: ${buffer.length} bytes, type: ${contentType}`,
          );

          // Set appropriate headers based on file type and request type
          res.setHeader("Content-Type", contentType);

          // For download requests, set attachment disposition
          if (!isPreview) {
            res.setHeader(
              "Content-Disposition",
              `attachment; filename="${encodeURIComponent(document.originalFilename)}"`,
            );
          } else {
            // For preview requests, use inline disposition
            res.setHeader(
              "Content-Disposition",
              `inline; filename="${encodeURIComponent(document.originalFilename)}"`,
            );
          }

          // Set permissive CORS headers to enable PDF.js and other viewers to work properly
          res.setHeader("Access-Control-Allow-Origin", "*");
          res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
          res.setHeader("Access-Control-Allow-Headers", "Content-Type, Range");
          res.setHeader(
            "Access-Control-Expose-Headers",
            "Content-Length, Content-Range, Content-Type",
          );

          // Add content length header
          res.setHeader("Content-Length", buffer.length);

          // Caching headers
          if (isPreview) {
            // Prevent caching for preview to ensure latest version is shown
            res.setHeader(
              "Cache-Control",
              "no-cache, no-store, must-revalidate",
            );
            res.setHeader("Pragma", "no-cache");
            res.setHeader("Expires", "0");
          } else {
            // Allow some caching for downloads
            res.setHeader("Cache-Control", "private, max-age=300");
          }

          // Send the file
          return res.send(buffer);
        } catch (storageError) {
          console.error("Error retrieving file from storage:", storageError);
          return res.status(404).json({ message: "File not found in storage" });
        }
      }
      // Fallback for legacy documents stored on disk
      else if (document.filePath && fs.existsSync(document.filePath)) {
        console.log(`File found on disk at path: ${document.filePath}`);

        if (isPreview) {
          // For preview, read the file and send with inline disposition
          const fileData = fs.readFileSync(document.filePath);
          const contentType =
            mime.lookup(document.filePath) || "application/octet-stream";

          console.log(
            `Serving file from disk: ${document.originalFilename}, size: ${fileData.length} bytes, type: ${contentType}`,
          );

          res.setHeader("Content-Type", contentType);
          res.setHeader(
            "Content-Disposition",
            `inline; filename="${encodeURIComponent(document.originalFilename)}"`,
          );

          // Set permissive CORS headers
          res.setHeader("Access-Control-Allow-Origin", "*");
          res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
          res.setHeader("Access-Control-Allow-Headers", "Content-Type, Range");
          res.setHeader(
            "Access-Control-Expose-Headers",
            "Content-Length, Content-Range, Content-Type",
          );

          res.setHeader("Content-Length", fileData.length);
          res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
          res.setHeader("Pragma", "no-cache");
          res.setHeader("Expires", "0");

          return res.send(fileData);
        } else {
          // For download, use res.download with appropriate headers
          res.setHeader("Access-Control-Allow-Origin", "*");
          res.setHeader("Cache-Control", "private, max-age=300");
          return res.download(document.filePath, document.originalFilename);
        }
      } else {
        console.error("Document file not found. No valid storage location.");
        return res.status(404).json({ message: "Document file not found" });
      }
    } catch (error) {
      console.error("Error downloading document:", error);
      res
        .status(500)
        .json({ message: "Failed to download document", error: String(error) });
    }
  });

  // Endpoint for direct access to a file by objectKey (used by PDF.js and document viewers)
  app.get("/api/expense-documents/file/:objectKey", async (req, res) => {
    try {
      const objectKey = decodeURIComponent(req.params.objectKey);
      // Check if this is a preview request or a download request
      const isPreview = req.query.preview === "true";

      // Extract the original filename from the objectKey
      // Format is typically SOHO/[procedure-id]/[timestamp]-[filename]
      let originalFilename = objectKey.split("/").pop() || "download";
      // Remove timestamp prefix if present (format: 1234567890-filename.ext)
      if (originalFilename.includes("-")) {
        originalFilename = originalFilename.split("-").slice(1).join("-");
      }

      console.log(
        `Preparing to serve file: ${objectKey}, filename: ${originalFilename}, preview: ${isPreview}`,
      );

      // Get the file from storage
      try {
        console.log(
          `Retrieving file from Replit Object Storage, key: ${objectKey}`,
        );
        const { buffer, contentType } = await getFile(objectKey);

        // Verify buffer contents
        console.log("Download result:", {
          ok: !!buffer,
          valueType: typeof buffer,
          isArray: Array.isArray(buffer),
          valueLength: buffer ? buffer.length : 0,
          valueBufferCheck: Buffer.isBuffer(buffer),
          firstItemCheck:
            Buffer.isBuffer(buffer) && buffer.length > 0
              ? `First item type: ${typeof buffer[0]}, is Buffer: ${Buffer.isBuffer(buffer[0])}`
              : "N/A",
        });

        if (!buffer || buffer.length === 0) {
          console.error("Retrieved empty buffer from storage");
          return res
            .status(404)
            .json({ message: "Empty file or file not found" });
        }

        console.log(
          `File retrieved successfully from Replit Object Storage: ${objectKey}`,
        );
        console.log(
          `Serving file: ${originalFilename}, size: ${buffer.length} bytes, type: ${contentType}`,
        );

        // Set appropriate headers based on file type and request type
        res.setHeader("Content-Type", contentType);

        // For download requests, set attachment disposition
        if (!isPreview) {
          res.setHeader(
            "Content-Disposition",
            `attachment; filename="${encodeURIComponent(originalFilename)}"`,
          );
        } else {
          // For preview requests, use inline disposition
          res.setHeader(
            "Content-Disposition",
            `inline; filename="${encodeURIComponent(originalFilename)}"`,
          );
        }

        // Set permissive CORS headers to enable PDF.js and other viewers to work properly
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Range");
        res.setHeader(
          "Access-Control-Expose-Headers",
          "Content-Length, Content-Range, Content-Type",
        );

        // Add security headers but make them more permissive for PDF.js to work
        res.setHeader("X-Content-Type-Options", "nosniff");

        // Caching headers
        res.setHeader("Content-Length", buffer.length);
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate"); // Prevent caching for document preview
        res.setHeader("Pragma", "no-cache");
        res.setHeader("Expires", "0");

        // Send the file
        return res.send(buffer);
      } catch (storageError) {
        console.error("Error retrieving file from storage:", storageError);
        return res.status(404).json({ message: "File not found in storage" });
      }
    } catch (error) {
      console.error("Error serving file:", error);
      res
        .status(500)
        .json({ message: "Failed to serve file", error: String(error) });
    }
  });

  // POST upload a document
  app.post(
    "/api/expense-documents",
    upload.single("file"),
    async (req, res) => {
      try {
        // Check if file was uploaded successfully
        if (!req.file) {
          return res.status(400).json({ message: "No file uploaded" });
        }

        // Get form data
        const {
          procedureReference,
          expenseType,
          expenseId,
          importDocumentType,
        } = req.body;

        if (!procedureReference) {
          return res
            .status(400)
            .json({ message: "Procedure reference is required" });
        }

        if (!expenseType) {
          return res.status(400).json({ message: "Expense type is required" });
        }

        if (!expenseId) {
          return res.status(400).json({ message: "Expense ID is required" });
        }

        // Import document type is required when expenseType is 'import_document'
        if (expenseType === "import_document" && !importDocumentType) {
          return res
            .status(400)
            .json({
              message: "Import document type is required for import documents",
            });
        }

        // Extract file details from the uploaded file
        const file = req.file;
        const originalFilename = file.originalname;
        const fileSize = file.size;
        const fileType = file.mimetype;

        // Upload file to Replit Object Storage with procedure reference folder
        const objectKey = await uploadFile(
          file.buffer,
          originalFilename,
          fileType,
          procedureReference,
        );

        // Create document upload data
        const documentData: any = {
          procedureReference,
          expenseType,
          expenseId: parseInt(expenseId),
          originalFilename,
          objectKey, // Store the cloud storage object key
          fileSize,
          fileType,
          uploadedBy: req.body.user?.id || 3, // Using admin user ID 3 instead of 1
        };

        // Add importDocumentType if provided
        if (importDocumentType) {
          documentData.importDocumentType = importDocumentType;
        }

        // Create the document record with cloud storage info
        const newDocument = await storage.uploadExpenseDocument(documentData);

        res.status(201).json({ document: newDocument });
      } catch (error) {
        console.error("Error uploading document:", error);
        res
          .status(400)
          .json({ message: "Failed to upload document", error: String(error) });
      }
    },
  );

  // POST attach an already-uploaded PDF to an expense (used for auto-attach from PDF analysis)
  app.post("/api/expense-documents/attach", async (req, res) => {
    try {
      const {
        procedureReference,
        expenseType,
        expenseId,
        objectKey,
        originalFilename,
        fileSize,
        fileType,
      } = req.body;

      // Validate required fields
      if (!procedureReference) {
        return res.status(400).json({ message: "Procedure reference is required" });
      }
      if (!expenseType) {
        return res.status(400).json({ message: "Expense type is required" });
      }
      if (!expenseId) {
        return res.status(400).json({ message: "Expense ID is required" });
      }
      if (!objectKey) {
        return res.status(400).json({ message: "Object key is required" });
      }

      console.log("[Auto-attach] Creating document record for:", {
        procedureReference,
        expenseType,
        expenseId,
        objectKey,
        originalFilename
      });

      // Create document record linking the already-uploaded PDF to the expense
      const documentData: any = {
        procedureReference,
        expenseType,
        expenseId: parseInt(expenseId),
        originalFilename: originalFilename || "analyzed-document.pdf",
        objectKey,
        fileSize: parseInt(fileSize) || 0,
        fileType: fileType || "application/pdf",
        uploadedBy: 3, // Admin user ID
      };

      const newDocument = await storage.uploadExpenseDocument(documentData);
      console.log("[Auto-attach] Document record created:", newDocument.id);

      res.status(201).json({ document: newDocument });
    } catch (error) {
      console.error("Error attaching document:", error);
      res.status(400).json({ 
        message: "Failed to attach document", 
        error: String(error) 
      });
    }
  });

  // GET documents by expense type and ID
  app.get(
    "/api/expense-documents/expense/:expenseType/:expenseId",
    async (req, res) => {
      try {
        const { expenseType, expenseId } = req.params;

        if (!expenseType || !expenseId) {
          return res
            .status(400)
            .json({ message: "Expense type and ID are required" });
        }

        // Get documents for this expense
        const documents = await storage.getExpenseDocumentsByExpense(
          expenseType,
          parseInt(expenseId),
        );

        res.json({ documents });
      } catch (error) {
        console.error("Error retrieving documents:", error);
        res
          .status(500)
          .json({
            message: "Failed to retrieve documents",
            error: String(error),
          });
      }
    },
  );

  // DELETE remove a document
  app.delete("/api/expense-documents/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);

      // Check if document exists
      const existingDocument = await storage.getExpenseDocument(id);
      if (!existingDocument) {
        return res.status(404).json({ message: "Document not found" });
      }

      // Delete the file from cloud storage if we have an objectKey
      if (existingDocument.objectKey) {
        try {
          await deleteFile(existingDocument.objectKey);
        } catch (cloudError) {
          console.error("Error deleting file from cloud storage:", cloudError);
          // Continue even if cloud deletion fails
        }
      }
      // Backwards compatibility for legacy files stored on disk
      else if (
        existingDocument.filePath &&
        fs.existsSync(existingDocument.filePath)
      ) {
        try {
          fs.unlinkSync(existingDocument.filePath);
        } catch (fileError) {
          console.error("Error deleting legacy file from disk:", fileError);
        }
      }

      // Delete the document from database
      const success = await storage.deleteExpenseDocument(id);

      res.json({ success });
    } catch (error) {
      res
        .status(500)
        .json({ message: "Failed to delete document", error: String(error) });
    }
  });

  // Procedure Status Details Endpoints

  // Get all status details for a procedure
  app.get("/api/procedure-status-details/:reference", async (req, res) => {
    try {
      // Decode the reference parameter to handle forward slashes properly
      const reference = decodeURIComponent(req.params.reference);
      const statusDetails = await storage.getProcedureStatusDetails(reference);
      res.json({ statusDetails });
    } catch (error) {
      console.error("Error fetching procedure status details:", error);
      res
        .status(500)
        .json({
          message: "Failed to fetch procedure status details",
          error: String(error),
        });
    }
  });

  // Get status details by category for a procedure
  app.get(
    "/api/procedure-status-details/:reference/:category",
    async (req, res) => {
      try {
        // Decode the reference parameter to handle forward slashes properly
        const reference = decodeURIComponent(req.params.reference);
        const { category } = req.params;
        const statusDetails = await storage.getProcedureStatusDetailsByCategory(
          reference,
          category,
        );
        res.json({ statusDetails });
      } catch (error) {
        console.error(
          "Error fetching procedure status details by category:",
          error,
        );
        res
          .status(500)
          .json({
            message: "Failed to fetch procedure status details by category",
            error: String(error),
          });
      }
    },
  );

  // Update status details (upsert single status)
  app.post("/api/procedure-status-details", async (req, res) => {
    try {
      const statusDetail = req.body;
      const result = await storage.upsertProcedureStatusDetail(statusDetail);
      res.json({ statusDetail: result });
    } catch (error) {
      console.error("Error updating procedure status detail:", error);
      res
        .status(500)
        .json({
          message: "Failed to update procedure status detail",
          error: String(error),
        });
    }
  });

  // Update multiple status details for a category
  app.post(
    "/api/procedure-status-details/:reference/:category",
    async (req, res) => {
      try {
        const { reference, category } = req.params;
        const statusList = req.body.statusList;

        if (!Array.isArray(statusList)) {
          return res
            .status(400)
            .json({ message: "Status list must be an array" });
        }

        const results = await storage.updateProcedureStatusDetails(
          reference,
          category,
          statusList,
        );
        res.json({ statusDetails: results });
      } catch (error) {
        console.error("Error updating procedure status details:", error);
        res
          .status(500)
          .json({
            message: "Failed to update procedure status details",
            error: String(error),
          });
      }
    },
  );

  // Delete a status detail
  app.delete("/api/procedure-status-details/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const success = await storage.deleteProcedureStatusDetail(id);
      res.json({ success });
    } catch (error) {
      console.error("Error deleting procedure status detail:", error);
      res
        .status(500)
        .json({
          message: "Failed to delete procedure status detail",
          error: String(error),
        });
    }
  });

  // Financial API endpoints

  // Get financial summary for a specific procedure
  app.get("/api/procedure-financial-summary/:reference", async (req, res) => {
    try {
      // Decode the reference parameter to handle forward slashes properly
      const reference = decodeURIComponent(req.params.reference);
      const summary = await storage.getProcedureFinancialSummary(reference);
      res.json({ summary });
    } catch (error) {
      console.error("Error fetching procedure financial summary:", error);
      res
        .status(500)
        .json({
          message: "Failed to fetch procedure financial summary",
          error: String(error),
        });
    }
  });

  // Get expense analytics data with date range and optional procedure filter
  app.get("/api/expense-analytics", async (req, res) => {
    try {
      // Parse date range parameters, defaulting to current month if not provided
      const today = new Date();
      const startDate = req.query.startDate
        ? new Date(req.query.startDate as string)
        : new Date(today.getFullYear(), today.getMonth(), 1);

      const endDate = req.query.endDate
        ? new Date(req.query.endDate as string)
        : new Date(today.getFullYear(), today.getMonth() + 1, 0);

      // Parse procedure references parameter if provided
      const procedureReferences = req.query.procedureReferences
        ? (req.query.procedureReferences as string).split(",")
        : [];

      console.log("Expense analytics request params:", {
        startDate,
        endDate,
        procedureReferences,
      });

      // Get expense analytics data
      const expenseData = await storage.getExpensesByCategoryAndDateRange(
        startDate,
        endDate,
        procedureReferences,
      );

      res.json({ expenseData });
    } catch (error) {
      console.error("Error fetching expense analytics:", error);
      res
        .status(500)
        .json({
          message: "Failed to fetch expense analytics",
          error: String(error),
        });
    }
  });

  // Dashboard API endpoints

  // Simple test endpoint for dashboard
  app.get("/api/dashboard/test", (req, res) => {
    res.json({ message: "Dashboard API is working", timestamp: new Date() });
  });

  // Dashboard snapshot endpoint for key metrics
  app.get("/api/dashboard/snapshot", async (req, res) => {
    try {
      console.log("Dashboard snapshot endpoint called");

      // Get raw data with safe text handling
      const proceduresQuery = `
        SELECT 
          amount::text as amount, 
          currency, 
          piece::text as piece, 
          usdtl_rate::text as usdtl_rate 
        FROM procedures
      `;
      const proceduresResult = await rawDb.query(proceduresQuery);

      const taxesQuery = `
        SELECT 
          customs_tax::text as customs_tax, 
          additional_customs_tax::text as additional_customs_tax, 
          kkdf::text as kkdf, 
          vat::text as vat, 
          stamp_tax::text as stamp_tax 
        FROM taxes
      `;
      const taxesResult = await rawDb.query(taxesQuery);

      const expensesQuery = `SELECT amount::text as amount, currency FROM import_expenses`;
      const expensesResult = await rawDb.query(expensesQuery);

      const invoicesQuery = `SELECT amount::text as amount, currency FROM import_service_invoices`;
      const invoicesResult = await rawDb.query(invoicesQuery);

      // Helper function to safely parse numbers
      const safeParseFloat = (value) => {
        if (!value || value === "" || value === null || value === undefined)
          return 0;
        const num = parseFloat(String(value).trim());
        return isNaN(num) ? 0 : num;
      };

      // Calculate metrics
      let totalValueUSD = 0;
      let totalPieces = 0;
      let totalTaxPaid = 0;
      let totalExpensesPaid = 0;

      // Calculate total value and pieces from procedures
      for (const procedure of proceduresResult.rows) {
        const amount = safeParseFloat(procedure.amount);
        if (amount > 0 && procedure.currency) {
          if (procedure.currency === "USD") {
            totalValueUSD += amount;
          } else if (procedure.currency === "TRY") {
            const rate = safeParseFloat(procedure.usdtl_rate);
            if (rate > 0) {
              totalValueUSD += amount / rate;
            } else {
              // Use a default rate if no rate available (e.g., 30 TRY = 1 USD)
              totalValueUSD += amount / 30;
            }
          } else {
            totalValueUSD += amount;
          }
        }

        totalPieces += safeParseFloat(procedure.piece);
      }

      // Calculate total taxes
      for (const tax of taxesResult.rows) {
        totalTaxPaid +=
          safeParseFloat(tax.customs_tax) +
          safeParseFloat(tax.additional_customs_tax) +
          safeParseFloat(tax.kkdf) +
          safeParseFloat(tax.vat) +
          safeParseFloat(tax.stamp_tax);
      }

      // Calculate total import expenses
      for (const expense of expensesResult.rows) {
        totalExpensesPaid += safeParseFloat(expense.amount);
      }

      // Calculate total service invoices
      for (const invoice of invoicesResult.rows) {
        totalExpensesPaid += safeParseFloat(invoice.amount);
      }

      const snapshot = {
        totalValueUSD: Math.round(totalValueUSD * 100) / 100,
        totalPieces: Math.round(totalPieces),
        totalTaxPaid: Math.round(totalTaxPaid * 100) / 100,
        totalExpensesPaid: Math.round(totalExpensesPaid * 100) / 100,
      };

      console.log("Dashboard snapshot calculated:", snapshot);
      res.json(snapshot);
    } catch (error) {
      console.error("Error fetching dashboard snapshot:", error);
      res
        .status(500)
        .json({
          message: "Failed to fetch dashboard snapshot",
          error: String(error),
        });
    }
  });

  // GET active procedures (where shipment_status is not 'closed')
  app.get("/api/dashboard/active-procedures", async (req, res) => {
    try {
      console.log("Active procedures endpoint called");

      // Use the raw query with pool instead
      const query = `
        SELECT reference, shipment_status, document_status, payment_status, created_at
        FROM procedures 
        WHERE shipment_status != 'closed' OR shipment_status IS NULL
        ORDER BY created_at DESC
      `;

      const result = await rawDb.query(query);
      console.log("Active procedures result:", { rowCount: result.rowCount });

      res.json({
        count: result.rowCount || 0,
        procedures: result.rows || [],
      });
    } catch (error) {
      console.error("Error fetching active procedures:", error);
      res.status(500).json({
        error: "Failed to fetch active procedures",
      });
    }
  });

  // GET pending documents (where document_status is not 'closed')
  app.get("/api/dashboard/pending-documents", async (req, res) => {
    try {
      console.log("Pending documents endpoint called");

      const query = `
        SELECT reference, shipment_status, document_status, payment_status, created_at
        FROM procedures 
        WHERE document_status != 'closed' OR document_status IS NULL
        ORDER BY created_at DESC
      `;

      const result = await rawDb.query(query);
      console.log("Pending documents result:", { rowCount: result.rowCount });

      res.json({
        count: result.rowCount || 0,
        procedures: result.rows || [],
      });
    } catch (error) {
      console.error("Error fetching pending documents:", error);
      res.status(500).json({
        error: "Failed to fetch pending documents",
      });
    }
  });

  // GET awaiting payment (where payment_status is not 'closed')
  app.get("/api/dashboard/awaiting-payment", async (req, res) => {
    try {
      console.log("Awaiting payment endpoint called");

      const query = `
        SELECT reference, shipment_status, document_status, payment_status, created_at
        FROM procedures 
        WHERE payment_status != 'closed' OR payment_status IS NULL
        ORDER BY created_at DESC
      `;

      const result = await rawDb.query(query);
      console.log("Awaiting payment result:", { rowCount: result.rowCount });

      res.json({
        count: result.rowCount || 0,
        procedures: result.rows || [],
      });
    } catch (error) {
      console.error("Error fetching awaiting payment:", error);
      res.status(500).json({
        error: "Failed to fetch awaiting payment",
      });
    }
  });

  // Debug endpoint to verify database structure and data
  app.get("/api/dashboard/debug", async (req, res) => {
    try {
      console.log("=== DASHBOARD DEBUG ENDPOINT CALLED ===");

      // Test 1: Check if procedures table exists
      const tableCheck = await rawDb.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_name LIKE '%procedure%'
      `);
      console.log("Tables found:", tableCheck.rows);

      // Test 2: Get column names
      const columnsCheck = await rawDb.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'procedures'
      `);

      const columnNames = columnsCheck.rows.map((row: any) => row.column_name);
      console.log("Columns in procedures table:", columnNames);

      // Test 3: Get sample data
      const sampleData = await rawDb.query("SELECT * FROM procedures LIMIT 5");
      console.log("Sample data count:", sampleData.rows.length);

      // Test 4: Get status values
      const statusValues = await rawDb.query(`
        SELECT 
          DISTINCT shipment_status as status_value, 'shipment_status' as status_type
        FROM procedures 
        WHERE shipment_status IS NOT NULL
        UNION ALL
        SELECT 
          DISTINCT document_status as status_value, 'document_status' as status_type
        FROM procedures 
        WHERE document_status IS NOT NULL
        UNION ALL
        SELECT 
          DISTINCT payment_status as status_value, 'payment_status' as status_type
        FROM procedures 
        WHERE payment_status IS NOT NULL
      `);
      console.log("Status values:", statusValues.rows);

      // Test 5: Count procedures by status
      const activeProceduresCount = await rawDb.query(`
        SELECT COUNT(*) as count FROM procedures WHERE shipment_status != 'closed' OR shipment_status IS NULL
      `);

      const pendingDocumentsCount = await rawDb.query(`
        SELECT COUNT(*) as count FROM procedures WHERE document_status != 'closed' OR document_status IS NULL
      `);

      const awaitingPaymentCount = await rawDb.query(`
        SELECT COUNT(*) as count FROM procedures WHERE payment_status != 'closed' OR payment_status IS NULL
      `);

      res.json({
        tablesFound: tableCheck.rows,
        columns: columnNames,
        sampleData: sampleData.rows,
        statusValues: statusValues.rows,
        totalProcedures: sampleData.rows.length,
        countsByStatus: {
          activeProcedures: activeProceduresCount.rows[0]?.count || 0,
          pendingDocuments: pendingDocumentsCount.rows[0]?.count || 0,
          awaitingPayment: awaitingPaymentCount.rows[0]?.count || 0,
        },
      });
    } catch (error) {
      console.error("Debug endpoint error:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  });

  // Invoice Line Item routes
  // GET all line items for a specific procedure reference
  app.get("/api/invoice-line-items/procedure/:reference", async (req, res) => {
    try {
      // Decode the reference parameter to handle special characters
      const reference = decodeURIComponent(req.params.reference);
      if (!reference) {
        return res
          .status(400)
          .json({ message: "Procedure reference is required" });
      }

      const lineItems = await storage.getInvoiceLineItemsByReference(reference);
      res.json({ lineItems });
    } catch (error) {
      console.error("Error fetching invoice line items:", error);
      res
        .status(500)
        .json({
          message: "Failed to retrieve invoice line items",
          error: String(error),
        });
    }
  });

  // GET a specific line item by ID
  app.get("/api/invoice-line-items/:id", async (req, res) => {
    try {
      const lineItem = await storage.getInvoiceLineItem(
        parseInt(req.params.id),
      );
      if (!lineItem) {
        return res.status(404).json({ message: "Invoice line item not found" });
      }
      res.json({ lineItem });
    } catch (error) {
      console.error("Error fetching invoice line item:", error);
      res
        .status(500)
        .json({
          message: "Failed to retrieve invoice line item",
          error: String(error),
        });
    }
  });

  // POST create a new line item
  app.post("/api/invoice-line-items", async (req, res) => {
    try {
      const lineItem = await storage.createInvoiceLineItem(req.body);
      res.status(201).json({ lineItem });
    } catch (error) {
      console.error("Error creating invoice line item:", error);
      res
        .status(500)
        .json({
          message: "Failed to create invoice line item",
          error: String(error),
        });
    }
  });

  // POST create multiple line items at once
  app.post("/api/invoice-line-items/bulk", async (req, res) => {
    try {
      const { lineItems } = req.body;
      if (!Array.isArray(lineItems) || lineItems.length === 0) {
        return res
          .status(400)
          .json({ message: "Must provide an array of line items" });
      }

      const createdItems = await storage.bulkCreateInvoiceLineItems(lineItems);
      res.status(201).json({ lineItems: createdItems });
    } catch (error) {
      console.error("Error creating bulk invoice line items:", error);
      res
        .status(500)
        .json({
          message: "Failed to create invoice line items",
          error: String(error),
        });
    }
  });

  // PATCH update a line item
  app.patch("/api/invoice-line-items/:id", async (req, res) => {
    try {
      const lineItem = await storage.updateInvoiceLineItem(
        parseInt(req.params.id),
        req.body,
      );
      if (!lineItem) {
        return res.status(404).json({ message: "Invoice line item not found" });
      }
      res.json({ lineItem });
    } catch (error) {
      console.error("Error updating invoice line item:", error);
      res
        .status(500)
        .json({
          message: "Failed to update invoice line item",
          error: String(error),
        });
    }
  });

  // DELETE a line item
  app.delete("/api/invoice-line-items/:id", async (req, res) => {
    try {
      const success = await storage.deleteInvoiceLineItem(
        parseInt(req.params.id),
      );
      if (!success) {
        return res.status(404).json({ message: "Invoice line item not found" });
      }
      res.json({ success });
    } catch (error) {
      console.error("Error deleting invoice line item:", error);
      res
        .status(500)
        .json({
          message: "Failed to delete invoice line item",
          error: String(error),
        });
    }
  });

  // DELETE all line items for a specific procedure
  app.delete(
    "/api/invoice-line-items/procedure/:reference",
    async (req, res) => {
      try {
        const reference = decodeURIComponent(req.params.reference);
        if (!reference) {
          return res
            .status(400)
            .json({ message: "Procedure reference is required" });
        }

        const deletedCount = await storage.deleteAllInvoiceLineItems(reference);
        res.json({ success: true, deletedCount });
      } catch (error) {
        console.error("Error deleting all invoice line items:", error);
        res
          .status(500)
          .json({
            message: "Failed to delete all invoice line items",
            error: String(error),
          });
      }
    },
  );

  // Calculate invoice line item costs for a procedure
  app.post("/api/invoice-line-items/calculate/:reference", async (req, res) => {
    try {
      const reference = decodeURIComponent(req.params.reference);
      if (!reference) {
        return res
          .status(400)
          .json({ message: "Procedure reference is required" });
      }

      console.log(`[API] Starting calculation for procedure ${reference}`);

      // First, ensure we have the current items with correct ordering
      const originalItems =
        await storage.getInvoiceLineItemsByReference(reference);
      console.log(
        `[API] Initial items order: ${originalItems.map((item) => `ID:${item.id}, order:${item.sortOrder || "null"}`).join(" -> ")}`,
      );

      // Perform the calculation
      const result = await storage.calculateInvoiceLineItemCosts(reference);

      // Check if items were returned in correct order
      if (result.updatedItems && Array.isArray(result.updatedItems)) {
        console.log(
          `[API] Final items order: ${result.updatedItems.map((item) => `ID:${item.id}, order:${item.sortOrder || "null"}`).join(" -> ")}`,
        );

        // Ensure items are returned in sortOrder sequence
        result.updatedItems.sort((a, b) => {
          const aSortOrder = a.sortOrder !== null ? a.sortOrder : 9999999;
          const bSortOrder = b.sortOrder !== null ? b.sortOrder : 9999999;
          return aSortOrder - bSortOrder;
        });
      }

      console.log(`[API] Calculation completed for procedure ${reference}`);
      res.json(result);
    } catch (error) {
      console.error("Error calculating invoice line item costs:", error);
      res
        .status(500)
        .json({ message: "Failed to calculate costs", error: String(error) });
    }
  });

  // Invoice Line Item Config routes
  // GET config for a specific procedure
  app.get("/api/invoice-line-items-config/:reference", async (req, res) => {
    try {
      const reference = decodeURIComponent(req.params.reference);
      if (!reference) {
        return res
          .status(400)
          .json({ message: "Procedure reference is required" });
      }

      const config = await storage.getInvoiceLineItemsConfig(reference);
      res.json({ config });
    } catch (error) {
      console.error("Error fetching invoice line items config:", error);
      res
        .status(500)
        .json({ message: "Failed to retrieve config", error: String(error) });
    }
  });

  // POST create/update config
  app.post("/api/invoice-line-items-config", async (req, res) => {
    try {
      const config = await storage.createOrUpdateInvoiceLineItemsConfig(
        req.body,
      );
      res.json({ config });
    } catch (error) {
      console.error(
        "Error creating/updating invoice line items config:",
        error,
      );
      res
        .status(500)
        .json({ message: "Failed to save config", error: String(error) });
    }
  });

  // Adobe PDF Services routes removed - now using jsPDF for procedure PDF export
  // Payment report routes removed (were using Adobe PDF Services)
  
  // Use Excel Report Route for Excel file downloads
  app.use("/api/excel-report", excelReportRoute);

  // Use Template-based Excel Report Route for professionally formatted Excel downloads
  app.use("/api/template-excel-report", templateExcelReportRoute);

  // Use Tax Calculation Excel Export
  app.use("/api/tax-calculation/calculations", taxCalculationExcelRoute);
  app.use("/api/tax-calculation/calculations", taxCalculationBeyannameRoute);

  // Use Tax Analytics routes
  app.use("/api", taxRoutes);

  // Use Custom Report routes
  app.use("/api/custom-report", customReportRoutes);

  app.get("/api/tax-calculation/products", async (req, res) => {
    try {
      const products = await storage.getAllProducts();
      res.json({ products });
    } catch (error) {
      res
        .status(500)
        .json({ message: "Failed to retrieve products", error: String(error) });
    }
  });

  // Get TR HS CODE suggestions based on HTS Code - MUST be before :id route
  app.get('/api/tax-calculation/products/suggestions-by-hts', async (req, res) => {
    try {
      const htsCode = req.query.hts_code as string;
      
      console.log('[Suggestions] ================');
      console.log('[Suggestions] HTS Code received:', htsCode);
      
      if (!htsCode) {
        console.log('[Suggestions] No HTS code provided');
        return res.json({ suggestions: [] });
      }
      
      // Use raw SQL query via rawDb
      const query = `
        SELECT tr_hs_code, COUNT(*)::int as product_count 
        FROM products 
        WHERE hts_code = $1 
          AND tr_hs_code IS NOT NULL 
          AND tr_hs_code != ''
        GROUP BY tr_hs_code
        ORDER BY COUNT(*) DESC
      `;
      
      console.log('[Suggestions] Running query with:', htsCode);
      
      const result = await rawDb.query(query, [htsCode]);
      
      console.log('[Suggestions] Query result rows:', result.rows?.length || 0);
      console.log('[Suggestions] Results:', result.rows);
      
      const suggestions = (result.rows || []).map((row: any) => ({
        tr_hs_code: row.tr_hs_code,
        product_count: row.product_count
      }));
      
      console.log('[Suggestions] Sending suggestions:', suggestions);
      
      res.json({ suggestions });
      
    } catch (error) {
      console.error('[Suggestions] ERROR:', error);
      res.status(500).json({ 
        error: 'Failed to get suggestions', 
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.get("/api/tax-calculation/products/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const product = await storage.getProduct(id);
      if (!product) {
        return res.status(404).json({ message: "Product not found" });
      }
      res.json({ product });
    } catch (error) {
      res
        .status(500)
        .json({ message: "Failed to retrieve product", error: String(error) });
    }
  });

  app.get("/api/tax-calculation/products/search", async (req, res) => {
    try {
      const { style, hts_code } = req.query;

      if (style) {
        const product = await storage.getProductByStyle(style as string);
        return res.json({ products: product ? [product] : [] });
      }

      if (hts_code) {
        const products = await storage.getProductByHtsCode(hts_code as string);
        return res.json({ products });
      }

      res
        .status(400)
        .json({ message: "Either style or hts_code parameter is required" });
    } catch (error) {
      res
        .status(500)
        .json({ message: "Failed to search products", error: String(error) });
    }
  });

  app.post("/api/tax-calculation/products", async (req, res) => {
    try {
      console.log('=== SAVING PRODUCT ===');
      console.log('Style:', req.body.style);
      console.log('Data:', req.body);
      
      if (!req.body.style) {
        console.error('ERROR: Style is required');
        return res.status(400).json({ error: 'Style is required' });
      }
      
      // Ensure color has a default value if empty
      const productData = {
        ...req.body,
        color: req.body.color || "MIXED"
      };
      
      const product = await storage.createProduct(productData);
      console.log('Product saved successfully:', product.id);
      res.json({ product });
    } catch (error) {
      console.error('=== PRODUCT SAVE ERROR ===');
      console.error('Error:', error instanceof Error ? error.message : String(error));
      console.error('Stack:', error instanceof Error ? error.stack : '');
      
      res.status(500).json({ 
        message: "Failed to create product", 
        error: error instanceof Error ? error.message : String(error),
        hint: 'Check if all required columns exist in the products table'
      });
    }
  });

  app.put("/api/tax-calculation/products/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const product = await storage.updateProduct(id, req.body);
      if (!product) {
        return res.status(404).json({ message: "Product not found" });
      }
      res.json({ product });
    } catch (error) {
      res
        .status(500)
        .json({ message: "Failed to update product", error: String(error) });
    }
  });

  app.delete("/api/tax-calculation/products/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const success = await storage.deleteProduct(id);
      res.json({ success });
    } catch (error) {
      res
        .status(500)
        .json({ message: "Failed to delete product", error: String(error) });
    }
  });

  app.get("/api/tax-calculation/hs-codes", async (req, res) => {
    try {
      const hsCodes = await storage.getAllHsCodes();
      res.json({ hsCodes });
    } catch (error) {
      res
        .status(500)
        .json({ message: "Failed to retrieve HS codes", error: String(error) });
    }
  });

  app.get("/api/tax-calculation/hs-codes/:code", async (req, res) => {
    try {
      const code = req.params.code;
      const hsCode = await storage.getHsCode(code);
      if (!hsCode) {
        return res.status(404).json({ message: "HS code not found" });
      }
      res.json({ hsCode });
    } catch (error) {
      res
        .status(500)
        .json({ message: "Failed to retrieve HS code", error: String(error) });
    }
  });

  app.post("/api/tax-calculation/hs-codes/validate", async (req, res) => {
    try {
      const { codes } = req.body;
      
      if (!Array.isArray(codes)) {
        return res.status(400).json({ error: 'Codes must be an array' });
      }
      
      if (codes.length === 0) {
        return res.json({ found: [], missing: [] });
      }
      
      const uniqueCodes = [...new Set(codes.filter((code): code is string => typeof code === 'string' && code.length > 0))];
      
      if (uniqueCodes.length === 0) {
        return res.status(400).json({ error: 'No valid codes provided' });
      }
      
      console.log(`[HS VALIDATE] Checking ${uniqueCodes.length} unique HS codes`);
      const startTime = Date.now();
      
      const foundHsCodes = await storage.getHsCodesBatch(uniqueCodes);
      const foundCodesSet = new Set(foundHsCodes.map(hs => hs.tr_hs_code));
      
      const missing = uniqueCodes.filter(code => !foundCodesSet.has(code));
      
      const duration = Date.now() - startTime;
      console.log(`[HS VALIDATE] ✓ Found ${foundHsCodes.length}, Missing ${missing.length} in ${duration}ms`);
      
      res.json({ found: foundHsCodes, missing });
      
    } catch (error) {
      console.error('[HS VALIDATE] Error:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: 'Failed to validate HS codes', details: errorMessage });
    }
  });

  app.post("/api/tax-calculation/hs-codes", async (req, res) => {
    try {
      const hsCode = await storage.createHsCode(req.body);
      res.json({ hsCode });
    } catch (error) {
      res
        .status(500)
        .json({ message: "Failed to create HS code", error: String(error) });
    }
  });

  app.put("/api/tax-calculation/hs-codes/:code", async (req, res) => {
    try {
      const code = req.params.code;
      const hsCode = await storage.updateHsCode(code, req.body);
      if (!hsCode) {
        return res.status(404).json({ message: "HS code not found" });
      }
      res.json({ hsCode });
    } catch (error) {
      res
        .status(500)
        .json({ message: "Failed to update HS code", error: String(error) });
    }
  });

  app.delete("/api/tax-calculation/hs-codes/:code", async (req, res) => {
    try {
      const code = req.params.code;
      const success = await storage.deleteHsCode(code);
      res.json({ success });
    } catch (error) {
      res
        .status(500)
        .json({ message: "Failed to delete HS code", error: String(error) });
    }
  });

  // Import Products from Excel
  app.post('/api/tax-calculation/import-products', excelUpload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(req.file.path);
      
      const worksheet = workbook.worksheets[0];
      if (!worksheet) {
        throw new Error('No worksheet found in Excel file');
      }

      const productsData: any[] = [];
      const seenStyles = new Set<string>();
      const errors: string[] = [];
      let skippedDuplicates = 0;
      let totalRowsInExcel = 0;
      
      // Start from row 2 (skip header)
      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return; // Skip header
        
        totalRowsInExcel++;
        const values = row.values as any[];
        
        const style = values[2]?.toString()?.trim();
        if (!style) {
          errors.push(`Row ${rowNumber}: Missing style`);
          return;
        }
        
        // Skip if we've already seen this style in this import
        if (seenStyles.has(style)) {
          skippedDuplicates++;
          return;
        }
        
        // Mark this style as seen
        seenStyles.add(style);
        
        // Parse according to format: Brand, Style, Category, Color, Fabric, Country, Cost, HTS Code, TR HS CODE
        // Note: category, color, cost are NOT in products schema, so we skip them
        const product = {
          brand: values[1]?.toString()?.trim() || null,
          style: style,
          item_description: values[3]?.toString()?.trim() || null, // Using category as description
          fabric_content: values[5]?.toString()?.trim() || null,
          country_of_origin: values[6]?.toString()?.trim() || null,
          hts_code: values[8]?.toString()?.trim() || null,
          tr_hs_code: values[9]?.toString()?.trim() || null,
        };
        
        productsData.push(product);
      });

      console.log(`Found ${productsData.length} unique products to import`);
      console.log(`Skipped ${skippedDuplicates} duplicate styles in Excel`);

      if (productsData.length === 0) {
        throw new Error('No valid products found in Excel file');
      }

      // Check which styles already exist in database
      const styleList = productsData.map(p => p.style);
      const existingProducts = await db
        .select({ style: products.style })
        .from(products)
        .where(inArray(products.style, styleList));
      
      const existingStyles = new Set(existingProducts.map(p => p.style));
      
      // Filter out products that already exist in database
      const newProducts = productsData.filter(p => !existingStyles.has(p.style));
      const skippedExisting = productsData.length - newProducts.length;

      console.log(`${newProducts.length} new products to insert`);
      console.log(`${skippedExisting} products already exist in database (skipped)`);

      // Insert in batches with error handling
      let imported = 0;
      const batchSize = 100;
      
      if (newProducts.length > 0) {
        for (let i = 0; i < newProducts.length; i += batchSize) {
          const batch = newProducts.slice(i, i + batchSize);
          try {
            await db.insert(products).values(batch);
            imported += batch.length;
            console.log(`Imported ${imported}/${newProducts.length} products`);
          } catch (batchError) {
            console.error(`Batch ${Math.floor(i/batchSize) + 1} failed:`, batchError);
          }
        }
      }

      // Clean up uploaded file
      fs.unlinkSync(req.file.path);

      res.json({
        success: true,
        message: 'Import complete',
        stats: {
          totalInExcel: totalRowsInExcel,
          duplicatesInExcel: skippedDuplicates,
          uniqueInExcel: productsData.length,
          alreadyInDatabase: skippedExisting,
          newlyImported: imported
        },
        errors: errors.length > 0 ? errors.slice(0, 10) : []
      });

    } catch (error) {
      console.error('Products import error:', error);
      
      // Clean up file on error
      if (req.file) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (e) {
          // Ignore cleanup errors
        }
      }
      
      res.status(500).json({ 
        error: 'Failed to import products',
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Import HS Codes from Excel
  app.post('/api/tax-calculation/import-hs-codes', excelUpload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(req.file.path);
      
      const worksheet = workbook.worksheets[0];
      if (!worksheet) {
        throw new Error('No worksheet found in Excel file');
      }

      const hsCodesData: any[] = [];
      const errors: string[] = [];
      
      // Start from row 2 (skip header)
      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return; // Skip header
        
        const values = row.values as any[];
        
        const tr_hs_code = values[1]?.toString()?.trim();
        if (!tr_hs_code) {
          errors.push(`Row ${rowNumber}: Missing TR HS CODE`);
          return;
        }
        
        // Helper to safely parse decimal values (allowing 0)
        const parseDecimal = (val: any): number => {
          const num = parseFloat(val?.toString() || '0');
          return Number.isFinite(num) ? num : 0;
        };
        
        // Parse according to format
        const hsCode = {
          tr_hs_code: tr_hs_code,
          ex_registry_form: values[2]?.toString()?.toUpperCase()?.trim() === 'X',
          azo_dye_test: values[3]?.toString()?.toUpperCase()?.trim() === 'X',
          customs_tax_percent: parseDecimal(values[4]),
          additional_customs_tax_percent: parseDecimal(values[5]),
          kkdf_percent: parseDecimal(values[6]),
          vat_percent: parseDecimal(values[7]),
          special_custom: values[8]?.toString()?.toUpperCase()?.trim() === 'X',
          description_tr: values[9]?.toString()?.trim() || null,
          unit: values[10]?.toString()?.trim() || null,
        };
        
        hsCodesData.push(hsCode);
      });

      console.log(`Found ${hsCodesData.length} HS codes to import, ${errors.length} errors`);

      if (hsCodesData.length === 0) {
        throw new Error('No valid HS codes found in Excel file');
      }

      // Insert with upsert to handle duplicates, with error handling
      let imported = 0;
      let failed = 0;
      
      for (const hsCode of hsCodesData) {
        try {
          await db.insert(hsCodes)
            .values(hsCode)
            .onConflictDoUpdate({
              target: hsCodes.tr_hs_code,
              set: hsCode
            });
          imported++;
        } catch (insertError) {
          console.error(`Failed to insert HS code ${hsCode.tr_hs_code}:`, insertError);
          failed++;
        }
      }

      // Clean up uploaded file
      fs.unlinkSync(req.file.path);

      res.json({
        success: true,
        message: `Imported ${imported} HS codes successfully${failed > 0 ? `, ${failed} failed` : ''}`,
        total: imported,
        failed: failed,
        errors: errors.length > 0 ? errors.slice(0, 10) : []
      });

    } catch (error) {
      console.error('HS codes import error:', error);
      
      // Clean up file on error
      if (req.file) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (e) {
          // Ignore cleanup errors
        }
      }
      
      res.status(500).json({ 
        error: 'Failed to import HS codes',
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.get("/api/tax-calculation/calculations", async (req, res) => {
    try {
      const calculations = await storage.getAllTaxCalculations();
      res.json({ calculations });
    } catch (error) {
      res
        .status(500)
        .json({
          message: "Failed to retrieve calculations",
          error: String(error),
        });
    }
  });

  app.get("/api/tax-calculation/calculations/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const calculation = await storage.getTaxCalculation(id);
      if (!calculation) {
        return res.status(404).json({ message: "Calculation not found" });
      }
      const items = await storage.getTaxCalculationItems(id);
      res.json({ calculation, items });
    } catch (error) {
      res
        .status(500)
        .json({
          message: "Failed to retrieve calculation",
          error: String(error),
        });
    }
  });

  app.post("/api/tax-calculation/calculations", async (req, res) => {
    try {
      // Parse the request body and handle date conversion
      const {
        reference,
        invoice_no,
        invoice_date,
        total_value,
        total_quantity,
        transport_cost,
        insurance_cost,
        storage_cost,
        currency_rate,
        is_prepaid,
        is_atr,
        status,
      } = req.body;

      // Helper function to safely parse decimal values
      const parseDecimal = (value: any, fieldName: string): number | null => {
        // Return null for empty/null/undefined
        if (value === null || value === undefined || value === '') {
          return null;
        }
        const num = parseFloat(value);
        if (!Number.isFinite(num)) {
          throw new Error(`Invalid ${fieldName}: must be a valid number`);
        }
        return num;
      };

      // Helper function to safely parse integer values
      const parseInteger = (value: any, fieldName: string): number | null => {
        if (value === null || value === undefined || value === '') return null;
        const num = Number(value);
        if (!Number.isInteger(num)) {
          throw new Error(`Invalid ${fieldName}: must be a valid integer`);
        }
        return num;
      };

      // Parse and validate invoice_date
      let parsedDate = null;
      if (invoice_date) {
        const date = typeof invoice_date === 'string' ? new Date(invoice_date) : invoice_date;
        // Validate that the date is valid
        if (date instanceof Date && !isNaN(date.getTime())) {
          parsedDate = date;
        } else {
          return res.status(400).json({
            message: "Invalid invoice_date format"
          });
        }
      }

      const calculationData: any = {
        reference,
        invoice_no: invoice_no || null,
        invoice_date: parsedDate,
        is_prepaid: !!is_prepaid,
        is_atr: !!is_atr,
        status: status || 'draft',
      };

      // Add nullable fields (no defaults in schema)
      const parsedTotalValue = parseDecimal(total_value, 'total_value');
      if (parsedTotalValue !== null) calculationData.total_value = parsedTotalValue;
      
      const parsedTotalQuantity = parseInteger(total_quantity, 'total_quantity');
      if (parsedTotalQuantity !== null) calculationData.total_quantity = parsedTotalQuantity;

      // Add fields with database defaults (only if provided and non-empty)
      // If empty, omit them to let database use default value of '0'
      if (transport_cost !== null && transport_cost !== undefined && transport_cost !== '') {
        calculationData.transport_cost = parseDecimal(transport_cost, 'transport_cost');
      }
      if (insurance_cost !== null && insurance_cost !== undefined && insurance_cost !== '') {
        calculationData.insurance_cost = parseDecimal(insurance_cost, 'insurance_cost');
      }
      if (storage_cost !== null && storage_cost !== undefined && storage_cost !== '') {
        calculationData.storage_cost = parseDecimal(storage_cost, 'storage_cost');
      }
      if (currency_rate !== null && currency_rate !== undefined && currency_rate !== '') {
        calculationData.currency_rate = parseDecimal(currency_rate, 'currency_rate');
      }

      const calculation = await storage.createTaxCalculation(calculationData);
      res.json({ calculation });
    } catch (error) {
      console.error('Create calculation error:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // Return 400 for validation errors, 500 for others
      if (errorMessage.includes('Invalid')) {
        res.status(400).json({
          message: "Validation error",
          error: errorMessage,
        });
      } else {
        res.status(500).json({
          message: "Failed to create calculation",
          error: errorMessage,
        });
      }
    }
  });

  app.put("/api/tax-calculation/calculations/:id", async (req, res) => {
    try {
      const id = Number.parseInt(req.params.id);
      
      // Helper function to safely parse decimal values
      const parseDecimal = (value: any, fieldName: string): number | null | undefined => {
        if (value === undefined) return undefined; // Field not provided
        if (value === null || value === '') return null; // Explicitly cleared
        const num = parseFloat(value);
        if (!Number.isFinite(num)) {
          throw new Error(`Invalid ${fieldName}: must be a valid number`);
        }
        return num;
      };

      // Helper function to safely parse integer values
      const parseInteger = (value: any, fieldName: string): number | null | undefined => {
        if (value === undefined) return undefined; // Field not provided
        if (value === null || value === '') return null; // Explicitly cleared
        const num = Number(value);
        if (!Number.isInteger(num)) {
          throw new Error(`Invalid ${fieldName}: must be a valid integer`);
        }
        return num;
      };
      
      const updateData: any = {};
      
      // Parse and validate invoice_date if present
      if ('invoice_date' in req.body) {
        if (req.body.invoice_date === null || req.body.invoice_date === '') {
          updateData.invoice_date = null;
        } else {
          const date = typeof req.body.invoice_date === 'string' 
            ? new Date(req.body.invoice_date) 
            : req.body.invoice_date;
          
          if (date instanceof Date && !isNaN(date.getTime())) {
            updateData.invoice_date = date;
          } else {
            return res.status(400).json({
              message: "Invalid invoice_date format"
            });
          }
        }
      }
      
      // Copy non-numeric fields
      if ('reference' in req.body) updateData.reference = req.body.reference;
      if ('invoice_no' in req.body) updateData.invoice_no = req.body.invoice_no || null;
      if ('is_prepaid' in req.body) updateData.is_prepaid = !!req.body.is_prepaid;
      if ('status' in req.body) updateData.status = req.body.status;
      
      // Parse numeric fields if present and non-empty
      // For nullable fields (total_value, total_quantity), allow null
      if ('total_value' in req.body) {
        const parsed = parseDecimal(req.body.total_value, 'total_value');
        if (parsed !== undefined) updateData.total_value = parsed;
      }
      if ('total_quantity' in req.body) {
        const parsed = parseInteger(req.body.total_quantity, 'total_quantity');
        if (parsed !== undefined) updateData.total_quantity = parsed;
      }
      
      // For fields with database defaults, only update if non-empty
      // Empty values are omitted to leave existing values unchanged
      if ('transport_cost' in req.body && req.body.transport_cost !== '' && req.body.transport_cost !== null && req.body.transport_cost !== undefined) {
        updateData.transport_cost = parseDecimal(req.body.transport_cost, 'transport_cost');
      }
      if ('insurance_cost' in req.body && req.body.insurance_cost !== '' && req.body.insurance_cost !== null && req.body.insurance_cost !== undefined) {
        updateData.insurance_cost = parseDecimal(req.body.insurance_cost, 'insurance_cost');
      }
      if ('storage_cost' in req.body && req.body.storage_cost !== '' && req.body.storage_cost !== null && req.body.storage_cost !== undefined) {
        updateData.storage_cost = parseDecimal(req.body.storage_cost, 'storage_cost');
      }
      if ('currency_rate' in req.body && req.body.currency_rate !== '' && req.body.currency_rate !== null && req.body.currency_rate !== undefined) {
        updateData.currency_rate = parseDecimal(req.body.currency_rate, 'currency_rate');
      }
      
      const calculation = await storage.updateTaxCalculation(id, updateData);
      if (!calculation) {
        return res.status(404).json({ message: "Calculation not found" });
      }
      res.json({ calculation });
    } catch (error) {
      console.error('Update calculation error:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // Return 400 for validation errors, 500 for others
      if (errorMessage.includes('Invalid')) {
        res.status(400).json({
          message: "Validation error",
          error: errorMessage,
        });
      } else {
        res.status(500).json({
          message: "Failed to update calculation",
          error: errorMessage,
        });
      }
    }
  });

  app.delete("/api/tax-calculation/calculations/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const success = await storage.deleteTaxCalculation(id);
      res.json({ success });
    } catch (error) {
      res
        .status(500)
        .json({
          message: "Failed to delete calculation",
          error: String(error),
        });
    }
  });

  app.post(
    "/api/tax-calculation/calculations/:id/calculate",
    async (req, res) => {
      try {
        const id = parseInt(req.params.id);
        await calculateAllItems(id);
        const calculation = await storage.getTaxCalculation(id);
        const items = await storage.getTaxCalculationItems(id);
        res.json({ calculation, items });
      } catch (error) {
        res
          .status(500)
          .json({ message: "Failed to calculate taxes", error: String(error) });
      }
    },
  );

  app.post(
    "/api/tax-calculation/calculations/:id/check-atr-rates",
    async (req, res) => {
      try {
        const id = parseInt(req.params.id);
        const result = await checkMissingAtrRates(id);
        res.json(result);
      } catch (error) {
        res
          .status(500)
          .json({ message: "Failed to check ATR rates", error: String(error) });
      }
    },
  );

  // Check for missing ATR rates before calculation is created (uses items from request body)
  app.post("/api/tax-calculation/atr-rates/check", async (req, res) => {
    try {
      const { items } = req.body;
      if (!Array.isArray(items) || items.length === 0) {
        return res.json({ hasMissingRates: false, missingHsCodes: [] });
      }
      
      // Countries that have 0% customs tax with ATR certificate (EU + exempt countries)
      const ATR_EXEMPT_COUNTRIES = new Set(['IT', 'TR', 'PT', 'TN', 'BA', 'DE', 'FR', 'ES', 'NL', 'BE', 'AT', 'GR', 'PL', 'CZ', 'HU', 'RO', 'BG', 'HR', 'SK', 'SI', 'LT', 'LV', 'EE', 'CY', 'MT', 'LU', 'IE', 'FI', 'SE', 'DK']);
      
      // Get unique HS codes from non-exempt countries only
      const uniqueHsCodes = new Map<string, { tr_hs_code: string; country_of_origin: string }>();
      for (const item of items) {
        if (item.tr_hs_code && item.country_of_origin) {
          // Skip exempt countries - they get 0% customs tax automatically
          if (ATR_EXEMPT_COUNTRIES.has(item.country_of_origin)) {
            continue;
          }
          // Store unique HS codes with a sample country (for display purposes)
          if (!uniqueHsCodes.has(item.tr_hs_code)) {
            uniqueHsCodes.set(item.tr_hs_code, { 
              tr_hs_code: item.tr_hs_code, 
              country_of_origin: item.country_of_origin 
            });
          }
        }
      }
      
      if (uniqueHsCodes.size === 0) {
        return res.json({ hasMissingRates: false, missingHsCodes: [] });
      }
      
      // Check which HS codes are missing ATR rates
      const existingRates = await storage.getAtrCustomsRates();
      const existingSet = new Set(existingRates.map(r => r.tr_hs_code));
      
      // Return full objects with tr_hs_code and country_of_origin for display
      const missingHsCodes = Array.from(uniqueHsCodes.values())
        .filter(combo => !existingSet.has(combo.tr_hs_code));
      
      console.log(`[ATR CHECK] Found ${missingHsCodes.length} missing ATR rates (excluding exempt countries)`);
      
      res.json({
        hasMissingRates: missingHsCodes.length > 0,
        missingHsCodes
      });
    } catch (error) {
      console.error('[ATR CHECK] Error:', error);
      res
        .status(500)
        .json({ message: "Failed to check ATR rates", error: String(error) });
    }
  });

  app.post("/api/tax-calculation/atr-rates", async (req, res) => {
    try {
      // Accept either { rates: [...] } or a single rate { tr_hs_code, customs_tax_percent }
      let ratesToSave: Array<{ tr_hs_code: string; customs_tax_percent: string | number }>;
      
      if (req.body.rates) {
        ratesToSave = req.body.rates;
      } else if (req.body.tr_hs_code && req.body.customs_tax_percent !== undefined) {
        ratesToSave = [{ tr_hs_code: req.body.tr_hs_code, customs_tax_percent: req.body.customs_tax_percent }];
      } else {
        return res.status(400).json({ error: "Either rates array or tr_hs_code/customs_tax_percent are required" });
      }
      
      if (!Array.isArray(ratesToSave) || ratesToSave.length === 0) {
        return res.status(400).json({ error: "Rates array is required" });
      }
      const saved = await storage.saveAtrCustomsRates(ratesToSave);
      res.json({ success: true, rates: saved });
    } catch (error) {
      res
        .status(500)
        .json({ message: "Failed to save ATR rates", error: String(error) });
    }
  });

  app.get("/api/tax-calculation/calculations/:id/items", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const items = await storage.getTaxCalculationItems(id);
      res.json({ items });
    } catch (error) {
      res
        .status(500)
        .json({ message: "Failed to retrieve items", error: String(error) });
    }
  });

  app.post("/api/tax-calculation/calculations/:id/items/batch", async (req, res) => {
    try {
      const calculationId = parseInt(req.params.id);
      const { items } = req.body;
      
      if (!Array.isArray(items)) {
        return res.status(400).json({ error: 'Items must be an array' });
      }
      
      if (items.length === 0) {
        return res.status(400).json({ error: 'Items array cannot be empty' });
      }
      
      const bodySize = JSON.stringify(req.body).length;
      console.log(`[BATCH] Creating ${items.length} items for calculation ${calculationId}`);
      console.log(`[BATCH] Request body size: ${(bodySize / 1024).toFixed(2)} KB`);
      
      if (bodySize > 10 * 1024 * 1024) {
        console.warn(`[BATCH] ⚠️  Very large request: ${(bodySize / 1024 / 1024).toFixed(2)} MB`);
      }
      
      const startTime = Date.now();
      
      const itemsToInsert = items.map((item, index) => {
        if (!item.style) {
          throw new Error(`Item at index ${index} is missing required field: style`);
        }
        
        const cost = typeof item.cost === 'number' ? item.cost : parseFloat(item.cost);
        if (isNaN(cost)) {
          throw new Error(`Item at index ${index} has invalid cost value: ${item.cost}`);
        }
        
        const totalValue = typeof item.total_value === 'number' ? item.total_value : parseFloat(item.total_value);
        if (isNaN(totalValue)) {
          throw new Error(`Item at index ${index} has invalid total_value: ${item.total_value}`);
        }
        
        const unitCount = typeof item.unit_count === 'number' ? item.unit_count : parseInt(String(item.unit_count), 10);
        if (isNaN(unitCount)) {
          throw new Error(`Item at index ${index} has invalid unit_count: ${item.unit_count}`);
        }
        
        const lineNumber = typeof item.line_number === 'number' ? item.line_number : (index + 1);
        
        return {
          tax_calculation_id: calculationId,
          product_id: item.product_id || null,
          line_number: lineNumber,
          style: item.style,
          color: item.color || null,
          category: item.category || null,
          description: item.description || null,
          fabric_content: item.fabric_content || null,
          country_of_origin: item.country_of_origin || null,
          hts_code: item.hts_code || null,
          cost: cost.toString(),
          unit_count: unitCount,
          total_value: totalValue.toString(),
          tr_hs_code: item.tr_hs_code || null,
        };
      });
      
      let inserted;
      try {
        inserted = await storage.batchCreateTaxCalculationItems(itemsToInsert);
      } catch (dbError) {
        const dbErrorMessage = dbError instanceof Error ? dbError.message : String(dbError);
        if (dbErrorMessage.includes('foreign key') || dbErrorMessage.includes('constraint')) {
          throw new Error(`Database constraint violation: ${dbErrorMessage}`);
        }
        throw dbError;
      }
      
      const duration = Date.now() - startTime;
      console.log(`[BATCH] ✓ Successfully created ${inserted.length} items in ${duration}ms`);
      
      res.json({ success: true, count: inserted.length, items: inserted });
      
    } catch (error) {
      console.error('[BATCH] Error creating items:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      if (errorMessage.includes('missing required field') || 
          errorMessage.includes('invalid cost') ||
          errorMessage.includes('invalid total_value') ||
          errorMessage.includes('invalid unit_count') ||
          errorMessage.includes('constraint violation')) {
        return res.status(422).json({ error: errorMessage });
      }
      
      res.status(500).json({ error: 'Failed to create items', details: errorMessage });
    }
  });

  app.post("/api/tax-calculation/calculations/:id/items", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const itemData = { ...req.body, tax_calculation_id: id };
      const item = await storage.createTaxCalculationItem(itemData);
      res.json({ item });
    } catch (error) {
      res
        .status(500)
        .json({ message: "Failed to create item", error: String(error) });
    }
  });

  app.put("/api/tax-calculation/items/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const item = await storage.updateTaxCalculationItem(id, req.body);
      if (!item) {
        return res.status(404).json({ message: "Item not found" });
      }
      res.json({ item });
    } catch (error) {
      res
        .status(500)
        .json({ message: "Failed to update item", error: String(error) });
    }
  });

  app.delete("/api/tax-calculation/items/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const success = await storage.deleteTaxCalculationItem(id);
      res.json({ success });
    } catch (error) {
      res
        .status(500)
        .json({ message: "Failed to delete item", error: String(error) });
    }
  });

  app.post("/api/tax-calculation/items/:id/match", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const item = await storage.getTaxCalculationItem(id);
      if (!item) {
        return res.status(404).json({ message: "Item not found" });
      }

      let productId = item.product_id;
      let trHsCode = item.tr_hs_code;

      if (item.style) {
        const product = await storage.getProductByStyle(item.style);
        if (product) {
          productId = product.id;
          trHsCode = product.tr_hs_code || trHsCode;
        }
      }

      const updatedItem = await storage.updateTaxCalculationItem(id, {
        product_id: productId,
        tr_hs_code: trHsCode,
      });

      res.json({ item: updatedItem });
    } catch (error) {
      res
        .status(500)
        .json({ message: "Failed to match item", error: String(error) });
    }
  });

  app.post(
    "/api/tax-calculation/calculations/:id/create-procedure",
    async (req, res) => {
      try {
        const id = parseInt(req.params.id);
        console.log('[Create Procedure] ========================================');
        console.log('[Create Procedure] Starting for calculation ID:', id);
        
        const calculation = await storage.getTaxCalculation(id);
        console.log('[Create Procedure] Calculation found:', !!calculation);
        
        if (!calculation) {
          console.log('[Create Procedure] ❌ Calculation not found');
          return res.status(404).json({ message: "Calculation not found" });
        }
        
        console.log('[Create Procedure] Reference:', calculation.reference);
        console.log('[Create Procedure] Total Value (USD):', calculation.total_value);

        // Get tax calculation items to create line items
        console.log('[Create Procedure] Fetching tax calculation items...');
        const taxItems = await storage.getTaxCalculationItems(id);
        console.log('[Create Procedure] Tax items found:', taxItems.length);

        const procedureData = {
          reference: calculation.reference,
          amount: calculation.total_value,
          currency: 'USD',
          piece: calculation.total_quantity,
          invoice_no: calculation.invoice_no,
          invoice_date: calculation.invoice_date || null, // Keep as YYYY-MM-DD string to avoid timezone issues
          createdBy: req.body.userId || 3,
        };

        // Create procedure
        console.log('[Create Procedure] Creating procedure with data:', {
          reference: procedureData.reference,
          amount: procedureData.amount,
          currency: procedureData.currency,
          piece: procedureData.piece,
        });
        const procedure = await storage.createProcedure(procedureData);
        console.log('[Create Procedure] ✅ Procedure created with ID:', procedure.id);

        // Update the tax calculation with the procedure_id
        await storage.updateTaxCalculation(id, { procedure_id: procedure.id });
        console.log('[Create Procedure] ✅ Tax calculation updated with procedure_id:', procedure.id);

        // Create invoice line items from tax calculation items
        if (taxItems.length > 0) {
          console.log('[Create Procedure] Preparing line items data...');
          const lineItemsData = taxItems.map((item, index) => {
            const lineItem = {
              procedureReference: calculation.reference,
              styleNo: item.style,
              description: item.category,
              quantity: item.unit_count,
              unitPrice: item.cost,
              totalPrice: item.total_value,
              sortOrder: index,
              source: 'tax_calculation',
              createdBy: req.body.userId || 3,
            };
            
            // Log first item as sample
            if (index === 0) {
              console.log('[Create Procedure] Sample line item (first):', JSON.stringify(lineItem, null, 2));
              console.log('[Create Procedure] Category used for description:', item.category);
            }
            
            return lineItem;
          });

          console.log('[Create Procedure] Total line items to insert:', lineItemsData.length);
          console.log('[Create Procedure] Inserting line items...');

          // Batch insert line items using db directly for performance
          try {
            const insertedItems = await db.insert(invoiceLineItems).values(lineItemsData).returning();
            console.log('[Create Procedure] ✅ Line items inserted successfully:', insertedItems.length);
            console.log('[Create Procedure] First inserted item ID:', insertedItems[0]?.id);
            console.log('[Create Procedure] Last inserted item ID:', insertedItems[insertedItems.length - 1]?.id);
          } catch (insertError) {
            console.error('[Create Procedure] ❌ Line items insert FAILED:', insertError);
            console.error('[Create Procedure] Error message:', insertError instanceof Error ? insertError.message : String(insertError));
            console.error('[Create Procedure] Sample data that failed:', JSON.stringify(lineItemsData[0], null, 2));
            throw insertError;
          }
        } else {
          console.log('[Create Procedure] ⚠️ No tax items found, skipping line items creation');
        }

        console.log('[Create Procedure] ========================================');
        res.json({ 
          procedure,
          lineItemsCreated: taxItems.length
        });
      } catch (error) {
        console.error('[Create Procedure] ❌ FATAL ERROR:', error);
        console.error('[Create Procedure] Error stack:', error instanceof Error ? error.stack : 'No stack trace');
        res
          .status(500)
          .json({
            message: "Failed to create procedure",
            error: error instanceof Error ? error.message : String(error),
          });
      }
    },
  );

  app.get('/api/tax-calculation/calculations/:id/export/pdf', async (req, res) => {
    try {
      const calculationId = parseInt(req.params.id);
      console.log('\n' + '='.repeat(80));
      console.log(`[PDF] Starting professional PDF generation for calculation ${calculationId}`);
      console.log('='.repeat(80));
      
      if (isNaN(calculationId)) {
        console.error('[PDF] ❌ Invalid calculation ID');
        return res.status(400).json({ error: 'Invalid calculation ID' });
      }
      
      // Step 1: Get calculation data
      console.log('[PDF] Step 1: Fetching calculation data...');
      const calculation = await storage.getTaxCalculation(calculationId);
      
      if (!calculation) {
        console.error('[PDF] ❌ Calculation not found');
        return res.status(404).json({ error: 'Calculation not found' });
      }
      
      console.log('[PDF] ✓ Calculation found:', calculation.reference);
      
      // Step 2: Get items
      console.log('[PDF] Step 2: Fetching calculation items...');
      const items = await storage.getTaxCalculationItems(calculationId);
      
      console.log(`[PDF] ✓ Found ${items.length} items`);
      
      // Step 3: Calculate totals
      console.log('[PDF] Step 3: Calculating totals...');
      const totalCustomsTax = items.reduce((sum, item) => 
        sum + parseFloat(item.customs_tax || '0'), 0
      );
      const totalAdditionalTax = items.reduce((sum, item) => 
        sum + parseFloat(item.additional_customs_tax || '0'), 0
      );
      const totalKkdf = items.reduce((sum, item) => 
        sum + parseFloat(item.kkdf || '0'), 0
      );
      const totalVat = items.reduce((sum, item) => 
        sum + parseFloat(item.vat || '0'), 0
      );
      const totalTaxUsd = items.reduce((sum, item) => 
        sum + parseFloat(item.total_tax_usd || '0'), 0
      );
      const totalTaxTl = items.reduce((sum, item) => 
        sum + parseFloat(item.total_tax_tl || '0'), 0
      );
      
      console.log('[PDF] ✓ Totals calculated');
      
      // Step 4: Load logos and custom font
      console.log('[PDF] Step 4: Loading company logos and custom font...');
      const fs = await import('fs');
      const path = await import('path');
      
      let cncLogoData: string | null = null;
      let sohoLogoData: string | null = null;
      
      try {
        const cncLogoPath = path.join(process.cwd(), 'attached_assets', 'Company Logo.png');
        const sohoLogoPath = path.join(process.cwd(), 'attached_assets', 'soho-logo.png');
        
        if (fs.existsSync(cncLogoPath)) {
          const cncBuffer = fs.readFileSync(cncLogoPath);
          cncLogoData = `data:image/png;base64,${cncBuffer.toString('base64')}`;
          console.log('[PDF] ✓ CNC logo loaded');
        }
        
        if (fs.existsSync(sohoLogoPath)) {
          const sohoBuffer = fs.readFileSync(sohoLogoPath);
          sohoLogoData = `data:image/png;base64,${sohoBuffer.toString('base64')}`;
          console.log('[PDF] ✓ SOHO logo loaded');
        }
      } catch (logoError) {
        console.warn('[PDF] ⚠️  Could not load logos:', logoError);
      }
      
      // Step 5: Create PDF document (Landscape)
      console.log('[PDF] Step 5: Creating PDF document...');
      
      const doc = new jsPDF({
        orientation: 'landscape',
        unit: 'mm',
        format: 'a4'
      });
      
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      
      // Set Inter font (auto-registered by import)
      doc.setFont('Inter_18pt-Regular', 'normal');
      console.log('[PDF] Using font: Inter_18pt-Regular');
      console.log('[PDF] Available fonts:', JSON.stringify(doc.getFontList()));
      
      console.log('[PDF] ✓ PDF document created');
      
      // ==================== MAIN PAGE (LANDSCAPE) ====================
      console.log('[PDF] Step 6: Creating main page with headers and cards...');
      
      // Add logos to header (bigger and closer to center: 45x22.5mm)
      if (cncLogoData) {
        try {
          doc.addImage(cncLogoData, 'PNG', 25, 5, 45, 22.5);
        } catch (e) {
          console.warn('[PDF] ⚠️  Could not add CNC logo to PDF');
        }
      }
      
      if (sohoLogoData) {
        try {
          doc.addImage(sohoLogoData, 'PNG', pageWidth - 70, 5, 45, 22.5);
        } catch (e) {
          console.warn('[PDF] ⚠️  Could not add SOHO logo to PDF');
        }
      }
      
      // Headline section - moved up and centered
      let currentY = 17;
      
      doc.setFontSize(24);
      doc.setTextColor(15, 23, 42);
      doc.setFont('Inter_18pt-Regular', 'normal');
      doc.text('CNC – SOHO GROUP', pageWidth / 2, currentY, { align: 'center' });
      
      currentY += 8;
      doc.setFontSize(16);
      doc.setTextColor(30, 41, 59);
      doc.setFont('Inter_18pt-Regular', 'normal');
      const reportTitleText = 'Import Tax Calculation Report';
      const reportTitleWidth = doc.getTextWidth(reportTitleText);
      doc.text(reportTitleText, pageWidth / 2, currentY, { align: 'center' });
      // Add underline
      doc.setLineWidth(0.3);
      doc.setDrawColor(30, 41, 59);
      doc.line(pageWidth / 2 - reportTitleWidth / 2, currentY + 0.5, pageWidth / 2 + reportTitleWidth / 2, currentY + 0.5);
      
      currentY += 9;
      
      // Gray card with Reference on left and Invoice info on right
      const invoiceDate = calculation.invoice_date ? new Date(calculation.invoice_date).toLocaleDateString('en-US', { 
        year: 'numeric', month: 'long', day: 'numeric' 
      }) : 'N/A';
      
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(15, currentY, pageWidth - 30, 12, 2, 2, 'F');
      
      // Left side: Reference (14pt bold)
      doc.setFontSize(14);
      doc.setTextColor(30, 41, 59);
      doc.setFont('Inter_18pt-Regular', 'normal');
      doc.text(calculation.reference, 20, currentY + 8);
      
      // Right side: Invoice Information
      doc.setFontSize(9);
      doc.setTextColor(71, 85, 105);
      doc.setFont('Inter_18pt-Regular', 'normal');
      doc.text('INVOICE INFORMATION', pageWidth - 20, currentY + 5, { align: 'right' });
      
      doc.setFontSize(8);
      doc.setFont('Inter_18pt-Regular', 'normal');
      doc.setTextColor(30, 41, 59);
      doc.text(`Invoice No: ${calculation.invoice_no || 'N/A'}  |  Invoice Date: ${invoiceDate}`, pageWidth - 20, currentY + 9, { align: 'right' });
      
      currentY += 17;
      
      // Summary cards section - reorganized layout
      const cardHeight = 25;
      const cardGap = 5;
      const cardsStartX = 15;
      const totalCardsWidth = pageWidth - 30;
      
      // Two different card widths for different rows
      const wideCardWidth = (totalCardsWidth - cardGap) / 2; // For 2 cards per row
      const normalCardWidth = (totalCardsWidth - cardGap * 3) / 4; // For 4 cards per row
      
      // Helper function to draw centered summary card with custom width
      const drawCard = (x: number, y: number, width: number, title: string, value: string, color: number[]) => {
        doc.setFillColor(color[0], color[1], color[2]);
        doc.roundedRect(x, y, width, cardHeight, 2, 2, 'F');
        
        doc.setFontSize(16);
        doc.setTextColor(255, 255, 255);
        doc.setFont('Inter_18pt-Regular', 'normal');
        // Draw underline manually
        const titleWidth = doc.getTextWidth(title);
        const titleX = x + width / 2;
        doc.text(title, titleX, y + 9, { align: 'center' });
        doc.setLineWidth(0.3);
        doc.setDrawColor(255, 255, 255);
        doc.line(titleX - titleWidth / 2, y + 10, titleX + titleWidth / 2, y + 10);
        
        doc.setFontSize(14);
        doc.setFont('Inter_18pt-Regular', 'normal');
        doc.text(value, x + width / 2, y + 18, { align: 'center' });
      };
      
      // Row 1 - 2 wide cards (Total Value and Total Pieces)
      drawCard(cardsStartX, currentY, wideCardWidth, 'Total Value (USD)', `$${parseFloat(calculation.total_value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, [59, 130, 246]);
      drawCard(cardsStartX + wideCardWidth + cardGap, currentY, wideCardWidth, 'Total Pieces', (calculation.total_quantity || 0).toLocaleString('en-US'), [16, 185, 129]);
      
      // Row 2 - 4 cards (Customs Tax, Add. Tax, KKDF, VAT)
      currentY += cardHeight + cardGap;
      drawCard(cardsStartX, currentY, normalCardWidth, 'Customs Tax (USD)', `$${totalCustomsTax.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, [139, 92, 246]);
      drawCard(cardsStartX + (normalCardWidth + cardGap), currentY, normalCardWidth, 'Add. Tax (USD)', `$${totalAdditionalTax.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, [236, 72, 153]);
      drawCard(cardsStartX + (normalCardWidth + cardGap) * 2, currentY, normalCardWidth, 'KKDF (USD)', `$${totalKkdf.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, [245, 158, 11]);
      drawCard(cardsStartX + (normalCardWidth + cardGap) * 3, currentY, normalCardWidth, 'VAT (USD)', `$${totalVat.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, [234, 88, 12]);
      
      // Row 3 - 4 cards (Transport, Insurance, Storage, Currency Rate)
      currentY += cardHeight + cardGap;
      drawCard(cardsStartX, currentY, normalCardWidth, 'Transport', `$${parseFloat(calculation.transport_cost || '0').toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, [107, 114, 128]);
      drawCard(cardsStartX + (normalCardWidth + cardGap), currentY, normalCardWidth, 'Insurance', `$${parseFloat(calculation.insurance_cost || '0').toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, [100, 116, 139]);
      drawCard(cardsStartX + (normalCardWidth + cardGap) * 2, currentY, normalCardWidth, 'Storage', `$${parseFloat(calculation.storage_cost || '0').toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, [71, 85, 105]);
      drawCard(cardsStartX + (normalCardWidth + cardGap) * 3, currentY, normalCardWidth, 'Currency Rate', parseFloat(calculation.currency_rate || '0').toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 }), [51, 65, 85]);
      
      // Total Tax card spanning full width (showing both USD and TL)
      currentY += cardHeight + 8;
      const totalTaxCardHeight = 35;
      doc.setFillColor(15, 23, 42);
      doc.roundedRect(cardsStartX, currentY, pageWidth - 30, totalTaxCardHeight, 2, 2, 'F');
      
      doc.setFontSize(24);
      doc.setTextColor(226, 232, 240);
      doc.setFont('Inter_18pt-Regular', 'normal');
      const totalTaxText = 'Total Tax';
      const totalTaxTextWidth = doc.getTextWidth(totalTaxText);
      doc.text(totalTaxText, cardsStartX + (pageWidth - 30) / 2, currentY + 12, { align: 'center' });
      // Add underline to Total Tax text
      doc.setLineWidth(0.4);
      doc.setDrawColor(226, 232, 240);
      doc.line(
        cardsStartX + (pageWidth - 30) / 2 - totalTaxTextWidth / 2,
        currentY + 13,
        cardsStartX + (pageWidth - 30) / 2 + totalTaxTextWidth / 2,
        currentY + 13
      );
      
      doc.setFontSize(19);
      doc.setTextColor(255, 255, 255);
      doc.text(
        `USD $${totalTaxUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}  |  TL ${totalTaxTl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        cardsStartX + (pageWidth - 30) / 2,
        currentY + 25,
        { align: 'center' }
      );
      
      // Table starts on page 2, so add a new page
      doc.addPage();
      currentY = 15; // Reset Y position for page 2
      
      // Detailed table with badges for requirements
      const tableData = items.map(item => [
        item.style || '-',
        `$${parseFloat(item.cost).toFixed(2)}`,
        (item.unit_count || 0).toString(),
        item.tr_hs_code || '-',
        `$${parseFloat(item.cif_value || '0').toFixed(2)}`,
        `$${parseFloat(item.customs_tax || '0').toFixed(2)}`,
        `$${parseFloat(item.additional_customs_tax || '0').toFixed(2)}`,
        `$${parseFloat(item.kkdf || '0').toFixed(2)}`,
        `$${parseFloat(item.vat || '0').toFixed(2)}`,
        `$${parseFloat(item.total_tax_usd || '0').toFixed(2)}`,
        `TL ${parseFloat(item.total_tax_tl || '0').toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        '' // Empty string - badges will be drawn in didDrawCell instead
      ]);
      
      // Calculate column widths for right alignment (landscape A4 = 297mm width)
      // Available width: 297mm - 30mm (margins) = 267mm
      const rightMargin = 15;
      const columnWidths = [15, 12, 11, 28, 20, 20, 15, 13, 13, 24, 24, 72]; // Total: 267mm
      const totalTableWidth = columnWidths.reduce((sum, w) => sum + w, 0);
      const startX = pageWidth - rightMargin - totalTableWidth;

      autoTable(doc, {
        startY: currentY,
        startX: startX, // Right-align the table
        head: [[
          'Style',
          'Cost',
          'Units',
          'TR HS CODE',
          'CIF Value',
          'Customs Tax',
          'Add. Tax',
          'KKDF',
          'VAT',
          'Total Tax (USD)',
          'Total Tax (TL)',
          'Requirements'
        ]],
        body: tableData,
        theme: 'striped',
        styles: {
          font: 'Inter_18pt-Regular',
          fontStyle: 'normal'
        },
        headStyles: { 
          fillColor: [30, 64, 175], 
          textColor: [255, 255, 255], 
          fontSize: 8,
          font: 'Inter_18pt-Regular',
          fontStyle: 'normal',
          halign: 'center',
          valign: 'middle',
          cellPadding: 2
        },
        bodyStyles: { 
          fontSize: 7,
          cellPadding: 2,
          textColor: [30, 41, 59],
          font: 'Inter_18pt-Regular',
          fontStyle: 'normal',
          halign: 'center',
          valign: 'middle'
        },
        alternateRowStyles: {
          fillColor: [248, 250, 252]
        },
        columnStyles: {
          0: { cellWidth: 15, halign: 'center', valign: 'middle', font: 'Inter_18pt-Regular', overflow: 'linebreak' },
          1: { cellWidth: 12, halign: 'center', valign: 'middle', font: 'Inter_18pt-Regular', overflow: 'linebreak' },
          2: { cellWidth: 11, halign: 'center', valign: 'middle', font: 'Inter_18pt-Regular', overflow: 'linebreak' },
          3: { cellWidth: 28, halign: 'center', valign: 'middle', font: 'Inter_18pt-Regular', overflow: 'linebreak' },
          4: { cellWidth: 20, halign: 'center', valign: 'middle', font: 'Inter_18pt-Regular', overflow: 'linebreak' },
          5: { cellWidth: 20, halign: 'center', valign: 'middle', font: 'Inter_18pt-Regular', overflow: 'linebreak' },
          6: { cellWidth: 15, halign: 'center', valign: 'middle', font: 'Inter_18pt-Regular', overflow: 'linebreak' },
          7: { cellWidth: 13, halign: 'center', valign: 'middle', font: 'Inter_18pt-Regular', overflow: 'linebreak' },
          8: { cellWidth: 13, halign: 'center', valign: 'middle', font: 'Inter_18pt-Regular', overflow: 'linebreak' },
          9: { cellWidth: 24, halign: 'center', valign: 'middle', font: 'Inter_18pt-Regular', fontStyle: 'normal', fillColor: [254, 249, 195], overflow: 'linebreak' },
          10: { cellWidth: 24, halign: 'center', valign: 'middle', font: 'Inter_18pt-Regular', fontStyle: 'normal', fillColor: [254, 249, 195], overflow: 'linebreak' },
          11: { cellWidth: 72, halign: 'center', valign: 'middle', font: 'Inter_18pt-Regular', fontSize: 7, overflow: 'visible' }
        },
        margin: { left: 15, right: 15 },
        tableWidth: 'wrap',
        didDrawCell: (data: any) => {
          // Draw colored badges for requirements column
          if (data.column.index === 11 && data.section === 'body') {
            // Get the actual requirements from the original items array using row index
            const rowIndex = data.row.index;
            const item = items[rowIndex];
            const reqText = item?.requirements || '';
            
            if (!reqText || reqText === '-') return;
            
            // Split requirements by comma and trim
            const requirements = reqText.split(',').map((r: string) => r.trim().toUpperCase());
            const badges: Array<{ color: number[], text: string }> = [];
            
            // Map each requirement to its badge color
            requirements.forEach((req: string) => {
              if (req.includes('EX REGISTRY FORM')) {
                badges.push({ color: [34, 197, 94], text: 'EX REGISTRY FORM' }); // Green
              } else if (req.includes('AZO DYE TEST')) {
                badges.push({ color: [249, 115, 22], text: 'AZO DYE TEST' }); // Orange
              } else if (req.includes('SPECIAL CUSTOMS') || req.includes('SPECIAL CUSTOM')) {
                badges.push({ color: [139, 92, 246], text: 'SPECIAL CUSTOMS' }); // Purple
              }
            });
            
            if (badges.length > 0) {
              const cellX = data.cell.x;
              const cellY = data.cell.y;
              const cellWidth = data.cell.width;
              const cellHeight = data.cell.height;
              
              doc.setFontSize(6);
              doc.setFont('Inter_18pt-Regular', 'normal');
              
              // Calculate total width of all badges
              const badgeSpacing = 2;
              const badgePadding = 3;
              const badgeHeight = 4;
              
              let totalBadgesWidth = 0;
              const badgeWidths: number[] = [];
              
              badges.forEach(badge => {
                const textWidth = doc.getTextWidth(badge.text);
                const badgeWidth = textWidth + badgePadding * 2;
                badgeWidths.push(badgeWidth);
                totalBadgesWidth += badgeWidth;
              });
              
              totalBadgesWidth += (badges.length - 1) * badgeSpacing;
              
              // Start position for first badge (centered in cell)
              let badgeX = cellX + (cellWidth - totalBadgesWidth) / 2;
              const badgeY = cellY + (cellHeight - badgeHeight) / 2;
              
              // Draw each badge (no text behind them since tableData has empty string)
              badges.forEach((badge, index) => {
                const badgeWidth = badgeWidths[index];
                
                // Draw rounded badge background
                doc.setFillColor(badge.color[0], badge.color[1], badge.color[2]);
                doc.roundedRect(badgeX, badgeY, badgeWidth, badgeHeight, 1, 1, 'F');
                
                // Draw white text ON the badge
                doc.setTextColor(255, 255, 255);
                doc.text(badge.text, badgeX + badgeWidth / 2, badgeY + 3, { align: 'center' });
                
                // Move to next badge position
                badgeX += badgeWidth + badgeSpacing;
              });
            }
          }
        },
        didDrawPage: (data: any) => {
          // Footer on each page (logos only on first page - handled above)
          doc.setFontSize(7);
          doc.setTextColor(148, 163, 184);
          doc.setFont('Inter_18pt-Regular', 'normal');
          const currentPage = data.pageNumber;
          doc.text(
            `Page ${currentPage + 1} | ${items.length} items | Generated on ${new Date().toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' })}`,
            pageWidth / 2,
            pageHeight - 7,
            { align: 'center' }
          );
        }
      });
      
      console.log('[PDF] ✓ Detailed results table added');
      
      // Step 8: Generate buffer
      console.log('[PDF] Step 8: Generating PDF buffer...');
      const pdfArrayBuffer = doc.output('arraybuffer');
      const pdfBuffer = Buffer.from(pdfArrayBuffer);
      
      console.log(`[PDF] ✓ PDF buffer generated (${pdfBuffer.length} bytes)`);
      
      // Step 9: Send PDF
      const filename = `Tax_Calculation_${calculation.reference}.pdf`;
      console.log(`[PDF] Step 9: Sending PDF: ${filename}`);
      
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(pdfBuffer);
      
      console.log('[PDF] ✅ PROFESSIONAL PDF GENERATION COMPLETE');
      console.log('='.repeat(80) + '\n');
      
    } catch (error) {
      console.error('\n' + '='.repeat(80));
      console.error('[PDF] ❌❌❌ FATAL ERROR ❌❌❌');
      console.error('='.repeat(80));
      console.error('[PDF] Error type:', error instanceof Error ? error.constructor.name : 'Unknown');
      console.error('[PDF] Error message:', error instanceof Error ? error.message : String(error));
      if (error instanceof Error && error.stack) {
        console.error('[PDF] Error stack:', error.stack);
      }
      console.error('='.repeat(80) + '\n');
      
      res.status(500).json({ 
        error: 'PDF generation failed', 
        details: error instanceof Error ? error.message : String(error),
        type: error instanceof Error ? error.constructor.name : 'Unknown'
      });
    }
  });

  // Adv. Taxletter PDF Export (matching Final Balance Report styling)
  app.post('/api/tax-calculation/calculations/:id/export/adv-taxletter', async (req, res) => {
    try {
      const calculationId = parseInt(req.params.id);
      const { taxes, expenses, totalExpenses, grandTotal } = req.body;
      
      console.log('[Adv Taxletter PDF] Generating for calculation:', calculationId);
      console.log('[Adv Taxletter PDF] Manual tax values:', taxes);
      console.log('[Adv Taxletter PDF] Expenses:', expenses);
      console.log('[Adv Taxletter PDF] Total Expenses:', totalExpenses);
      console.log('[Adv Taxletter PDF] Grand Total:', grandTotal);
      
      if (isNaN(calculationId)) {
        return res.status(400).json({ error: 'Invalid calculation ID' });
      }
      
      // Get calculation data
      const calculation = await storage.getTaxCalculation(calculationId);
      
      if (!calculation) {
        return res.status(404).json({ error: 'Calculation not found' });
      }
      
      // Use manual tax values from modal (in TL)
      const totalCustomsTax = taxes?.customsTax || 0;
      const totalAdditionalTax = taxes?.additionalTax || 0;
      const totalKkdf = taxes?.kkdf || 0;
      const totalVat = taxes?.vat || 0;
      const totalStampTax = taxes?.stampTax || 0;
      const totalTaxTl = totalCustomsTax + totalAdditionalTax + totalKkdf + totalVat + totalStampTax;
      
      // Import jsPDF and fonts - same as Final Balance Report
      const { jsPDF } = await import('jspdf');
      await import('./fonts/Inter_18pt-Regular-normal.js');
      await import('./fonts/Inter_18pt-ExtraLight-normal.js');
      await import('./fonts/Inter_18pt-Light-normal.js');
      await import('./fonts/Inter_18pt-Bold-normal.js');
      await import('./fonts/Inter_24pt-SemiBold-normal.js');
      
      // Create PDF - A4 portrait (same as Final Balance Report)
      const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
        compress: true
      });
      
      // Set font
      doc.setFont('Inter_18pt-Regular', 'normal');
      
      // Page dimensions for reference
      const pageWidth = 210;  // A4 width in mm
      const pageHeight = 297; // A4 height in mm
      const pdfPageWidth = doc.internal.pageSize.getWidth();
      
      console.log('[Adv Taxletter PDF] Blank A4 created');
      
      // === HEADER ===
      // Yellow line at the top (same as Final Balance Report)
      doc.setFillColor(255, 215, 0); // Yellow color
      doc.rect(0, 0, pageWidth, 5, 'F'); // Fill rectangle from top
      
      // Add company logo (same as Final Balance Report)
      const fs = await import('fs');
      const path = await import('path');
      const logoPath = path.join(process.cwd(), 'attached_assets', 'CNC_tranparanLOGO_1763335105931.png');
      
      if (fs.existsSync(logoPath)) {
        const logoData = fs.readFileSync(logoPath, { encoding: 'base64' });
        const logoImg = `data:image/png;base64,${logoData}`;
        
        // Add bigger logo on the right side below yellow line
        doc.addImage(logoImg, 'PNG', pageWidth - 55, 8, 45, 25);
        console.log('[Adv Taxletter PDF] ✓ Logo added');
      } else {
        console.log('[Adv Taxletter PDF] ⚠ Logo file not found');
      }
      
      // === HEADER TEXT ===
      let currentY = 38;
      const leftMargin = 20;
      const rightMargin = 190;
      
      // "To SOHO..." header (SemiBold 11pt)
      doc.setFontSize(11);
      doc.setFont('Inter_24pt-SemiBold', 'normal');
      doc.text('To SOHO PERAKENDE YATIRIM VE TICARET ANONIM SIRKETI;', leftMargin, currentY);
      currentY += 10;
      
      // Description paragraph with dynamic data
      const invoiceNo = calculation.invoice_no || '[invoice_no]';
      
      // Format date as day/month/year
      let formattedDate = '[invoice_date]';
      if (calculation.invoice_date) {
        const date = new Date(calculation.invoice_date);
        const day = date.getDate();
        const month = date.getMonth() + 1;
        const year = date.getFullYear();
        formattedDate = `${day}/${month}/${year}`;
      }
      
      // Format amount with thousand separator
      const rawAmount = parseFloat(calculation.total_value || '0');
      const formattedAmount = rawAmount.toLocaleString('en-US', { 
        minimumFractionDigits: 2,
        maximumFractionDigits: 2 
      });
      
      const pieces = calculation.total_quantity || '[piece]';
      const calculationRef = calculation.reference || '[reference]';
      
      const descriptionText = `As per your request duty + tax amount of the imported goods, invoice no ${invoiceNo} dated ${formattedDate} in the amount of ${formattedAmount}-USD / ${pieces} pieces reference ${calculationRef} are given below:`;
      
      doc.setFontSize(11);
      doc.setFont('Inter_18pt-ExtraLight', 'normal');
      const descLines = doc.splitTextToSize(descriptionText, rightMargin - leftMargin);
      doc.text(descLines, leftMargin, currentY);
      currentY += descLines.length * 5 + 8;
      
      // Add spacing
      currentY -= 7;
      
      // REFERENCE (centered, SemiBold 11pt)
      const referenceText = `REFERENCE: ${calculationRef}`;
      doc.setFontSize(11);
      doc.setFont('Inter_24pt-SemiBold', 'normal');
      const referenceTextWidth = doc.getTextWidth(referenceText);
      const centerX = (pdfPageWidth - referenceTextWidth) / 2;
      doc.text(referenceText, centerX, currentY);
      currentY += 8;
      
      // === TAX DETAILS SECTION ===
      // "TAX DETAILS" heading (centered, SemiBold 11pt, underlined)
      doc.setFontSize(11);
      doc.setFont('Inter_24pt-SemiBold', 'normal');
      const taxDetailsText = 'TAX DETAILS';
      const taxDetailsWidth = doc.getTextWidth(taxDetailsText);
      const taxDetailsCenterX = (pdfPageWidth - taxDetailsWidth) / 2;
      doc.text(taxDetailsText, taxDetailsCenterX, currentY);
      
      // Underline the "TAX DETAILS" text
      const underlineY = currentY + 0.5;
      doc.setLineWidth(0.3);
      doc.line(taxDetailsCenterX, underlineY, taxDetailsCenterX + taxDetailsWidth, underlineY);
      currentY += 8;
      
      // Tax data formatting
      const formatTaxValue = (value: number) => {
        return value.toLocaleString('en-US', { 
          minimumFractionDigits: 2,
          maximumFractionDigits: 2 
        });
      };
      
      // Tax table layout matching the Final Balance Report
      const tableLeftMargin = 33;
      const labelX = tableLeftMargin;
      const colonX = 95;
      const valueEndX = 165;
      
      doc.setFontSize(11);
      doc.setFont('Inter_18pt-ExtraLight', 'normal');
      
      // Tax line items
      const taxLineHeight = 6;
      
      // Customs Tax
      doc.text('-', labelX, currentY);
      doc.text('Customs Tax', labelX + 5, currentY);
      doc.text(':', colonX, currentY);
      doc.text(`₺${formatTaxValue(totalCustomsTax)}`, valueEndX, currentY, { align: 'right' });
      currentY += taxLineHeight;
      
      // Additional Customs Tax
      doc.text('-', labelX, currentY);
      doc.text('Additional Customs Tax', labelX + 5, currentY);
      doc.text(':', colonX, currentY);
      doc.text(`₺${formatTaxValue(totalAdditionalTax)}`, valueEndX, currentY, { align: 'right' });
      currentY += taxLineHeight;
      
      // KKDF
      doc.text('-', labelX, currentY);
      doc.text('KKDF', labelX + 5, currentY);
      doc.text(':', colonX, currentY);
      doc.text(`₺${formatTaxValue(totalKkdf)}`, valueEndX, currentY, { align: 'right' });
      currentY += taxLineHeight;
      
      // VAT
      doc.text('-', labelX, currentY);
      doc.text('VAT', labelX + 5, currentY);
      doc.text(':', colonX, currentY);
      doc.text(`₺${formatTaxValue(totalVat)}`, valueEndX, currentY, { align: 'right' });
      currentY += taxLineHeight;
      
      // Stamp Tax
      doc.text('-', labelX, currentY);
      doc.text('Stamp Tax', labelX + 5, currentY);
      doc.text(':', colonX, currentY);
      doc.text(`₺${formatTaxValue(totalStampTax)}`, valueEndX, currentY, { align: 'right' });
      currentY += taxLineHeight;
      
      // Line centered vertically above TOTAL TAX
      const lineY = currentY - (taxLineHeight / 2);
      doc.setLineWidth(0.3);
      doc.line(colonX + 3, lineY, valueEndX, lineY);
      
      // Add spacing before TOTAL TAX
      currentY += 2;
      
      // TOTAL TAX (SemiBold 11pt, right-aligned to colon)
      doc.setFontSize(11);
      doc.setFont('Inter_24pt-SemiBold', 'normal');
      doc.text('TOTAL TAX', colonX, currentY, { align: 'right' });
      doc.text(':', colonX, currentY);
      doc.text(`₺${totalTaxTl.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, valueEndX, currentY, { align: 'right' });
      currentY += 10;
      
      // === EXPENSE DETAILS SECTION ===
      doc.setFontSize(11);
      doc.setFont('Inter_24pt-SemiBold', 'normal');
      const expenseDetailsText = 'EXPENSE DETAILS';
      const expenseDetailsWidth = doc.getTextWidth(expenseDetailsText);
      const expenseDetailsCenterX = (pdfPageWidth - expenseDetailsWidth) / 2;
      doc.text(expenseDetailsText, expenseDetailsCenterX, currentY);
      
      // Underline the "EXPENSE DETAILS" text
      const expenseUnderlineY = currentY + 0.5;
      doc.setLineWidth(0.3);
      doc.line(expenseDetailsCenterX, expenseUnderlineY, expenseDetailsCenterX + expenseDetailsWidth, expenseUnderlineY);
      currentY += 8;
      
      doc.setFontSize(11);
      doc.setFont('Inter_18pt-ExtraLight', 'normal');
      
      const expenseLineHeight = 6;
      
      if (expenses && expenses.length > 0) {
        expenses.forEach((expense: { type: string; amount: number }) => {
          doc.text('-', labelX, currentY);
          doc.text(expense.type, labelX + 5, currentY);
          doc.text(':', colonX, currentY);
          doc.text(`₺${formatTaxValue(expense.amount)}`, valueEndX, currentY, { align: 'right' });
          currentY += expenseLineHeight;
        });
        
        // Line above total expenses
        const expenseLineY = currentY - (expenseLineHeight / 2);
        doc.setLineWidth(0.3);
        doc.line(colonX + 3, expenseLineY, valueEndX, expenseLineY);
        currentY += 2;
        
        // TOTAL EXPENSES
        doc.setFontSize(11);
        doc.setFont('Inter_24pt-SemiBold', 'normal');
        doc.text('TOTAL EXPENSES', colonX, currentY, { align: 'right' });
        doc.text(':', colonX, currentY);
        doc.text(`₺${(totalExpenses || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, valueEndX, currentY, { align: 'right' });
      } else {
        doc.text('No expenses recorded', labelX, currentY);
      }
      currentY += 10;
      
      // === GRAND TOTAL (TOTAL IMPORT EXPENSES) ===
      doc.setFontSize(14);
      doc.setFont('Inter_24pt-SemiBold', 'normal');
      const grandTotalText = 'TOTAL IMPORT EXPENSES';
      const grandTotalWidth = doc.getTextWidth(grandTotalText);
      const grandTotalCenterX = (pdfPageWidth - grandTotalWidth) / 2;
      doc.text(grandTotalText, grandTotalCenterX, currentY);
      
      // Underline grand total
      const grandUnderlineY = currentY + 0.5;
      doc.setLineWidth(0.3);
      doc.line(grandTotalCenterX, grandUnderlineY, grandTotalCenterX + grandTotalWidth, grandUnderlineY);
      currentY += 10;
      
      // Grand total value with yellow highlight
      doc.setFontSize(14);
      doc.setFont('Inter_24pt-SemiBold', 'normal');
      const grandTotalValue = `₺${(grandTotal || totalTaxTl).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      const grandTotalValueWidth = doc.getTextWidth(grandTotalValue);
      const grandTotalValueX = (pdfPageWidth - grandTotalValueWidth) / 2;
      
      // Draw yellow highlight background
      doc.setFillColor(255, 255, 0);
      doc.rect(grandTotalValueX - 3, currentY - 5, grandTotalValueWidth + 6, 7, 'F');
      
      // Draw the value text
      doc.setTextColor(0, 0, 0);
      doc.text(grandTotalValue, grandTotalValueX, currentY);
      currentY += 15;
      
      // === BANK DETAILS ===
      doc.setFontSize(10);
      doc.setFont('Inter_24pt-SemiBold', 'normal');
      const bankDetailsTitle = 'TURKISH LIRA BANK DETAILS:';
      doc.text(bankDetailsTitle, leftMargin, currentY);
      
      // Underline the title
      const bankDetailsTitleWidth = doc.getTextWidth(bankDetailsTitle);
      doc.setLineWidth(0.3);
      doc.line(leftMargin, currentY + 1, leftMargin + bankDetailsTitleWidth, currentY + 1);
      
      currentY += 5;
      
      // Bank details with Light font at 9pt
      doc.setFontSize(9);
      doc.setFont('Inter_18pt-Light', 'normal');
      doc.text('Bank Name : GARANTI BANKASI AŞ', leftMargin, currentY);
      currentY += 4;
      doc.text('Branch Name and Code : BURSA ORG. SAN. – 454', leftMargin, currentY);
      currentY += 4;
      doc.text('IBAN: TR89 0006 2000 4540 0001 2998 50', leftMargin, currentY);
      currentY += 4;
      doc.text('Account Number: 1299850', leftMargin, currentY);
      
      // === SIGNATURE ===
      const signaturePath = path.join(process.cwd(), 'attached_assets', 'image_1763683132112.png');
      
      if (fs.existsSync(signaturePath)) {
        const signatureData = fs.readFileSync(signaturePath, { encoding: 'base64' });
        const signatureImg = `data:image/png;base64,${signatureData}`;
        
        // Position signature at right bottom, above footer
        const signatureWidth = 50;
        const signatureHeight = 25;
        const signatureX = pdfPageWidth - signatureWidth - 15;
        const signatureY = pageHeight - 58;
        
        doc.addImage(signatureImg, 'PNG', signatureX, signatureY, signatureWidth, signatureHeight);
        console.log('[Adv Taxletter PDF] ✓ Signature added');
      } else {
        console.log('[Adv Taxletter PDF] ⚠ Signature file not found');
      }
      
      // === FOOTER (same as Final Balance Report) ===
      const footerY = pageHeight - 25;
      const footerFontSize = 6;
      const footerLineHeight = 3.5;
      
      doc.setFontSize(footerFontSize);
      doc.setFont('Inter_18pt-Regular', 'normal');
      
      // Calculate column widths for 4 offices
      const footerStartX = 10;
      const footerWidth = pdfPageWidth - 20;
      const colWidth = footerWidth / 4;
      
      let footerCurrentY = footerY;
      
      // Column 1: MERKEZ
      let col1X = footerStartX;
      doc.setFont('Inter_24pt-SemiBold', 'normal');
      doc.text('MERKEZ:', col1X, footerCurrentY);
      doc.setFont('Inter_18pt-Regular', 'normal');
      footerCurrentY += footerLineHeight;
      doc.text('Mudanya Yolu Çınar İşhanı', col1X, footerCurrentY);
      footerCurrentY += footerLineHeight;
      doc.text('No:2/5-6 Hamitler/Bursa', col1X, footerCurrentY);
      footerCurrentY += footerLineHeight;
      doc.text('T: 0224 242 4646  F: 0224 241 5790', col1X, footerCurrentY);
      
      // Column 2: GEMLİK ŞUBE
      footerCurrentY = footerY;
      let col2X = footerStartX + colWidth;
      doc.setFont('Inter_24pt-SemiBold', 'normal');
      doc.text('GEMLİK ŞUBE:', col2X, footerCurrentY);
      doc.setFont('Inter_18pt-Regular', 'normal');
      footerCurrentY += footerLineHeight;
      doc.text('Ata Mahallesi Hisar Mevkii Liman Yolu', col2X, footerCurrentY);
      footerCurrentY += footerLineHeight;
      doc.text('Kentli Gümrük Müdürlüğü Karşısı', col2X, footerCurrentY);
      footerCurrentY += footerLineHeight;
      doc.text('T: 0224 524 7546  F: 0224 524 7547', col2X, footerCurrentY);
      
      // Column 3: KADIKÖY ŞUBE
      footerCurrentY = footerY;
      let col3X = footerStartX + (2 * colWidth);
      doc.setFont('Inter_24pt-SemiBold', 'normal');
      doc.text('KADIKÖY ŞUBE:', col3X, footerCurrentY);
      doc.setFont('Inter_18pt-Regular', 'normal');
      footerCurrentY += footerLineHeight;
      doc.text('Orkide Sok. Aktaş İş Merkezi', col3X, footerCurrentY);
      footerCurrentY += footerLineHeight;
      doc.text('Kat:1 No:5 Kayışdağı/İstanbul', col3X, footerCurrentY);
      footerCurrentY += footerLineHeight;
      doc.text('T: 0216 337 6890 F: 0216 337 6880', col3X, footerCurrentY);
      
      // Column 4: AHL ŞUBE
      footerCurrentY = footerY;
      let col4X = footerStartX + (3 * colWidth);
      doc.setFont('Inter_24pt-SemiBold', 'normal');
      doc.text('AHL ŞUBE:', col4X, footerCurrentY);
      doc.setFont('Inter_18pt-Regular', 'normal');
      footerCurrentY += footerLineHeight;
      doc.text('AHL Kargo Gümrük Müdürlüğü', col4X, footerCurrentY);
      footerCurrentY += footerLineHeight;
      doc.text('Acenteler Binası Zemin Kat No: 16', col4X, footerCurrentY);
      footerCurrentY += footerLineHeight;
      doc.text('Yeşilköy/İstanbul', col4X, footerCurrentY);
      
      // Contact info at bottom center
      footerCurrentY += footerLineHeight + 2;
      const contactText = 'cnc@cncgumruk.com / www.cncgumruk.com';
      const contactTextWidth = doc.getTextWidth(contactText);
      const contactX = (pdfPageWidth - contactTextWidth) / 2;
      doc.text(contactText, contactX, footerCurrentY);
      
      // Send PDF
      const pdfBuffer = Buffer.from(doc.output('arraybuffer'));
      const filename = `AdvTaxletter_${calculation.reference || calculationId}.pdf`;
      
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(pdfBuffer);
      
      console.log('[Adv Taxletter PDF] ✅ Generated successfully');
      
    } catch (error) {
      console.error('[Adv Taxletter PDF] Error:', error);
      res.status(500).json({ 
        error: 'PDF generation failed', 
        details: error instanceof Error ? error.message : String(error) 
      });
    }
  });

  // Procedure PDF Export (using jsPDF)
  app.get('/api/procedures/:reference/export/pdf', async (req, res) => {
    try {
      const reference = decodeURIComponent(req.params.reference);
      console.log('\n' + '='.repeat(80));
      console.log(`[Procedure PDF] Starting PDF generation for: ${reference}`);
      console.log('='.repeat(80));
      
      // Step 1: Get procedure data
      console.log('[Procedure PDF] Step 1: Fetching procedure data...');
      const procedureResult = await db.query.procedures.findFirst({
        where: eq(procedures.reference, reference),
      });
      
      if (!procedureResult) {
        console.error('[Procedure PDF] ❌ Procedure not found');
        return res.status(404).json({ error: 'Procedure not found' });
      }
      
      console.log('[Procedure PDF] ✓ Procedure found:', procedureResult.reference);
      
      // Step 2: Get tax data
      console.log('[Procedure PDF] Step 2: Fetching tax data...');
      let taxData = null;
      try {
        const encodedReference = encodeURIComponent(reference);
        const taxResponse = await storage.getTaxByProcedureReference(reference);
        if (taxResponse) {
          taxData = taxResponse;
          console.log('[Procedure PDF] ✓ Tax data found');
        }
      } catch (error) {
        console.log('[Procedure PDF] ⚠️  No tax data available');
      }
      
      // Step 3: Get import expenses
      console.log('[Procedure PDF] Step 3: Fetching import expenses...');
      let expenses: any[] = [];
      try {
        expenses = await storage.getImportExpensesByReference(reference);
        console.log(`[Procedure PDF] ✓ Found ${expenses.length} expenses`);
      } catch (error) {
        console.log('[Procedure PDF] ⚠️  No expenses available');
      }
      
      // Step 4: Get service invoices
      console.log('[Procedure PDF] Step 4: Fetching service invoices...');
      let serviceInvoices: any[] = [];
      try {
        serviceInvoices = await storage.getImportServiceInvoicesByReference(reference);
        console.log(`[Procedure PDF] ✓ Found ${serviceInvoices.length} service invoices`);
      } catch (error) {
        console.log('[Procedure PDF] ⚠️  No service invoices available');
      }
      
      // Step 5: Get payments (traditional and distributed)
      console.log('[Procedure PDF] Step 5: Fetching payments...');
      let payments: any[] = [];
      let paymentDistributions: any[] = [];
      try {
        payments = await storage.getPaymentsByProcedureReference(reference);
        console.log(`[Procedure PDF] ✓ Found ${payments.length} traditional payments`);
      } catch (error) {
        console.log('[Procedure PDF] ⚠️  No traditional payments available');
      }
      
      try {
        paymentDistributions = await storage.getPaymentDistributionsByProcedure(reference);
        console.log(`[Procedure PDF] ✓ Found ${paymentDistributions.length} payment distributions`);
      } catch (error) {
        console.log('[Procedure PDF] ⚠️  No payment distributions available');
      }
      
      // Step 6: Load logos
      console.log('[Procedure PDF] Step 6: Loading company logos...');
      const fs = await import('fs');
      const path = await import('path');
      
      let cncLogoData: string | null = null;
      let sohoLogoData: string | null = null;
      
      try {
        const cncLogoPath = path.join(process.cwd(), 'attached_assets', 'Company Logo.png');
        const sohoLogoPath = path.join(process.cwd(), 'attached_assets', 'soho-logo.png');
        
        if (fs.existsSync(cncLogoPath)) {
          const cncBuffer = fs.readFileSync(cncLogoPath);
          cncLogoData = `data:image/png;base64,${cncBuffer.toString('base64')}`;
          console.log('[Procedure PDF] ✓ CNC logo loaded');
        }
        
        if (fs.existsSync(sohoLogoPath)) {
          const sohoBuffer = fs.readFileSync(sohoLogoPath);
          sohoLogoData = `data:image/png;base64,${sohoBuffer.toString('base64')}`;
          console.log('[Procedure PDF] ✓ SOHO logo loaded');
        }
      } catch (logoError) {
        console.warn('[Procedure PDF] ⚠️  Could not load logos:', logoError);
      }
      
      // Step 7: Create PDF document (Portrait A4)
      console.log('[Procedure PDF] Step 7: Creating PDF document...');
      const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
      });
      
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      
      doc.setFont('Inter_18pt-Regular', 'normal');
      console.log('[Procedure PDF] ✓ PDF document created');
      
      // Add logos
      if (cncLogoData) {
        try {
          doc.addImage(cncLogoData, 'PNG', 10, 10, 30, 15);
        } catch (e) {
          console.warn('[Procedure PDF] ⚠️  Could not add CNC logo');
        }
      }
      
      if (sohoLogoData) {
        try {
          doc.addImage(sohoLogoData, 'PNG', pageWidth - 40, 10, 30, 15);
        } catch (e) {
          console.warn('[Procedure PDF] ⚠️  Could not add SOHO logo');
        }
      }
      
      // Title
      let currentY = 35;
      doc.setFont('Inter_18pt-Bold', 'normal');
      doc.setFontSize(20);
      doc.setTextColor(15, 23, 42);
      doc.text('PROCEDURE REPORT', pageWidth / 2, currentY, { align: 'center' });
      
      currentY += 10;
      doc.setFont('Inter_18pt-Regular', 'normal');
      
      // Procedure Information Box
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(15, currentY, pageWidth - 30, 50, 2, 2, 'F');
      
      doc.setFontSize(10);
      doc.setTextColor(30, 41, 59);
      
      const infoStartY = currentY + 8;
      
      const drawLabelValue = (label: string, value: string, x: number, y: number) => {
        doc.setFont('Inter_18pt-Bold', 'normal');
        doc.text(label, x, y);
        const labelWidth = doc.getTextWidth(label);
        doc.setFont('Inter_18pt-Regular', 'normal');
        doc.text(value, x + labelWidth, y);
      };
      
      drawLabelValue('Reference: ', procedureResult.reference, 20, infoStartY);
      drawLabelValue('Shipper: ', procedureResult.shipper || 'N/A', 20, infoStartY + 7);
      drawLabelValue('Invoice #: ', procedureResult.invoice_no || 'N/A', 20, infoStartY + 14);
      drawLabelValue('Invoice Date: ', procedureResult.invoice_date ? (() => { const d = new Date(procedureResult.invoice_date); return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()}`; })() : 'N/A', 20, infoStartY + 21);
      drawLabelValue('AWB #: ', procedureResult.awb_number || 'N/A', 20, infoStartY + 28);
      drawLabelValue('Carrier: ', procedureResult.carrier || 'N/A', 20, infoStartY + 35);
      
      drawLabelValue('Amount: ', `$${parseFloat(procedureResult.amount || '0').toLocaleString('en-US', { minimumFractionDigits: 2 })}`, 120, infoStartY);
      drawLabelValue('Currency: ', procedureResult.currency || 'USD', 120, infoStartY + 7);
      drawLabelValue('Pieces: ', String(procedureResult.piece || 0), 120, infoStartY + 14);
      drawLabelValue('Weight: ', `${procedureResult.kg || 0} kg`, 120, infoStartY + 21);
      drawLabelValue('Package: ', procedureResult.package || 'N/A', 120, infoStartY + 28);
      drawLabelValue('Customs: ', procedureResult.customs || 'N/A', 120, infoStartY + 35);
      
      currentY += 58;
      
      // Tax Information Section
      if (taxData) {
        doc.setFont('Inter_18pt-Bold', 'normal');
        doc.setFontSize(12);
        doc.setTextColor(15, 23, 42);
        doc.text('TAX INFORMATION', 20, currentY);
        currentY += 7;
        doc.setFont('Inter_18pt-Regular', 'normal');
        
        const taxTableData = [
          ['Customs Tax', `TL ${parseFloat(taxData.customsTax || '0').toLocaleString('en-US', { minimumFractionDigits: 2 })}`],
          ['Additional Customs Tax', `TL ${parseFloat(taxData.additionalCustomsTax || '0').toLocaleString('en-US', { minimumFractionDigits: 2 })}`],
          ['KKDF', `TL ${parseFloat(taxData.kkdf || '0').toLocaleString('en-US', { minimumFractionDigits: 2 })}`],
          ['VAT', `TL ${parseFloat(taxData.vat || '0').toLocaleString('en-US', { minimumFractionDigits: 2 })}`],
          ['Stamp Tax', `TL ${parseFloat(taxData.stampTax || '0').toLocaleString('en-US', { minimumFractionDigits: 2 })}`],
        ];
        
        autoTable(doc, {
          startY: currentY,
          head: [['Tax Type', 'Amount']],
          body: taxTableData,
          theme: 'grid',
          headStyles: {
            fillColor: [59, 130, 246],
            textColor: 255,
            fontSize: 10,
            fontStyle: 'normal',
            halign: 'left',
            font: 'Inter_18pt-Bold',
          },
          bodyStyles: {
            fontSize: 9,
            textColor: [30, 41, 59],
            fontStyle: 'normal',
            font: 'Inter_18pt-Regular',
          },
          columnStyles: {
            0: { cellWidth: 100 },
            1: { cellWidth: 60, halign: 'right' },
          },
          margin: { left: 20, right: 20 },
        });
        
        currentY = (doc as any).lastAutoTable.finalY + 10;
      }
      
      // Import Expenses Section
      if (expenses.length > 0) {
        doc.setFont('Inter_18pt-Bold', 'normal');
        doc.setFontSize(12);
        doc.setTextColor(15, 23, 42);
        doc.text('IMPORT EXPENSES', 20, currentY);
        currentY += 7;
        doc.setFont('Inter_18pt-Regular', 'normal');
        
        const expenseTableData = expenses.map(expense => {
          const formatCategoryName = (category: string) => {
            if (!category) return 'N/A';
            return category.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');
          };
          const formatExpenseDate = (date: any) => {
            if (!date) return '-';
            const d = new Date(date);
            return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()}`;
          };
          return [
            formatCategoryName(expense.category),
            `TL ${parseFloat(expense.amount || '0').toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
            expense.invoiceNumber || '-',
            formatExpenseDate(expense.invoiceDate),
          ];
        });
        
        autoTable(doc, {
          startY: currentY,
          head: [['Category', 'Amount', 'Invoice #', 'Date']],
          body: expenseTableData,
          theme: 'grid',
          headStyles: {
            fillColor: [16, 185, 129],
            textColor: 255,
            fontSize: 10,
            fontStyle: 'normal',
            font: 'Inter_18pt-Bold',
          },
          bodyStyles: {
            fontSize: 9,
            textColor: [30, 41, 59],
            fontStyle: 'normal',
            font: 'Inter_18pt-Regular',
          },
          columnStyles: {
            0: { cellWidth: 50 },
            1: { cellWidth: 40, halign: 'right' },
            2: { cellWidth: 35 },
            3: { cellWidth: 35 },
          },
          margin: { left: 20, right: 20 },
        });
        
        currentY = (doc as any).lastAutoTable.finalY + 10;
      }
      
      // Service Invoices Section
      if (serviceInvoices.length > 0) {
        doc.setFont('Inter_18pt-Bold', 'normal');
        doc.setFontSize(12);
        doc.setTextColor(15, 23, 42);
        doc.text('SERVICE INVOICES', 20, currentY);
        currentY += 7;
        doc.setFont('Inter_18pt-Regular', 'normal');
        
        const invoiceTableData = serviceInvoices.map(invoice => {
          const formatInvoiceDate = (date: any) => {
            if (!date) return '-';
            const d = new Date(date);
            return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()}`;
          };
          return [
            invoice.invoiceNumber || 'N/A',
            formatInvoiceDate(invoice.date),
            `TL ${parseFloat(invoice.amount || '0').toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
            invoice.notes || '-',
          ];
        });
        
        autoTable(doc, {
          startY: currentY,
          head: [['Invoice #', 'Date', 'Amount', 'Notes']],
          body: invoiceTableData,
          theme: 'grid',
          headStyles: {
            fillColor: [139, 92, 246],
            textColor: 255,
            fontSize: 10,
            fontStyle: 'normal',
            font: 'Inter_18pt-Bold',
          },
          bodyStyles: {
            fontSize: 9,
            textColor: [30, 41, 59],
            fontStyle: 'normal',
            font: 'Inter_18pt-Regular',
          },
          columnStyles: {
            0: { cellWidth: 35 },
            1: { cellWidth: 35 },
            2: { cellWidth: 40, halign: 'right' },
            3: { cellWidth: 50 },
          },
          margin: { left: 20, right: 20 },
        });
        
        currentY = (doc as any).lastAutoTable.finalY + 10;
      }
      
      // Payments Section - show both traditional payments and distributions
      if (payments.length > 0 || paymentDistributions.length > 0) {
        doc.setFont('Inter_18pt-Bold', 'normal');
        doc.setFontSize(12);
        doc.setTextColor(15, 23, 42);
        doc.text('PAYMENTS', 20, currentY);
        currentY += 7;
        doc.setFont('Inter_18pt-Regular', 'normal');
        
        const formatPaymentDate = (date: any) => {
          if (!date) return '-';
          const d = new Date(date);
          return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()}`;
        };
        
        // Traditional payments
        const traditionalPaymentData = payments.map(payment => [
          payment.paymentType === 'advance' ? 'Advance Payment' : 'Balance Payment',
          formatPaymentDate(payment.dateReceived),
          `TL ${parseFloat(payment.amount || '0').toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
          payment.paymentMethod || '-',
          'Direct',
        ]);
        
        // Get unique incoming payment IDs and their total amounts
        const incomingPaymentIds = [...new Set(paymentDistributions.map(d => d.incomingPaymentId))];
        let totalIncomingPaymentValue = 0;
        let incomingPaymentDetails: string[] = [];
        
        // Fetch incoming payment details for summary
        for (const incomingId of incomingPaymentIds) {
          try {
            const incomingPayment = await storage.getIncomingPayment(incomingId);
            if (incomingPayment) {
              const paymentTotal = parseFloat(incomingPayment.totalAmount || '0');
              totalIncomingPaymentValue += paymentTotal;
              incomingPaymentDetails.push(`${incomingPayment.paymentId}: TL ${paymentTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
              console.log(`[Procedure PDF] Found incoming payment ${incomingPayment.paymentId} with total: ${paymentTotal}`);
            }
          } catch (e) {
            console.log(`[Procedure PDF] Could not fetch incoming payment ${incomingId}`);
          }
        }
        console.log(`[Procedure PDF] Total incoming payment value: ${totalIncomingPaymentValue}`);
        
        // Distributed payments
        const distributedPaymentData = paymentDistributions.map(dist => [
          dist.paymentType === 'advance' ? 'Advance Payment' : 'Balance Payment',
          formatPaymentDate(dist.distributionDate),
          `TL ${parseFloat(dist.distributedAmount || '0').toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
          '-',
          'Distributed',
        ]);
        
        const allPaymentData = [...traditionalPaymentData, ...distributedPaymentData];
        
        // Calculate totals
        const totalTraditional = payments.reduce((sum, p) => sum + parseFloat(p.amount || '0'), 0);
        const totalDistributed = paymentDistributions.reduce((sum, d) => sum + parseFloat(d.distributedAmount || '0'), 0);
        const grandTotal = totalTraditional + totalDistributed;
        
        autoTable(doc, {
          startY: currentY,
          head: [['Type', 'Date', 'Amount', 'Method', 'Source']],
          body: allPaymentData,
          foot: [
            [
              { content: `Total Incoming Payment Value (${incomingPaymentDetails.length > 0 ? incomingPaymentDetails.join(', ') : 'N/A'}):`, colSpan: 2, styles: { fontStyle: 'normal', halign: 'left', font: 'Inter_18pt-Regular' } },
              { content: `TL ${totalIncomingPaymentValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, styles: { fontStyle: 'normal', halign: 'right', font: 'Inter_18pt-Regular' } },
              '',
              ''
            ],
            [
              { content: 'TOTAL DISTRIBUTED TO THIS PROCEDURE:', colSpan: 2, styles: { fontStyle: 'normal', halign: 'left', font: 'Inter_18pt-Bold' } },
              { content: `TL ${grandTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, styles: { fontStyle: 'normal', halign: 'right', font: 'Inter_18pt-Bold' } },
              '',
              ''
            ]
          ],
          theme: 'grid',
          headStyles: {
            fillColor: [234, 88, 12],
            textColor: 255,
            fontSize: 10,
            fontStyle: 'normal',
            font: 'Inter_18pt-Bold',
          },
          bodyStyles: {
            fontSize: 9,
            textColor: [30, 41, 59],
            fontStyle: 'normal',
            font: 'Inter_18pt-Regular',
          },
          footStyles: {
            fillColor: [254, 215, 170],
            textColor: [30, 41, 59],
            fontSize: 9,
            fontStyle: 'normal',
            font: 'Inter_18pt-Regular',
          },
          columnStyles: {
            0: { cellWidth: 35 },
            1: { cellWidth: 30 },
            2: { cellWidth: 40, halign: 'right' },
            3: { cellWidth: 30 },
            4: { cellWidth: 25 },
          },
          margin: { left: 20, right: 20 },
        });
        
        currentY = (doc as any).lastAutoTable.finalY + 10;
      }
      
      // Footer
      doc.setFontSize(8);
      doc.setTextColor(148, 163, 184);
      doc.text(
        `Generated on ${new Date().toLocaleString()}`,
        pageWidth / 2,
        pageHeight - 10,
        { align: 'center' }
      );
      
      // Step 8: Generate buffer
      console.log('[Procedure PDF] Step 8: Generating PDF buffer...');
      const pdfArrayBuffer = doc.output('arraybuffer');
      const pdfBuffer = Buffer.from(pdfArrayBuffer);
      
      console.log(`[Procedure PDF] ✓ PDF buffer generated (${pdfBuffer.length} bytes)`);
      
      // Step 9: Send PDF
      const filename = `Procedure_${reference}_${Date.now()}.pdf`;
      console.log(`[Procedure PDF] Step 9: Sending PDF: ${filename}`);
      
      // Check if inline mode is requested (for view in browser)
      const inline = req.query.inline === 'true';
      
      res.setHeader('Content-Type', 'application/pdf');
      if (inline) {
        res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
        console.log('[Procedure PDF] ✓ Sending PDF for inline viewing');
      } else {
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        console.log('[Procedure PDF] ✓ Sending PDF for download');
      }
      res.send(pdfBuffer);
      
      console.log('[Procedure PDF] ✅ PDF GENERATION COMPLETE');
      console.log('='.repeat(80) + '\n');
      
    } catch (error) {
      console.error('\n' + '='.repeat(80));
      console.error('[Procedure PDF] ❌❌❌ FATAL ERROR ❌❌❌');
      console.error('='.repeat(80));
      console.error('[Procedure PDF] Error type:', error instanceof Error ? error.constructor.name : 'Unknown');
      console.error('[Procedure PDF] Error message:', error instanceof Error ? error.message : String(error));
      if (error instanceof Error && error.stack) {
        console.error('[Procedure PDF] Error stack:', error.stack);
      }
      console.error('='.repeat(80) + '\n');
      
      res.status(500).json({ 
        error: 'PDF generation failed', 
        details: error instanceof Error ? error.message : String(error),
        type: error instanceof Error ? error.constructor.name : 'Unknown'
      });
    }
  });

  // Final Balance Report PDF Export endpoint
  app.get('/api/procedures/:reference/export/final-balance-pdf', async (req, res) => {
    try {
      const reference = req.params.reference;
      console.log('[Final Balance PDF] Generating blank template for:', reference);
      
      // Get procedure data (we'll need this later)
      const procedure = await db.query.procedures.findFirst({
        where: eq(procedures.reference, reference),
      });
      
      if (!procedure) {
        return res.status(404).json({ error: 'Procedure not found' });
      }
      
      // Get expenses (we'll need this later)
      const expenses = await db.query.importExpenses.findMany({
        where: eq(importExpenses.procedureReference, reference),
      });
      
      // Get service invoices
      const serviceInvoices = await db.query.importServiceInvoices.findMany({
        where: eq(importServiceInvoices.procedureReference, reference),
      });
      
      // Get taxes
      const taxData = await db.query.taxes.findFirst({
        where: eq(taxes.procedureReference, reference),
      });
      
      // Get payment distributions for this procedure
      const distributionsForProc = await db.query.paymentDistributions.findMany({
        where: eq(paymentDistributions.procedureReference, reference),
      });
      
      // Calculate financial summary (same logic as in /api/financial-summary endpoint)
      let advancePayments = 0;
      let balancePayments = 0;
      
      for (const dist of distributionsForProc) {
        const amount = parseFloat(String(dist.distributedAmount || "0"));
        if (dist.paymentType === "advance") {
          advancePayments += amount;
        } else if (dist.paymentType === "balance") {
          balancePayments += amount;
        }
      }
      
      const totalPayments = advancePayments + balancePayments;
      
      console.log('[Final Balance PDF] Data loaded - Financial Summary:', {
        advancePayments: advancePayments.toFixed(2),
        balancePayments: balancePayments.toFixed(2),
        totalPayments: totalPayments.toFixed(2)
      });
      
      // Import jsPDF
      const { jsPDF } = await import('jspdf');
      await import('./fonts/Inter_18pt-Regular-normal.js');
      await import('./fonts/Inter_18pt-ExtraLight-normal.js');
      await import('./fonts/Inter_18pt-Light-normal.js');
      await import('./fonts/Inter_18pt-Bold-normal.js');
      await import('./fonts/Inter_24pt-SemiBold-normal.js');
      
      // Create blank A4 PDF (Portrait)
      const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
        compress: true
      });
      
      // Set font
      doc.setFont('Inter_18pt-Regular', 'normal');
      
      // Page dimensions for reference
      const pageWidth = 210;  // A4 width in mm
      const pageHeight = 297; // A4 height in mm
      
      console.log('[Final Balance PDF] Blank A4 created');
      console.log('[Final Balance PDF] Page size:', pageWidth, 'x', pageHeight, 'mm');
      
      // === HEADER ===
      // Yellow line at the top
      doc.setFillColor(255, 215, 0); // Yellow color
      doc.rect(0, 0, pageWidth, 5, 'F'); // Fill rectangle from top
      
      // Add company logo (bigger size)
      const fs = await import('fs');
      const path = await import('path');
      const logoPath = path.join(process.cwd(), 'attached_assets', 'CNC_tranparanLOGO_1763335105931.png');
      
      if (fs.existsSync(logoPath)) {
        const logoData = fs.readFileSync(logoPath, { encoding: 'base64' });
        const logoImg = `data:image/png;base64,${logoData}`;
        
        // Add bigger logo on the right side below yellow line
        doc.addImage(logoImg, 'PNG', pageWidth - 55, 8, 45, 25);
        console.log('[Final Balance PDF] ✓ Logo added');
      } else {
        console.log('[Final Balance PDF] ⚠ Logo file not found');
      }
      
      // === HEADER TEXT ===
      let currentY = 38; // Start closer to the logo (reduced from 45)
      const leftMargin = 20;
      const rightMargin = 190;
      
      // "To SOHO..." header (SemiBold 11pt)
      doc.setFontSize(11);
      doc.setFont('Inter_24pt-SemiBold', 'normal');
      doc.text('To SOHO PERAKENDE YATIRIM VE TICARET ANONIM SIRKETI;', leftMargin, currentY);
      currentY += 10;
      
      // Description paragraph with dynamic data
      const shipper = procedure.shipper || '[shipper]';
      const invoiceNo = procedure.invoice_no || '[invoice_no]';
      
      // Format date as day/month/year
      let formattedDate = '[invoice_date]';
      if (procedure.invoice_date) {
        const date = new Date(procedure.invoice_date);
        const day = date.getDate();
        const month = date.getMonth() + 1; // Months are 0-indexed
        const year = date.getFullYear();
        formattedDate = `${day}/${month}/${year}`;
      }
      
      // Format amount with thousand separator
      const rawAmount = parseFloat(procedure.amount || '0');
      const formattedAmount = rawAmount.toLocaleString('en-US', { 
        minimumFractionDigits: 2,
        maximumFractionDigits: 2 
      });
      
      const currency = procedure.currency || '[currency]';
      const pieces = procedure.piece || '[piece]';
      const procedureRef = procedure.reference || '[reference]';
      
      const descriptionText = `As per your request duty + tax amount and all related expenses of the imported goods from ${shipper}, invoice no ${invoiceNo} dated ${formattedDate} in the amount of ${formattedAmount}-${currency} / ${pieces} pieces reference ${procedureRef} are given below:`;
      
      doc.setFontSize(11);
      doc.setFont('Inter_18pt-ExtraLight', 'normal'); // ExtraLight 11pt for description
      const descLines = doc.splitTextToSize(descriptionText, rightMargin - leftMargin);
      doc.text(descLines, leftMargin, currentY);
      currentY += descLines.length * 5 + 8;
      
      // Add 3mm spacing
      currentY -= 7;
      
      // IMPORT DEC. NO (centered, SemiBold 11pt)
      const importDecNo = procedure.import_dec_number || '[import_dec_number]';
      const importDecText = `IMPORT DEC. NO: ${importDecNo}`;
      doc.setFontSize(11);
      doc.setFont('Inter_24pt-SemiBold', 'normal');
      const pdfPageWidth = doc.internal.pageSize.getWidth();
      const importDecTextWidth = doc.getTextWidth(importDecText);
      const centerX = (pdfPageWidth - importDecTextWidth) / 2;
      doc.text(importDecText, centerX, currentY);
      currentY += 8; // Reduced by 2mm
      
      // === TAX DETAILS SECTION ===
      // "TAX DETAILS" heading (centered, SemiBold 11pt, underlined)
      doc.setFontSize(11);
      doc.setFont('Inter_24pt-SemiBold', 'normal');
      const taxDetailsText = 'TAX DETAILS';
      const taxDetailsWidth = doc.getTextWidth(taxDetailsText);
      const taxDetailsCenterX = (pdfPageWidth - taxDetailsWidth) / 2;
      doc.text(taxDetailsText, taxDetailsCenterX, currentY);
      
      // Underline the "TAX DETAILS" text
      const underlineY = currentY + 0.5;
      doc.setLineWidth(0.3);
      doc.line(taxDetailsCenterX, underlineY, taxDetailsCenterX + taxDetailsWidth, underlineY);
      currentY += 8;
      
      // Tax data (with formatting)
      const formatTaxValue = (value: string | null | undefined) => {
        const num = parseFloat(value || '0');
        return num.toLocaleString('en-US', { 
          minimumFractionDigits: 2,
          maximumFractionDigits: 2 
        });
      };
      
      const customsTax = formatTaxValue(taxData?.customsTax);
      const additionalCustomsTax = formatTaxValue(taxData?.additionalCustomsTax);
      const kkdf = formatTaxValue(taxData?.kkdf);
      const vat = formatTaxValue(taxData?.vat);
      const stampTax = formatTaxValue(taxData?.stampTax);
      
      // Calculate total
      const totalTax = (
        parseFloat(taxData?.customsTax || '0') +
        parseFloat(taxData?.additionalCustomsTax || '0') +
        parseFloat(taxData?.kkdf || '0') +
        parseFloat(taxData?.vat || '0') +
        parseFloat(taxData?.stampTax || '0')
      );
      const formattedTotalTax = totalTax.toLocaleString('en-US', { 
        minimumFractionDigits: 2,
        maximumFractionDigits: 2 
      });
      
      // Tax table layout matching the example
      const tableLeftMargin = 33; // Moved 2mm to the left
      const labelX = tableLeftMargin;
      const colonX = 95; // Colon position after labels
      const valueEndX = 165; // Right edge for values
      
      doc.setFontSize(11);
      doc.setFont('Inter_18pt-ExtraLight', 'normal'); // ExtraLight 11pt for tax table
      
      // Tax line items
      const taxLineHeight = 6;
      
      // Customs Tax
      doc.text('-', labelX, currentY);
      doc.text('Customs Tax', labelX + 5, currentY);
      doc.text(':', colonX, currentY);
      doc.text(`₺${customsTax}`, valueEndX, currentY, { align: 'right' });
      currentY += taxLineHeight;
      
      // Additional Customs Tax
      doc.text('-', labelX, currentY);
      doc.text('Additional Customs Tax', labelX + 5, currentY);
      doc.text(':', colonX, currentY);
      doc.text(`₺${additionalCustomsTax}`, valueEndX, currentY, { align: 'right' });
      currentY += taxLineHeight;
      
      // KKDF
      doc.text('-', labelX, currentY);
      doc.text('KKDF', labelX + 5, currentY);
      doc.text(':', colonX, currentY);
      doc.text(`₺${kkdf}`, valueEndX, currentY, { align: 'right' });
      currentY += taxLineHeight;
      
      // VAT
      doc.text('-', labelX, currentY);
      doc.text('VAT', labelX + 5, currentY);
      doc.text(':', colonX, currentY);
      doc.text(`₺${vat}`, valueEndX, currentY, { align: 'right' });
      currentY += taxLineHeight;
      
      // Stamp Tax
      doc.text('-', labelX, currentY);
      doc.text('Stamp Tax', labelX + 5, currentY);
      doc.text(':', colonX, currentY);
      doc.text(`₺${stampTax}`, valueEndX, currentY, { align: 'right' });
      currentY += taxLineHeight;
      
      // Line centered vertically between Stamp Tax and TOTAL TAX
      const lineY = currentY - (taxLineHeight / 2);
      doc.setLineWidth(0.3);
      doc.line(colonX + 3, lineY, valueEndX, lineY);
      
      // Add spacing before TOTAL TAX
      currentY += 2;
      
      // TOTAL TAX (SemiBold 11pt, right-aligned to colon)
      doc.setFontSize(11);
      doc.setFont('Inter_24pt-SemiBold', 'normal');
      doc.text('TOTAL TAX', colonX, currentY, { align: 'right' });
      doc.text(':', colonX, currentY);
      doc.text(`₺${formattedTotalTax}`, valueEndX, currentY, { align: 'right' });
      currentY += 7; // Reduced by 1mm
      
      // === EXPENSE DETAILS SECTION ===
      currentY += 2; // Reduced spacing
      
      // "EXPENSE DETAILS" heading (centered, SemiBold 11pt, underlined)
      doc.setFontSize(11);
      doc.setFont('Inter_24pt-SemiBold', 'normal');
      const expenseDetailsText = 'EXPENSE DETAILS';
      const expenseDetailsWidth = doc.getTextWidth(expenseDetailsText);
      const expenseDetailsCenterX = (pdfPageWidth - expenseDetailsWidth) / 2;
      doc.text(expenseDetailsText, expenseDetailsCenterX, currentY);
      
      // Underline the "EXPENSE DETAILS" text
      const expenseUnderlineY = currentY + 0.5;
      doc.setLineWidth(0.3);
      doc.line(expenseDetailsCenterX, expenseUnderlineY, expenseDetailsCenterX + expenseDetailsWidth, expenseUnderlineY);
      currentY += 8;
      
      // Format expense category names
      const formatCategoryName = (category: string) => {
        return category.split('_').map(word => 
          word.charAt(0).toUpperCase() + word.slice(1)
        ).join(' ');
      };
      
      // Format expense values (always use ₺ symbol)
      const formatExpenseValue = (amount: string | null | undefined) => {
        const num = parseFloat(amount || '0');
        const formatted = num.toLocaleString('en-US', { 
          minimumFractionDigits: 2,
          maximumFractionDigits: 2 
        });
        return `₺${formatted}`;
      };
      
      doc.setFontSize(11);
      doc.setFont('Inter_18pt-ExtraLight', 'normal'); // ExtraLight 11pt for expense table
      
      // Expense line items
      let totalExpenses = 0;
      for (const expense of expenses) {
        const categoryName = formatCategoryName(expense.category);
        const expenseValue = formatExpenseValue(expense.amount);
        
        doc.text('-', labelX, currentY);
        doc.text(categoryName, labelX + 5, currentY);
        doc.text(':', colonX, currentY);
        doc.text(expenseValue, valueEndX, currentY, { align: 'right' });
        currentY += taxLineHeight;
        
        // Add to total
        totalExpenses += parseFloat(expense.amount || '0');
      }
      
      // Service invoice line items (without invoice number)
      for (const invoice of serviceInvoices) {
        const invoiceName = 'Service Invoice';
        const invoiceValue = formatExpenseValue(invoice.amount);
        
        doc.text('-', labelX, currentY);
        doc.text(invoiceName, labelX + 5, currentY);
        doc.text(':', colonX, currentY);
        doc.text(invoiceValue, valueEndX, currentY, { align: 'right' });
        currentY += taxLineHeight;
        
        // Add to total
        totalExpenses += parseFloat(invoice.amount || '0');
      }
      
      // If no expenses or invoices, show a message
      if (expenses.length === 0 && serviceInvoices.length === 0) {
        doc.text('No expenses recorded', labelX + 5, currentY);
        currentY += taxLineHeight;
      }
      
      // Line above TOTAL EXPENSES (shorter line, positioned under the value only)
      const expenseLineY = currentY - (taxLineHeight / 2);
      doc.setLineWidth(0.3);
      doc.line(colonX + 3, expenseLineY, valueEndX, expenseLineY);
      currentY += 2;
      
      // TOTAL EXPENSES (SemiBold 11pt, right-aligned to colon)
      const formattedTotalExpenses = totalExpenses.toLocaleString('en-US', { 
        minimumFractionDigits: 2,
        maximumFractionDigits: 2 
      });
      doc.setFontSize(11);
      doc.setFont('Inter_24pt-SemiBold', 'normal');
      doc.text('TOTAL EXPENSES', colonX, currentY, { align: 'right' });
      doc.text(':', colonX, currentY);
      doc.text(`₺${formattedTotalExpenses}`, valueEndX, currentY, { align: 'right' });
      currentY += 6; // Reduced spacing
      
      // === TOTAL IMPORT EXPENSES ===
      // Black line across the page (shorter, positioned under value)
      doc.setLineWidth(0.5);
      doc.line(colonX + 3, currentY, valueEndX, currentY);
      currentY += 6; // Reduced spacing
      
      // Calculate total import expenses (Total Tax + Total Expenses)
      const totalImportExpenses = totalTax + totalExpenses;
      const formattedTotalImportExpenses = totalImportExpenses.toLocaleString('en-US', { 
        minimumFractionDigits: 2,
        maximumFractionDigits: 2 
      });
      
      // TOTAL IMPORT EXPENSES (Bold 12pt, underlined)
      doc.setFontSize(12);
      doc.setFont('Inter_18pt-Bold', 'normal');
      const totalImportExpensesLabel = 'TOTAL IMPORT EXPENSES';
      const totalImportExpensesValue = `₺${formattedTotalImportExpenses}`;
      
      // Draw label (right-aligned to colon)
      doc.text(totalImportExpensesLabel, colonX, currentY, { align: 'right' });
      const totalImportExpensesLabelWidth = doc.getTextWidth(totalImportExpensesLabel);
      
      // Draw colon
      doc.text(':', colonX, currentY);
      
      // Draw value
      doc.text(totalImportExpensesValue, valueEndX, currentY, { align: 'right' });
      const totalImportExpensesValueWidth = doc.getTextWidth(totalImportExpensesValue);
      
      // Underline label
      doc.setLineWidth(0.3);
      doc.line(colonX - totalImportExpensesLabelWidth, currentY + 1, colonX, currentY + 1);
      
      // Underline value
      doc.line(valueEndX - totalImportExpensesValueWidth, currentY + 1, valueEndX, currentY + 1);
      
      currentY += 10; // Reduced spacing
      
      // === RECEIVED AMOUNT ===
      // Format total payments (already calculated above)
      const formattedTotalPayments = totalPayments.toLocaleString('en-US', { 
        minimumFractionDigits: 2,
        maximumFractionDigits: 2 
      });
      
      // RECEIVED AMOUNT (SemiBold 12pt, underlined, left-aligned)
      doc.setFontSize(12);
      doc.setFont('Inter_24pt-SemiBold', 'normal');
      const receivedAmountText = 'RECEIVED AMOUNT:';
      const receivedAmountValue = `₺${formattedTotalPayments}`;
      
      // Draw text at left margin (like "To SOHO..." header)
      doc.text(receivedAmountText, leftMargin, currentY);
      const textWidth = doc.getTextWidth(receivedAmountText);
      
      // Underline the label
      doc.setLineWidth(0.3);
      doc.line(leftMargin, currentY + 1, leftMargin + textWidth, currentY + 1);
      
      // Add value next to it (no underline)
      const valueX = leftMargin + textWidth + 5;
      doc.text(receivedAmountValue, valueX, currentY);
      
      currentY += 9; // Reduced by 1mm
      
      // === FINAL BALANCE ===
      // Calculate final balance
      const finalBalance = totalPayments - totalImportExpenses;
      const finalBalanceAbs = Math.abs(finalBalance);
      const formattedFinalBalance = finalBalanceAbs.toLocaleString('en-US', { 
        minimumFractionDigits: 2,
        maximumFractionDigits: 2 
      });
      
      // Determine color and label based on balance
      let balanceColor: [number, number, number];
      let balanceLabel: string;
      
      if (finalBalance < 0) {
        // Remaining Balance (red)
        balanceColor = [220, 38, 38]; // Red color (RGB)
        balanceLabel = 'REMAINING BALANCE';
      } else {
        // Excess Payment (green)
        balanceColor = [22, 163, 74]; // Green color (RGB)
        balanceLabel = 'EXCESS PAYMENT';
      }
      
      // FINAL BALANCE label (Bold 14pt, underlined, left-aligned, black)
      doc.setFontSize(14);
      doc.setFont('Inter_18pt-Bold', 'normal');
      doc.setTextColor(0, 0, 0); // Black for label
      const finalBalanceText = 'FINAL BALANCE:';
      
      // Draw label
      doc.text(finalBalanceText, leftMargin, currentY);
      const finalBalanceLabelWidth = doc.getTextWidth(finalBalanceText);
      
      // Underline the label
      doc.setLineWidth(0.3);
      doc.line(leftMargin, currentY + 1, leftMargin + finalBalanceLabelWidth, currentY + 1);
      
      // Value and label (colored, no underline)
      const finalBalanceValueText = `₺${formattedFinalBalance} – ${balanceLabel}`;
      const finalBalanceValueX = leftMargin + finalBalanceLabelWidth + 5;
      
      // Set color for value and balance label
      doc.setTextColor(balanceColor[0], balanceColor[1], balanceColor[2]);
      doc.text(finalBalanceValueText, finalBalanceValueX, currentY);
      
      // Reset text color to black
      doc.setTextColor(0, 0, 0);
      
      currentY += 20; // 20mm spacing after FINAL BALANCE
      
      // === BANK DETAILS ===
      doc.setFontSize(10);
      doc.setFont('Inter_24pt-SemiBold', 'normal');
      const bankDetailsTitle = 'TURKISH LIRA BANK DETAILS:';
      doc.text(bankDetailsTitle, leftMargin, currentY);
      
      // Underline the title
      const bankDetailsTitleWidth = doc.getTextWidth(bankDetailsTitle);
      doc.setLineWidth(0.3);
      doc.line(leftMargin, currentY + 1, leftMargin + bankDetailsTitleWidth, currentY + 1);
      
      currentY += 5;
      
      // Bank details with Light font at 9pt
      doc.setFontSize(9);
      doc.setFont('Inter_18pt-Light', 'normal');
      doc.text('Bank Name : GARANTI BANKASI AŞ', leftMargin, currentY);
      currentY += 4;
      doc.text('Branch Name and Code : BURSA ORG. SAN. – 454', leftMargin, currentY);
      currentY += 4;
      doc.text('IBAN: TR89 0006 2000 4540 0001 2998 50', leftMargin, currentY);
      currentY += 4;
      doc.text('Account Number: 1299850', leftMargin, currentY);
      
      currentY += 10;
      
      // === SIGNATURE ===
      // Add signature image at right bottom above footer
      const signaturePath = path.join(process.cwd(), 'attached_assets', 'image_1763683132112.png');
      
      if (fs.existsSync(signaturePath)) {
        const signatureData = fs.readFileSync(signaturePath, { encoding: 'base64' });
        const signatureImg = `data:image/png;base64,${signatureData}`;
        
        // Position signature at right bottom, above footer
        const signatureWidth = 50;
        const signatureHeight = 25;
        const signatureX = pdfPageWidth - signatureWidth - 15; // 15mm from right edge
        const signatureY = pageHeight - 58; // 58mm from bottom (moved 5mm up)
        
        doc.addImage(signatureImg, 'PNG', signatureX, signatureY, signatureWidth, signatureHeight);
        console.log('[Final Balance PDF] ✓ Signature added');
      } else {
        console.log('[Final Balance PDF] ⚠ Signature file not found');
      }
      
      // === FOOTER ===
      const footerY = pageHeight - 25; // Position footer 25mm from bottom
      const footerFontSize = 6;
      const footerLineHeight = 3.5;
      
      doc.setFontSize(footerFontSize);
      doc.setFont('Inter_18pt-Regular', 'normal');
      
      // Calculate column widths for 4 offices (expand to edges)
      const footerStartX = 10; // Closer to left edge
      const footerWidth = pdfPageWidth - 20; // Expand to both edges
      const colWidth = footerWidth / 4;
      
      let footerCurrentY = footerY;
      
      // Column 1: MERKEZ (Center)
      let col1X = footerStartX;
      doc.setFont('Inter_24pt-SemiBold', 'normal');
      doc.text('MERKEZ:', col1X, footerCurrentY);
      doc.setFont('Inter_18pt-Regular', 'normal');
      footerCurrentY += footerLineHeight;
      doc.text('Mudanya Yolu Çınar İşhanı', col1X, footerCurrentY);
      footerCurrentY += footerLineHeight;
      doc.text('No:2/5-6 Hamitler/Bursa', col1X, footerCurrentY);
      footerCurrentY += footerLineHeight;
      doc.text('T: 0224 242 4646  F: 0224 241 5790', col1X, footerCurrentY);
      
      // Column 2: GEMLİK ŞUBE
      footerCurrentY = footerY;
      let col2X = footerStartX + colWidth;
      doc.setFont('Inter_24pt-SemiBold', 'normal');
      doc.text('GEMLİK ŞUBE:', col2X, footerCurrentY);
      doc.setFont('Inter_18pt-Regular', 'normal');
      footerCurrentY += footerLineHeight;
      doc.text('Ata Mahallesi Hisar Mevkii Liman Yolu', col2X, footerCurrentY);
      footerCurrentY += footerLineHeight;
      doc.text('Kentli Gümrük Müdürlüğü Karşısı', col2X, footerCurrentY);
      footerCurrentY += footerLineHeight;
      doc.text('T: 0224 524 7546  F: 0224 524 7547', col2X, footerCurrentY);
      
      // Column 3: KADIKÖY ŞUBE
      footerCurrentY = footerY;
      let col3X = footerStartX + (2 * colWidth);
      doc.setFont('Inter_24pt-SemiBold', 'normal');
      doc.text('KADIKÖY ŞUBE:', col3X, footerCurrentY);
      doc.setFont('Inter_18pt-Regular', 'normal');
      footerCurrentY += footerLineHeight;
      doc.text('Orkide Sok. Aktaş İş Merkezi', col3X, footerCurrentY);
      footerCurrentY += footerLineHeight;
      doc.text('Kat:1 No:5 Kayışdağı/İstanbul', col3X, footerCurrentY);
      footerCurrentY += footerLineHeight;
      doc.text('T: 0216 337 6890 F: 0216 337 6880', col3X, footerCurrentY);
      
      // Column 4: AHL ŞUBE
      footerCurrentY = footerY;
      let col4X = footerStartX + (3 * colWidth);
      doc.setFont('Inter_24pt-SemiBold', 'normal');
      doc.text('AHL ŞUBE:', col4X, footerCurrentY);
      doc.setFont('Inter_18pt-Regular', 'normal');
      footerCurrentY += footerLineHeight;
      doc.text('AHL Kargo Gümrük Müdürlüğü', col4X, footerCurrentY);
      footerCurrentY += footerLineHeight;
      doc.text('Acenteler Binası Zemin Kat No: 16', col4X, footerCurrentY);
      footerCurrentY += footerLineHeight;
      doc.text('Yeşilköy/İstanbul', col4X, footerCurrentY);
      
      // Contact info at bottom center
      footerCurrentY += footerLineHeight + 2;
      const contactText = 'cnc@cncgumruk.com / www.cncgumruk.com';
      const contactTextWidth = doc.getTextWidth(contactText);
      const contactX = (pdfPageWidth - contactTextWidth) / 2;
      doc.text(contactText, contactX, footerCurrentY);
      
      // Send PDF
      const pdfBuffer = Buffer.from(doc.output('arraybuffer'));
      const filename = `FinalBalance_${reference}_${Date.now()}.pdf`;
      
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(pdfBuffer);
      
      console.log('[Final Balance PDF] ✅ Sent successfully');
      
    } catch (error) {
      console.error('[Final Balance PDF] ❌ Error:', error);
      res.status(500).json({ 
        error: 'PDF generation failed', 
        details: error instanceof Error ? error.message : String(error) 
      });
    }
  });

  // =============================================================================
  // CLAUDE VISION API ENDPOINTS
  // =============================================================================
  
  // Authentication middleware for Claude endpoints
  const requireClaudeAuth = (req: Request, res: Response, next: Function) => {
    // Check session first
    const sessionUserId = (req.session as any)?.userId;

    // Check Authorization header as fallback
    const authHeader = req.headers.authorization;
    let headerUserId = null;

    if (authHeader && authHeader.startsWith("Bearer ")) {
      try {
        const token = authHeader.substring(7);
        headerUserId = parseInt(token); // Simple token for now (user ID)
      } catch (error) {
        // Invalid token format
      }
    }

    // Use either session or header authentication
    const effectiveUserId = sessionUserId || headerUserId;
    
    if (!effectiveUserId) {
      return res.status(401).json({ 
        error: "Authentication required",
        message: "You must be logged in to use Claude Vision API"
      });
    }
    
    // Check if Claude API is configured
    if (!claude.isConfigured()) {
      return res.status(503).json({ 
        error: "Service unavailable",
        message: "Claude API is not configured. Please contact administrator."
      });
    }
    
    next();
  };
  
  // Validation helper for base64 images
  const validateBase64Image = (base64Image: string, maxSizeMB = 20): boolean => {
    if (!base64Image || typeof base64Image !== 'string') return false;
    
    // Check size (rough estimate: base64 is ~4/3 of original size)
    const sizeInBytes = (base64Image.length * 3) / 4;
    const sizeInMB = sizeInBytes / (1024 * 1024);
    
    if (sizeInMB > maxSizeMB) {
      throw new Error(`Image size (${sizeInMB.toFixed(2)}MB) exceeds maximum allowed size (${maxSizeMB}MB)`);
    }
    
    return true;
  };
  
  /**
   * POST /api/claude/analyze-image
   * Analyze a single image using Claude Vision
   * Body: { base64Image: string, mediaType?: string, prompt?: string }
   * Requires authentication
   */
  app.post("/api/claude/analyze-image", requireClaudeAuth, async (req, res) => {
    try {
      const { base64Image, mediaType, prompt } = req.body;
      
      if (!base64Image) {
        return res.status(400).json({ error: "base64Image is required" });
      }
      
      // Validate image size
      try {
        validateBase64Image(base64Image);
      } catch (validationError) {
        return res.status(400).json({ 
          error: "Invalid image",
          details: validationError instanceof Error ? validationError.message : String(validationError)
        });
      }
      
      const result = await claude.analyzeImage(
        base64Image,
        mediaType || 'image/jpeg',
        prompt
      );
      
      res.json({ success: true, analysis: result });
    } catch (error) {
      console.error("[Claude] Image analysis error:", error);
      res.status(500).json({ 
        error: "Failed to analyze image", 
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });
  
  /**
   * POST /api/claude/extract-invoice
   * Extract structured data from invoice/document image
   * Body: { base64Image: string, mediaType?: string }
   * Requires authentication
   */
  app.post("/api/claude/extract-invoice", requireClaudeAuth, async (req, res) => {
    try {
      const { base64Image, mediaType } = req.body;
      
      if (!base64Image) {
        return res.status(400).json({ error: "base64Image is required" });
      }
      
      // Validate image size
      try {
        validateBase64Image(base64Image);
      } catch (validationError) {
        return res.status(400).json({ 
          error: "Invalid image",
          details: validationError instanceof Error ? validationError.message : String(validationError)
        });
      }
      
      const extractedData = await claude.extractInvoiceData(
        base64Image,
        mediaType || 'image/jpeg'
      );
      
      res.json({ success: true, data: extractedData });
    } catch (error) {
      console.error("[Claude] Invoice extraction error:", error);
      res.status(500).json({ 
        error: "Failed to extract invoice data", 
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });
  
  /**
   * POST /api/claude/ask-about-image
   * Ask a specific question about an image
   * Body: { base64Image: string, question: string, mediaType?: string }
   * Requires authentication
   */
  app.post("/api/claude/ask-about-image", requireClaudeAuth, async (req, res) => {
    try {
      const { base64Image, question, mediaType } = req.body;
      
      if (!base64Image || !question) {
        return res.status(400).json({ error: "base64Image and question are required" });
      }
      
      if (typeof question !== 'string' || question.trim().length === 0) {
        return res.status(400).json({ error: "question must be a non-empty string" });
      }
      
      // Validate image size
      try {
        validateBase64Image(base64Image);
      } catch (validationError) {
        return res.status(400).json({ 
          error: "Invalid image",
          details: validationError instanceof Error ? validationError.message : String(validationError)
        });
      }
      
      const answer = await claude.askAboutImage(
        base64Image,
        question,
        mediaType || 'image/jpeg'
      );
      
      res.json({ success: true, answer });
    } catch (error) {
      console.error("[Claude] Ask about image error:", error);
      res.status(500).json({ 
        error: "Failed to answer question about image", 
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });
  
  /**
   * POST /api/claude/analyze-multiple-images
   * Analyze multiple images (e.g., multi-page PDF)
   * Body: { images: Array<{ base64: string, mediaType: string }>, prompt?: string }
   * Requires authentication
   */
  app.post("/api/claude/analyze-multiple-images", requireClaudeAuth, async (req, res) => {
    try {
      const { images, prompt } = req.body;
      
      if (!images || !Array.isArray(images) || images.length === 0) {
        return res.status(400).json({ error: "images array is required" });
      }
      
      if (images.length > 10) {
        return res.status(400).json({ error: "Maximum 10 images allowed per request" });
      }
      
      // Validate each image
      try {
        images.forEach((img, idx) => {
          if (!img.base64 || typeof img.base64 !== 'string') {
            throw new Error(`Image at index ${idx} is missing base64 data`);
          }
          validateBase64Image(img.base64, 10); // Lower limit per image for multi-image requests
        });
      } catch (validationError) {
        return res.status(400).json({ 
          error: "Invalid images",
          details: validationError instanceof Error ? validationError.message : String(validationError)
        });
      }
      
      const result = await claude.analyzeMultipleImages(images, prompt);
      
      res.json({ success: true, analysis: result });
    } catch (error) {
      console.error("[Claude] Multiple images analysis error:", error);
      res.status(500).json({ 
        error: "Failed to analyze multiple images", 
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });
  
  /**
   * POST /api/claude/analyze-text
   * Analyze text with Claude (non-vision)
   * Body: { prompt: string, systemPrompt?: string }
   * Requires authentication
   */
  app.post("/api/claude/analyze-text", requireClaudeAuth, async (req, res) => {
    try {
      const { prompt, systemPrompt } = req.body;
      
      if (!prompt) {
        return res.status(400).json({ error: "prompt is required" });
      }
      
      if (typeof prompt !== 'string' || prompt.trim().length === 0) {
        return res.status(400).json({ error: "prompt must be a non-empty string" });
      }
      
      // Validate prompt length (max 100k characters to prevent abuse)
      if (prompt.length > 100000) {
        return res.status(400).json({ error: "prompt exceeds maximum length of 100,000 characters" });
      }
      
      const result = await claude.analyzeText(prompt, systemPrompt);
      
      res.json({ success: true, result });
    } catch (error) {
      console.error("[Claude] Text analysis error:", error);
      res.status(500).json({ 
        error: "Failed to analyze text", 
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // =============================================================================
  // PDF ANALYSIS ENDPOINTS FOR EXPENSE TRACKING
  // =============================================================================

  // Zod validation schemas for PDF analysis responses
  const taxDataSchema = z.object({
    declarationNumber: z.string(),
    declarationDate: z.string(),
    currency: z.string(),
    customsTax: z.number(),
    additionalCustomsTax: z.number(),
    kkdf: z.number(),
    vat: z.number(),
    stampTax: z.number()
  });

  const importExpenseDataSchema = z.object({
    category: z.string(),
    amount: z.number(),
    currency: z.string(),
    invoiceNumber: z.string(),
    invoiceDate: z.string(),
    documentNumber: z.string(),
    policyNumber: z.string(),
    issuer: z.string(),
    notes: z.string()
  });

  const serviceInvoiceDataSchema = z.object({
    amount: z.number(),
    currency: z.string(),
    invoiceNumber: z.string(),
    date: z.string(),
    notes: z.string()
  });

  const customsDeclarationDataSchema = z.object({
    shipper: z.string(),
    package: z.number().optional().default(0),
    weight: z.number(),
    pieces: z.number(),
    awbNumber: z.string(),
    customs: z.string(),
    importDeclarationNumber: z.string(),
    importDeclarationDate: z.string(),
    usdTlRate: z.number()
  });

  /**
   * POST /api/expenses/analyze-pdf/tax
   * Analyze Turkish tax documents (auto-detects type)
   * Supports: Gümrük Beyannamesi (Customs Declaration) or Vergi Ödeme Dekontu (Tax Payment Receipt)
   * Extracts: declarationNumber, declarationDate, currency (optional), 5 tax amounts (required)
   * Accepts: PDF file upload (max 20MB)
   */
  app.post("/api/expenses/analyze-pdf/tax", requireClaudeAuth, pdfUpload.single('pdf'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "PDF file is required" });
      }

      // Validate file size (additional check)
      if (req.file.size > 20 * 1024 * 1024) {
        return res.status(400).json({ error: "PDF file exceeds 20MB limit" });
      }

      // Convert PDF buffer to base64
      const base64Pdf = req.file.buffer.toString('base64');

      const prompt = `Analyze this Turkish tax document (Gümrük Beyannamesi or Vergi Ödeme Dekontu).

CRITICAL: Extract tax amounts with EXACT Turkish term matching:

1. Gümrük Vergisi (Customs Tax):
   - Look for: 'Gümrük Vergisi' or 'G.Vergisi' or 'Gümrük V.'
   - Map to: customsTax

2. İlave Gümrük Vergisi (Additional Customs Tax):
   - Look for: 'İlave Gümrük Vergisi' or 'İlave G.V.' or 'İlave Gümrük'
   - This is SEPARATE from KDV!
   - Map to: additionalCustomsTax

3. KKDF (Resource Utilization Support Fund):
   - Look for: 'KKDF' (exact match)
   - Map to: kkdf

4. KDV (VAT - Value Added Tax):
   - Look for: 'KDV' or 'Katma Değer Vergisi'
   - This is DIFFERENT from İlave Gümrük Vergisi!
   - Map to: vat

5. Damga Vergisi (Stamp Tax):
   - Look for: 'Damga Vergisi' or 'D.Vergisi'
   - Map to: stampTax

IMPORTANT DISTINCTIONS:
- 'İlave Gümrük Vergisi' (Additional Customs) ≠ 'KDV' (VAT)
- These are TWO DIFFERENT taxes
- İlave Gümrük Vergisi is usually smaller than KDV
- KDV is typically the largest tax amount

EXAMPLE from real document:
Gümrük Vergisi: 5.000,00 → customsTax: 5000
İlave Gümrük Vergisi: 1.200,00 → additionalCustomsTax: 1200
KKDF: 800,00 → kkdf: 800
KDV: 9.500,00 → vat: 9500
Damga Vergisi: 150,00 → stampTax: 150

NUMBER FORMAT:
- Turkish format: '5.000,00' means 5000.00 (dot is thousands separator, comma is decimal)
- Convert to decimal number

VISUAL CLUES:
- Document usually has a table with tax names on left, amounts on right
- Tax names may be in BOLD
- Look in both table rows and summary sections

If a field is not found in the document, return 0.

Return ONLY valid JSON:
{
  "declarationNumber": "string or empty",
  "declarationDate": "YYYY-MM-DD or empty", 
  "currency": "TRY/USD/EUR or empty",
  "customsTax": 0,
  "additionalCustomsTax": 0,
  "kkdf": 0,
  "vat": 0,
  "stampTax": 0
}

⚠️ CRITICAL OUTPUT FORMAT:
Your response MUST be ONLY the JSON object, nothing else.
Do NOT include:
- Explanations before the JSON
- Comments about the document
- Step-by-step reasoning
- Any text outside the JSON object

ONLY output the raw JSON object starting with { and ending with }.`;

      const result = await claude.analyzePdfWithClaude({
        base64Data: base64Pdf,
        prompt,
        maxTokens: 2000
      });
      
      console.log("[Tax PDF] Claude raw response:", result);
      console.log("[Tax PDF] Response length:", result.length, "characters");
      
      // Parse JSON response (handle markdown code blocks and extract JSON object)
      let parsedData;
      try {
        // Remove markdown code blocks if present
        let cleanJson = result.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        
        // Extract JSON object from text (find last { ... })
        const jsonMatch = cleanJson.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          console.error("[Tax PDF] No JSON object found in response");
          throw new Error('No JSON object found in Claude response');
        }
        
        cleanJson = jsonMatch[0];
        console.log("[Tax PDF] Extracted JSON:", cleanJson);
        
        parsedData = JSON.parse(cleanJson);
        console.log("[Tax PDF] Parsed data:", JSON.stringify(parsedData, null, 2));
      } catch (parseError) {
        console.error("[Tax PDF] JSON parse error:", parseError);
        console.error("[Tax PDF] Failed to parse:", result.substring(0, 500));
        return res.status(500).json({ 
          error: "Failed to parse extracted data",
          details: "Claude returned invalid JSON format"
        });
      }

      // Validate parsed data with Zod
      const validation = taxDataSchema.safeParse(parsedData);
      if (!validation.success) {
        console.error("[Tax PDF] Validation error:", validation.error);
        return res.status(422).json({ 
          error: "Invalid data format from Claude",
          details: "Missing or invalid required fields",
          validationErrors: validation.error.issues
        });
      }

      res.json({ success: true, data: validation.data });
    } catch (error) {
      console.error("[Tax PDF] Analysis error:", error);
      res.status(500).json({ 
        error: "Failed to analyze tax document", 
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  /**
   * POST /api/expenses/analyze-pdf/import-expense
   * Analyze Turkish import expense invoice
   * Identifies expense category and extracts relevant data
   * Accepts: PDF file upload (max 20MB)
   */
  app.post("/api/expenses/analyze-pdf/import-expense", requireClaudeAuth, pdfUpload.single('pdf'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "PDF file is required" });
      }

      // Validate file size (additional check)
      if (req.file.size > 20 * 1024 * 1024) {
        return res.status(400).json({ error: "PDF file exceeds 20MB limit" });
      }

      // Convert PDF buffer to base64
      const base64Pdf = req.file.buffer.toString('base64');

      const prompt = `Analyze this Turkish import expense invoice and identify its category.

⚠️ IMPORTANT: Read the ENTIRE document first, then apply pattern matching.

🔍 STEP 1: CATEGORY DETECTION - EXACT PATTERN MATCHING

Check these patterns IN ORDER (top priority first):

1️⃣ export_registry_fee (İhracat Kayıt Belgesi):
   MUST HAVE: 'İTKİB' or 'İhracatçı Birlikleri' or 'TAHSİLAT MAKBUZU'
   Keywords: 'İthalat Hizmet Bedeli', 'Makbuz No'
   → If İTKİB found → ALWAYS export_registry_fee

2️⃣ awb_fee (Havayolu Faturası/Ordino):
   MUST HAVE: 'ORDİNO' or 'Ordino' or 'ordino'
   Keywords: 'AWB', 'Air Waybill', 'Havayolu'
   Companies: DHL, FedEx, Turkish Cargo, UPS, airline names
   → If 'ORDİNO' found → ALWAYS awb_fee
   → If airline company + AWB number → awb_fee

3️⃣ airport_storage_fee (Havaalanı Depolama):
   MUST HAVE: 'ARDIYE' or 'Ardiye' or 'ardiye'
   Keywords: 'Depolama', 'Storage', 'Antrepo', 'Havaalanı', 'Airport'
   Company: Airport cargo/logistics companies
   May contain: AWB number (but NO 'ORDİNO')
   → If 'ARDIYE' found (and NO 'ORDİNO') → ALWAYS airport_storage_fee

4️⃣ insurance (Sigorta):
   MUST HAVE: 'Sigorta' or 'Insurance' or 'Policy' or 'Poliçe'
   Company: Insurance company name
   Keywords: 'Poliçe No', 'Teminat', 'Coverage'
   → If insurance terms found → insurance

5️⃣ bonded_warehouse_storage_fee (Gümrüklü Antrepo):
   MUST HAVE: 'Gümrüklü Antrepo' or 'Bonded Warehouse'
   Keywords: 'Gümrük', 'Antrepo'
   → If 'Gümrüklü Antrepo' found → bonded_warehouse_storage_fee

6️⃣ transportation (Yurtiçi Nakliye):
   CRITICAL: Search ENTIRE document including:
   - Main text body
   - Invoice description field ('Açıklama:', 'Description:')
   - Notes field ('Not:', 'Notes:')
   - Service description
   - Any field containing text
   
   MUST HAVE (anywhere in document): 
   - 'nakliye' OR 'Nakliye' OR 'NAKLİYE' (case insensitive)
   - 'taşıma' OR 'Taşıma' OR 'TAŞIMA' 
   - 'transport' OR 'Transport' OR 'TRANSPORT'
   
   Additional Keywords:
   - 'Yurtiçi', 'İç Hat', 'Domestic'
   - 'Kara Taşımacılığı' (Land Transportation)
   - Company: Transportation/logistics company
   - Route: City to city within Turkey
   
   ⚠️ CRITICAL RULES:
   - If 'nakliye' found ANYWHERE (title, description, notes, ANY field) → transportation
   - If 'nakliye' + 'Uluslararası' → international_transportation
   - If 'nakliye' alone (no 'Uluslararası') → transportation
   - Check ALL text fields, not just document header
   - Search is case-insensitive for Turkish keywords

7️⃣ international_transportation (Uluslararası Nakliye):
   MUST HAVE: 'Uluslararası' or 'International'
   Keywords: 'Freight', 'Shipping'
   Route: Country to country
   → If international transport → international_transportation

8️⃣ tareks_fee (TAREKS Ücreti):
   MUST HAVE: 'TAREKS' (exact match)
   Keywords: 'Sistem', 'Kayıt'
   → If TAREKS found → tareks_fee

9️⃣ customs_inspection (Gümrük Muayene):
   MUST HAVE: 'Muayene' or 'Inspection' or 'Kontrol'
   Authority: Customs/Gümrük
   → If inspection terms → customs_inspection

🔟 azo_test (AZO Test):
   MUST HAVE: 'AZO' or 'Test' or 'Analiz' or 'Laboratuvar'
   Company: Laboratory/test company
   → If test/lab terms → azo_test

1️⃣1️⃣ other (Diğer):
   Use ONLY if no pattern matches

⚠️ CRITICAL DISAMBIGUATION:
- Document with 'ORDİNO' → awb_fee (even if has AWB number)
- Document with 'ARDIYE' + AWB number (NO 'ORDİNO') → airport_storage_fee
- AWB number alone is NOT enough to determine category!
- ORDİNO = Airway Bill Document = awb_fee
- ARDIYE = Storage Fee = airport_storage_fee

🔍 STEP 2: EXTRACT DATA BASED ON CATEGORY

FOR ALL CATEGORIES:
- amount: Find the FINAL payable amount with priority order:
  1. 'Ödenecek Tutar:' or 'Ödenecek' (Amount to be paid)
  2. 'TOPLAM' or 'Toplam' or 'Total' (Total)
  3. 'Genel Toplam' or 'Grand Total'
  4. 'Tutar:' or 'Amount:'
  Priority: Always prefer 'Ödenecek Tutar' over other amount fields
  Convert Turkish format: 1.234,56 → 1234.56
- currency: TRY/USD/EUR/GBP (default TRY if not found)
- invoiceDate: Find date in YYYY-MM-DD format
- issuer: Company/organization name
- notes: Description or service details

CATEGORY-SPECIFIC FIELDS:

If export_registry_fee:
- documentNumber: Value after 'Makbuz No:'
- invoiceNumber: Leave empty
- Look for: 'Tarih:', 'Makbuz No:', 'İTKİB'

If awb_fee:
- invoiceNumber: Look for ANY field ending with 'No:' or 'No' 
  * Priority: 'Fatura No:', 'Invoice No:', 'Payment No:', 'ORDİNO No:', 'Belge No:'
  * Extract the number after these labels
- documentNumber: AWB number (from 'AWB No:' or 'AWB:')
- issuer: Airline/cargo company name
- Search patterns: 'ORDİNO', 'Fatura No:', 'Payment No:', 'Belge No:', 'Invoice No:'

If airport_storage_fee:
- invoiceNumber: Look for ANY field ending with 'No:' or 'No'
  * Priority: 'Fatura No:', 'Invoice No:', 'Payment No:', 'Makbuz No:', 'Belge No:'
  * Extract the number after these labels
- documentNumber: AWB number if mentioned (from 'AWB No:' or 'AWB:')
- Search patterns: 'ARDIYE', 'Fatura No:', 'Payment No:', 'Makbuz No:', 'Invoice No:'

If insurance:
- policyNumber: Value after 'Poliçe No:' or 'Policy No:'
- invoiceNumber: Invoice number if exists
- Look for: 'Poliçe No:', 'Sigorta Şirketi'

For other categories:
- Fill invoiceNumber and documentNumber as found
- policyNumber: Leave empty unless insurance

⚠️ SEARCH METHODOLOGY:
1. Read ENTIRE document text from top to bottom
2. Check ALL fields: titles, descriptions, notes, amounts, dates
3. Look for keywords in:
   - Document header/title
   - Invoice description ('Açıklama')
   - Service description
   - Notes field ('Not')
   - Any text content
4. For 'nakliye' keyword: Search the COMPLETE document text
5. Case-insensitive search (nakliye = Nakliye = NAKLİYE)

⚠️ INVOICE NUMBER EXTRACTION RULES:
1. Scan document for fields ending with 'No:' or 'No'
2. Common patterns in Turkish documents:
   - 'Fatura No:' (Invoice Number)
   - 'Payment No:' (Payment Number)
   - 'Makbuz No:' (Receipt Number)
   - 'Belge No:' (Document Number)
   - 'ORDİNO No:' (for AWB documents)
   - 'Fiş No:' (Slip Number)
3. For AWB fee: Prefer 'Fatura No:' or 'Payment No:' over 'AWB No:'
4. For Airport Storage: Prefer 'Fatura No:' or 'Payment No:' 
5. AWB No should go to documentNumber (not invoiceNumber)

📋 REAL EXAMPLES:

EXAMPLE 1 - Export Registry Fee:
Document shows:
TAHSİLAT MAKBUZU
İTKİB
Makbuz No: 607192
Tarih: 18/11/2025
TUTAR: 750,00

Output:
{
  "category": "export_registry_fee",
  "amount": 750,
  "currency": "TRY",
  "invoiceNumber": "",
  "invoiceDate": "2025-11-18",
  "documentNumber": "607192",
  "policyNumber": "",
  "issuer": "İTKİB",
  "notes": "İthalat Hizmet Bedeli"
}

EXAMPLE 2 - AWB Fee (ORDİNO):
Document shows:
ORDİNO
Turkish Cargo
AWB No: 235-12345678
Payment No: PAY-2024-5678
Tutar: 5.200,00 USD
Tarih: 20/11/2025

Output:
{
  "category": "awb_fee",
  "amount": 5200,
  "currency": "USD",
  "invoiceNumber": "PAY-2024-5678",
  "invoiceDate": "2025-11-20",
  "documentNumber": "235-12345678",
  "policyNumber": "",
  "issuer": "Turkish Cargo",
  "notes": "ORDİNO - Havayolu Taşıma Belgesi"
}

EXAMPLE 3 - Airport Storage Fee (ARDIYE):
Document shows:
FATURA
Açıklama: ARDIYE
AWB: 235-12345678
Fatura No: FTR-2024-1234
Tutar: 2.500,00 TL
Tarih: 20/11/2025

Output:
{
  "category": "airport_storage_fee",
  "amount": 2500,
  "currency": "TRY",
  "invoiceNumber": "FTR-2024-1234",
  "invoiceDate": "2025-11-20",
  "documentNumber": "235-12345678",
  "policyNumber": "",
  "issuer": "",
  "notes": "ARDIYE - Havaalanı Depolama"
}

EXAMPLE 4 - Transportation (Nakliye):
Document shows:
NAKLİYE FATURASI
İstanbul - Ankara
Ara Toplam: 3.000,00 TL
KDV (%20): 600,00 TL
Genel Toplam: 3.600,00 TL
Ödenecek Tutar: 3.600,00 TL
Fatura No: NK-2024-789
Tarih: 22/11/2025

Output:
{
  "category": "transportation",
  "amount": 3600,
  "currency": "TRY",
  "invoiceNumber": "NK-2024-789",
  "invoiceDate": "2025-11-22",
  "documentNumber": "",
  "policyNumber": "",
  "issuer": "",
  "notes": "Nakliye - İstanbul-Ankara"
}

EXAMPLE 5 - Transportation (Nakliye in Description):
Document shows:
FATURA
Fatura No: THY-TUPIA-12345
Tarih: 22/11/2025
Açıklama: nakliye bedeli - Airport cargo terminal service
Tutar: 13.500,00 TL
Ödenecek Tutar: 13.500,00 TL

Output:
{
  "category": "transportation",
  "amount": 13500,
  "currency": "TRY",
  "invoiceNumber": "THY-TUPIA-12345",
  "invoiceDate": "2025-11-22",
  "documentNumber": "",
  "policyNumber": "",
  "issuer": "",
  "notes": "nakliye bedeli - Airport cargo terminal service"
}

⚠️ KEY POINT: Even though 'nakliye' is in the description field (not the main title), 
it is STILL detected as transportation category! Search the ENTIRE document text.

⚠️ AMOUNT EXTRACTION PRIORITY:
1. Look for 'Ödenecek Tutar:' FIRST (this is the payable amount)
2. If not found, look for 'TOPLAM' or 'Toplam'
3. If not found, look for 'Tutar:' or 'Amount:'
4. The document may have multiple amounts (subtotal, VAT, total, payable)
5. Always extract the FINAL payable amount (Ödenecek Tutar)

⚠️ TRANSPORTATION DETECTION:
1. 'Nakliye' or 'NAKLİYE' (any case) → Check if domestic or international
2. If NO 'Uluslararası' keyword → transportation
3. If has 'Uluslararası' → international_transportation
4. Transportation is HIGH PRIORITY - check before 'other' category

⚠️ CRITICAL RULES:
1. Check ENTIRE document text before deciding category
2. Priority order matters:
   - İTKİB → export_registry_fee
   - ORDİNO → awb_fee
   - ARDIYE (no ORDİNO) → airport_storage_fee
   - Nakliye (no Uluslararası) → transportation
3. AWB number can exist in BOTH awb_fee and airport_storage_fee
4. ORDİNO keyword is THE deciding factor for awb_fee
5. ARDIYE keyword is THE deciding factor for airport_storage_fee
6. Convert Turkish numbers: '1.234,56' → 1234.56
7. Empty strings for missing fields, 0 for missing amount
8. Return ONLY JSON, no explanation

OUTPUT FORMAT:
{
  "category": "string",
  "amount": 0,
  "currency": "TRY",
  "invoiceNumber": "",
  "invoiceDate": "YYYY-MM-DD",
  "documentNumber": "",
  "policyNumber": "",
  "issuer": "",
  "notes": ""
}`;

      const result = await claude.analyzePdfWithClaude({
        base64Data: base64Pdf,
        prompt,
        maxTokens: 2000
      });
      
      console.log("[Import Expense PDF] Claude raw response:", result);
      
      // Parse JSON response (handle markdown code blocks and extract JSON object)
      let parsedData;
      try {
        // Remove markdown code blocks if present
        let cleanJson = result.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        
        // Extract JSON object from text (find last { ... })
        const jsonMatch = cleanJson.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          console.error("[Import Expense PDF] No JSON object found in response");
          throw new Error('No JSON object found in Claude response');
        }
        
        cleanJson = jsonMatch[0];
        console.log("[Import Expense PDF] Extracted JSON:", cleanJson);
        
        parsedData = JSON.parse(cleanJson);
        console.log("[Import Expense PDF] Parsed data:", JSON.stringify(parsedData, null, 2));
      } catch (parseError) {
        console.error("[Import Expense PDF] JSON parse error:", parseError);
        return res.status(500).json({ 
          error: "Failed to parse extracted data",
          details: "Claude returned invalid JSON format"
        });
      }

      // Validate parsed data with Zod
      const validation = importExpenseDataSchema.safeParse(parsedData);
      if (!validation.success) {
        console.error("[Import Expense PDF] Validation error:", validation.error);
        return res.status(422).json({ 
          error: "Invalid data format from Claude",
          details: "Missing or invalid required fields",
          validationErrors: validation.error.issues
        });
      }

      // Upload PDF to storage for later attachment to expense
      let pdfObjectKey: string | null = null;
      try {
        const originalFilename = req.file.originalname || 'analyzed-expense.pdf';
        // Use temp folder since we don't have procedure reference yet
        pdfObjectKey = await uploadFile(
          req.file.buffer,
          originalFilename,
          'application/pdf',
          'temp-analyzed-pdfs'
        );
        console.log("[Import Expense PDF] Uploaded PDF to storage:", pdfObjectKey);
      } catch (uploadError: any) {
        // Check if this is a storage not configured error
        const errorMsg = uploadError?.message || String(uploadError);
        if (errorMsg.includes('Error code undefined') || errorMsg.includes('Failed to upload')) {
          console.log("[Import Expense PDF] Object Storage not configured - skipping auto-attach. " +
            "To enable auto-attach, please set up App Storage in the Tools panel.");
        } else {
          console.error("[Import Expense PDF] Failed to upload PDF:", uploadError);
        }
        // Continue even if upload fails - user can still add expense manually
      }

      res.json({ 
        success: true, 
        data: validation.data,
        pdfFile: pdfObjectKey ? {
          objectKey: pdfObjectKey,
          originalFilename: req.file.originalname || 'analyzed-expense.pdf',
          fileSize: req.file.size,
          fileType: 'application/pdf'
        } : null,
        storageConfigured: pdfObjectKey !== null
      });
    } catch (error) {
      console.error("[Import Expense PDF] Analysis error:", error);
      res.status(500).json({ 
        error: "Failed to analyze import expense document", 
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  /**
   * POST /api/expenses/analyze-pdf/service-invoice
   * Analyze Turkish customs broker service invoice (Gümrük Komisyoncusu Faturası)
   * Extracts: amount, currency, invoiceNumber, date, notes
   * Accepts: PDF file upload (max 20MB)
   */
  app.post("/api/expenses/analyze-pdf/service-invoice", requireClaudeAuth, pdfUpload.single('pdf'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "PDF file is required" });
      }

      // Validate file size (additional check)
      if (req.file.size > 20 * 1024 * 1024) {
        return res.status(400).json({ error: "PDF file exceeds 20MB limit" });
      }

      // Convert PDF buffer to base64
      const base64Pdf = req.file.buffer.toString('base64');

      const prompt = `Analyze this Turkish customs broker invoice (Gümrük Komisyoncusu Faturası).

Extract the following information:
- amount: Total invoice amount (numeric only, no currency symbols)
- currency: Currency code (TRY, USD, EUR, etc.)
- invoiceNumber: Invoice number
- date: Invoice date in YYYY-MM-DD format
- notes: Any relevant notes, services provided, or additional information

Return ONLY valid JSON in this exact format:
{
  "amount": 0,
  "currency": "TRY",
  "invoiceNumber": "",
  "date": "",
  "notes": ""
}

Leave fields as empty strings "" or 0 if not found.

⚠️ CRITICAL OUTPUT FORMAT:
Your response MUST be ONLY the JSON object, nothing else.
Do NOT include:
- Explanations before the JSON
- Comments about the document
- Step-by-step reasoning
- Any text outside the JSON object

ONLY output the raw JSON object starting with { and ending with }.`;

      const result = await claude.analyzePdfWithClaude({
        base64Data: base64Pdf,
        prompt,
        maxTokens: 2000
      });
      
      console.log("[Service Invoice PDF] Claude raw response:", result);
      
      // Parse JSON response (handle markdown code blocks and extract JSON object)
      let parsedData;
      try {
        // Remove markdown code blocks if present
        let cleanJson = result.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        
        // Extract JSON object from text (find last { ... })
        const jsonMatch = cleanJson.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          console.error("[Service Invoice PDF] No JSON object found in response");
          throw new Error('No JSON object found in Claude response');
        }
        
        cleanJson = jsonMatch[0];
        console.log("[Service Invoice PDF] Extracted JSON:", cleanJson);
        
        parsedData = JSON.parse(cleanJson);
        console.log("[Service Invoice PDF] Parsed data:", JSON.stringify(parsedData, null, 2));
      } catch (parseError) {
        console.error("[Service Invoice PDF] JSON parse error:", parseError);
        return res.status(500).json({ 
          error: "Failed to parse extracted data",
          details: "Claude returned invalid JSON format"
        });
      }

      // Validate parsed data with Zod
      const validation = serviceInvoiceDataSchema.safeParse(parsedData);
      if (!validation.success) {
        console.error("[Service Invoice PDF] Validation error:", validation.error);
        return res.status(422).json({ 
          error: "Invalid data format from Claude",
          details: "Missing or invalid required fields",
          validationErrors: validation.error.issues
        });
      }

      // Upload PDF to storage for later attachment to service invoice
      let pdfObjectKey: string | null = null;
      try {
        const originalFilename = req.file.originalname || 'analyzed-service-invoice.pdf';
        // Use temp folder since we don't have procedure reference yet
        pdfObjectKey = await uploadFile(
          req.file.buffer,
          originalFilename,
          'application/pdf',
          'temp-analyzed-pdfs'
        );
        console.log("[Service Invoice PDF] Uploaded PDF to storage:", pdfObjectKey);
      } catch (uploadError: any) {
        // Check if this is a storage not configured error
        const errorMsg = uploadError?.message || String(uploadError);
        if (errorMsg.includes('Error code undefined') || errorMsg.includes('Failed to upload')) {
          console.log("[Service Invoice PDF] Object Storage not configured - skipping auto-attach. " +
            "To enable auto-attach, please set up App Storage in the Tools panel.");
        } else {
          console.error("[Service Invoice PDF] Failed to upload PDF:", uploadError);
        }
        // Continue even if upload fails - user can still add invoice manually
      }

      res.json({ 
        success: true, 
        data: validation.data,
        pdfFile: pdfObjectKey ? {
          objectKey: pdfObjectKey,
          originalFilename: req.file.originalname || 'analyzed-service-invoice.pdf',
          fileSize: req.file.size,
          fileType: 'application/pdf'
        } : null,
        storageConfigured: pdfObjectKey !== null
      });
    } catch (error) {
      console.error("[Service Invoice PDF] Analysis error:", error);
      res.status(500).json({ 
        error: "Failed to analyze service invoice document", 
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  /**
   * POST /api/expenses/analyze-pdf/expense-receipt
   * Analyze Expense Receipt PDF OR Service Invoice
   * Intelligently detects document type based on page count:
   * - 1-2 pages: Service Invoice (extract only total amount)
   * - 5+ pages: Expense Receipt (extract taxes, expenses, and match invoices)
   * Accepts: PDF file upload (max 20MB)
   */
  app.post("/api/expenses/analyze-pdf/expense-receipt", requireClaudeAuth, pdfUpload.single('pdf'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "PDF file is required" });
      }

      if (req.file.size > 20 * 1024 * 1024) {
        return res.status(400).json({ error: "PDF file exceeds 20MB limit" });
      }

      const base64Pdf = req.file.buffer.toString('base64');

      // Combined prompt that detects document type and extracts data in one call
      const prompt = `Count the pages in this PDF.

DOCUMENT TYPE RULES:
- 1-2 pages: SERVICE INVOICE → extract total amount only
- 3+ pages: EXPENSE RECEIPT → the FIRST PAGE lists ALL expenses, following pages contain invoices/receipts

=== SERVICE INVOICE (1-2 pages) ===
{
  "documentType": "service_invoice",
  "pageCount": <number>,
  "items": [{
    "description": "Service Invoice",
    "amount": <TOTAL>,
    "currency": "TRY",
    "suggestedCategory": "service_invoice",
    "type": "service_invoice",
    "invoiceNumber": "<from Fatura No field>",
    "invoiceDate": "<YYYY-MM-DD>",
    "receiptNumber": "",
    "issuer": "<company name>",
    "pageNumber": 1
  }],
  "taxes": {},
  "totalTaxFromExpenseReceipt": 0,
  "documentInfo": {}
}

=== EXPENSE RECEIPT (3+ pages) ===

**THE FIRST PAGE IS THE EXPENSE RECEIPT (Masraf Makbuzu)**
It contains a TABLE listing ALL expenses for this shipment. Each row typically has:
- Expense description (Açıklama): Nakliye, Ordino, Sigorta, Ardiye, Vergiler, etc.
- Amount (Tutar): The cost in TRY
- Document Number (Belge No / Makbuz No / Evrak No): The receipt/document number for this expense

**STEP 1: READ THE FIRST PAGE - EXTRACT EXPENSES WITH DOCUMENT NUMBERS**
Extract every SERVICE EXPENSE from page 1 (Nakliye, Ordino, Sigorta, Ardiye, TAREKS, etc.)
SKIP "Vergiler" or "Toplam Vergi" - this is just a total, NOT an individual item!
Record totalTaxFromExpenseReceipt = the "Vergiler" amount (for reference only)

**CRITICAL - EXTRACT DOCUMENT NUMBER FROM PAGE 1 TABLE:**
- Look for a column labeled "Belge No", "Makbuz No", "Evrak No", or "Document No" in the expense table on page 1
- Each expense row should have its own document number in this column
- Store this value in the "receiptNumber" field for each item
- This is DIFFERENT from invoiceNumber which comes from the individual invoice pages later

**STEP 2: FIND THE TAX RECEIPT PAGE - EXTRACT INDIVIDUAL TAXES**
CRITICAL: Search ALL pages to find the TAX RECEIPT (Vergi Makbuzu, Tahsilat Makbuzu, Gümrük Vergisi Tahakkuku).
The tax receipt shows a BREAKDOWN of each tax type with individual amounts:
- Gümrük Vergisi (Customs Tax) → suggestedCategory: "customs_tax"
- İlave Gümrük Vergisi (Additional Customs Tax) → suggestedCategory: "additional_customs_tax"
- KKDF → suggestedCategory: "kkdf"
- KDV / Katma Değer Vergisi (VAT) → suggestedCategory: "vat"
- Damga Vergisi (Stamp Tax) → suggestedCategory: "stamp_tax"

ADD EACH TAX AS A SEPARATE ITEM with type="tax". DO NOT add a "total tax" item!
IMPORTANT: Record the "pageNumber" (1-indexed) where each tax item was found!

**STEP 3: SCAN ALL OTHER PAGES FOR INVOICES/RECEIPTS**
For EACH expense from Step 1, search pages 2+ to find the matching invoice.
Match by: AMOUNT (Toplam/Genel Toplam) or by service description
CRITICAL: Record the "pageNumber" (1-indexed) where each matching invoice was found!

**HOW TO FIND INVOICE NUMBER (Fatura No) - MANDATORY FOR EACH EXPENSE:**
- Location: TOP-RIGHT area of invoice, document header, or anywhere on page
- SEARCH FOR THESE LABELS (look for ANY of these):
  * "Fatura No", "Fatura No:", "e-Fatura No:", "ETTN:", "Belge No:"
  * "Payment Advice No", "Makbuz No", "Makbuz No:"
  * "Invoice No", "Invoice Number", "Receipt No", "Document No"
- ACCEPT ANY FORMAT: numbers, letters, alphanumeric strings of any length
- Examples: "ABC2025000000001", "12345", "FA-2025-001", "MAKBUZ-123"
- RULE: If you find ANY labeled document/invoice number, ALWAYS extract it exactly as shown (trim whitespace only)
- DO NOT leave empty if a label with a value is visible on the page!

**HOW TO FIND INVOICE DATE (Fatura Tarihi) - MANDATORY FOR EACH EXPENSE:**
- Location: Near invoice number, document header, or anywhere on invoice page
- SEARCH FOR THESE LABELS (look for ANY of these):
  * "Fatura Tarihi", "Tarih", "Düzenleme Tarihi"
  * "Date", "Invoice Date", "Payment Date", "Issue Date"
- ACCEPT ANY DATE FORMAT you find:
  * DD.MM.YYYY (e.g., 04.12.2025)
  * DD/MM/YYYY (e.g., 04/12/2025)
  * DD-MM-YYYY (e.g., 04-12-2025)
  * YYYY-MM-DD (e.g., 2025-12-04)
  * DD.MM.YY (e.g., 04.12.25)
  * Text months (e.g., "4 Aralık 2025", "December 4, 2025")
- RULE: If you find ANY labeled date, ALWAYS extract it in DD.MM.YYYY format
- DO NOT leave empty if a date is visible on the invoice page!

**HOW TO FIND ISSUER:**
- Location: TOP of invoice in seller (Satıcı) section

EXPENSE CATEGORIES (type="expense"):
- export_registry_fee (İTKİB, İhracat Kayıt)
- insurance (Sigorta, Poliçe)
- awb_fee (Ordino, AWB, Hava Yolu)
- airport_storage_fee (Havalimanı Ardiye)
- bonded_warehouse_storage_fee (Antrepo Ardiye)
- transportation (Nakliye, Taşıma)
- international_transportation (Uluslararası Nakliye)
- tareks_fee (TAREKS, TSE)
- customs_inspection (Gümrük Muayene)
- azo_test (AZO Testi)
- other

TAX CATEGORIES (type="tax") - EACH MUST BE SEPARATE:
- customs_tax (Gümrük Vergisi)
- additional_customs_tax (İlave Gümrük Vergisi)
- kkdf (KKDF)
- vat (KDV)
- stamp_tax (Damga Vergisi)

OUTPUT FORMAT:
{
  "documentType": "expense_receipt",
  "pageCount": <number>,
  "items": [
    {
      "description": "Nakliye",
      "amount": 2500.00,
      "currency": "TRY",
      "suggestedCategory": "transportation",
      "type": "expense",
      "invoiceNumber": "ABC2025000000123",
      "invoiceDate": "04.12.2025",
      "receiptNumber": "",
      "issuer": "ABC Nakliyat Ltd.",
      "pageNumber": 3
    },
    {
      "description": "Gümrük Vergisi",
      "amount": 15000.00,
      "currency": "TRY",
      "suggestedCategory": "customs_tax",
      "type": "tax",
      "invoiceNumber": "",
      "invoiceDate": "",
      "receiptNumber": "",
      "issuer": "",
      "pageNumber": 2
    },
    {
      "description": "İlave Gümrük Vergisi",
      "amount": 500.00,
      "currency": "TRY",
      "suggestedCategory": "additional_customs_tax",
      "type": "tax",
      "invoiceNumber": "",
      "invoiceDate": "",
      "receiptNumber": "",
      "issuer": "",
      "pageNumber": 2
    },
    {
      "description": "KKDF",
      "amount": 1200.00,
      "currency": "TRY",
      "suggestedCategory": "kkdf",
      "type": "tax",
      "invoiceNumber": "",
      "invoiceDate": "",
      "receiptNumber": "",
      "issuer": "",
      "pageNumber": 2
    },
    {
      "description": "KDV",
      "amount": 8000.00,
      "currency": "TRY",
      "suggestedCategory": "vat",
      "type": "tax",
      "invoiceNumber": "",
      "invoiceDate": "",
      "receiptNumber": "",
      "issuer": "",
      "pageNumber": 2
    },
    {
      "description": "Damga Vergisi",
      "amount": 100.00,
      "currency": "TRY",
      "suggestedCategory": "stamp_tax",
      "type": "tax",
      "invoiceNumber": "",
      "invoiceDate": "",
      "receiptNumber": "",
      "issuer": "",
      "pageNumber": 2
    }
  ],
  "taxes": {
    "customsTax": 15000.00,
    "additionalCustomsTax": 500.00,
    "kkdf": 1200.00,
    "vat": 8000.00,
    "stampTax": 100.00
  },
  "totalTaxFromExpenseReceipt": 24800.00,
  "documentInfo": {}
}

CRITICAL RULES:
1. NEVER add "Vergiler" or "Toplam Vergi" as an item - it's just a total!
2. Find the TAX RECEIPT page and extract EACH tax type separately
3. Each tax (customs_tax, additional_customs_tax, kkdf, vat, stamp_tax) must be a SEPARATE item
4. For expenses, find: invoiceNumber, invoiceDate, issuer from matching invoice pages
5. Taxes go in both "items" array AND "taxes" object with individual amounts
6. ALWAYS include "pageNumber" for each item - the page (1-indexed) where each matching invoice was found
7. Return ONLY valid JSON
8. MANDATORY - Two types of document numbers:
   a) receiptNumber: Extract from PAGE 1's expense table - look for "Belge No", "Makbuz No", "Evrak No" column
   b) invoiceNumber: Extract from INDIVIDUAL INVOICE PAGES - look for "Fatura No", "Payment Advice No", etc.
   - NEVER confuse these - receiptNumber is from page 1 table, invoiceNumber is from invoice pages!
9. MANDATORY - Invoice dates:
   - invoiceDate: Look for "Fatura Tarihi", "Tarih", "Date", etc. on invoice pages
   - Extract in DD.MM.YYYY format
   - NEVER leave empty if a date is visible on the invoice page!`;

      const result = await claude.analyzePdfWithClaude({
        base64Data: base64Pdf,
        prompt,
        maxTokens: 8000,
        temperature: 0  // More deterministic for precise data extraction
      });

      console.log("[PDF Analysis] Claude raw response:", result);

      let parsedData;
      try {
        let cleanJson = result.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const jsonMatch = cleanJson.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          console.error("[PDF Analysis] No JSON object found in response");
          throw new Error('No JSON object found in Claude response');
        }
        cleanJson = jsonMatch[0];
        console.log("[PDF Analysis] Extracted JSON:", cleanJson);
        parsedData = JSON.parse(cleanJson);
        console.log("[PDF Analysis] Parsed data:", JSON.stringify(parsedData, null, 2));
      } catch (parseError) {
        console.error("[PDF Analysis] JSON parse error:", parseError);
        return res.status(500).json({
          error: "Failed to parse extracted data",
          details: "Claude returned invalid JSON format"
        });
      }

      // Upload PDF to storage BEFORE checking document type so all document types have access to pdfFile
      let pdfObjectKey: string | null = null;
      try {
        const { uploadFile } = await import('./object-storage');
        const sanitizedName = req.file.originalname?.replace(/[^a-zA-Z0-9.-]/g, '_') || 'expense-receipt.pdf';
        pdfObjectKey = await uploadFile(req.file.buffer, sanitizedName, 'application/pdf', 'expense-receipts');
        console.log(`[Expense Receipt PDF] Uploaded to storage: ${pdfObjectKey}`);
      } catch (uploadError: any) {
        console.error("[Expense Receipt PDF] Failed to upload PDF to storage:", uploadError);
        pdfObjectKey = null;
      }

      // Check if this is a service invoice based on documentType or pageCount
      const documentType = parsedData.documentType || 'expense_receipt';
      const pageCount = parsedData.pageCount || 5;
      console.log(`[PDF Analysis] Document type: ${documentType}, Pages: ${pageCount}`);

      if (documentType === 'service_invoice' || pageCount <= 2) {
        // Handle as service invoice
        const rawItems = parsedData.items || [];
        parsedData.items = rawItems.map((item: any, index: number) => ({
          id: `temp-${index}`,
          description: item.description || 'Service Invoice',
          amount: typeof item.amount === 'number' ? item.amount : parseFloat(item.amount) || 0,
          currency: item.currency || 'TRY',
          suggestedCategory: 'service_invoice',
          type: 'service_invoice',
          invoiceNumber: item.invoiceNumber || '',
          invoiceDate: item.invoiceDate || '',
          receiptNumber: item.receiptNumber || '',
          issuer: item.issuer || '',
          pageNumber: item.pageNumber || 1
        }));

        parsedData.taxes = {};
        parsedData.expenses = [];

        return res.json({
          success: true,
          data: parsedData,
          documentType: 'service_invoice',
          pdfFile: pdfObjectKey ? {
            objectKey: pdfObjectKey,
            originalFilename: req.file.originalname || 'service-invoice.pdf',
            fileSize: req.file.size,
            fileType: 'application/pdf',
            pageCount: pageCount
          } : null
        });
      }

      // Validate the structure - handle both old (expenses) and new (items) format
      const rawItems = parsedData.items || parsedData.expenses || [];
      if (!Array.isArray(rawItems)) {
        parsedData.items = [];
      }

      // Valid categories including taxes
      const taxCategories = ['customs_tax', 'additional_customs_tax', 'kkdf', 'vat', 'stamp_tax'];
      const expenseCategories = [
        'export_registry_fee', 'insurance', 'awb_fee', 'airport_storage_fee',
        'bonded_warehouse_storage_fee', 'transportation', 'international_transportation',
        'tareks_fee', 'customs_inspection', 'azo_test', 'other'
      ];
      const allCategories = [...taxCategories, ...expenseCategories];

      // Normalize each item
      parsedData.items = rawItems.map((item: any, index: number) => {
        const category = allCategories.includes(item.suggestedCategory) ? item.suggestedCategory : 'other';
        const isTax = taxCategories.includes(category);
        
        return {
          id: `temp-${index}`,
          description: item.description || '',
          amount: typeof item.amount === 'number' ? item.amount : parseFloat(item.amount) || 0,
          currency: item.currency || 'TRY',
          suggestedCategory: category,
          type: isTax ? 'tax' : 'expense',
          invoiceNumber: item.invoiceNumber || '',
          invoiceDate: item.invoiceDate || '',
          receiptNumber: item.receiptNumber || '',
          issuer: item.issuer || '',
          pageNumber: item.pageNumber || null
        };
      });

      // Ensure taxes summary exists
      if (!parsedData.taxes) {
        parsedData.taxes = {
          customsTax: 0,
          additionalCustomsTax: 0,
          kkdf: 0,
          vat: 0,
          stampTax: 0
        };
      }

      // Calculate taxes from items if not provided in summary
      const taxItems = parsedData.items.filter((item: any) => item.type === 'tax');
      taxItems.forEach((item: any) => {
        switch (item.suggestedCategory) {
          case 'customs_tax':
            parsedData.taxes.customsTax = (parsedData.taxes.customsTax || 0) + item.amount;
            break;
          case 'additional_customs_tax':
            parsedData.taxes.additionalCustomsTax = (parsedData.taxes.additionalCustomsTax || 0) + item.amount;
            break;
          case 'kkdf':
            parsedData.taxes.kkdf = (parsedData.taxes.kkdf || 0) + item.amount;
            break;
          case 'vat':
            parsedData.taxes.vat = (parsedData.taxes.vat || 0) + item.amount;
            break;
          case 'stamp_tax':
            parsedData.taxes.stampTax = (parsedData.taxes.stampTax || 0) + item.amount;
            break;
        }
      });

      // For backward compatibility, also include expenses array
      parsedData.expenses = parsedData.items.filter((item: any) => item.type === 'expense');

      // PDF was already uploaded at the start of this endpoint (before document type check)
      res.json({
        success: true,
        data: parsedData,
        pdfFile: pdfObjectKey ? {
          objectKey: pdfObjectKey,
          originalFilename: req.file.originalname || 'expense-receipt.pdf',
          fileSize: req.file.size,
          fileType: 'application/pdf',
          pageCount: parsedData.pageCount || 1
        } : null
      });
    } catch (error) {
      console.error("[Expense Receipt PDF] Analysis error:", error);
      res.status(500).json({
        error: "Failed to analyze expense receipt document",
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  /**
   * POST /api/expenses/analyze-pdf/single-page
   * Analyze a single page from a stored PDF to extract missing expenses
   * Used when the initial analysis missed an expense
   */
  app.post("/api/expenses/analyze-pdf/single-page", requireClaudeAuth, async (req, res) => {
    try {
      const { objectKey, pageNumber } = req.body;

      if (!objectKey) {
        return res.status(400).json({ error: "Object key is required" });
      }
      if (!pageNumber || pageNumber < 1) {
        return res.status(400).json({ error: "Valid page number is required (1-indexed)" });
      }

      console.log(`[Single Page Analysis] Analyzing page ${pageNumber} from ${objectKey}`);

      // Download the source PDF from object storage
      const { getFile } = await import('./object-storage');
      
      let pdfBuffer: Buffer;
      try {
        const fileResult = await getFile(objectKey);
        pdfBuffer = fileResult.buffer;
        console.log(`[Single Page Analysis] Downloaded PDF, buffer length: ${pdfBuffer.length}`);
      } catch (downloadError: any) {
        console.error(`[Single Page Analysis] Failed to download PDF:`, downloadError.message);
        return res.status(404).json({ error: "PDF not found in storage" });
      }

      // Use pdf-lib to extract the specific page
      const { PDFDocument } = await import('pdf-lib');
      const sourcePdf = await PDFDocument.load(pdfBuffer);
      const totalPages = sourcePdf.getPageCount();

      if (pageNumber > totalPages) {
        return res.status(400).json({ 
          error: `Page ${pageNumber} does not exist. PDF has ${totalPages} pages.` 
        });
      }

      // Create a new PDF with just the requested page
      const newPdf = await PDFDocument.create();
      const [copiedPage] = await newPdf.copyPages(sourcePdf, [pageNumber - 1]); // 0-indexed
      newPdf.addPage(copiedPage);

      const extractedPdfBytes = await newPdf.save();
      const base64Pdf = Buffer.from(extractedPdfBytes).toString('base64');

      // Create prompt for single page analysis
      const prompt = `Analyze this single invoice/receipt page and extract expense information.

This is page ${pageNumber} from an expense receipt document. Extract the expense or invoice shown on this page.

**EXTRACT THE FOLLOWING:**
1. description: What type of expense is this? (Nakliye, Ordino, Sigorta, Ardiye, etc.)
2. amount: The total amount (look for Toplam, Genel Toplam, Total)
3. currency: TRY or USD
4. invoiceNumber: Look for "Fatura No", "Payment Advice No", "Makbuz No", "Invoice No"
5. invoiceDate: Look for "Fatura Tarihi", "Tarih", "Date" - extract in DD.MM.YYYY format
6. issuer: Company name from the top of the invoice
7. suggestedCategory: One of these categories:
   - transportation (Nakliye, Taşıma)
   - awb_fee (Ordino, AWB)
   - airport_storage_fee (Havalimanı Ardiye)
   - bonded_warehouse_storage_fee (Antrepo Ardiye)
   - insurance (Sigorta, Poliçe)
   - tareks_fee (TAREKS, TSE)
   - customs_inspection (Gümrük Muayene)
   - customs_tax (Gümrük Vergisi)
   - vat (KDV)
   - stamp_tax (Damga Vergisi)
   - other

**OUTPUT FORMAT:**
{
  "items": [
    {
      "description": "<description>",
      "amount": <number>,
      "currency": "TRY",
      "suggestedCategory": "<category>",
      "type": "expense",
      "invoiceNumber": "<invoice_no>",
      "invoiceDate": "<DD.MM.YYYY>",
      "receiptNumber": "",
      "issuer": "<company_name>"
    }
  ]
}

Return ONLY valid JSON.`;

      const result = await claude.analyzePdfWithClaude({
        base64Data: base64Pdf,
        prompt,
        maxTokens: 2000,
        temperature: 0
      });

      console.log("[Single Page Analysis] Claude response:", result);

      let parsedData;
      try {
        let cleanJson = result.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const jsonMatch = cleanJson.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          throw new Error('No JSON object found in Claude response');
        }
        cleanJson = jsonMatch[0];
        parsedData = JSON.parse(cleanJson);
      } catch (parseError) {
        console.error("[Single Page Analysis] JSON parse error:", parseError);
        return res.status(500).json({
          error: "Failed to parse extracted data",
          details: "Claude returned invalid JSON format"
        });
      }

      // Normalize items
      const taxCategories = ['customs_tax', 'additional_customs_tax', 'kkdf', 'vat', 'stamp_tax'];
      const items = (parsedData.items || []).map((item: any, index: number) => {
        const isTax = taxCategories.includes(item.suggestedCategory);
        return {
          id: `single-page-${pageNumber}-${index}`,
          description: item.description || '',
          amount: typeof item.amount === 'number' ? item.amount : parseFloat(item.amount) || 0,
          currency: item.currency || 'TRY',
          suggestedCategory: item.suggestedCategory || 'other',
          type: isTax ? 'tax' : 'expense',
          invoiceNumber: item.invoiceNumber || '',
          invoiceDate: item.invoiceDate || '',
          receiptNumber: item.receiptNumber || '',
          issuer: item.issuer || '',
          pageNumber: pageNumber
        };
      });

      res.json({
        success: true,
        data: { items },
        pageNumber
      });
    } catch (error) {
      console.error("[Single Page Analysis] Error:", error);
      res.status(500).json({
        error: "Failed to analyze page",
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  /**
   * POST /api/expense-documents/extract-page
   * Extract a single page from a PDF stored in object storage
   * Returns the extracted page as a new PDF in storage
   */
  app.post("/api/expense-documents/extract-page", async (req, res) => {
    try {
      const { sourceObjectKey, pageNumber, procedureReference, expenseType, expenseId } = req.body;

      if (!sourceObjectKey) {
        return res.status(400).json({ error: "Source object key is required" });
      }
      if (!pageNumber || pageNumber < 1) {
        return res.status(400).json({ error: "Valid page number is required (1-indexed)" });
      }

      console.log(`[Page Extract] Extracting page ${pageNumber} from ${sourceObjectKey}`);

      // Download the source PDF from object storage using the centralized function
      const { getFile, uploadFile } = await import('./object-storage');
      
      let pdfBuffer: Buffer;
      try {
        const fileResult = await getFile(sourceObjectKey);
        pdfBuffer = fileResult.buffer;
        console.log(`[Page Extract] Downloaded source PDF, buffer length: ${pdfBuffer.length}`);
      } catch (downloadError: any) {
        console.error(`[Page Extract] Failed to download source PDF:`, downloadError.message);
        return res.status(404).json({ error: "Source PDF not found in storage" });
      }
      
      // Use pdf-lib to extract the specific page
      const { PDFDocument } = await import('pdf-lib');
      const sourcePdf = await PDFDocument.load(pdfBuffer);
      const totalPages = sourcePdf.getPageCount();

      if (pageNumber > totalPages) {
        return res.status(400).json({ 
          error: `Page ${pageNumber} does not exist. PDF has ${totalPages} pages.` 
        });
      }

      // Create a new PDF with just the requested page
      const newPdf = await PDFDocument.create();
      const [copiedPage] = await newPdf.copyPages(sourcePdf, [pageNumber - 1]); // 0-indexed
      newPdf.addPage(copiedPage);

      const extractedPdfBytes = await newPdf.save();
      const extractedBuffer = Buffer.from(extractedPdfBytes);

      // Upload the extracted page to storage using the centralized function
      const extractedObjectKey = await uploadFile(
        extractedBuffer, 
        `page-${pageNumber}.pdf`, 
        'application/pdf', 
        procedureReference || 'expense-documents'
      );

      console.log(`[Page Extract] Successfully extracted page ${pageNumber} to ${extractedObjectKey}`);

      // If expenseId is provided, create the expense document record
      let documentRecord = null;
      if (expenseId && expenseType) {
        try {
          documentRecord = await storage.uploadExpenseDocument({
            expenseType: expenseType,
            expenseId: parseInt(expenseId),
            originalFilename: `page-${pageNumber}.pdf`,
            objectKey: extractedObjectKey,
            fileSize: extractedBuffer.length,
            fileType: 'application/pdf',
            procedureReference: procedureReference || ''
          });
          console.log(`[Page Extract] Created document record:`, documentRecord);
        } catch (docError) {
          console.error("[Page Extract] Failed to create document record:", docError);
        }
      }

      res.json({
        success: true,
        extractedObjectKey,
        fileSize: extractedBuffer.length,
        document: documentRecord
      });

    } catch (error) {
      console.error("[Page Extract] Error:", error);
      res.status(500).json({
        error: "Failed to extract page from PDF",
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  /**
   * GET /api/expense-documents/pdf-page/:objectKey/:pageNumber
   * Get a specific page from a PDF as an image or PDF for preview
   */
  app.get("/api/expense-documents/pdf-page/:objectKey(*)", async (req, res) => {
    try {
      const objectKey = req.params.objectKey;
      const pageNumber = parseInt(req.query.page as string) || 1;
      const format = (req.query.format as string) || 'pdf';

      console.log(`[PDF Preview] Getting page ${pageNumber} from ${objectKey}`);

      // Use the existing getFile function which properly handles buffer conversion
      const { getFile } = await import('./object-storage');
      
      let pdfBuffer: Buffer;
      try {
        const fileResult = await getFile(objectKey);
        pdfBuffer = fileResult.buffer;
        console.log(`[PDF Preview] Downloaded file, buffer length: ${pdfBuffer.length}`);
      } catch (err: any) {
        console.log(`[PDF Preview] Download failed for ${objectKey}:`, err.message);
        return res.status(404).json({ error: "PDF not found in storage" });
      }
      
      // Check if it starts with PDF header (%PDF)
      const pdfHeader = pdfBuffer.slice(0, 4).toString('ascii');
      console.log(`[PDF Preview] PDF header check: "${pdfHeader}" (should be "%PDF")`);
      
      if (!pdfHeader.startsWith('%PDF')) {
        console.error(`[PDF Preview] Invalid PDF - header is "${pdfHeader}" instead of "%PDF"`);
        return res.status(500).json({ error: "Stored file is not a valid PDF" });
      }
      
      // Use pdf-lib to extract the specific page
      const { PDFDocument } = await import('pdf-lib');
      const sourcePdf = await PDFDocument.load(pdfBuffer);
      const totalPages = sourcePdf.getPageCount();

      if (pageNumber > totalPages) {
        return res.status(400).json({ 
          error: `Page ${pageNumber} does not exist. PDF has ${totalPages} pages.` 
        });
      }

      // Create a new PDF with just the requested page
      const newPdf = await PDFDocument.create();
      const [copiedPage] = await newPdf.copyPages(sourcePdf, [pageNumber - 1]);
      newPdf.addPage(copiedPage);

      const extractedPdfBytes = await newPdf.save();

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="page-${pageNumber}.pdf"`);
      res.send(Buffer.from(extractedPdfBytes));

    } catch (error) {
      console.error("[PDF Preview] Error:", error);
      res.status(500).json({
        error: "Failed to get PDF page",
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  /**
   * POST /api/procedures/analyze-customs-declaration
   * Analyze Turkish Customs Declaration (Gümrük Beyannamesi)
   * Extracts: shipper, package, weight, pieces, awbNumber, customs, importDeclarationNumber, importDeclarationDate
   * Accepts: PDF file upload (max 20MB)
   */
  app.post("/api/procedures/analyze-customs-declaration", requireClaudeAuth, pdfUpload.single('pdf'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "PDF file is required" });
      }

      // Validate file size (additional check)
      if (req.file.size > 20 * 1024 * 1024) {
        return res.status(400).json({ error: "PDF file exceeds 20MB limit" });
      }

      // Convert PDF buffer to base64
      const base64Pdf = req.file.buffer.toString('base64');

      const prompt = `⚠️ CRITICAL: You MUST return ONLY a JSON object. NO explanations, NO markdown, NO text before or after the JSON.

Your response must START with { and END with }

Any text outside the JSON object will cause the system to fail.

DO NOT use markdown code blocks like \`\`\`json
DO NOT add explanations before or after the JSON
DO NOT return anything except the JSON object

⚠️⚠️⚠️ CRITICAL EXAMPLES - READ THESE FIRST ⚠️⚠️⚠️

Here are 3 examples showing COMMON MISTAKES and CORRECT extraction:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EXAMPLE 1: 

PDF contains:
- Box '6 Kap Adedi' shows: 15
- Item line shows: '15 KAP 42 AD Marka:ALO'
- Box '23 Döviz kuru' shows: 42,34020

❌ WRONG extraction:
{
  "package": 42,  ← WRONG! This is from item line or exchange rate
  "usdTlRate": 42.34020
}

✅ CORRECT extraction:
{
  "package": 15,  ← CORRECT! From '6 Kap Adedi' box
  "usdTlRate": 42.34020
}

WHY: The number 42 appears in TWO wrong places:
1. In item description '15 KAP 42 AD' (this is item count)
2. As integer part of exchange rate 42,34020
The CORRECT package is 15 from the dedicated '6 Kap Adedi' box.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EXAMPLE 2:

PDF contains:
- Box '6 Kap Adedi' shows: 8
- Item line shows: '20 KAP 156 AD Marka:XYZ'
- Box '23 Döviz kuru' shows: 35,12450

❌ WRONG extraction:
{
  "package": 156,  ← WRONG! This is from item description
  "usdTlRate": 35.12450
}

❌ ALSO WRONG:
{
  "package": 35,  ← WRONG! This is from exchange rate
  "usdTlRate": 35.12450
}

✅ CORRECT extraction:
{
  "package": 8,  ← CORRECT! From '6 Kap Adedi' box
  "usdTlRate": 35.12450
}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EXAMPLE 3:

PDF contains:
- Box '6 Kap Adedi' shows: 25
- Item line shows: '10 KAP 50 AD Marka:ABC'
- Box '23 Döviz kuru' shows: 38,45678

✅ CORRECT extraction:
{
  "package": 25,  ← CORRECT! From '6 Kap Adedi' box
  "usdTlRate": 38.45678
}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PATTERN TO FOLLOW:
- ALWAYS get package from the box labeled '6 Kap Adedi'
- NEVER get package from item descriptions (lines with 'KAP' and 'AD' together)
- NEVER get package from exchange rate box ('23 Döviz kuru')
- Package is typically a SMALL number (1-100)
- Package is in its OWN dedicated box at the TOP of the page

NOW EXTRACT FROM THE ACTUAL DOCUMENT:

Based on the examples above, extract the package number from the '6 Kap Adedi' box ONLY.

Analyze this Turkish Customs Declaration document (Gümrük Beyannamesi).

⚠️ IMPORTANT: This document has a STANDARD FORMAT. All information is in the SAME LOCATIONS on every customs declaration.

📍 FIELD LOCATIONS - FIRST PAGE (Page 1):

1. Import Declaration Number (Beyanname No):
   - Location: TOP CENTER of first page
   - Format: Numbers like '25341453IM00684473'
   - Label: May appear as barcode or plain text
   
2. Import Declaration Date (Kayıt Tarihi):
   - Location: TOP RIGHT area of first page
   - Look for: 'Tarih' or date next to declaration number
   - Format: DD.MM.YYYY or DD/MM/YYYY
   
3. Shipper/Exporter (İhracatçı):
   - Location: TOP LEFT section, labeled 'İHRACATÇI='
   - Company name in ALL CAPS
   - Example: 'ALO HONG KONG LTD'
   - ⚠️ NOT the importer! Look for 'İHRACATÇI=' label
   
4. Customs Office (Gümrük Müdürlüğü):
   - Location: MIDDLE section of first page
   - Look for: 'İSTANBUL HAVALİMANI GÜMRÜK MÜDÜRLÜĞÜ' or similar
   - Contains word 'GÜMRÜK'
   
5. Package (Kap Adedi):

⚠️ IMPORTANT: Package extraction is OPTIONAL. If you cannot find it clearly, return 0.

ONLY extract package if you can CLEARLY identify the box labeled '6 Kap Adedi'.

If you see:
- A dedicated box at the top of the page
- Labeled exactly '6 Kap Adedi' 
- Contains a single number between 1-100
→ Extract that number

If you CANNOT find this box clearly:
→ Return: "package": 0

DO NOT guess. DO NOT use numbers from:
- Item descriptions (lines with 'KAP' and 'AD' together)
  Example: '15 KAP 42 AD Marka:ALO' ← This is item description
- Exchange rate boxes ('23 Döviz kuru')
  Example: '42,34020' ← This is exchange rate
- Any other location

VISUAL GUIDE (only if you can clearly see this):
┌──────────────┐
│ 6 Kap Adedi  │
│     15       │ ← Only extract if you clearly see this box
└──────────────┘

If uncertain → Return 0

The user will manually enter the package number if needed.
   
6. USD/TL Exchange Rate (Döviz Kuru):
⚠️ CRITICAL: This is a DECIMAL number with 4-5 decimal places!
⚠️ DO NOT use this as the package number!

EXACT LOCATION: FIRST PAGE, box labeled '23 Döviz kuru'
VISUAL POSITION: 
- To the RIGHT of '22 Döviz ve toplam fatura bedeli' (invoice amount)
- This is in the MIDDLE-RIGHT section of the page
- Contains a decimal number like 42.34020 or 34.5678

VALIDATION RULES:
- Must be a DECIMAL number
- Typical range: 20.0000 to 50.0000
- Has 4-5 decimal places
- Example: 42.34020 (NOT an integer!)

THE NUMBER 42.34020 is the EXCHANGE RATE, not the package number!
   
7. AWB Number (Air Waybill):
   - ⚠️ CRITICAL: ONLY from FIRST PAGE
   - Location: Section '18 Çıkıştaki aracın kimliği ve kayıtlı olduğu ülke'
   - Format: 'U - 23591954424' (has 'U - ' prefix)
   - Extract ONLY the numbers after 'U - '
   - Example input: 'U - 23591954424'
   - Example output: '23591954424'
   - This field is almost always present

📍 FIELD LOCATIONS - LAST PAGE (Final page with TOPLAM):

8. Weight (Brüt Ağırlık):
   - Location: LAST PAGE, TOPLAM row, in 'BRÜT KG' column
   - Example: '2.829,00' becomes 2829.00
   - Decimal number
   
9. Pieces (Toplam Adet):
   - ⚠️ CRITICAL: ONLY from LAST PAGE
   - Location: TOPLAM row only
   - You must find TWO numbers in the TOPLAM row:
     * First number followed by 'AD' (adet/pieces)
     * Second number followed by 'ÇİFT' (pairs)
   - Format example: '7.861,00 AD' and '85,00 ÇİFT'
   - ⚠️ CRITICAL CALCULATION: ADD both numbers together
   - Formula: Pieces = AD_number + ÇİFT_number
   - Example calculation: 7861 + 85 = 7946
   - First convert Turkish number format: '7.861,00' becomes 7861
   - If only AD exists (no ÇİFT), use just the AD number

🔍 EXTRACTION STRATEGY:

⚠️ PACKAGE EXTRACTION WARNING:

The document contains multiple references to 'KAP':
- One in the dedicated '6 Kap Adedi' box (CORRECT - use this)
- Multiple in the items table like '15 KAP 42 AD' (WRONG - ignore these)

ALWAYS extract package from the '6 Kap Adedi' box, NEVER from item descriptions!

STEP 1: READ FIRST PAGE CAREFULLY

VISUAL MAP OF FIRST PAGE:

TOP AREA (use for package):
┌──────────────────────────┐
│ Import Declaration Date  │
│                          │
│ ┌──────────────┐         │
│ │6 Kap Adedi   │         │
│ │     15       │ ← PACKAGE (CORRECT)
│ └──────────────┘         │
└──────────────────────────┘

MIDDLE/BOTTOM AREA (do NOT use for package):
┌──────────────────────────────────┐
│ Items Table:                     │
│ 15 KAP 42 AD Marka:ALO          │
│        ^                         │
│        └─ This 42 is NOT package!│
└──────────────────────────────────┘

OTHER LOCATIONS:
- TOP RIGHT: Import Declaration Date
- MIDDLE LEFT: Shipper/Exporter (İHRACATÇI=)
- MIDDLE CENTER: Invoice amount section
- RIGHT OF INVOICE AMOUNT: Box '23 Döviz kuru' (USD/TL Rate)
- BOTTOM LEFT: Section '18 Çıkıştaki aracın kimliği' (AWB Number)

Extract from FIRST PAGE:
1. Declaration Number (top center, barcode area)
2. Declaration Date (top right area)
3. Package: Look BELOW the date, LEFT side, box '6 Kap Adedi'
4. USD/TL Rate: Look for '23 Döviz kuru' box, RIGHT of invoice amount
5. Shipper/Exporter (section labeled İHRACATÇI=)
6. Customs Office (contains word GÜMRÜK)
7. AWB Number: Section '18 Çıkıştaki aracın kimliği' with 'U - XXXXXXXXXX'

STEP 2: GO TO LAST PAGE (page with TOPLAM:)
Extract from LAST PAGE:
- Find the row that says 'TOPLAM:'
- Weight: From 'BRÜT KG' column (decimal number)
- Pieces: Find TWO numbers in TOPLAM row
  * Look for number with 'AD' after it (example: 7.861,00 AD)
  * Look for number with 'ÇİFT' after it (example: 85,00 ÇİFT)
  * ADD BOTH NUMBERS TOGETHER
  * Convert Turkish format first: 7.861,00 = 7861 and 85,00 = 85
  * Total pieces = 7861 + 85 = 7946
  * If only AD exists, use just that number

⚠️⚠️⚠️ CRITICAL: DO NOT CONFUSE THESE TWO FIELDS ⚠️⚠️⚠️

PACKAGE (6 Kap Adedi):
- Location: Upper-left area of first page
- Label: Has number '6' before 'Kap Adedi'
- Value type: INTEGER (whole number)
- Example value: 15
- Range: 1-100

USD/TL EXCHANGE RATE (23 Döviz kuru):
- Location: Middle-right area of first page
- Label: Has number '23' before 'Döviz kuru'
- Value type: DECIMAL (with comma)
- Example value: 42,34020
- Range: 20-50 with decimals

IF YOU SEE 42.34020 or 42,34020:
- This is the EXCHANGE RATE (goes to usdTlRate field)
- This is NOT the package number

IF YOU SEE 15 or 42 (without decimals):
- Check which box it's in
- If it's in '6 Kap Adedi' box → This is the package
- If it's near 'Döviz kuru' → This is probably truncated exchange rate

📋 CRITICAL EXTRACTION RULES:

Package (Koli):
- ONLY from FIRST PAGE
- Section '6 Kap Adedi'
- Small number (1-100 range typically)
- NOT from TOPLAM row
- Must be an INTEGER, not a decimal

Pieces (Adet):
- ONLY from LAST PAGE
- TOPLAM row only
- TWO numbers: AD + ÇİFT
- MUST ADD them together
- Formula: total = AD_value + ÇİFT_value

AWB Number:
- ONLY from FIRST PAGE
- Section '18 Çıkıştaki aracın kimliği'
- Format: 'U - XXXXXXXXXXX'
- Extract numbers after 'U - '

Declaration Number:
- Take the FULL number (may be 15-20 characters)
- Example: '25341453IM00684473'

Date Format:
- Convert to YYYY-MM-DD
- Input: '19.11.2025' or '19/11/2025'
- Output: '2025-11-19'

Shipper (İHRACATÇI):
- Look for section labeled 'İHRACATÇI='
- Take FULL company name after this label
- Example: 'ALO HONG KONG LTD'
- ⚠️ CRITICAL: Do NOT use the importer (İTHALATÇI)!

Customs:
- Full name of customs office
- Usually contains 'Gümrük Müdürlüğü'

Numbers:
- Package: Integer from FIRST PAGE (whole number, small)
- Weight: Decimal from LAST PAGE (e.g., 2829.00)
- Pieces: Integer from LAST PAGE (AD + ÇİFT, large number)
- Convert Turkish format: '7.861,00' → 7861

📄 REAL EXAMPLE WITH EXACT LOCATIONS:

FIRST PAGE shows (with visual positions):

TOP RIGHT AREA:
19.11.2025 (Declaration Date)

BELOW DATE, LEFT SIDE:
6 Kap Adedi
15 ← (Package number in highlighted box)

MIDDLE LEFT:
İHRACATÇI= ALO HONG KONG LTD
           6/F, THE ANNEX, CENTRAL PLAZA
           18 HARBOUR ROAD, HONG KONG

İTHALATÇI= SOHO PERAKENDE YATIRIM VE TİCARET ANONİM ŞİRKETİ
           (This is the IMPORTER - do NOT use this!)

MIDDLE CENTER-RIGHT:
22 Döviz ve toplam fatura bedeli    23 Döviz kuru
USD    139.878,30                    42,34020 ← (Exchange rate in highlighted box)

BOTTOM LEFT:
18 Çıkıştaki aracın kimliği ve kayıtlı olduğu ülke
U - 23591954424

OTHER INFO:
25341453IM00684473
İSTANBUL HAVALİMANI GÜMRÜK MÜDÜRLÜĞÜ
DOSYA NO: 25-18710
---------------------------

LAST PAGE shows:
---------------------------
TOPLAM: 7.861,00 AD  2.829,00  2.829,00
           85,00 ÇİFT
---------------------------

CORRECT EXTRACTION:
{
  "shipper": "ALO HONG KONG LTD",
  "package": 15,
  "weight": 2829.00,
  "pieces": 7946,
  "awbNumber": "23591954424",
  "customs": "İSTANBUL HAVALİMANI GÜMRÜK MÜDÜRLÜĞÜ",
  "importDeclarationNumber": "25341453IM00684473",
  "importDeclarationDate": "2025-11-19",
  "usdTlRate": 42.34020
}

CALCULATION NOTES:
- Package: From '6 Kap Adedi' box = 15
- USD/TL Rate: From '23 Döviz kuru' box = 42,34020 → 42.34020
- Pieces: 7861 (AD) + 85 (ÇİFT) = 7946
- AWB: Extract after 'U - ' = 23591954424

STEP BY STEP PIECES CALCULATION:
1. Find TOPLAM row on last page
2. Locate number with AD: 7.861,00 AD
3. Locate number with ÇİFT: 85,00 ÇİFT
4. Convert Turkish format: 7.861,00 → 7861 and 85,00 → 85
5. Add together: 7861 + 85 = 7946
6. Return: 7946

⚠️ DOUBLE-CHECK SHIPPER:
- Shipper field MUST contain the EXPORTER (İHRACATÇI)
- Example: 'ALO HONG KONG LTD', 'ABC TRADING CO', etc.
- Do NOT use the importer company name!
- Look for the section labeled 'İHRACATÇI=' on first page

⚠️ FINAL REMINDER:
- Your ENTIRE response must be ONLY the JSON object
- Start with {
- End with }
- No \`\`\`json markers
- No explanations
- No additional text
- JUST THE JSON OBJECT

BAD RESPONSE EXAMPLE (DO NOT DO THIS):
\`\`\`json
{
  "shipper": "ALO HONG KONG LTD",
  ...
}
\`\`\`

GOOD RESPONSE EXAMPLE (DO THIS):
{
  "shipper": "ALO HONG KONG LTD",
  "package": 15,
  "weight": 2829.00,
  "pieces": 7946,
  "awbNumber": "23591954424",
  "customs": "İSTANBUL HAVALİMANI GÜMRÜK MÜDÜRLÜĞÜ",
  "importDeclarationNumber": "25341453IM00684473",
  "importDeclarationDate": "2025-11-19"
}

⚠️ DOUBLE CHECK YOUR EXTRACTION:
- Package must be from FIRST PAGE Kap Adedi box (small number, 1-100)
- Pieces must be AD + ÇİFT from LAST PAGE TOPLAM row (large number, add them!)
- AWB must start with U - on FIRST PAGE section 18 (extract numbers only)
- Weight from LAST PAGE TOPLAM row BRÜT KG column

MANDATORY CROSS-CHECK BEFORE SUBMITTING:

After extracting all values, verify:

❌ If package value is 42 or 43:
   → STOP! You probably extracted the exchange rate by mistake
   → Go back to the FIRST PAGE
   → Find the box that says '6 Kap Adedi' (not '23 Döviz kuru')
   → Extract the number from THAT box

❌ If package has decimals (like 42.34):
   → STOP! This is definitely the exchange rate
   → Find the '6 Kap Adedi' box
   → Extract the integer from there

✓ Correct extraction example:
   package: 15 (from '6 Kap Adedi')
   usdTlRate: 42.34020 (from '23 Döviz kuru')
   
✓ These should be DIFFERENT numbers!
✓ Package is typically much SMALLER than exchange rate

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FINAL CHECK BEFORE SUBMITTING YOUR ANSWER:

Look at the package number you extracted.

Question: Did you get it from the box labeled '6 Kap Adedi'?
□ YES → Proceed
□ NO → Go back and find the '6 Kap Adedi' box

Question: Is your package number different from the numbers in item descriptions?
□ YES → Proceed  
□ NO → You extracted from wrong location

Question: Did you avoid using numbers from lines that contain both 'KAP' and 'AD'?
□ YES → Proceed
□ NO → Those are item descriptions, not package count

If you extracted package = 42 from this specific document:
❌ YOU MADE AN ERROR - The correct answer is 15

Return your JSON now.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚠️ CRITICAL OUTPUT FORMAT:
Return ONLY the JSON object, no explanation before or after.

{
  "shipper": "string",
  "package": 0,
  "weight": 0.0,
  "pieces": 0,
  "awbNumber": "string",
  "customs": "string",
  "importDeclarationNumber": "string",
  "importDeclarationDate": "YYYY-MM-DD"
}`;

      const result = await claude.analyzePdfWithClaude({
        base64Data: base64Pdf,
        prompt,
        maxTokens: 3000,
        temperature: 0  // More deterministic output
      });
      
      console.log("[Customs Declaration PDF] Claude raw response:", result.substring(0, 500));
      
      // Parse JSON response with robust cleaning
      let parsedData;
      try {
        // Remove ANY non-JSON content
        let cleanedJson = result.trim();
        
        // Remove markdown code blocks
        cleanedJson = cleanedJson.replace(/```json\n?/g, '').replace(/```\n?/g, '');
        
        // Remove any HTML tags
        cleanedJson = cleanedJson.replace(/<[^>]*>/g, '');
        
        // Remove any text before first {
        const firstBrace = cleanedJson.indexOf('{');
        if (firstBrace > 0) {
          cleanedJson = cleanedJson.substring(firstBrace);
        }
        
        // Remove any text after last }
        const lastBrace = cleanedJson.lastIndexOf('}');
        if (lastBrace !== -1 && lastBrace < cleanedJson.length - 1) {
          cleanedJson = cleanedJson.substring(0, lastBrace + 1);
        }
        
        cleanedJson = cleanedJson.trim();
        
        // Validate it's valid JSON structure
        if (!cleanedJson.startsWith('{') || !cleanedJson.endsWith('}')) {
          console.error('[Customs Declaration] Invalid JSON structure:', cleanedJson.substring(0, 200));
          throw new Error('Claude response does not contain valid JSON object');
        }
        
        console.log('[Customs Declaration] Cleaned JSON:', cleanedJson);
        
        parsedData = JSON.parse(cleanedJson);
        console.log("[Customs Declaration PDF] Parsed data:", JSON.stringify(parsedData, null, 2));
        
      } catch (parseError: any) {
        console.error('[Customs Declaration] JSON parse error:', parseError);
        console.error('[Customs Declaration] Attempted to parse:', result.substring(0, 500));
        return res.status(500).json({ 
          error: "Failed to parse extracted data",
          details: `Claude returned invalid JSON format: ${parseError.message}`
        });
      }

      // Validate parsed data with Zod
      const validation = customsDeclarationDataSchema.safeParse(parsedData);
      if (!validation.success) {
        console.error("[Customs Declaration PDF] Validation error:", validation.error);
        return res.status(422).json({ 
          error: "Invalid data format from Claude",
          details: "Missing or invalid required fields",
          validationErrors: validation.error.issues
        });
      }

      const validatedData = validation.data;

      // Detect likely extraction errors and set package to 0
      if (validatedData.package > 0) {
        // Check if package seems wrong (matches exchange rate or is suspiciously large)
        if (validatedData.package === Math.floor(validatedData.usdTlRate)) {
          console.warn('[Customs Declaration] Package matches exchange rate, setting to 0');
          validatedData.package = 0;
        }
        
        if (validatedData.package > 100) {
          console.warn('[Customs Declaration] Package > 100, likely from item count, setting to 0');
          validatedData.package = 0;
        }
      }

      console.log('[Customs Declaration] Final validated data:', validatedData);

      res.json({ success: true, data: validatedData });
    } catch (error) {
      console.error("[Customs Declaration PDF] Analysis error:", error);
      res.status(500).json({ 
        error: "Failed to analyze customs declaration document", 
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  /**
   * GET /api/claude/test
   * Test endpoint to verify Claude API key is configured and working
   */
  app.get("/api/claude/test", async (req, res) => {
    try {
      // Check if Claude is configured
      if (!claude.isConfigured()) {
        return res.status(503).json({ 
          error: "Claude API not configured",
          details: "ANTHROPIC_API_KEY is not set or invalid. Please add your API key to Replit Secrets."
        });
      }

      // Make a simple API call to test the key
      const testPrompt = "Say 'API key is valid' if you can read this message.";
      const response = await claude.analyzeText(testPrompt);
      
      res.json({ 
        success: true, 
        configured: true,
        message: "Claude API is configured and working correctly",
        testResponse: response.substring(0, 100) // First 100 chars of response
      });
    } catch (error) {
      console.error("[Claude Test] Error:", error);
      
      // Check for authentication errors
      if (error instanceof Error && error.message.includes('401')) {
        return res.status(401).json({ 
          error: "Invalid API key",
          details: "The ANTHROPIC_API_KEY is invalid. Please check your API key at console.anthropic.com"
        });
      }
      
      res.status(500).json({ 
        error: "Claude API test failed", 
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // TEST ENDPOINT: Verify date timezone fix
  app.post('/api/test-date-fix', async (req, res) => {
    try {
      const testDate = req.body.date; // Should be "2025-11-19"
      
      console.log('=== DATE FIX TEST ===');
      console.log('Received date:', testDate, 'Type:', typeof testDate);
      
      // Create a test procedure
      const testReference = 'TEST-DATE-' + Date.now();
      const result = await db.insert(procedures).values({
        reference: testReference,
        arrival_date: testDate,
        invoice_date: testDate,
        import_dec_date: testDate,
        createdBy: 3,
      }).returning();
      
      console.log('Inserted arrival_date:', result[0].arrival_date, 'Type:', typeof result[0].arrival_date);
      console.log('Inserted invoice_date:', result[0].invoice_date, 'Type:', typeof result[0].invoice_date);
      console.log('Inserted import_dec_date:', result[0].import_dec_date, 'Type:', typeof result[0].import_dec_date);
      
      // Query it back to verify
      const queried = await db.query.procedures.findFirst({
        where: eq(procedures.reference, testReference)
      });
      
      console.log('Queried arrival_date:', queried?.arrival_date, 'Type:', typeof queried?.arrival_date);
      console.log('=== END TEST ===');
      
      res.json({
        success: true,
        sent: testDate,
        stored_arrival_date: result[0].arrival_date,
        stored_invoice_date: result[0].invoice_date,
        stored_import_dec_date: result[0].import_dec_date,
        queried_arrival_date: queried?.arrival_date,
        match: testDate === result[0].arrival_date && testDate === queried?.arrival_date,
        message: testDate === result[0].arrival_date ? 'SUCCESS: No timezone conversion!' : 'FAILED: Date was converted'
      });
    } catch (error) {
      console.error('Test endpoint error:', error);
      res.status(500).json({ error: String(error) });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
