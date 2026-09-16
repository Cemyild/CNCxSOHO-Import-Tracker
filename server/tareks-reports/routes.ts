import type { Express, Request, Response } from "express";
import multer from "multer";
import archiver from "archiver";
import { z } from "zod";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { products, tareksReports, tareksReportStyles } from "@shared/schema";
import { uploadFile, getFile, deleteFile } from "../object-storage";
import { detectStyles, normalizeStyle, buildZipPaths } from "./style-matcher";

const MAX_FILE_BYTES = 25 * 1024 * 1024; // lab reports are scans; 25MB is generous
const MAX_FILES_PER_UPLOAD = 50;

const reportUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (_req, file, cb) => {
    const allowed = ["application/pdf", "image/jpeg", "image/png"];
    if (allowed.includes(file.mimetype) || /\.(pdf|jpe?g|png)$/i.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error("Only PDF, JPG and PNG reports are allowed"));
    }
  },
  limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES_PER_UPLOAD },
});

/** The product catalogue, used to recognise style numbers inside filenames. */
async function loadKnownStyles(): Promise<string[]> {
  const rows = await db
    .select({ style: products.style })
    .from(products)
    .where(sql`${products.style} is not null and ${products.style} <> ''`);
  return rows.map((r) => r.style as string);
}

function requireUser(req: Request, res: Response): number | null {
  const userId = (req.session as any)?.userId;
  if (!userId) {
    res.status(401).json({ error: "Not authenticated" });
    return null;
  }
  return userId;
}

/** Fetch reports plus their styles, newest first, optionally filtered. */
async function listReports(search: string | undefined) {
  const reports = await db.select().from(tareksReports).orderBy(desc(tareksReports.id));
  if (reports.length === 0) return [];

  const styleRows = await db
    .select()
    .from(tareksReportStyles)
    .where(inArray(tareksReportStyles.reportId, reports.map((r) => r.id)));

  const stylesByReport = new Map<number, string[]>();
  for (const row of styleRows) {
    if (!stylesByReport.has(row.reportId)) stylesByReport.set(row.reportId, []);
    stylesByReport.get(row.reportId)!.push(row.style);
  }

  const enriched = reports.map((r) => ({
    id: r.id,
    originalFilename: r.originalFilename,
    fileSize: r.fileSize,
    fileType: r.fileType,
    procedureReference: r.procedureReference,
    testDate: r.testDate,
    notes: r.notes,
    createdAt: r.createdAt,
    styles: (stylesByReport.get(r.id) ?? []).sort(),
  }));

  const needle = (search ?? "").trim().toUpperCase();
  if (!needle) return enriched;

  return enriched.filter(
    (r) =>
      r.originalFilename.toUpperCase().includes(needle) ||
      (r.procedureReference ?? "").toUpperCase().includes(needle) ||
      r.styles.some((s) => s.includes(needle)),
  );
}

const parseFilenamesSchema = z.object({
  filenames: z.array(z.string().min(1)).min(1).max(MAX_FILES_PER_UPLOAD),
});

const uploadMetaSchema = z.array(
  z.object({
    filename: z.string().min(1),
    styles: z.array(z.string()).default([]),
    procedureReference: z.string().nullish(),
    testDate: z.string().nullish(),
    notes: z.string().nullish(),
  }),
);

const downloadSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1),
});

export function registerTareksReportRoutes(app: Express): void {
  // Suggest style numbers for a batch of filenames, before anything is uploaded.
  app.post("/api/tareks-reports/parse-filenames", async (req: Request, res: Response) => {
    if (requireUser(req, res) === null) return;
    const parsed = parseFilenamesSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    }
    try {
      const known = await loadKnownStyles();
      const knownSet = new Set(known.map(normalizeStyle));
      const results = parsed.data.filenames.map((filename) => {
        const styles = detectStyles(filename, known);
        return {
          filename,
          styles,
          // Flags styles the catalogue does not know, so the UI can warn gently.
          unknownStyles: styles.filter((s) => !knownSet.has(s)),
        };
      });
      return res.json({ results });
    } catch (err) {
      console.error("tareks-reports/parse-filenames error:", err);
      return res.status(500).json({ error: "Failed to parse filenames", details: String(err) });
    }
  });

  // Upload one or more reports together with their (user-confirmed) styles.
  app.post(
    "/api/tareks-reports",
    reportUpload.array("files", MAX_FILES_PER_UPLOAD),
    async (req: Request, res: Response) => {
      const userId = requireUser(req, res);
      if (userId === null) return;

      const files = (req.files as Express.Multer.File[] | undefined) ?? [];
      if (files.length === 0) {
        return res.status(400).json({ error: "No files uploaded" });
      }

      let meta: z.infer<typeof uploadMetaSchema>;
      try {
        meta = uploadMetaSchema.parse(JSON.parse(String(req.body?.meta ?? "[]")));
      } catch (err) {
        return res.status(400).json({ error: "Invalid meta payload", details: String(err) });
      }

      const metaByName = new Map(meta.map((m) => [m.filename, m]));
      const created: Array<{ id: number; originalFilename: string; styles: string[] }> = [];
      const failed: Array<{ filename: string; error: string }> = [];

      for (const file of files) {
        const entry = metaByName.get(file.originalname);
        const styles = [...new Set((entry?.styles ?? []).map(normalizeStyle).filter(Boolean))];
        const procedureReference = entry?.procedureReference?.trim() || null;

        try {
          // Object keys are grouped per procedure; unlinked reports get their own folder.
          const objectKey = await uploadFile(
            file.buffer,
            file.originalname,
            file.mimetype,
            procedureReference ? `TAREKS_REPORTS/${procedureReference}` : "TAREKS_REPORTS",
          );

          const [row] = await db
            .insert(tareksReports)
            .values({
              originalFilename: file.originalname,
              objectKey,
              fileSize: file.size,
              fileType: file.mimetype,
              procedureReference,
              testDate: entry?.testDate?.trim() || null,
              notes: entry?.notes?.trim() || null,
              uploadedBy: userId,
            })
            .returning();

          if (styles.length > 0) {
            await db
              .insert(tareksReportStyles)
              .values(styles.map((style) => ({ reportId: row.id, style })))
              .onConflictDoNothing();
          }

          created.push({ id: row.id, originalFilename: row.originalFilename, styles });
        } catch (err) {
          console.error(`tareks-reports: upload failed for ${file.originalname}:`, err);
          failed.push({ filename: file.originalname, error: String(err) });
        }
      }

      const status = failed.length > 0 && created.length === 0 ? 500 : 201;
      return res.status(status).json({ created, failed });
    },
  );

  app.get("/api/tareks-reports", async (req: Request, res: Response) => {
    try {
      const search = typeof req.query.search === "string" ? req.query.search : undefined;
      const reports = await listReports(search);
      return res.json({ reports });
    } catch (err) {
      console.error("tareks-reports list error:", err);
      return res.status(500).json({ error: "Failed to list reports", details: String(err) });
    }
  });

  // Single-file download (also used by the row-level download button).
  app.get("/api/tareks-reports/:id/download", async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: "Invalid id" });
    }
    try {
      const [report] = await db.select().from(tareksReports).where(eq(tareksReports.id, id));
      if (!report) return res.status(404).json({ error: "Report not found" });

      const { buffer, contentType } = await getFile(report.objectKey);
      res.setHeader("Content-Type", contentType || report.fileType);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(report.originalFilename)}`,
      );
      res.setHeader("Cache-Control", "no-store");
      return res.send(buffer);
    } catch (err) {
      console.error("tareks-reports download error:", err);
      return res.status(500).json({ error: "Failed to download report", details: String(err) });
    }
  });

  // Bulk download: one file streams as-is, several stream as a ZIP.
  app.post("/api/tareks-reports/download", async (req: Request, res: Response) => {
    if (requireUser(req, res) === null) return;
    const parsed = downloadSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    }

    const ids = [...new Set(parsed.data.ids)];
    let reports: Array<typeof tareksReports.$inferSelect>;
    const stylesByReport = new Map<number, string[]>();

    try {
      reports = await db.select().from(tareksReports).where(inArray(tareksReports.id, ids));
      if (reports.length === 0) {
        return res.status(404).json({ error: "No reports found for the selection" });
      }
      const styleRows = await db
        .select()
        .from(tareksReportStyles)
        .where(inArray(tareksReportStyles.reportId, reports.map((r) => r.id)));
      for (const row of styleRows) {
        if (!stylesByReport.has(row.reportId)) stylesByReport.set(row.reportId, []);
        stylesByReport.get(row.reportId)!.push(row.style);
      }
    } catch (err) {
      console.error("tareks-reports bulk download prepare error:", err);
      return res.status(500).json({ error: "Failed to prepare download", details: String(err) });
    }

    // A single report needs no archive — hand back the file itself.
    if (reports.length === 1) {
      try {
        const { buffer, contentType } = await getFile(reports[0].objectKey);
        res.setHeader("Content-Type", contentType || reports[0].fileType);
        res.setHeader(
          "Content-Disposition",
          `attachment; filename*=UTF-8''${encodeURIComponent(reports[0].originalFilename)}`,
        );
        res.setHeader("Cache-Control", "no-store");
        return res.send(buffer);
      } catch (err) {
        console.error("tareks-reports single download error:", err);
        return res.status(500).json({ error: "Failed to download report", details: String(err) });
      }
    }

    const byId = new Map(reports.map((r) => [r.id, r]));
    const plan = buildZipPaths(
      reports.map((r) => ({
        id: r.id,
        originalFilename: r.originalFilename,
        styles: (stylesByReport.get(r.id) ?? []).sort(),
      })),
    );

    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="tareks-reports-${stamp}.zip"`);
    res.setHeader("Cache-Control", "no-store");

    const archive = archiver("zip", { zlib: { level: 1 } });
    archive.on("warning", (err) => console.warn("archiver warning:", err));
    archive.on("error", (err) => {
      console.error("archiver error:", err);
      try { res.end(); } catch { /* stream already torn down */ }
    });
    archive.pipe(res);

    // Fetch each object once even when it lands in several style folders.
    const bufferCache = new Map<number, Buffer>();
    try {
      for (const entry of plan) {
        const report = byId.get(entry.id);
        if (!report) continue;
        try {
          let buffer = bufferCache.get(entry.id);
          if (!buffer) {
            buffer = (await getFile(report.objectKey)).buffer;
            bufferCache.set(entry.id, buffer);
          }
          archive.append(buffer, { name: entry.pathInZip });
        } catch (err) {
          console.warn(`tareks-reports: failed to fetch ${report.objectKey}: ${err}`);
        }
      }
      await archive.finalize();
    } catch (err) {
      console.error("tareks-reports zip streaming error:", err);
      try { res.end(); } catch { /* stream already torn down */ }
    }
  });

  app.delete("/api/tareks-reports/:id", async (req: Request, res: Response) => {
    if (requireUser(req, res) === null) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: "Invalid id" });
    }
    try {
      const [report] = await db.select().from(tareksReports).where(eq(tareksReports.id, id));
      if (!report) return res.status(404).json({ error: "Report not found" });

      await db.delete(tareksReports).where(eq(tareksReports.id, id)); // styles cascade
      try {
        await deleteFile(report.objectKey);
      } catch (err) {
        // The DB row is gone; a stranded object is not worth failing the request.
        console.warn(`tareks-reports: could not delete object ${report.objectKey}: ${err}`);
      }
      return res.json({ deleted: id });
    } catch (err) {
      console.error("tareks-reports delete error:", err);
      return res.status(500).json({ error: "Failed to delete report", details: String(err) });
    }
  });
}
