import { Router } from "express";
import type { Request, Response } from "express";
import { requireRole } from "../auth-middleware";
import { storage } from "../storage";
import { roleSatisfies } from "../auth-roles";
import * as store from "./store";
import { readMessageFilter } from "./query-params";
import { createAuthUrl, exchangeCode, revokeAccess } from "./gmail-client";
import { signState, verifyState, InvalidStateError } from "./oauth-state";
import { runSync, isSyncRunning } from "./sync-service";

const router = Router();

function userId(req: Request): number {
  return (req as any).currentUser?.id;
}

function fail(res: Response, error: unknown, fallback = "İşlem başarısız") {
  const message = error instanceof Error ? error.message : fallback;
  console.error("[email-inbox] API hatası:", message);
  return res.status(500).json({ message });
}

// --- Bağlantı durumu ---------------------------------------------------------

router.get("/account", requireRole("admin"), async (_req, res) => {
  try {
    const row = await store.getAccountRow();
    if (!row || row.status === "disconnected") {
      return res.json({ connected: false });
    }
    return res.json({
      connected: row.status === "connected",
      emailAddress: row.emailAddress,
      status: row.status,
      lastSyncedAt: row.lastSyncedAt,
      lastError: row.lastError,
      syncing: isSyncRunning(),
    });
  } catch (error) {
    return fail(res, error);
  }
});

router.get("/google/auth-url", requireRole("admin"), async (req, res) => {
  try {
    return res.json({ url: createAuthUrl(signState(userId(req))) });
  } catch (error) {
    return fail(res, error, "Google OAuth ayarları eksik");
  }
});

/**
 * Tarayıcı Google'dan buraya döner; Authorization başlığı taşıyamaz.
 * Koruma: imzalı state + kullanıcının rolünün DB'den yeniden doğrulanması.
 */
router.get("/google/callback", async (req, res) => {
  const redirect = (params: string) => res.redirect(`/settings?${params}`);
  try {
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const state = typeof req.query.state === "string" ? req.query.state : "";
    if (!code) return redirect("mail=error&reason=no_code");

    const { userId: actingUserId } = verifyState(state);
    const user = await storage.getUserById(actingUserId);
    if (!user || !roleSatisfies(user.role, ["admin"])) {
      return redirect("mail=error&reason=forbidden");
    }

    const tokens = await exchangeCode(code);
    await store.saveAccount({ userId: actingUserId, ...tokens });
    return redirect("mail=connected");
  } catch (error) {
    if (error instanceof InvalidStateError) return redirect("mail=error&reason=state");
    console.error("[email-inbox] OAuth callback hatası:", error);
    return redirect("mail=error&reason=exchange");
  }
});

router.delete("/account", requireRole("admin"), async (_req, res) => {
  try {
    const account = await store.getAccount();
    if (!account) return res.json({ ok: true });
    try {
      await revokeAccess(account.refreshToken);
    } catch (error) {
      console.warn("[email-inbox] Google token iptali başarısız, yerel kayıt yine de siliniyor:", error);
    }
    await store.disconnectAccount(account.id);
    return res.json({ ok: true });
  } catch (error) {
    return fail(res, error);
  }
});

// --- Takip edilen gönderenler ------------------------------------------------

router.get("/senders", requireRole("admin"), async (_req, res) => {
  try {
    return res.json(await store.listSenders());
  } catch (error) {
    return fail(res, error);
  }
});

router.post("/senders", requireRole("admin"), async (req, res) => {
  try {
    const pattern = String(req.body?.pattern ?? "");
    if (!store.isValidSenderPattern(pattern)) {
      return res.status(400).json({
        message: "Geçerli bir mail adresi (ornek@firma.com) veya alan adı (@firma.com) girin",
      });
    }
    const created = await store.addSender({
      pattern,
      label: typeof req.body?.label === "string" ? req.body.label : undefined,
      createdBy: userId(req),
    });
    return res.status(201).json(created);
  } catch (error) {
    if (error instanceof Error && /duplicate key/i.test(error.message)) {
      return res.status(409).json({ message: "Bu gönderen zaten listede" });
    }
    return fail(res, error);
  }
});

router.patch("/senders/:id", requireRole("admin"), async (req, res) => {
  try {
    const patch: { label?: string; active?: boolean } = {};
    if (typeof req.body?.label === "string") patch.label = req.body.label;
    if (typeof req.body?.active === "boolean") patch.active = req.body.active;
    await store.updateSender(Number(req.params.id), patch);
    return res.json({ ok: true });
  } catch (error) {
    return fail(res, error);
  }
});

router.delete("/senders/:id", requireRole("admin"), async (req, res) => {
  try {
    await store.removeSender(Number(req.params.id));
    return res.json({ ok: true });
  } catch (error) {
    return fail(res, error);
  }
});

// --- Mailler -----------------------------------------------------------------

router.get("/messages", requireRole("admin"), async (req, res) => {
  try {
    return res.json(await store.listMessages(readMessageFilter(req.query as any)));
  } catch (error) {
    return fail(res, error);
  }
});

router.get("/messages/:id", requireRole("admin"), async (req, res) => {
  try {
    const message = await store.getMessage(Number(req.params.id));
    if (!message) return res.status(404).json({ message: "Mail bulunamadı" });
    return res.json(message);
  } catch (error) {
    return fail(res, error);
  }
});

router.patch("/messages/:id", requireRole("admin"), async (req, res) => {
  try {
    const patch: Parameters<typeof store.updateMessage>[1] = {};

    if (req.body?.status !== undefined) {
      if (!["new", "read", "done"].includes(req.body.status)) {
        return res.status(400).json({ message: "Geçersiz durum" });
      }
      patch.status = req.body.status;
    }
    if (req.body?.procedureId !== undefined) {
      const value = req.body.procedureId;
      if (value !== null && !Number.isInteger(value)) {
        return res.status(400).json({ message: "Geçersiz prosedür" });
      }
      patch.procedureId = value;
    }
    if (Array.isArray(req.body?.actionItems)) {
      patch.actionItems = req.body.actionItems.map((item: any) => ({
        id: String(item?.id ?? ""),
        text: String(item?.text ?? ""),
        done: Boolean(item?.done),
      }));
    }

    await store.updateMessage(Number(req.params.id), patch);
    return res.json({ ok: true });
  } catch (error) {
    return fail(res, error);
  }
});

router.post("/messages/:id/reprocess", requireRole("admin"), async (req, res) => {
  try {
    await store.resetForReprocess(Number(req.params.id));
    const result = await runSync();
    return res.json(result);
  } catch (error) {
    return fail(res, error);
  }
});

// --- Manuel senkron ----------------------------------------------------------

router.post("/sync", requireRole("admin"), async (_req, res) => {
  try {
    const result = await runSync();
    if (result.skipped === "already-running") {
      return res.status(409).json({ message: "Senkron zaten çalışıyor", ...result });
    }
    return res.json(result);
  } catch (error) {
    return fail(res, error);
  }
});

export default router;
