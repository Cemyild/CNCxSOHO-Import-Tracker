import { Router } from "express";
import { db } from "./db";
import { invoiceMakerHistory, taxCalculationItems } from "@shared/schema";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import {
  buildCommercialInvoiceXlsx,
  type ExportPayload,
} from "./invoice-maker-export";

const router = Router();

// Resolve TR HS codes for a list of styles from past tax calculation items.
// For each style the most recently entered tr_hs_code wins.
router.post("/resolve-hs-codes", async (req, res) => {
  try {
    const stylesRaw = req.body?.styles;
    if (!Array.isArray(stylesRaw)) {
      return res.status(400).json({ message: "styles must be an array" });
    }
    const styles = Array.from(
      new Set(
        stylesRaw
          .filter((s: unknown): s is string => typeof s === "string")
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    ).slice(0, 500);

    if (styles.length === 0) {
      return res.json({ matches: {} });
    }

    const rows = await db
      .select({
        style: taxCalculationItems.style,
        tr_hs_code: taxCalculationItems.tr_hs_code,
      })
      .from(taxCalculationItems)
      .where(
        and(
          inArray(taxCalculationItems.style, styles),
          isNotNull(taxCalculationItems.tr_hs_code),
        ),
      )
      .orderBy(desc(taxCalculationItems.id));

    const matches: Record<string, string> = {};
    for (const row of rows) {
      if (!row.tr_hs_code) continue;
      if (!(row.style in matches)) {
        matches[row.style] = row.tr_hs_code;
      }
    }

    res.json({ matches });
  } catch (error) {
    console.error("Error resolving HS codes:", error);
    res
      .status(500)
      .json({ message: "Failed to resolve HS codes", error: String(error) });
  }
});

// Build the CI & PL workbook from the template and stream it back.
router.post("/export", async (req, res) => {
  try {
    const payload = req.body as ExportPayload;
    if (!Array.isArray(payload?.lineItems) || payload.lineItems.length === 0) {
      return res.status(400).json({ message: "lineItems is required" });
    }
    if (!Array.isArray(payload?.pallets) || payload.pallets.length === 0) {
      return res.status(400).json({ message: "pallets is required" });
    }

    const buffer = await buildCommercialInvoiceXlsx(payload);

    const safeNo = String(payload.invoiceNo || "")
      .replace(/[^\w.-]+/g, " ")
      .trim();
    const filename = safeNo ? `${safeNo} CI & PL.xlsx` : "CI & PL.xlsx";

    // Record the export so past invoices can be listed and re-downloaded.
    // A failed insert must not block the download itself.
    try {
      const totalQty = payload.lineItems.reduce(
        (a, li) => a + (Number(li.qty) || 0),
        0,
      );
      const totalAmount = payload.lineItems.reduce(
        (a, li) => a + (Number(li.qty) || 0) * (Number(li.unitPrice) || 0),
        0,
      );
      await db.insert(invoiceMakerHistory).values({
        invoice_no: payload.invoiceNo || "(no number)",
        total_qty: totalQty,
        total_amount: (Math.round(totalAmount * 100) / 100).toFixed(2),
        filename,
        payload: payload as object,
      });
    } catch (historyError) {
      console.error("Failed to record invoice history:", historyError);
    }

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}"`,
    );
    res.send(buffer);
  } catch (error) {
    console.error("Error exporting commercial invoice:", error);
    res
      .status(500)
      .json({ message: "Failed to export invoice", error: String(error) });
  }
});

// List past exports, newest first.
router.get("/history", async (_req, res) => {
  try {
    const rows = await db
      .select({
        id: invoiceMakerHistory.id,
        invoice_no: invoiceMakerHistory.invoice_no,
        total_qty: invoiceMakerHistory.total_qty,
        total_amount: invoiceMakerHistory.total_amount,
        filename: invoiceMakerHistory.filename,
        created_at: invoiceMakerHistory.created_at,
      })
      .from(invoiceMakerHistory)
      .orderBy(desc(invoiceMakerHistory.id))
      .limit(100);
    res.json({ history: rows });
  } catch (error) {
    console.error("Error fetching invoice history:", error);
    res
      .status(500)
      .json({ message: "Failed to fetch history", error: String(error) });
  }
});

// Re-download a past export: the workbook is rebuilt from the stored payload.
router.get("/history/:id/download", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: "Invalid id" });
    }
    const [row] = await db
      .select()
      .from(invoiceMakerHistory)
      .where(eq(invoiceMakerHistory.id, id));
    if (!row) {
      return res.status(404).json({ message: "Invoice not found" });
    }
    const buffer = await buildCommercialInvoiceXlsx(
      row.payload as ExportPayload,
    );
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${row.filename}"`,
    );
    res.send(buffer);
  } catch (error) {
    console.error("Error re-downloading invoice:", error);
    res
      .status(500)
      .json({ message: "Failed to download invoice", error: String(error) });
  }
});

export default router;
