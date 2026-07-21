import { Router } from "express";
import type { Response } from "express";
import multer from "multer";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { procedures } from "@shared/schema";
import { requireRole } from "./auth-middleware";
import { EnrichmentParseError, type ParseOverrides } from "./enrichment/parse-workbook";
import type { MatchCandidate } from "./enrichment/match";
import { computeChanges, isFillable } from "./enrichment/diff";
import { FIELD_KIND, type EnrichField } from "./enrichment/types";
import {
  detectStructure,
  runEnrichmentPipeline,
} from "./enrichment/pipeline";

const router = Router();

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (_req, file, cb) => {
    cb(null, /\.xlsx?$/i.test(file.originalname));
  },
});

/** Only these columns may ever be written by this feature. */
const ENRICH_FIELDS = new Set(Object.keys(FIELD_KIND) as EnrichField[]);

function readOverrides(body: Record<string, unknown>): ParseOverrides {
  const overrides: ParseOverrides = {};
  if (typeof body.sheetName === "string" && body.sheetName !== "") {
    overrides.sheetName = body.sheetName;
  }
  const headerRowIndex = Number(body.headerRowIndex);
  if (Number.isInteger(headerRowIndex) && headerRowIndex >= 0) {
    overrides.headerRowIndex = headerRowIndex;
  }
  return overrides;
}

function handleParseError(error: unknown, res: Response): boolean {
  if (error instanceof EnrichmentParseError) {
    res.status(400).json({
      code: error.code,
      message: error.message,
      detectedHeaders: error.detectedHeaders,
      availableSheets: error.availableSheets,
    });
    return true;
  }
  return false;
}

/** Step 1 of the UI: what did we find in this workbook? */
router.post(
  "/analyze",
  requireRole("admin"),
  upload.single("file"),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });
    try {
      const detection = detectStructure(
        req.file.buffer,
        readOverrides(req.body ?? {}),
      );
      console.log(
        `[Enrichment] analyze: sheet="${detection.sheetName}" headerRow=${detection.headerRowIndex} rows=${detection.dataRowCount} mapped=${detection.mapped.length}`,
      );
      res.json({ detection });
    } catch (error) {
      if (handleParseError(error, res)) return;
      console.error("[Enrichment] analyze failed:", error);
      res.status(500).json({ message: "Failed to analyze Excel file" });
    }
  },
);

/** Step 2 of the UI: which procedures would change, and what stayed behind? */
router.post(
  "/preview",
  requireRole("admin"),
  upload.single("file"),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });
    try {
      // One read serves both jobs: matching needs id/reference/invoice/amount,
      // the diff needs every column of the winning rows.
      const full = await db.select().from(procedures);
      const candidates: MatchCandidate[] = full.map((p) => ({
        id: p.id,
        reference: p.reference,
        invoice_no: p.invoice_no,
        amount: p.amount,
      }));

      const { detection, matched, unmatched } = runEnrichmentPipeline(
        req.file.buffer,
        candidates,
        readOverrides(req.body ?? {}),
      );

      const byId = new Map(full.map((p) => [p.id, p as Record<string, unknown>]));

      const withChanges = matched
        .map((group) => {
          const procedure = byId.get(group.procedureId);
          if (!procedure) return null;
          return { ...group, changes: computeChanges(group, procedure) };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null)
        .filter((item) => item.changes.length > 0);

      console.log(
        `[Enrichment] preview: matched=${matched.length} withChanges=${withChanges.length} unmatched=${unmatched.length}`,
      );
      res.json({ detection, matched: withChanges, unmatched });
    } catch (error) {
      if (handleParseError(error, res)) return;
      console.error("[Enrichment] preview failed:", error);
      res.status(500).json({ message: "Failed to process Excel file" });
    }
  },
);

/** Step 3: write the changes the user ticked. */
router.post("/apply", requireRole("admin"), async (req, res) => {
  const { updates } = req.body ?? {};
  if (!Array.isArray(updates)) {
    return res.status(400).json({ message: "Invalid updates format" });
  }

  const results: Array<{
    id: number;
    status: "success" | "not_found" | "skipped" | "error";
    applied?: string[];
    skipped?: string[];
  }> = [];

  for (const update of updates) {
    const procedureId = Number(update?.procedureId);
    const changes = update?.changes;
    if (!Number.isInteger(procedureId) || !changes || typeof changes !== "object") {
      continue;
    }

    try {
      const [procedure] = await db
        .select()
        .from(procedures)
        .where(eq(procedures.id, procedureId));

      if (!procedure) {
        results.push({ id: procedureId, status: "not_found" });
        continue;
      }

      const applied: string[] = [];
      const skipped: string[] = [];
      const patch: Record<string, string> = {};

      for (const [rawField, value] of Object.entries(changes)) {
        const field = rawField as EnrichField;
        if (!ENRICH_FIELDS.has(field)) {
          console.warn(`[Enrichment] apply: rejected unknown field "${rawField}"`);
          continue;
        }
        // Re-check against the current row: someone may have filled this in
        // between preview and apply.
        if (!isFillable(field, (procedure as Record<string, unknown>)[field])) {
          skipped.push(field);
          continue;
        }
        patch[field] = String(value);
        applied.push(field);
      }

      if (applied.length === 0) {
        results.push({ id: procedureId, status: "skipped", applied, skipped });
        continue;
      }

      await db
        .update(procedures)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(procedures.id, procedureId));

      results.push({ id: procedureId, status: "success", applied, skipped });
    } catch (error) {
      console.error(`[Enrichment] apply failed for #${procedureId}:`, error);
      results.push({ id: procedureId, status: "error" });
    }
  }

  const succeeded = results.filter((r) => r.status === "success").length;
  console.log(`[Enrichment] apply: ${succeeded}/${results.length} updated`);
  res.json({ message: "Updates applied", results });
});

export default router;
