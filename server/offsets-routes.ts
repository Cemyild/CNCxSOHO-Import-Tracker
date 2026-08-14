import { Router } from "express";
import type { Request, Response } from "express";
import { requireRole } from "./auth-middleware";
import {
  getOffsetCandidates,
  previewOffsets,
  applyOffsets,
  getOffsetHistory,
  reverseOffset,
  reverseBatch,
  OffsetValidationError,
  type CandidateFilter,
} from "./offset-service";
import { InsufficientSourceError, type OffsetMove } from "./offset-engine";

const router = Router();

function readFilter(source: Record<string, any>): CandidateFilter {
  const filter: CandidateFilter = {};
  if (typeof source.shipper === "string" && source.shipper !== "") {
    filter.shipper = source.shipper;
  }
  if (source.includeClosed === false || source.includeClosed === "false") {
    filter.includeClosed = false;
  }
  return filter;
}

function actingUserId(req: Request): number {
  const user = (req as any).currentUser;
  return user?.id ?? 1;
}

function fail(res: Response, error: unknown) {
  if (
    error instanceof OffsetValidationError ||
    error instanceof InsufficientSourceError
  ) {
    return res.status(400).json({ message: error.message });
  }
  console.error("[offsets]", error);
  return res
    .status(500)
    .json({ message: "Mahsuplaşma işlemi başarısız", error: String(error) });
}

router.get("/candidates", async (req, res) => {
  try {
    res.json(await getOffsetCandidates(readFilter(req.query)));
  } catch (error) {
    fail(res, error);
  }
});

// GET, not POST: previewing writes nothing, and server/index.ts requires a
// session for every POST/PUT/PATCH/DELETE under /api.
router.get("/preview", async (req, res) => {
  try {
    res.json(await previewOffsets(readFilter(req.query)));
  } catch (error) {
    fail(res, error);
  }
});

router.post("/apply", requireRole("admin", "accountant"), async (req, res) => {
  try {
    const moves = req.body?.moves;
    if (!Array.isArray(moves) || moves.length === 0) {
      return res.status(400).json({ message: "moves listesi gerekli" });
    }

    const parsed: OffsetMove[] = moves.map((m: any) => ({
      fromReference: String(m.fromReference),
      toReference: String(m.toReference),
      amount: Number(m.amount),
    }));

    if (parsed.some((m) => !Number.isFinite(m.amount) || m.amount <= 0)) {
      return res.status(400).json({ message: "Geçersiz aktarım tutarı" });
    }

    const mode = req.body?.mode === "auto" ? "auto" : "manual";
    res.status(201).json(await applyOffsets(parsed, actingUserId(req), mode));
  } catch (error) {
    fail(res, error);
  }
});

router.get("/history", async (_req, res) => {
  try {
    res.json({ offsets: await getOffsetHistory() });
  } catch (error) {
    fail(res, error);
  }
});

router.post("/:id/reverse", requireRole("admin", "accountant"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: "Geçersiz mahsup numarası" });
    }
    await reverseOffset(id, actingUserId(req));
    res.json({ success: true });
  } catch (error) {
    fail(res, error);
  }
});

router.post(
  "/batch/:batchId/reverse",
  requireRole("admin", "accountant"),
  async (req, res) => {
    try {
      res.json(await reverseBatch(req.params.batchId, actingUserId(req)));
    } catch (error) {
      fail(res, error);
    }
  },
);

export default router;
