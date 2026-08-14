# Prosedürler Arası Mahsuplaşma — Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazla ödemeli prosedürlerden borçlu prosedürlere para aktarımı — elle ve tek tuşla otomatik, geri alınabilir.

**Architecture:** Aktarım, `payment_distributions` tablosuna aynı `incoming_payment_id` ile yazılan bir çift satırdır (kaynakta eksi, hedefte artı); künyesi yeni `payment_offsets` tablosunda durur. Hesap mantığı veritabanı bilmeyen saf bir motorda (`offset-engine.ts`), veritabanı işleri ayrı bir serviste (`offset-service.ts`), HTTP uçları `routes.ts` monolitine dokunmadan ayrı bir router'da (`offsets-routes.ts`) yaşar.

**Tech Stack:** TypeScript, Express, Drizzle ORM (neon-serverless), PostgreSQL (Neon), React + wouter + TanStack Query, shadcn/ui, react-i18next, vitest.

**Spec:** [2026-08-06-payment-offset-design.md](../specs/2026-08-06-payment-offset-design.md)

## Global Constraints

- **Şema değişikliği yalnızca `db/manual-ddl/NNN_*.sql` ile.** `npm run db:push` / `drizzle-kit push` **kesinlikle çalıştırılmaz** (mevcut şema sürüklenmesi var: status kolonları gerçek PG enum'ları, `schema.ts` onları `text` sanıyor). DDL idempotent olmalı.
- **`npm run check` (tsc) bu depoda zaten ~1450 hatayla kırmızı**; hepsi bozuk `server/pdf-data-transformer.ts` dosyasından geliyor. Tip doğrulaması için bu dosyanın hataları yok sayılır; **yeni yazılan dosyalarda sıfır hata** beklenir.
- **Yerel sunucu:** `npm run dev` Windows'ta çalışmaz. Kullan: `node --env-file=.env --import tsx server/index.ts` (port 5000 sabit).
- **Yerel `.env` CANLI veritabanına bakar** (Neon, 185 gerçek prosedür). Hiçbir adımda canlı veriye yazma yapılmaz; okuma serbesttir. Yazan testler yalnızca `TEST_DATABASE_URL` tanımlıysa çalışır.
- **Ön yüzdeki tüm yazma istekleri `apiRequest` ile gider** (`@/lib/queryClient`). Ham `fetch` ile POST/PUT/DELETE token taşımaz → 401.
- **GET uçlarına zorunlu auth eklenmez.** Ön yüz GET'leri token taşımıyor; zorlamak export/detay/dashboard akışlarını kırar. Yazan uçlar `requireRole('admin','accountant')` ile korunur.
- **Her kullanıcıya görünen metin i18n'den gelir.** `client/src/locales/tr.json` ve `en.json` aynı anahtar ağacına sahip olmalı; sabit metin yazılmaz. Doğrulama mesajları `validation.*` anahtarı olarak verilir (merkezî `FormMessage` deseni).
- **Para birimi tek:** TL. Kur dönüşümü yok.
- **Enum gerçekleri (canlı DB'den doğrulandı, 2026-08-06):** `incoming_payments.distribution_status` gerçek bir PG enum'dur, tip adı `distribution_status`, değerleri `pending_distribution` / `partially_distributed` / `fully_distributed` — SQL'de yazarken cast şart (`'fully_distributed'::distribution_status`). Buna karşılık `payment_distributions.payment_type` **`text`** kolonudur (aynı adlı bir enum tipi veritabanında var ama bu kolon onu kullanmıyor), dolayısıyla cast gerekmez.
- **Tolerans:** `1.00 TL` altındaki bakiyeler yok sayılır; kuruş karşılaştırmalarında `0.005` epsilon kullanılır.
- **Dal:** Tüm iş `feature/payment-offset` dalında. `main`'e push canlıya deploy tetikler — plan bitene ve kabul doğrulaması geçene kadar push edilmez.

---

## Dosya Yapısı

**Oluşturulacak:**

| Dosya | Sorumluluk |
|---|---|
| `db/manual-ddl/003_payment_offsets.sql` | `payment_offsets` tablosu + `payment_distributions.offset_id` kolonu |
| `server/offset-engine.ts` | Saf hesap: eşleştirme algoritması, LIFO kaynak tüketme planı, tolerans yardımcıları. DB bilmez. |
| `server/offset-engine.test.ts` | Motorun birim testleri |
| `server/offset-service.ts` | DB işleri: aday listesi, önizleme, uygulama (transaction), geri alma, geçmiş |
| `server/offset-service.test.ts` | Servis entegrasyon testleri (`TEST_DATABASE_URL` varsa) |
| `server/offsets-routes.ts` | Express router, 6 uç nokta |
| `client/src/pages/offsets.tsx` | Mahsuplaşma sayfası (Eşleştirme + Geçmiş sekmeleri) |
| `client/src/components/offset-preview-modal.tsx` | Otomatik eşleştirme önizleme penceresi |

**Değiştirilecek:**

| Dosya | Değişiklik |
|---|---|
| `shared/schema.ts:419` öncesi | `paymentOffsets` tablo tanımı; `paymentDistributions`'a `offsetId`; insert şeması ve tipler |
| `server/routes.ts:53` civarı + `:5298` civarı | Router import + `app.use("/api/offsets", offsetsRoutes)` |
| `client/src/App.tsx` | `/offsets` rotası |
| `client/src/lib/nav-items.ts` | Menü kaydı |
| `client/src/locales/tr.json`, `en.json` | `nav.offsets` + `offsets.*` ağacı |
| `client/src/pages/procedure-details.tsx:1863` | Fazla ödeme kutusuna kısayol bağlantısı |

---

### Task 1: Veritabanı temeli

**Files:**
- Create: `db/manual-ddl/003_payment_offsets.sql`
- Modify: `shared/schema.ts` (satır 419 öncesi ve `paymentDistributions` tanımı)

**Interfaces:**
- Consumes: —
- Produces: `paymentOffsets` tablosu (Drizzle), `PaymentOffset` / `InsertPaymentOffset` tipleri, `paymentDistributions.offsetId` kolonu

- [ ] **Step 1: DDL dosyasını yaz**

`db/manual-ddl/003_payment_offsets.sql`:

```sql
-- payment_offsets: künye tablosu. Bir prosedürdeki fazla ödemenin başka bir
-- prosedürün borcuna aktarılmasını kaydeder. Paranın kendisi
-- payment_distributions tablosunda bir çift satır olarak durur (kaynakta eksi,
-- hedefte artı, ikisi de aynı incoming_payment_id'ye bağlı); offset_id bu iki
-- satırı künyeye bağlar.
-- Applied as one-off DDL because `drizzle-kit push` is blocked by
-- pre-existing schema drift (see 000_*). Idempotent; safe to re-apply.
-- Source of truth for column shape: shared/schema.ts → paymentOffsets.

CREATE TABLE IF NOT EXISTS payment_offsets (
  id             SERIAL PRIMARY KEY,
  batch_id       TEXT NOT NULL,
  from_reference TEXT NOT NULL,
  to_reference   TEXT NOT NULL,
  amount         NUMERIC(15, 2) NOT NULL,
  offset_date    TIMESTAMP NOT NULL DEFAULT NOW(),
  mode           TEXT NOT NULL,
  notes          TEXT,
  created_by     INTEGER REFERENCES users(id),
  created_at     TIMESTAMP DEFAULT NOW(),
  reversed_at    TIMESTAMP,
  reversed_by    INTEGER REFERENCES users(id)
);

ALTER TABLE payment_distributions
  ADD COLUMN IF NOT EXISTS offset_id INTEGER REFERENCES payment_offsets(id);

CREATE INDEX IF NOT EXISTS idx_payment_offsets_batch
  ON payment_offsets (batch_id);
CREATE INDEX IF NOT EXISTS idx_payment_offsets_from
  ON payment_offsets (from_reference);
CREATE INDEX IF NOT EXISTS idx_payment_offsets_to
  ON payment_offsets (to_reference);
CREATE INDEX IF NOT EXISTS idx_payment_distributions_offset
  ON payment_distributions (offset_id);
```

- [ ] **Step 2: Drizzle tanımını ekle**

`shared/schema.ts` içinde, `// Payment Distributions table to link payments to procedures` yorumunun **hemen üstüne** ekle (sıra önemli: `paymentDistributions.offsetId` bu tabloya referans veriyor):

```ts
// Payment Offsets: ledger of transfers between procedures. The money itself
// lives as a pair of rows in paymentDistributions (minus on the source, plus
// on the target, both against the same incoming payment); offsetId links them
// back to this record.
export const paymentOffsets = pgTable("payment_offsets", {
  id: serial("id").primaryKey(),

  batchId: text("batch_id").notNull(),
  fromReference: text("from_reference").notNull(),
  toReference: text("to_reference").notNull(),
  amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
  offsetDate: timestamp("offset_date").notNull().defaultNow(),
  mode: text("mode").notNull(), // 'auto' | 'manual'
  notes: text("notes"),

  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  reversedAt: timestamp("reversed_at"),
  reversedBy: integer("reversed_by").references(() => users.id),
});
```

`paymentDistributions` tanımının içine, `updatedAt` satırının hemen üstüne ekle:

```ts
  // Set when this row is one half of an offset transfer (see paymentOffsets)
  offsetId: integer("offset_id").references(() => paymentOffsets.id),
```

- [ ] **Step 3: Insert şeması ve tipleri ekle**

`shared/schema.ts` içinde `export const insertPaymentDistributionSchema = ...` satırının hemen altına:

```ts
export const insertPaymentOffsetSchema = createInsertSchema(paymentOffsets).omit({
  id: true,
  createdAt: true,
  reversedAt: true,
  reversedBy: true
});
```

`export type PaymentDistribution = ...` satırının hemen altına:

```ts
export type InsertPaymentOffset = z.infer<typeof insertPaymentOffsetSchema>;
export type PaymentOffset = typeof paymentOffsets.$inferSelect;
```

- [ ] **Step 4: Tip kontrolü**

Run: `npx tsc --noEmit shared/schema.ts --skipLibCheck --esModuleInterop --moduleResolution bundler --module esnext --target es2022 2>&1 | head -20`

Expected: `shared/schema.ts` kaynaklı hata yok. (Depo genelindeki `npm run check` çıktısı `pdf-data-transformer.ts` yüzünden zaten kırmızı — ona bakma.)

- [ ] **Step 5: Commit**

```bash
git add db/manual-ddl/003_payment_offsets.sql shared/schema.ts
git commit -m "feat(offsets): add payment_offsets table and distribution link"
```

---

### Task 2: Eşleştirme motoru

**Files:**
- Create: `server/offset-engine.ts`
- Test: `server/offset-engine.test.ts`

**Interfaces:**
- Consumes: —
- Produces:
  - `OFFSET_TOLERANCE: number` (1), `CENT_EPSILON: number` (0.005)
  - `interface OffsetParty { reference: string; amount: number }`
  - `interface OffsetMove { fromReference: string; toReference: string; amount: number }`
  - `interface MatchResult { moves: OffsetMove[]; closedDebts: string[]; unmatchedDebts: string[]; usedAmount: number; remainingOverpayment: number }`
  - `matchOffsets(overpayments: OffsetParty[], debts: OffsetParty[]): MatchResult`
  - `round2(value: number): number`

- [ ] **Step 1: Testleri yaz**

`server/offset-engine.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { matchOffsets, round2, OFFSET_TOLERANCE } from "./offset-engine";

describe("matchOffsets", () => {
  it("closes every debt when the overpayment covers all of them", () => {
    const result = matchOffsets(
      [{ reference: "A", amount: 100 }],
      [{ reference: "X", amount: 30 }, { reference: "Y", amount: 20 }],
    );

    expect(result.closedDebts.sort()).toEqual(["X", "Y"]);
    expect(result.unmatchedDebts).toEqual([]);
    expect(result.usedAmount).toBe(50);
    expect(result.remainingOverpayment).toBe(50);
  });

  it("prefers closing the largest number of debts in full", () => {
    // 40 available. Smallest-first closes X(12) and Y(25) = 2 debts.
    const result = matchOffsets(
      [{ reference: "A", amount: 40 }],
      [
        { reference: "Z", amount: 30 },
        { reference: "Y", amount: 25 },
        { reference: "X", amount: 12 },
      ],
    );

    expect(result.closedDebts.sort()).toEqual(["X", "Y"]);
    expect(result.unmatchedDebts).toEqual(["Z"]);
    expect(result.usedAmount).toBe(37);
    expect(result.remainingOverpayment).toBe(3);
  });

  it("never partially pays a debt it cannot close", () => {
    const result = matchOffsets(
      [{ reference: "A", amount: 10 }],
      [{ reference: "X", amount: 500 }],
    );

    expect(result.moves).toEqual([]);
    expect(result.closedDebts).toEqual([]);
    expect(result.unmatchedDebts).toEqual(["X"]);
    expect(result.remainingOverpayment).toBe(10);
  });

  it("feeds one debt from several sources", () => {
    const result = matchOffsets(
      [{ reference: "A", amount: 60 }, { reference: "B", amount: 40 }],
      [{ reference: "X", amount: 100 }],
    );

    expect(result.closedDebts).toEqual(["X"]);
    expect(result.moves).toHaveLength(2);
    expect(result.moves.map((m) => m.fromReference).sort()).toEqual(["A", "B"]);
    expect(round2(result.moves.reduce((s, m) => s + m.amount, 0))).toBe(100);
  });

  it("drains the biggest source first so small sources survive", () => {
    const result = matchOffsets(
      [{ reference: "SMALL", amount: 5 }, { reference: "BIG", amount: 95 }],
      [{ reference: "X", amount: 90 }],
    );

    expect(result.moves).toEqual([
      { fromReference: "BIG", toReference: "X", amount: 90 },
    ]);
  });

  it("ignores parties at or below the 1 TL tolerance", () => {
    const result = matchOffsets(
      [{ reference: "A", amount: 0.5 }, { reference: "B", amount: 100 }],
      [{ reference: "X", amount: 0.9 }, { reference: "Y", amount: 40 }],
    );

    expect(result.moves.map((m) => m.fromReference)).toEqual(["B"]);
    expect(result.closedDebts).toEqual(["Y"]);
    expect(result.unmatchedDebts).toEqual([]);
    expect(OFFSET_TOLERANCE).toBe(1);
  });

  it("handles kurus amounts without leaving rounding dust", () => {
    const result = matchOffsets(
      [{ reference: "A", amount: 214006.91 }],
      [{ reference: "X", amount: 66896.97 }, { reference: "Y", amount: 147109.94 }],
    );

    expect(result.closedDebts.sort()).toEqual(["X", "Y"]);
    expect(result.usedAmount).toBe(214006.91);
    expect(result.remainingOverpayment).toBe(0);
  });

  it("closes an exact match with nothing left over", () => {
    const result = matchOffsets(
      [{ reference: "A", amount: 50 }],
      [{ reference: "X", amount: 50 }],
    );

    expect(result.moves).toEqual([
      { fromReference: "A", toReference: "X", amount: 50 },
    ]);
    expect(result.remainingOverpayment).toBe(0);
  });

  it("returns an empty result for empty input", () => {
    const result = matchOffsets([], []);

    expect(result.moves).toEqual([]);
    expect(result.closedDebts).toEqual([]);
    expect(result.unmatchedDebts).toEqual([]);
    expect(result.usedAmount).toBe(0);
    expect(result.remainingOverpayment).toBe(0);
  });

  it("does not mutate its input arrays", () => {
    const overpayments = [{ reference: "A", amount: 100 }];
    const debts = [{ reference: "X", amount: 30 }];
    matchOffsets(overpayments, debts);

    expect(overpayments).toEqual([{ reference: "A", amount: 100 }]);
    expect(debts).toEqual([{ reference: "X", amount: 30 }]);
  });
});

describe("round2", () => {
  it("rounds to two decimals", () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(66896.974)).toBe(66896.97);
    expect(round2(0.1 + 0.2)).toBe(0.3);
  });
});
```

- [ ] **Step 2: Testin başarısız olduğunu doğrula**

Run: `npx vitest run server/offset-engine.test.ts`
Expected: FAIL — `Failed to resolve import "./offset-engine"`

- [ ] **Step 3: Motoru yaz**

`server/offset-engine.ts`:

```ts
/**
 * Pure matching engine for cross-procedure payment offsetting.
 * Knows nothing about the database — give it balances, it gives back moves.
 */

/** Balances at or below this (in TL) are noise and never take part. */
export const OFFSET_TOLERANCE = 1;

/** Comparison epsilon for kurus-level arithmetic. */
export const CENT_EPSILON = 0.005;

export interface OffsetParty {
  reference: string;
  /** Always positive: how much this procedure has spare, or how much it owes. */
  amount: number;
}

export interface OffsetMove {
  fromReference: string;
  toReference: string;
  amount: number;
}

export interface MatchResult {
  moves: OffsetMove[];
  /** Debts that end up fully closed by this plan. */
  closedDebts: string[];
  /** Debts left untouched because no combination could close them in full. */
  unmatchedDebts: string[];
  usedAmount: number;
  remainingOverpayment: number;
}

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Spend the available overpayments so that as many debts as possible are
 * closed *in full*. Debts are considered smallest-first — that is what
 * maximises the count. A debt that cannot be closed completely is skipped
 * entirely; automatic mode never leaves a half-paid procedure behind.
 */
export function matchOffsets(
  overpayments: OffsetParty[],
  debts: OffsetParty[],
): MatchResult {
  const sources = overpayments
    .filter((o) => o.amount > OFFSET_TOLERANCE)
    .map((o) => ({ reference: o.reference, left: o.amount }))
    .sort((a, b) => b.left - a.left || a.reference.localeCompare(b.reference));

  const targets = debts
    .filter((d) => d.amount > OFFSET_TOLERANCE)
    .map((d) => ({ reference: d.reference, left: d.amount }))
    .sort((a, b) => a.left - b.left || a.reference.localeCompare(b.reference));

  const moves: OffsetMove[] = [];
  const closedDebts: string[] = [];
  const unmatchedDebts: string[] = [];

  for (const target of targets) {
    const available = sources.reduce((sum, s) => sum + s.left, 0);
    if (available + CENT_EPSILON < target.left) {
      unmatchedDebts.push(target.reference);
      continue;
    }

    for (const source of sources) {
      if (target.left <= CENT_EPSILON) break;
      if (source.left <= CENT_EPSILON) continue;

      const amount = round2(Math.min(source.left, target.left));
      source.left = round2(source.left - amount);
      target.left = round2(target.left - amount);
      moves.push({
        fromReference: source.reference,
        toReference: target.reference,
        amount,
      });
    }

    closedDebts.push(target.reference);
  }

  const usedAmount = round2(moves.reduce((sum, m) => sum + m.amount, 0));
  const remainingOverpayment = round2(
    sources.reduce((sum, s) => sum + s.left, 0),
  );

  return { moves, closedDebts, unmatchedDebts, usedAmount, remainingOverpayment };
}
```

- [ ] **Step 4: Testlerin geçtiğini doğrula**

Run: `npx vitest run server/offset-engine.test.ts`
Expected: PASS — 11 test

- [ ] **Step 5: Commit**

```bash
git add server/offset-engine.ts server/offset-engine.test.ts
git commit -m "feat(offsets): pure matching engine that maximises fully closed debts"
```

---

### Task 3: LIFO kaynak tüketme planı

**Files:**
- Modify: `server/offset-engine.ts`
- Modify: `server/offset-engine.test.ts`

**Interfaces:**
- Consumes: Task 2'nin `round2`, `CENT_EPSILON`
- Produces:
  - `interface SourceBucket { incomingPaymentId: number; paymentType: "advance" | "balance"; available: number; lastDate: Date; lastId: number }`
  - `interface ConsumptionSlice { incomingPaymentId: number; paymentType: "advance" | "balance"; amount: number }`
  - `planSourceConsumption(buckets: SourceBucket[], amount: number): ConsumptionSlice[]`
  - `class InsufficientSourceError extends Error`

- [ ] **Step 1: Testleri yaz**

`server/offset-engine.test.ts` dosyasının **sonuna** ekle:

```ts
import {
  planSourceConsumption,
  InsufficientSourceError,
  type SourceBucket,
} from "./offset-engine";

const bucket = (
  id: number,
  available: number,
  isoDate: string,
  paymentType: "advance" | "balance" = "balance",
): SourceBucket => ({
  incomingPaymentId: id,
  paymentType,
  available,
  lastDate: new Date(isoDate),
  lastId: id,
});

describe("planSourceConsumption", () => {
  it("takes everything from the newest bucket when it is big enough", () => {
    const slices = planSourceConsumption(
      [bucket(1, 500, "2026-01-10"), bucket(2, 800, "2026-05-20")],
      300,
    );

    expect(slices).toEqual([
      { incomingPaymentId: 2, paymentType: "balance", amount: 300 },
    ]);
  });

  it("walks backwards through buckets when one is not enough", () => {
    const slices = planSourceConsumption(
      [bucket(1, 500, "2026-01-10"), bucket(2, 200, "2026-05-20")],
      600,
    );

    expect(slices).toEqual([
      { incomingPaymentId: 2, paymentType: "balance", amount: 200 },
      { incomingPaymentId: 1, paymentType: "balance", amount: 400 },
    ]);
  });

  it("keeps each bucket's payment type", () => {
    const slices = planSourceConsumption(
      [bucket(1, 100, "2026-01-10", "advance"), bucket(2, 50, "2026-05-20", "balance")],
      120,
    );

    expect(slices).toEqual([
      { incomingPaymentId: 2, paymentType: "balance", amount: 50 },
      { incomingPaymentId: 1, paymentType: "advance", amount: 70 },
    ]);
  });

  it("breaks ties on id, newest first", () => {
    const slices = planSourceConsumption(
      [bucket(7, 10, "2026-03-01"), bucket(9, 10, "2026-03-01")],
      15,
    );

    expect(slices.map((s) => s.incomingPaymentId)).toEqual([9, 7]);
  });

  it("throws when the buckets cannot cover the amount", () => {
    expect(() =>
      planSourceConsumption([bucket(1, 100, "2026-01-10")], 150),
    ).toThrow(InsufficientSourceError);
  });

  it("tolerates kurus shortfall inside the epsilon", () => {
    const slices = planSourceConsumption([bucket(1, 99.999, "2026-01-10")], 100);

    expect(slices).toHaveLength(1);
    expect(slices[0].amount).toBe(100);
  });

  it("skips exhausted buckets", () => {
    const slices = planSourceConsumption(
      [bucket(1, 0, "2026-06-01"), bucket(2, 75, "2026-05-01")],
      75,
    );

    expect(slices).toEqual([
      { incomingPaymentId: 2, paymentType: "balance", amount: 75 },
    ]);
  });
});
```

- [ ] **Step 2: Testin başarısız olduğunu doğrula**

Run: `npx vitest run server/offset-engine.test.ts`
Expected: FAIL — `planSourceConsumption is not exported` / `is not a function`

- [ ] **Step 3: Uygula**

`server/offset-engine.ts` dosyasının sonuna ekle:

```ts
/** One incoming payment's net usable amount inside a single procedure. */
export interface SourceBucket {
  incomingPaymentId: number;
  paymentType: "advance" | "balance";
  /** Net positive amount still attributable to this payment on this procedure. */
  available: number;
  lastDate: Date;
  lastId: number;
}

export interface ConsumptionSlice {
  incomingPaymentId: number;
  paymentType: "advance" | "balance";
  amount: number;
}

export class InsufficientSourceError extends Error {
  constructor(requested: number, available: number) {
    super(
      `Offset of ${requested.toFixed(2)} exceeds the available ${available.toFixed(2)}`,
    );
    this.name = "InsufficientSourceError";
  }
}

/**
 * Decide which incoming payments a transfer is drawn from, newest money first
 * (LIFO). A transfer that does not fit in one bucket is split across several —
 * each slice becomes its own pair of distribution rows.
 */
export function planSourceConsumption(
  buckets: SourceBucket[],
  amount: number,
): ConsumptionSlice[] {
  const total = buckets.reduce((sum, b) => sum + b.available, 0);
  if (total + CENT_EPSILON < amount) {
    throw new InsufficientSourceError(amount, total);
  }

  const ordered = [...buckets].sort(
    (a, b) => b.lastDate.getTime() - a.lastDate.getTime() || b.lastId - a.lastId,
  );

  const slices: ConsumptionSlice[] = [];
  let left = amount;

  for (const b of ordered) {
    if (left <= CENT_EPSILON) break;
    if (b.available <= CENT_EPSILON) continue;

    const take = round2(Math.min(b.available, left));
    left = round2(left - take);
    slices.push({
      incomingPaymentId: b.incomingPaymentId,
      paymentType: b.paymentType,
      amount: take,
    });
  }

  // Absorb sub-kurus shortfall into the last slice so the pair sums exactly.
  if (left > 0 && slices.length > 0) {
    const last = slices[slices.length - 1];
    last.amount = round2(last.amount + left);
  }

  return slices;
}
```

- [ ] **Step 4: Testlerin geçtiğini doğrula**

Run: `npx vitest run server/offset-engine.test.ts`
Expected: PASS — 18 test

- [ ] **Step 5: Commit**

```bash
git add server/offset-engine.ts server/offset-engine.test.ts
git commit -m "feat(offsets): plan which incoming payments a transfer draws from"
```

---

### Task 4: Aday listesi (tek SQL)

**Files:**
- Create: `server/offset-service.ts`

**Interfaces:**
- Consumes: `OFFSET_TOLERANCE`, `round2` (Task 2)
- Produces:
  - `interface OffsetCandidate { reference: string; shipper: string | null; paymentStatus: string | null; balance: number }`
  - `interface CandidateFilter { shipper?: string; includeClosed?: boolean }`
  - `interface CandidateResult { overpayments: OffsetCandidate[]; debts: OffsetCandidate[]; totalOverpayment: number; totalDebt: number; uncosted: { count: number; amount: number } }`
  - `getOffsetCandidates(filter?: CandidateFilter): Promise<CandidateResult>`
  - `PROCEDURE_BALANCE_SQL: string` (tek prosedür sorgularında da kullanılır)

- [ ] **Step 1: Servisi yaz**

`server/offset-service.ts`:

```ts
import { rawDb } from "./db";
import { OFFSET_TOLERANCE, round2 } from "./offset-engine";

export interface OffsetCandidate {
  reference: string;
  shipper: string | null;
  paymentStatus: string | null;
  /** Positive = owes money, negative = overpaid. */
  balance: number;
}

export interface CandidateFilter {
  shipper?: string;
  /** Closed procedures take part by default (product decision, 2026-08-06). */
  includeClosed?: boolean;
}

export interface CandidateResult {
  overpayments: OffsetCandidate[];
  debts: OffsetCandidate[];
  totalOverpayment: number;
  totalDebt: number;
}

/**
 * Every procedure's balance in one query.
 *
 * Mirrors storage.calculateFinancialSummary (server/storage.ts:2253):
 *   balance = expenses + service invoices + taxes - payments - distributions
 * That function issues ~5 queries per procedure; at 185 procedures it would
 * blow past the 60s proxy_read_timeout in front of the app.
 */
export const PROCEDURE_BALANCE_SQL = `
  WITH exp AS (
    SELECT procedure_reference AS ref, SUM(amount::numeric) AS v
    FROM import_expenses GROUP BY 1
  ), svc AS (
    SELECT procedure_reference AS ref, SUM(amount::numeric) AS v
    FROM import_service_invoices GROUP BY 1
  ), tx AS (
    SELECT procedure_reference AS ref,
           SUM(COALESCE(customs_tax::numeric, 0)
             + COALESCE(additional_customs_tax::numeric, 0)
             + COALESCE(kkdf::numeric, 0)
             + COALESCE(vat::numeric, 0)
             + COALESCE(stamp_tax::numeric, 0)) AS v
    FROM taxes GROUP BY 1
  ), pay AS (
    SELECT procedure_reference AS ref, SUM(amount::numeric) AS v
    FROM payments GROUP BY 1
  ), dist AS (
    SELECT procedure_reference AS ref, SUM(distributed_amount::numeric) AS v
    FROM payment_distributions GROUP BY 1
  )
  SELECT p.reference,
         p.shipper,
         p.payment_status::text AS payment_status,
         ROUND(
           (COALESCE(exp.v, 0) + COALESCE(svc.v, 0) + COALESCE(tx.v, 0))
           - (COALESCE(pay.v, 0) + COALESCE(dist.v, 0)), 2
         ) AS balance
  FROM procedures p
  LEFT JOIN exp  ON exp.ref  = p.reference
  LEFT JOIN svc  ON svc.ref  = p.reference
  LEFT JOIN tx   ON tx.ref   = p.reference
  LEFT JOIN pay  ON pay.ref  = p.reference
  LEFT JOIN dist ON dist.ref = p.reference
`;

export async function getOffsetCandidates(
  filter: CandidateFilter = {},
): Promise<CandidateResult> {
  const { rows } = await rawDb.query(PROCEDURE_BALANCE_SQL);

  const candidates: OffsetCandidate[] = rows
    .map((r: any) => ({
      reference: r.reference as string,
      shipper: (r.shipper ?? null) as string | null,
      paymentStatus: (r.payment_status ?? null) as string | null,
      balance: round2(Number(r.balance ?? 0)),
    }))
    .filter((c) => (filter.shipper ? c.shipper === filter.shipper : true))
    .filter((c) =>
      filter.includeClosed === false ? c.paymentStatus !== "closed" : true,
    );

  const overpayments = candidates
    .filter((c) => -c.balance > OFFSET_TOLERANCE)
    .sort((a, b) => a.balance - b.balance);

  const debts = candidates
    .filter((c) => c.balance > OFFSET_TOLERANCE)
    .sort((a, b) => b.balance - a.balance);

  return {
    overpayments,
    debts,
    totalOverpayment: round2(
      overpayments.reduce((sum, c) => sum + Math.abs(c.balance), 0),
    ),
    totalDebt: round2(debts.reduce((sum, c) => sum + c.balance, 0)),
  };
}
```

- [ ] **Step 2: Canlı veriye karşı salt-okunur doğrula**

Geçici bir betikle çalıştır (`scripts/tmp-verify-candidates.mjs` yerine tsx kullan):

```bash
node --env-file=.env --import tsx -e "
import { getOffsetCandidates } from './server/offset-service.ts';
const r = await getOffsetCandidates();
console.log('overpayments:', r.overpayments.length, r.totalOverpayment);
console.log('debts:', r.debts.length, r.totalDebt);
process.exit(0);
"
```

Expected (canlı veri 2026-08-06 ölçümü ile):
```
overpayments: 13 1254083.29
debts: 15 5098800.34
```
Sayılar tutmuyorsa canlı veri değişmiş olabilir — devam etmeden önce fark araştırılır, SQL körlemesine düzeltilmez.

- [ ] **Step 3: Filtrelerin çalıştığını doğrula**

```bash
node --env-file=.env --import tsx -e "
import { getOffsetCandidates } from './server/offset-service.ts';
const all = await getOffsetCandidates();
const alo = await getOffsetCandidates({ shipper: 'ALO, LLC' });
const open = await getOffsetCandidates({ includeClosed: false });
console.log('all/alo/open overpayments:', all.overpayments.length, alo.overpayments.length, open.overpayments.length);
process.exit(0);
"
```

Expected: `alo` ve `open` sayıları `all`'dan küçük veya eşit; hata yok.

- [ ] **Step 4: Commit**

```bash
git add server/offset-service.ts
git commit -m "feat(offsets): list overpaid and indebted procedures in one query"
```

---

### Task 5: Aktarımı uygula (transaction)

**Files:**
- Modify: `server/offset-service.ts`
- Test: `server/offset-service.test.ts`

**Interfaces:**
- Consumes: `matchOffsets`, `planSourceConsumption`, `round2`, `CENT_EPSILON`, `InsufficientSourceError` (Task 2-3); `getOffsetCandidates`, `PROCEDURE_BALANCE_SQL` (Task 4)
- Produces:
  - `interface OffsetPlan { moves: OffsetMove[]; closedDebts: string[]; unmatchedDebts: string[]; usedAmount: number; remainingOverpayment: number }`
  - `previewOffsets(filter?: CandidateFilter): Promise<OffsetPlan>`
  - `applyOffsets(moves: OffsetMove[], userId: number, mode: "auto" | "manual"): Promise<{ batchId: string; offsetIds: number[]; applied: number }>`
  - `class OffsetValidationError extends Error`

- [ ] **Step 1: Önizleme ve uygulama kodunu yaz**

`server/offset-service.ts`: önce dosyanın **başındaki** import bloğunu genişlet — Task 4'te yazılan `import { OFFSET_TOLERANCE, round2 } from "./offset-engine";` satırını aşağıdakiyle değiştir ve diğer import'ları onun yanına ekle (aynı modülden ikinci bir import satırı açma):

```ts
import { randomUUID } from "crypto";
import { rawDb, db } from "./db";
import { paymentOffsets, paymentDistributions } from "@shared/schema";
import { eq, sql as drizzleSql } from "drizzle-orm";
import {
  OFFSET_TOLERANCE,
  round2,
  matchOffsets,
  planSourceConsumption,
  CENT_EPSILON,
  type OffsetMove,
  type SourceBucket,
} from "./offset-engine";
```

(Task 4'teki `import { rawDb } from "./db";` satırı yukarıdaki `rawDb, db` satırıyla birleştiği için silinir.)

Ardından dosyanın sonuna ekle:

```ts

export interface OffsetPlan {
  moves: OffsetMove[];
  closedDebts: string[];
  unmatchedDebts: string[];
  usedAmount: number;
  remainingOverpayment: number;
}

export class OffsetValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OffsetValidationError";
  }
}

/** Runs the engine over current balances. Writes nothing. */
export async function previewOffsets(
  filter: CandidateFilter = {},
): Promise<OffsetPlan> {
  const { overpayments, debts } = await getOffsetCandidates(filter);

  return matchOffsets(
    overpayments.map((c) => ({ reference: c.reference, amount: -c.balance })),
    debts.map((c) => ({ reference: c.reference, amount: c.balance })),
  );
}

/**
 * Net usable amount per incoming payment for one procedure. Offset rows are
 * negative, so summing per payment already nets out earlier transfers.
 */
async function readSourceBuckets(
  executor: { execute: (q: any) => Promise<any> },
  reference: string,
): Promise<SourceBucket[]> {
  const result = await executor.execute(drizzleSql`
    SELECT incoming_payment_id,
           payment_type::text AS payment_type,
           SUM(distributed_amount::numeric) AS net_amount,
           MAX(distribution_date) AS last_date,
           MAX(id) AS last_id
    FROM payment_distributions
    WHERE procedure_reference = ${reference}
    GROUP BY incoming_payment_id, payment_type
    HAVING SUM(distributed_amount::numeric) > 0
  `);

  const rows = (result.rows ?? result) as any[];
  return rows.map((r) => ({
    incomingPaymentId: Number(r.incoming_payment_id),
    paymentType: r.payment_type === "advance" ? "advance" : "balance",
    available: round2(Number(r.net_amount)),
    lastDate: new Date(r.last_date),
    lastId: Number(r.last_id),
  }));
}

async function readBalance(
  executor: { execute: (q: any) => Promise<any> },
  reference: string,
): Promise<number> {
  const result = await executor.execute(
    drizzleSql.raw(
      `${PROCEDURE_BALANCE_SQL} WHERE p.reference = '${reference.replace(/'/g, "''")}'`,
    ),
  );
  const rows = (result.rows ?? result) as any[];
  if (rows.length === 0) {
    throw new OffsetValidationError(`Procedure ${reference} not found`);
  }
  return round2(Number(rows[0].balance ?? 0));
}

/** Recompute an incoming payment's distributed/remaining/status fields. */
async function refreshIncomingPayment(
  executor: { execute: (q: any) => Promise<any> },
  incomingPaymentId: number,
): Promise<void> {
  await executor.execute(drizzleSql`
    UPDATE incoming_payments ip
    SET amount_distributed = agg.total,
        remaining_balance  = GREATEST(0, ip.total_amount::numeric - agg.total),
        distribution_status = CASE
          WHEN agg.total <= 0 THEN 'pending_distribution'::distribution_status
          WHEN ABS(ip.total_amount::numeric - agg.total) < 0.01
            THEN 'fully_distributed'::distribution_status
          ELSE 'partially_distributed'::distribution_status
        END,
        updated_at = NOW()
    FROM (
      SELECT COALESCE(SUM(distributed_amount::numeric), 0) AS total
      FROM payment_distributions
      WHERE incoming_payment_id = ${incomingPaymentId}
    ) agg
    WHERE ip.id = ${incomingPaymentId}
  `);
}

/**
 * Write the transfers. All or nothing: one transaction, balances re-checked
 * inside it, so a stale preview can never overdraw a source.
 */
export async function applyOffsets(
  moves: OffsetMove[],
  userId: number,
  mode: "auto" | "manual",
): Promise<{ batchId: string; offsetIds: number[]; applied: number }> {
  if (moves.length === 0) {
    throw new OffsetValidationError("No moves to apply");
  }

  const batchId = randomUUID();
  const offsetIds: number[] = [];

  await db.transaction(async (tx) => {
    // Aggregate per source so several moves from one procedure are validated
    // against its balance together, not one by one.
    const requestedBySource = new Map<string, number>();
    for (const move of moves) {
      if (move.amount <= 0) {
        throw new OffsetValidationError(
          `Transfer amount must be positive (${move.fromReference} → ${move.toReference})`,
        );
      }
      if (move.fromReference === move.toReference) {
        throw new OffsetValidationError(
          `Cannot offset ${move.fromReference} against itself`,
        );
      }
      requestedBySource.set(
        move.fromReference,
        round2((requestedBySource.get(move.fromReference) ?? 0) + move.amount),
      );
    }

    for (const [reference, requested] of requestedBySource) {
      const balance = await readBalance(tx as any, reference);
      const availableNow = round2(-balance);
      if (availableNow + CENT_EPSILON < requested) {
        throw new OffsetValidationError(
          `${reference} has ${availableNow.toFixed(2)} available but ${requested.toFixed(2)} was requested`,
        );
      }
    }

    const touchedPayments = new Set<number>();

    for (const move of moves) {
      const [offset] = await tx
        .insert(paymentOffsets)
        .values({
          batchId,
          fromReference: move.fromReference,
          toReference: move.toReference,
          amount: move.amount.toFixed(2),
          offsetDate: new Date(),
          mode,
          createdBy: userId,
        })
        .returning();

      offsetIds.push(offset.id);

      const buckets = await readSourceBuckets(tx as any, move.fromReference);
      const slices = planSourceConsumption(buckets, move.amount);

      for (const slice of slices) {
        await tx.insert(paymentDistributions).values({
          incomingPaymentId: slice.incomingPaymentId,
          procedureReference: move.fromReference,
          distributedAmount: (-slice.amount).toFixed(2),
          distributionDate: new Date(),
          paymentType: slice.paymentType,
          offsetId: offset.id,
          createdBy: userId,
        });

        await tx.insert(paymentDistributions).values({
          incomingPaymentId: slice.incomingPaymentId,
          procedureReference: move.toReference,
          distributedAmount: slice.amount.toFixed(2),
          distributionDate: new Date(),
          paymentType: "balance",
          offsetId: offset.id,
          createdBy: userId,
        });

        touchedPayments.add(slice.incomingPaymentId);
      }
    }

    for (const paymentId of touchedPayments) {
      await refreshIncomingPayment(tx as any, paymentId);
    }
  });

  return { batchId, offsetIds, applied: moves.length };
}
```

- [ ] **Step 2: Entegrasyon testlerini yaz**

`server/offset-service.test.ts`:

```ts
import { describe, it, expect } from "vitest";

/**
 * These touch a real database. The local .env points at the LIVE Neon
 * database, so they only run when a separate TEST_DATABASE_URL is provided.
 * Create one with a Neon branch, then:
 *   TEST_DATABASE_URL=... npx vitest run server/offset-service.test.ts
 */
const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);

describe.skipIf(!hasTestDb)("applyOffsets", () => {
  it("moves the balance from source to target", async () => {
    const { getOffsetCandidates, applyOffsets } = await import("./offset-service");
    const before = await getOffsetCandidates();
    const source = before.overpayments[0];
    const target = before.debts[0];
    const amount = Math.min(Math.abs(source.balance), target.balance);

    await applyOffsets(
      [{ fromReference: source.reference, toReference: target.reference, amount }],
      1,
      "manual",
    );

    const after = await getOffsetCandidates();
    const sourceAfter = after.overpayments.find((c) => c.reference === source.reference);
    const targetAfter = after.debts.find((c) => c.reference === target.reference);

    expect(Math.abs(sourceAfter?.balance ?? 0)).toBeCloseTo(
      Math.abs(source.balance) - amount, 2,
    );
    expect(targetAfter?.balance ?? 0).toBeCloseTo(target.balance - amount, 2);
  });

  it("leaves the incoming payment untouched", async () => {
    const { getOffsetCandidates, applyOffsets } = await import("./offset-service");
    const { rawDb } = await import("./db");

    const snapshot = async () =>
      (await rawDb.query(
        "SELECT id, total_amount, amount_distributed, remaining_balance, distribution_status::text FROM incoming_payments ORDER BY id",
      )).rows;

    const before = await snapshot();
    const candidates = await getOffsetCandidates();
    const source = candidates.overpayments[0];
    const target = candidates.debts[0];

    await applyOffsets(
      [{
        fromReference: source.reference,
        toReference: target.reference,
        amount: Math.min(Math.abs(source.balance), target.balance),
      }],
      1,
      "manual",
    );

    expect(await snapshot()).toEqual(before);
  });

  it("keeps the sum of all balances constant", async () => {
    const { getOffsetCandidates, applyOffsets } = await import("./offset-service");
    const total = async () => {
      const c = await getOffsetCandidates();
      return c.totalDebt - c.totalOverpayment;
    };

    const before = await total();
    const candidates = await getOffsetCandidates();
    const source = candidates.overpayments[0];
    const target = candidates.debts[0];

    await applyOffsets(
      [{
        fromReference: source.reference,
        toReference: target.reference,
        amount: Math.min(Math.abs(source.balance), target.balance),
      }],
      1,
      "manual",
    );

    expect(await total()).toBeCloseTo(before, 2);
  });

  it("refuses a transfer larger than the source's overpayment", async () => {
    const { getOffsetCandidates, applyOffsets, OffsetValidationError } =
      await import("./offset-service");
    const candidates = await getOffsetCandidates();
    const source = candidates.overpayments[0];
    const target = candidates.debts[0];

    await expect(
      applyOffsets(
        [{
          fromReference: source.reference,
          toReference: target.reference,
          amount: Math.abs(source.balance) + 1000,
        }],
        1,
        "manual",
      ),
    ).rejects.toBeInstanceOf(OffsetValidationError);
  });

  it("writes nothing when one move in a batch is invalid", async () => {
    const { getOffsetCandidates, applyOffsets } = await import("./offset-service");
    const { rawDb } = await import("./db");
    const countRows = async () =>
      Number((await rawDb.query("SELECT COUNT(*) AS c FROM payment_distributions")).rows[0].c);

    const before = await countRows();
    const candidates = await getOffsetCandidates();
    const source = candidates.overpayments[0];
    const target = candidates.debts[0];

    await expect(
      applyOffsets(
        [
          { fromReference: source.reference, toReference: target.reference, amount: 1 },
          { fromReference: source.reference, toReference: source.reference, amount: 1 },
        ],
        1,
        "manual",
      ),
    ).rejects.toThrow();

    expect(await countRows()).toBe(before);
  });
});
```

- [ ] **Step 3: Testleri çalıştır**

Run: `npx vitest run server/offset-service.test.ts`
Expected: `TEST_DATABASE_URL` yoksa 5 test **skipped**, hata yok. Varsa 5 test PASS.

`TEST_DATABASE_URL` yoksa Task 12'deki manuel doğrulama bu boşluğu kapatır — atlanan testler orada elle yürütülür.

- [ ] **Step 4: Motor testlerinin hâlâ geçtiğini doğrula**

Run: `npx vitest run`
Expected: `offset-engine.test.ts` 18 PASS; `offset-service.test.ts` skipped ya da PASS.

- [ ] **Step 5: Commit**

```bash
git add server/offset-service.ts server/offset-service.test.ts
git commit -m "feat(offsets): apply transfers atomically with balances re-checked"
```

---

### Task 6: Geri alma ve geçmiş

**Files:**
- Modify: `server/offset-service.ts`

**Interfaces:**
- Consumes: Task 5'in `refreshIncomingPayment`, `OffsetValidationError`
- Produces:
  - `interface OffsetHistoryEntry { id: number; batchId: string; fromReference: string; toReference: string; amount: number; offsetDate: Date; mode: string; createdBy: number | null; createdByName: string | null; reversedAt: Date | null }`
  - `getOffsetHistory(): Promise<OffsetHistoryEntry[]>`
  - `reverseOffset(offsetId: number, userId: number): Promise<void>`
  - `reverseBatch(batchId: string, userId: number): Promise<{ reversed: number }>`

- [ ] **Step 1: Uygula**

`server/offset-service.ts` sonuna ekle:

```ts
export interface OffsetHistoryEntry {
  id: number;
  batchId: string;
  fromReference: string;
  toReference: string;
  amount: number;
  offsetDate: Date;
  mode: string;
  createdBy: number | null;
  createdByName: string | null;
  reversedAt: Date | null;
}

export async function getOffsetHistory(): Promise<OffsetHistoryEntry[]> {
  const { rows } = await rawDb.query(`
    SELECT o.id, o.batch_id, o.from_reference, o.to_reference, o.amount,
           o.offset_date, o.mode, o.created_by, u.username AS created_by_name,
           o.reversed_at
    FROM payment_offsets o
    LEFT JOIN users u ON u.id = o.created_by
    ORDER BY o.offset_date DESC, o.id DESC
  `);

  return rows.map((r: any) => ({
    id: Number(r.id),
    batchId: r.batch_id as string,
    fromReference: r.from_reference as string,
    toReference: r.to_reference as string,
    amount: round2(Number(r.amount)),
    offsetDate: new Date(r.offset_date),
    mode: r.mode as string,
    createdBy: r.created_by === null ? null : Number(r.created_by),
    createdByName: (r.created_by_name ?? null) as string | null,
    reversedAt: r.reversed_at === null ? null : new Date(r.reversed_at),
  }));
}

/** Delete both halves of a transfer and mark the ledger entry reversed. */
export async function reverseOffset(
  offsetId: number,
  userId: number,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [offset] = await tx
      .select()
      .from(paymentOffsets)
      .where(eq(paymentOffsets.id, offsetId));

    if (!offset) {
      throw new OffsetValidationError(`Offset ${offsetId} not found`);
    }
    if (offset.reversedAt) {
      throw new OffsetValidationError(`Offset ${offsetId} is already reversed`);
    }

    const linked = await tx
      .select()
      .from(paymentDistributions)
      .where(eq(paymentDistributions.offsetId, offsetId));

    const touchedPayments = new Set(linked.map((d) => d.incomingPaymentId));

    await tx
      .delete(paymentDistributions)
      .where(eq(paymentDistributions.offsetId, offsetId));

    await tx
      .update(paymentOffsets)
      .set({ reversedAt: new Date(), reversedBy: userId })
      .where(eq(paymentOffsets.id, offsetId));

    for (const paymentId of touchedPayments) {
      await refreshIncomingPayment(tx as any, paymentId);
    }
  });
}

export async function reverseBatch(
  batchId: string,
  userId: number,
): Promise<{ reversed: number }> {
  const rows = await db
    .select()
    .from(paymentOffsets)
    .where(eq(paymentOffsets.batchId, batchId));

  const open = rows.filter((o) => !o.reversedAt);
  if (open.length === 0) {
    throw new OffsetValidationError(
      `Batch ${batchId} has nothing left to reverse`,
    );
  }

  for (const offset of open) {
    await reverseOffset(offset.id, userId);
  }

  return { reversed: open.length };
}
```

- [ ] **Step 2: Geri alma testlerini ekle**

`server/offset-service.test.ts` dosyasının sonuna ekle:

```ts
describe.skipIf(!hasTestDb)("reverseOffset", () => {
  it("restores both balances exactly", async () => {
    const { getOffsetCandidates, applyOffsets, reverseOffset } =
      await import("./offset-service");

    const before = await getOffsetCandidates();
    const source = before.overpayments[0];
    const target = before.debts[0];

    const { offsetIds } = await applyOffsets(
      [{
        fromReference: source.reference,
        toReference: target.reference,
        amount: Math.min(Math.abs(source.balance), target.balance),
      }],
      1,
      "manual",
    );

    await reverseOffset(offsetIds[0], 1);

    const after = await getOffsetCandidates();
    expect(
      after.overpayments.find((c) => c.reference === source.reference)?.balance,
    ).toBeCloseTo(source.balance, 2);
    expect(
      after.debts.find((c) => c.reference === target.reference)?.balance,
    ).toBeCloseTo(target.balance, 2);
  });

  it("refuses to reverse the same offset twice", async () => {
    const { getOffsetCandidates, applyOffsets, reverseOffset, OffsetValidationError } =
      await import("./offset-service");

    const candidates = await getOffsetCandidates();
    const { offsetIds } = await applyOffsets(
      [{
        fromReference: candidates.overpayments[0].reference,
        toReference: candidates.debts[0].reference,
        amount: 1,
      }],
      1,
      "manual",
    );

    await reverseOffset(offsetIds[0], 1);
    await expect(reverseOffset(offsetIds[0], 1)).rejects.toBeInstanceOf(
      OffsetValidationError,
    );
  });

  it("reverses a whole batch at once", async () => {
    const { getOffsetCandidates, applyOffsets, reverseBatch, getOffsetHistory } =
      await import("./offset-service");

    const candidates = await getOffsetCandidates();
    const source = candidates.overpayments[0];
    const { batchId } = await applyOffsets(
      [
        { fromReference: source.reference, toReference: candidates.debts[0].reference, amount: 1 },
        { fromReference: source.reference, toReference: candidates.debts[1].reference, amount: 1 },
      ],
      1,
      "auto",
    );

    const { reversed } = await reverseBatch(batchId, 1);
    expect(reversed).toBe(2);

    const history = await getOffsetHistory();
    expect(
      history.filter((h) => h.batchId === batchId).every((h) => h.reversedAt !== null),
    ).toBe(true);
  });
});
```

- [ ] **Step 3: Testleri çalıştır**

Run: `npx vitest run`
Expected: motor testleri PASS; servis testleri `TEST_DATABASE_URL` yoksa skipped.

- [ ] **Step 4: Commit**

```bash
git add server/offset-service.ts server/offset-service.test.ts
git commit -m "feat(offsets): reverse a transfer or a whole batch"
```

---

### Task 7: HTTP uçları

**Files:**
- Create: `server/offsets-routes.ts`
- Modify: `server/routes.ts` (import bloğu ~satır 53; `app.use` bloğu ~satır 5298)

**Interfaces:**
- Consumes: Task 4-6'nın tüm dışa açık fonksiyonları
- Produces: `/api/offsets/*` uçları; varsayılan export `router`

- [ ] **Step 1: Router'ı yaz**

`server/offsets-routes.ts`:

```ts
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

router.post("/preview", async (req, res) => {
  try {
    res.json(await previewOffsets(readFilter(req.body ?? {})));
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
```

- [ ] **Step 2: routes.ts'e bağla**

`server/routes.ts` satır 53'teki `import excelEnrichmentRouter from "./excel-enrichment";` satırının hemen altına:

```ts
import offsetsRoutes from "./offsets-routes";
```

Satır 5298 civarındaki `app.use("/api/custom-report", customReportRoutes);` satırının hemen altına:

```ts
  // Cross-procedure payment offsetting
  app.use("/api/offsets", offsetsRoutes);
```

- [ ] **Step 3: Sunucuyu başlat ve uçları dene**

Terminal 1:
```bash
node --env-file=.env --import tsx server/index.ts
```

Terminal 2:
```bash
curl -s "http://localhost:5000/api/offsets/candidates" | head -c 400
echo
curl -s -X POST "http://localhost:5000/api/offsets/preview" -H "Content-Type: application/json" -d '{}' | head -c 400
echo
curl -s -o /dev/null -w "%{http_code}\n" -X POST "http://localhost:5000/api/offsets/apply" -H "Content-Type: application/json" -d '{"moves":[]}'
```

Expected:
- `candidates` → `overpayments` ve `debts` dizileri dolu JSON
- `preview` → `moves` dizisi ve `closedDebts` uzunluğu 11
- `apply` → `401` (oturumsuz istek reddedilir; yetki koruması çalışıyor)

- [ ] **Step 4: Commit**

```bash
git add server/offsets-routes.ts server/routes.ts
git commit -m "feat(offsets): expose candidates, preview, apply, history and reverse"
```

---

### Task 8: Çeviriler, rota ve menü

**Files:**
- Modify: `client/src/locales/tr.json`, `client/src/locales/en.json`
- Modify: `client/src/lib/nav-items.ts`
- Modify: `client/src/App.tsx`
- Create: `client/src/pages/offsets.tsx` (iskelet)

**Interfaces:**
- Consumes: `/api/offsets/candidates`
- Produces: `/offsets` rotası, `OffsetsPage` varsayılan export, `offsets.*` çeviri ağacı

- [ ] **Step 1: Türkçe çevirileri ekle**

`client/src/locales/tr.json` içinde `nav` nesnesine, `"payments"` satırının hemen altına:

```json
    "offsets": "Mahsuplaşma",
```

Aynı dosyada en üst düzeye (örneğin `incomingPayments` bloğunun hemen altına) ekle:

```json
  "offsets": {
    "title": "Mahsuplaşma",
    "tabs": { "match": "Eşleştirme", "history": "Geçmiş" },
    "summary": {
      "totalOverpayment": "Toplam Fazla",
      "totalDebt": "Toplam Borç",
      "closable": "Tek Tuşla Kapanacak",
      "procedureCount": "{{n}} prosedür",
      "debtCount": "{{n}} borç"
    },
    "filters": {
      "shipper": "Gönderici",
      "allShippers": "Tümü",
      "showClosed": "Kapalıları göster"
    },
    "lists": {
      "overpayments": "Fazla Ödeme ({{n}})",
      "debts": "Borçlu ({{n}})",
      "emptyOverpayments": "Fazla ödemesi olan prosedür yok",
      "emptyDebts": "Borçlu prosedür yok",
      "closedBadge": "kapalı"
    },
    "actions": {
      "autoMatch": "Tümünü otomatik eşleştir",
      "transferSelected": "Seçilenleri aktar",
      "cancel": "Vazgeç",
      "apply": "{{n}} aktarımı uygula",
      "reverse": "Geri al",
      "reverseBatch": "Tüm partiyi geri al",
      "fromProcedure": "Bu fazlayı mahsuplaştır"
    },
    "preview": {
      "title": "Otomatik Eşleştirme Önizlemesi",
      "description": "Hiçbir kayıt siz onaylamadan yazılmaz.",
      "closedDebts": "{{n}} borç tamamen kapanacak",
      "usedAmount": "{{amount}} aktarılacak",
      "moveCount": "{{n}} işlem",
      "remaining": "Kalan fazla: {{amount}}",
      "unmatched": "Kapanmayacak borç: {{n}}",
      "willClose": "kapanır",
      "partial": "kısmi",
      "sourceCount": "{{n}} kaynaktan",
      "empty": "Eşleştirilebilecek bir aktarım bulunamadı."
    },
    "manual": {
      "title": "Elle Aktarım",
      "from": "Kaynak prosedür",
      "to": "Hedef prosedür",
      "amount": "Aktarılacak tutar",
      "selectBoth": "Soldan bir fazla ödeme, sağdan bir borç seçin"
    },
    "history": {
      "empty": "Henüz mahsuplaşma yapılmamış",
      "auto": "Otomatik eşleştirme",
      "manual": "Elle aktarım",
      "reversed": "geri alındı",
      "batchSummary": "{{n}} aktarım · {{amount}}"
    },
    "toast": {
      "applySuccess": "{{n}} aktarım yapıldı, {{amount}} yerine ulaştı",
      "applyError": "Aktarım yapılamadı",
      "reverseSuccess": "Aktarım geri alındı",
      "reverseError": "Geri alma başarısız",
      "loadError": "Mahsuplaşma listesi yüklenemedi"
    }
  },
```

- [ ] **Step 2: İngilizce çevirileri ekle**

`client/src/locales/en.json` içinde `nav` nesnesine, `"payments"` satırının hemen altına:

```json
    "offsets": "Offsetting",
```

Aynı yapıyı en üst düzeye ekle:

```json
  "offsets": {
    "title": "Offsetting",
    "tabs": { "match": "Matching", "history": "History" },
    "summary": {
      "totalOverpayment": "Total Overpaid",
      "totalDebt": "Total Owed",
      "closable": "Closed In One Click",
      "procedureCount": "{{n}} procedures",
      "debtCount": "{{n}} debts"
    },
    "filters": {
      "shipper": "Shipper",
      "allShippers": "All",
      "showClosed": "Show closed"
    },
    "lists": {
      "overpayments": "Overpaid ({{n}})",
      "debts": "Owing ({{n}})",
      "emptyOverpayments": "No procedure has an overpayment",
      "emptyDebts": "No procedure owes anything",
      "closedBadge": "closed"
    },
    "actions": {
      "autoMatch": "Match everything automatically",
      "transferSelected": "Transfer selected",
      "cancel": "Cancel",
      "apply": "Apply {{n}} transfers",
      "reverse": "Undo",
      "reverseBatch": "Undo the whole batch",
      "fromProcedure": "Offset this overpayment"
    },
    "preview": {
      "title": "Automatic Matching Preview",
      "description": "Nothing is written until you approve it.",
      "closedDebts": "{{n}} debts close completely",
      "usedAmount": "{{amount}} will be transferred",
      "moveCount": "{{n}} operations",
      "remaining": "Overpayment left: {{amount}}",
      "unmatched": "Debts left open: {{n}}",
      "willClose": "closes",
      "partial": "partial",
      "sourceCount": "from {{n}} sources",
      "empty": "No transfer could be matched."
    },
    "manual": {
      "title": "Manual Transfer",
      "from": "Source procedure",
      "to": "Target procedure",
      "amount": "Amount to transfer",
      "selectBoth": "Pick an overpayment on the left and a debt on the right"
    },
    "history": {
      "empty": "No offsetting has been done yet",
      "auto": "Automatic matching",
      "manual": "Manual transfer",
      "reversed": "undone",
      "batchSummary": "{{n}} transfers · {{amount}}"
    },
    "toast": {
      "applySuccess": "{{n}} transfers done, {{amount}} reallocated",
      "applyError": "Transfer failed",
      "reverseSuccess": "Transfer undone",
      "reverseError": "Undo failed",
      "loadError": "Could not load the offsetting lists"
    }
  },
```

**Neden `{{n}}`, `{{count}}` değil:** react-i18next'te `count` ayrılmış bir değişkendir — verildiğinde çoğul son ekli anahtarları (`_one` / `_other`) arar, bulamayınca metni basmaz. Sayı yerine geçen tüm değişkenler `n` adını taşır.

- [ ] **Step 3: Anahtar ağaçlarının eşleştiğini doğrula**

```bash
node -e "
const tr=require('./client/src/locales/tr.json');
const en=require('./client/src/locales/en.json');
const walk=(o,p='')=>Object.entries(o).flatMap(([k,v])=>typeof v==='object'&&v?walk(v,p+k+'.'):[p+k]);
const a=walk(tr.offsets).sort(), b=walk(en.offsets).sort();
console.log('tr keys:', a.length, 'en keys:', b.length);
console.log('mismatch:', JSON.stringify(a.filter(k=>!b.includes(k)).concat(b.filter(k=>!a.includes(k)))));
console.log('nav.offsets:', tr.nav.offsets, '/', en.nav.offsets);
"
```

Expected: `tr keys: 49 en keys: 49`, `mismatch: []`, `nav.offsets: Mahsuplaşma / Offsetting`

- [ ] **Step 4: Sayfa iskeletini oluştur**

`client/src/pages/offsets.tsx`:

```tsx
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { PageLayout } from '@/components/layout/PageLayout';
import { formatCurrency } from '@/lib/formatters';

export interface OffsetCandidate {
  reference: string;
  shipper: string | null;
  paymentStatus: string | null;
  balance: number;
}

export interface CandidateResult {
  overpayments: OffsetCandidate[];
  debts: OffsetCandidate[];
  totalOverpayment: number;
  totalDebt: number;
}

export default function OffsetsPage() {
  const { t } = useTranslation();

  const { data } = useQuery<CandidateResult>({
    queryKey: ['/api/offsets/candidates'],
    queryFn: async () => {
      const response = await apiRequest('GET', '/api/offsets/candidates');
      return await response.json();
    },
  });

  return (
    <PageLayout title={t('nav.offsets')}>
      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-md border p-4">
          <p className="text-sm text-muted-foreground">
            {t('offsets.summary.totalOverpayment')}
          </p>
          <p className="text-2xl font-bold">
            {formatCurrency(data?.totalOverpayment ?? 0)}
          </p>
          <p className="text-sm text-muted-foreground">
            {t('offsets.summary.procedureCount', {
              n: data?.overpayments.length ?? 0,
            })}
          </p>
        </div>
        <div className="rounded-md border p-4">
          <p className="text-sm text-muted-foreground">
            {t('offsets.summary.totalDebt')}
          </p>
          <p className="text-2xl font-bold">
            {formatCurrency(data?.totalDebt ?? 0)}
          </p>
          <p className="text-sm text-muted-foreground">
            {t('offsets.summary.debtCount', { n: data?.debts.length ?? 0 })}
          </p>
        </div>
      </div>
    </PageLayout>
  );
}
```

- [ ] **Step 5: Rota ve menü kaydı**

`client/src/App.tsx` — `import IncomingPaymentsPage from "@/pages/incoming-payments";` satırının altına:

```tsx
import OffsetsPage from "@/pages/offsets";
```

`<Route path="/incoming-payments">` bloğunun (satır 106-112) hemen altına:

```tsx
      <Route path="/offsets">
        {() => (
          <ProtectedRoute>
            <OffsetsPage />
          </ProtectedRoute>
        )}
      </Route>
```

`client/src/lib/nav-items.ts` — `ArrowLeftRight` ikonunu import listesine ekle (alfabetik olarak `Archive`'dan sonra) ve menüye kaydet:

```ts
  { titleKey: "nav.offsets", url: "/offsets", icon: ArrowLeftRight },
```

`nav.payments` satırının hemen altına yerleştir.

- [ ] **Step 6: Tarayıcıda doğrula**

Sunucuyu çalıştır (`node --env-file=.env --import tsx server/index.ts`), `http://localhost:5000/offsets` adresini aç.

Expected: Sol menüde "Mahsuplaşma" görünür; sayfada iki kart — 1.254.083,29 TL / 13 prosedür ve 5.098.800,34 TL / 15 prosedür.

- [ ] **Step 7: Commit**

```bash
git add client/src/locales/tr.json client/src/locales/en.json client/src/lib/nav-items.ts client/src/App.tsx client/src/pages/offsets.tsx
git commit -m "feat(offsets): add the offsetting page shell, route and translations"
```

---

### Task 9: Eşleştirme sekmesi — listeler ve elle aktarım

**Files:**
- Modify: `client/src/pages/offsets.tsx`

**Interfaces:**
- Consumes: `CandidateResult` (Task 8), `POST /api/offsets/apply`
- Produces: seçim durumu ve elle aktarım akışı; `selectedSource` / `selectedTarget` state'leri

- [ ] **Step 1: Filtreler, listeler ve elle aktarımı ekle**

`client/src/pages/offsets.tsx` dosyasını genişlet — `OffsetsPage` gövdesini şununla değiştir:

```tsx
export default function OffsetsPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [shipper, setShipper] = React.useState<string>('');
  const [showClosed, setShowClosed] = React.useState(true);
  const [selectedSource, setSelectedSource] = React.useState<string | null>(null);
  const [selectedTarget, setSelectedTarget] = React.useState<string | null>(null);
  const [manualAmount, setManualAmount] = React.useState<string>('');

  const candidatesKey = ['/api/offsets/candidates', shipper, showClosed] as const;

  const { data, isLoading } = useQuery<CandidateResult>({
    queryKey: candidatesKey,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (shipper) params.set('shipper', shipper);
      if (!showClosed) params.set('includeClosed', 'false');
      const suffix = params.toString() ? `?${params.toString()}` : '';
      const response = await apiRequest('GET', `/api/offsets/candidates${suffix}`);
      return await response.json();
    },
  });

  const source = data?.overpayments.find((c) => c.reference === selectedSource) ?? null;
  const target = data?.debts.find((c) => c.reference === selectedTarget) ?? null;
  const suggested = source && target
    ? Math.min(Math.abs(source.balance), target.balance)
    : 0;

  React.useEffect(() => {
    setManualAmount(suggested > 0 ? suggested.toFixed(2) : '');
  }, [suggested]);

  const shippers = React.useMemo(() => {
    const all = [...(data?.overpayments ?? []), ...(data?.debts ?? [])];
    return Array.from(new Set(all.map((c) => c.shipper).filter(Boolean) as string[])).sort();
  }, [data]);

  const applyManual = useMutation({
    mutationFn: async () => {
      const amount = parseFloat(manualAmount);
      const response = await apiRequest('POST', '/api/offsets/apply', {
        mode: 'manual',
        moves: [{
          fromReference: source!.reference,
          toReference: target!.reference,
          amount,
        }],
      });
      return await response.json();
    },
    onSuccess: (result) => {
      toast({
        title: t('offsets.toast.applySuccess', {
          n: result.applied,
          amount: formatCurrency(parseFloat(manualAmount)),
        }),
      });
      setSelectedSource(null);
      setSelectedTarget(null);
      queryClient.invalidateQueries({ queryKey: ['/api/offsets/candidates'] });
      queryClient.invalidateQueries({ queryKey: ['/api/offsets/history'] });
    },
    onError: (error: unknown) => {
      toast({
        title: t('offsets.toast.applyError'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    },
  });

  const manualValid =
    source !== null &&
    target !== null &&
    parseFloat(manualAmount) > 0 &&
    parseFloat(manualAmount) <= Math.abs(source.balance) + 0.005 &&
    parseFloat(manualAmount) <= target.balance + 0.005;

  const renderRow = (
    candidate: OffsetCandidate,
    selected: boolean,
    onSelect: () => void,
  ) => (
    <button
      key={candidate.reference}
      type="button"
      onClick={onSelect}
      className={`w-full rounded-md border p-3 text-left transition-colors ${
        selected ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{candidate.reference}</span>
        <span className="font-mono">{formatCurrency(Math.abs(candidate.balance))}</span>
      </div>
      <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
        <span className="truncate">{candidate.shipper ?? '—'}</span>
        {candidate.paymentStatus === 'closed' && (
          <span className="rounded bg-orange-100 px-1.5 py-0.5 text-orange-700 dark:bg-orange-950 dark:text-orange-300">
            {t('offsets.lists.closedBadge')}
          </span>
        )}
      </div>
    </button>
  );

  return (
    <PageLayout title={t('nav.offsets')}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <select
            className="h-9 rounded-md border bg-background px-2 text-sm"
            value={shipper}
            onChange={(e) => setShipper(e.target.value)}
          >
            <option value="">{t('offsets.filters.allShippers')}</option>
            {shippers.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showClosed}
              onChange={(e) => setShowClosed(e.target.checked)}
            />
            {t('offsets.filters.showClosed')}
          </label>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <SummaryCard
            label={t('offsets.summary.totalOverpayment')}
            value={formatCurrency(data?.totalOverpayment ?? 0)}
            hint={t('offsets.summary.procedureCount', { n: data?.overpayments.length ?? 0 })}
          />
          <SummaryCard
            label={t('offsets.summary.totalDebt')}
            value={formatCurrency(data?.totalDebt ?? 0)}
            hint={t('offsets.summary.debtCount', { n: data?.debts.length ?? 0 })}
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <section className="space-y-2">
            <h2 className="text-sm font-semibold">
              {t('offsets.lists.overpayments', { n: data?.overpayments.length ?? 0 })}
            </h2>
            <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
              {data?.overpayments.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {t('offsets.lists.emptyOverpayments')}
                </p>
              )}
              {data?.overpayments.map((c) =>
                renderRow(c, c.reference === selectedSource, () =>
                  setSelectedSource(c.reference === selectedSource ? null : c.reference),
                ),
              )}
            </div>
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold">
              {t('offsets.lists.debts', { n: data?.debts.length ?? 0 })}
            </h2>
            <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
              {data?.debts.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {t('offsets.lists.emptyDebts')}
                </p>
              )}
              {data?.debts.map((c) =>
                renderRow(c, c.reference === selectedTarget, () =>
                  setSelectedTarget(c.reference === selectedTarget ? null : c.reference),
                ),
              )}
            </div>
          </section>
        </div>

        <div className="flex flex-wrap items-end gap-3 rounded-md border p-4">
          {source && target ? (
            <>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">
                  {t('offsets.manual.amount')}
                </label>
                <Input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={manualAmount}
                  onChange={(e) => setManualAmount(e.target.value)}
                  className="w-40"
                />
              </div>
              <Button
                onClick={() => applyManual.mutate()}
                disabled={!manualValid || applyManual.isPending}
              >
                {source.reference} → {target.reference}
              </Button>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t('offsets.manual.selectBoth')}
            </p>
          )}
        </div>
      </div>
    </PageLayout>
  );
}

function SummaryCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-md border p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-sm text-muted-foreground">{hint}</p>
    </div>
  );
}
```

Dosyanın başındaki import bloğunu şununla değiştir:

```tsx
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { PageLayout } from '@/components/layout/PageLayout';
import { formatCurrency } from '@/lib/formatters';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
```

- [ ] **Step 2: Elle aktarımı tarayıcıda dene**

`http://localhost:5000/offsets` — soldan `CNCALO-2` (18,00 TL), sağdan herhangi bir borç seç.

Expected:
- Tutar kutusuna `18.00` önerilir
- Butonda `CNCALO-2 → <hedef>` yazar
- Tıklayınca yeşil bildirim çıkar ve **her iki liste de anında güncellenir** (CNCALO-2 fazla listesinden düşer)

**Bu adım canlı veriye yazar.** Denemeden önce Task 10'un geri alma ekranı hazır değilse, doğrudan API ile geri al:

```bash
curl -s -X POST "http://localhost:5000/api/offsets/1/reverse" -H "Content-Type: application/json"
```

ve `candidates` çıktısının eski hâline döndüğünü doğrula. Tercih edilen sıra: Task 10'u bitirip geri almayı ekrandan yapmak.

- [ ] **Step 3: Filtrelerin çalıştığını doğrula**

Gönderici olarak `SOHO PERAKENDE YATIRIM VE TİCARET ANONİM ŞİRKETİ` seç.

Expected: Borç listesinde yalnızca `CNCALO-EXPORT-*` kayıtları kalır; "Kapalıları göster" işaretini kaldırınca kapalı rozetli satırlar listeden çıkar.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/offsets.tsx
git commit -m "feat(offsets): candidate lists, shipper filter and manual transfer"
```

---

### Task 10: Önizleme penceresi ve otomatik eşleştirme

**Files:**
- Create: `client/src/components/offset-preview-modal.tsx`
- Modify: `client/src/pages/offsets.tsx`

**Interfaces:**
- Consumes: `POST /api/offsets/preview`, `POST /api/offsets/apply`
- Produces: `OffsetPreviewModal` bileşeni; props `{ isOpen, onClose, plan, onApplied }`

- [ ] **Step 1: Önizleme penceresini yaz**

`client/src/components/offset-preview-modal.tsx`:

```tsx
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { formatCurrency } from '@/lib/formatters';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export interface OffsetMove {
  fromReference: string;
  toReference: string;
  amount: number;
}

export interface OffsetPlan {
  moves: OffsetMove[];
  closedDebts: string[];
  unmatchedDebts: string[];
  usedAmount: number;
  remainingOverpayment: number;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  plan: OffsetPlan | null;
  onApplied: () => void;
}

export function OffsetPreviewModal({ isOpen, onClose, plan, onApplied }: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  // Moves are identified by their position in plan.moves — two transfers can
  // legitimately share source, target and amount.
  const [excluded, setExcluded] = React.useState<Set<number>>(new Set());

  React.useEffect(() => {
    if (isOpen) setExcluded(new Set());
  }, [isOpen, plan]);

  const moves = plan?.moves ?? [];
  const selected = moves.filter((_, index) => !excluded.has(index));

  // Group by target so the "closes / partial" label sits where it is true:
  // one debt can be fed by several sources.
  const groups = React.useMemo(() => {
    const byTarget = new Map<string, { move: OffsetMove; index: number }[]>();
    moves.forEach((move, index) => {
      byTarget.set(move.toReference, [
        ...(byTarget.get(move.toReference) ?? []),
        { move, index },
      ]);
    });

    return Array.from(byTarget.entries()).map(([reference, planned]) => {
      const plannedTotal = planned.reduce((s, p) => s + p.move.amount, 0);
      const kept = planned.filter((p) => !excluded.has(p.index));
      const keptTotal = kept.reduce((s, p) => s + p.move.amount, 0);
      return {
        reference,
        planned,
        plannedTotal,
        keptCount: kept.length,
        keptTotal,
        closes: kept.length > 0 && Math.abs(plannedTotal - keptTotal) < 0.005,
      };
    });
  }, [moves, excluded]);

  const selectedTotal = selected.reduce((s, m) => s + m.amount, 0);
  const closingCount = groups.filter((g) => g.closes).length;

  const apply = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('POST', '/api/offsets/apply', {
        mode: 'auto',
        moves: selected,
      });
      return await response.json();
    },
    onSuccess: (result) => {
      toast({
        title: t('offsets.toast.applySuccess', {
          n: result.applied,
          amount: formatCurrency(selectedTotal),
        }),
      });
      onApplied();
      onClose();
    },
    onError: (error: unknown) => {
      toast({
        title: t('offsets.toast.applyError'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    },
  });

  const toggle = (index: number) => {
    setExcluded((previous) => {
      const next = new Set(previous);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[700px]">
        <DialogHeader>
          <DialogTitle>{t('offsets.preview.title')}</DialogTitle>
          <DialogDescription>{t('offsets.preview.description')}</DialogDescription>
        </DialogHeader>

        {moves.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {t('offsets.preview.empty')}
          </p>
        ) : (
          <>
            <div className="rounded-md border p-3 text-sm">
              <p>{t('offsets.preview.closedDebts', { n: closingCount })}</p>
              <p>{t('offsets.preview.usedAmount', { amount: formatCurrency(selectedTotal) })}</p>
              <p>{t('offsets.preview.moveCount', { n: selected.length })}</p>
              <p className="text-muted-foreground">
                {t('offsets.preview.remaining', {
                  amount: formatCurrency(
                    (plan?.remainingOverpayment ?? 0) + ((plan?.usedAmount ?? 0) - selectedTotal),
                  ),
                })}
              </p>
              <p className="text-muted-foreground">
                {t('offsets.preview.unmatched', { n: plan?.unmatchedDebts.length ?? 0 })}
              </p>
            </div>

            <div className="space-y-3">
              {groups.map((group) => (
                <div key={group.reference} className="rounded-md border">
                  <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-2 text-sm font-medium">
                    <span>
                      {group.reference} · {formatCurrency(group.plannedTotal)}
                    </span>
                    <span className={group.closes ? 'text-green-600' : 'text-orange-600'}>
                      {group.closes
                        ? t('offsets.preview.willClose')
                        : t('offsets.preview.partial')}
                      {group.planned.length > 1 &&
                        ` · ${t('offsets.preview.sourceCount', { n: group.planned.length })}`}
                    </span>
                  </div>
                  {group.planned.map(({ move, index }) => (
                    <label
                      key={index}
                      className="flex items-center gap-3 px-3 py-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={!excluded.has(index)}
                        onChange={() => toggle(index)}
                      />
                      <span className="flex-1">{move.fromReference}</span>
                      <span className="font-mono">{formatCurrency(move.amount)}</span>
                    </label>
                  ))}
                </div>
              ))}
            </div>
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={apply.isPending}>
            {t('offsets.actions.cancel')}
          </Button>
          <Button
            onClick={() => apply.mutate()}
            disabled={selected.length === 0 || apply.isPending}
          >
            {t('offsets.actions.apply', { n: selected.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Sayfaya bağla**

`client/src/pages/offsets.tsx` — import bloğuna ekle:

```tsx
import { OffsetPreviewModal, type OffsetPlan } from '@/components/offset-preview-modal';
```

`OffsetsPage` içinde state ve önizleme çağrısı ekle (mevcut state tanımlarının altına):

```tsx
  const [previewPlan, setPreviewPlan] = React.useState<OffsetPlan | null>(null);
  const [previewOpen, setPreviewOpen] = React.useState(false);

  const loadPreview = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('POST', '/api/offsets/preview', {
        shipper: shipper || undefined,
        includeClosed: showClosed,
      });
      return (await response.json()) as OffsetPlan;
    },
    onSuccess: (plan) => {
      setPreviewPlan(plan);
      setPreviewOpen(true);
    },
    onError: () => {
      toast({ title: t('offsets.toast.loadError'), variant: 'destructive' });
    },
  });
```

Üçüncü özet kartını ekle (`SummaryCard` grubunun sonuna):

```tsx
          <SummaryCard
            label={t('offsets.summary.closable')}
            value={formatCurrency(previewPlan?.usedAmount ?? 0)}
            hint={t('offsets.summary.debtCount', { n: previewPlan?.closedDebts.length ?? 0 })}
          />
```

Otomatik eşleştirme butonunu elle aktarım kutusunun üstüne ekle:

```tsx
        <Button
          onClick={() => loadPreview.mutate()}
          disabled={loadPreview.isPending}
        >
          {t('offsets.actions.autoMatch')}
        </Button>
```

Ve pencereyi `PageLayout` içinde en sona ekle:

```tsx
        <OffsetPreviewModal
          isOpen={previewOpen}
          onClose={() => setPreviewOpen(false)}
          plan={previewPlan}
          onApplied={() => {
            queryClient.invalidateQueries({ queryKey: ['/api/offsets/candidates'] });
            queryClient.invalidateQueries({ queryKey: ['/api/offsets/history'] });
            setPreviewPlan(null);
          }}
        />
```

Sayfa açılışında üçüncü kartın dolması için efekt ekle:

```tsx
  React.useEffect(() => {
    apiRequest('POST', '/api/offsets/preview', {
      shipper: shipper || undefined,
      includeClosed: showClosed,
    })
      .then((r) => r.json())
      .then((plan: OffsetPlan) => setPreviewPlan(plan))
      .catch(() => undefined);
  }, [shipper, showClosed]);
```

- [ ] **Step 3: Önizlemeyi tarayıcıda doğrula (uygulamadan)**

`http://localhost:5000/offsets` → "Tümünü otomatik eşleştir".

Expected:
- Özet rakamları, aynı anda çalıştırılan `POST /api/offsets/preview` çıktısıyla birebir aynı (canlı veri hareketli olduğu için sabit sayı beklenmez — bkz. Task 13 Step 3)
- Gruplar hedef prosedüre göre; birden fazla kaynaktan beslenen bir hedefin başlığında "kapanır · N kaynaktan" yazar (2026-08-14 verisinde `CNCALO-67 FOOTWEAR` 3 kaynaktan besleniyor)
- Bir satırın işaretini kaldır → o grup "kısmi" olur, özetteki tutar ve işlem sayısı anında düşer
- **"Vazgeç" ile kapat** — bu adımda uygulama yapılmaz

- [ ] **Step 4: Commit**

```bash
git add client/src/components/offset-preview-modal.tsx client/src/pages/offsets.tsx
git commit -m "feat(offsets): preview modal grouped by target with per-move opt-out"
```

---

### Task 11: Geçmiş sekmesi ve geri alma

**Files:**
- Modify: `client/src/pages/offsets.tsx`

**Interfaces:**
- Consumes: `GET /api/offsets/history`, `POST /api/offsets/:id/reverse`, `POST /api/offsets/batch/:batchId/reverse`
- Produces: `OffsetHistoryEntry` istemci tipi; Eşleştirme/Geçmiş sekme geçişi

- [ ] **Step 1: Sekmeleri ve geçmişi ekle**

`client/src/pages/offsets.tsx` — import bloğuna ekle:

```tsx
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatDate } from '@/lib/formatters';
```

Tip tanımlarının yanına ekle:

```tsx
export interface OffsetHistoryEntry {
  id: number;
  batchId: string;
  fromReference: string;
  toReference: string;
  amount: number;
  offsetDate: string;
  mode: 'auto' | 'manual';
  createdByName: string | null;
  reversedAt: string | null;
}
```

`OffsetsPage` içine geçmiş sorgusu ve geri alma mutasyonlarını ekle:

```tsx
  const { data: history } = useQuery<{ offsets: OffsetHistoryEntry[] }>({
    queryKey: ['/api/offsets/history'],
    queryFn: async () => {
      const response = await apiRequest('GET', '/api/offsets/history');
      return await response.json();
    },
  });

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ['/api/offsets/candidates'] });
    queryClient.invalidateQueries({ queryKey: ['/api/offsets/history'] });
  };

  const reverseOne = useMutation({
    mutationFn: async (id: number) => {
      const response = await apiRequest('POST', `/api/offsets/${id}/reverse`);
      return await response.json();
    },
    onSuccess: () => {
      toast({ title: t('offsets.toast.reverseSuccess') });
      refreshAll();
    },
    onError: (error: unknown) => {
      toast({
        title: t('offsets.toast.reverseError'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    },
  });

  const reverseWholeBatch = useMutation({
    mutationFn: async (batchId: string) => {
      const response = await apiRequest('POST', `/api/offsets/batch/${batchId}/reverse`);
      return await response.json();
    },
    onSuccess: () => {
      toast({ title: t('offsets.toast.reverseSuccess') });
      refreshAll();
    },
    onError: (error: unknown) => {
      toast({
        title: t('offsets.toast.reverseError'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    },
  });

  const batches = React.useMemo(() => {
    const grouped = new Map<string, OffsetHistoryEntry[]>();
    for (const entry of history?.offsets ?? []) {
      grouped.set(entry.batchId, [...(grouped.get(entry.batchId) ?? []), entry]);
    }
    return Array.from(grouped.entries());
  }, [history]);
```

Sayfa gövdesini `Tabs` ile sar. Somut olarak: `PageLayout` içindeki `<div className="space-y-4">` sarmalayıcısının **açılış etiketini** aşağıdaki `<Tabs>` + `<TabsList>` + `<TabsContent value="match" className="space-y-4">` üçlüsüyle değiştir; Task 9-10'da yazılan filtre kutusu, özet kartlar, iki liste, elle aktarım kutusu ve `OffsetPreviewModal` olduğu gibi bu `TabsContent` içinde kalır. Kapanış `</div>` yerine `</TabsContent>` gelir, ardından geçmiş sekmesi eklenir ve `</Tabs>` ile kapanır:

```tsx
        <Tabs defaultValue="match">
          <TabsList>
            <TabsTrigger value="match">{t('offsets.tabs.match')}</TabsTrigger>
            <TabsTrigger value="history">{t('offsets.tabs.history')}</TabsTrigger>
          </TabsList>

          <TabsContent value="match" className="space-y-4">
            {/* Task 9 ve 10'da yazılan içerik buraya taşınır — yeniden yazılmaz */}
          </TabsContent>

          <TabsContent value="history" className="space-y-4">
            {batches.length === 0 && (
              <p className="text-sm text-muted-foreground">{t('offsets.history.empty')}</p>
            )}
            {batches.map(([batchId, entries]) => {
              const total = entries.reduce((s, e) => s + e.amount, 0);
              const open = entries.filter((e) => e.reversedAt === null);
              return (
                <div key={batchId} className="rounded-md border">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2 text-sm">
                    <span>
                      {formatDate(entries[0].offsetDate)} · {entries[0].createdByName ?? '—'} ·{' '}
                      {entries[0].mode === 'auto'
                        ? t('offsets.history.auto')
                        : t('offsets.history.manual')}{' '}
                      · {t('offsets.history.batchSummary', {
                        n: entries.length,
                        amount: formatCurrency(total),
                      })}
                    </span>
                    {open.length > 1 && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => reverseWholeBatch.mutate(batchId)}
                        disabled={reverseWholeBatch.isPending}
                      >
                        {t('offsets.actions.reverseBatch')}
                      </Button>
                    )}
                  </div>
                  {entries.map((entry) => (
                    <div
                      key={entry.id}
                      className={`flex items-center justify-between gap-3 px-3 py-2 text-sm ${
                        entry.reversedAt ? 'text-muted-foreground line-through' : ''
                      }`}
                    >
                      <span className="flex-1">
                        {entry.fromReference} → {entry.toReference}
                      </span>
                      <span className="font-mono">{formatCurrency(entry.amount)}</span>
                      {entry.reversedAt ? (
                        <span className="text-xs">{t('offsets.history.reversed')}</span>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => reverseOne.mutate(entry.id)}
                          disabled={reverseOne.isPending}
                        >
                          {t('offsets.actions.reverse')}
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              );
            })}
          </TabsContent>
        </Tabs>
```

- [ ] **Step 2: Uçtan uca dene — uygula ve geri al**

Tarayıcıda: "Tümünü otomatik eşleştir" → önizlemede **yalnızca en küçük iki satırı bırak** (diğerlerinin işaretini kaldır) → "Uygula".

Expected:
- Yeşil bildirim, listeler güncellenir, kapanan borçlar borç listesinden düşer
- Geçmiş sekmesinde tek parti, 2 aktarım, "Otomatik eşleştirme" etiketi

Sonra aynı partide "Tüm partiyi geri al".

Expected: Her iki satır üstü çizili "geri alındı" olur; Eşleştirme sekmesindeki listeler **işlem öncesi hâline** döner (tutarlar birebir aynı).

- [ ] **Step 3: Gelen ödemenin bozulmadığını doğrula**

```bash
node --env-file=.env -e "
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);
sql\`select id, total_amount, amount_distributed, remaining_balance, distribution_status from incoming_payments order by id\`
  .then(r => console.log(JSON.stringify(r).slice(0, 600)));
"
```

Expected: `amount_distributed` ve `distribution_status` değerleri Task 11 öncesi ile aynı — mahsuplaşma gelen ödeme kayıtlarına dokunmuyor.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/offsets.tsx
git commit -m "feat(offsets): history tab with per-transfer and batch undo"
```

---

### Task 12: Prosedür detayı entegrasyonu ve eski ekranların doğrulanması

**Files:**
- Modify: `client/src/pages/procedure-details.tsx` (~satır 1863 fazla ödeme kutusu; ödeme geçmişi tablosu)

**Interfaces:**
- Consumes: `/offsets` rotası
- Produces: prosedür detayından mahsuplaşmaya kısayol; mahsup satırlarının ayırt edilmesi

- [ ] **Step 1: Kısayol bağlantısını ekle**

`client/src/pages/procedure-details.tsx` — fazla ödeme kutusunun (satır 1863-1875 aralığı) içine, tutarın altına:

```tsx
                    {remainingBalance < 0 && (
                      <Link
                        href={`/offsets?source=${encodeURIComponent(reference)}`}
                        className="mt-2 inline-block text-sm underline"
                      >
                        {t('offsets.actions.fromProcedure')} →
                      </Link>
                    )}
```

`Link` bileşeni `wouter`'dan gelir; dosyanın import bloğunda yoksa ekle:

```tsx
import { Link } from 'wouter';
```

wouter 3.x'te `Link` kendi `<a>` etiketini üretir — içine ayrıca `<a>` koyma (iç içe anchor olur). Depodaki mevcut kullanım da bu şekilde: [analytics.tsx:280](../../../client/src/pages/analytics.tsx).

`reference` değişkeni bu dosyada rota parametresinden geliyor; bulunduğun kapsamda hangi adla tanımlıysa onu kullan (`useParams` çıktısı).

- [ ] **Step 2: Mahsuplaşma sayfasında kaynağı önceden seç**

`client/src/pages/offsets.tsx` — import bloğuna `import { useSearch } from 'wouter';` ekle ve state tanımlarının altına:

```tsx
  const searchString = useSearch();

  React.useEffect(() => {
    const preselected = new URLSearchParams(searchString).get('source');
    if (preselected) setSelectedSource(preselected);
  }, [searchString]);
```

- [ ] **Step 3: Fazla ödemesi olan bir prosedürde dene**

`http://localhost:5000/procedures/CNCALO-96` (veya arayüzden git) → yeşil "Fazla Ödeme" kutusundaki bağlantıya tıkla.

Expected: Mahsuplaşma sayfası açılır, `CNCALO-96` sol listede seçili gelir.

- [ ] **Step 4: Eksi tutarlı satırların eski ekranlarda görünümünü doğrula**

Bir aktarım uygula (küçük tutarlı, örn. `CNCALO-2` → herhangi bir borç, 18,00 TL), sonra sırayla kontrol et:

| Ekran | Nasıl açılır | Beklenen |
|---|---|---|
| Ödemeler sayfası | `/incoming-payments` → ilgili ödemede "Dağıtımları gör" | Eksi tutarlı satır `-18,00` olarak görünür, toplam doğru |
| Prosedür detayı | `/procedures/CNCALO-2` | Ödeme geçmişinde eksi satır; bakiye kutusu artık "fazla ödeme" göstermiyor |
| Prosedür PDF | Prosedür detayında "PDF oluştur" | Ödeme bölümünde eksi satır görünür, toplam dağıtım doğru |
| Excel raporu | Raporlar → ilgili prosedür | Toplamlar doğru |

Herhangi bir ekranda tutar yanlış görünüyorsa **düzeltmeyi bu adımda yap** ve neyi düzelttiğini commit mesajına yaz. Yalnızca gösterim bozuksa gösterimi düzelt — hesap katmanına dokunma.

Kontrol bitince aktarımı geçmiş sekmesinden geri al.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/procedure-details.tsx client/src/pages/offsets.tsx
git commit -m "feat(offsets): shortcut from procedure detail and offset row display"
```

---

### Task 13: Kabul doğrulaması ve yayın

**Files:** yok (doğrulama ve yayın adımı)

**Interfaces:**
- Consumes: tüm önceki task'lar
- Produces: yayına hazır dal

- [ ] **Step 1: Tüm testleri çalıştır**

Run: `npx vitest run`
Expected: `offset-engine.test.ts` 18 PASS. `offset-service.test.ts` — `TEST_DATABASE_URL` varsa 8 PASS, yoksa skipped.

- [ ] **Step 2: Yeni dosyalarda tip hatası olmadığını doğrula**

Run: `npx tsc --noEmit 2>&1 | grep -E "offset-engine|offset-service|offsets-routes|pages/offsets|offset-preview-modal"`
Expected: çıktı boş. (Depo genelindeki tsc çıktısı `pdf-data-transformer.ts` yüzünden kırmızı — o hatalar bu iş kapsamında değil.)

- [ ] **Step 3: Kabul karşılaştırması**

Sunucu çalışırken:

```bash
curl -s -X POST "http://localhost:5000/api/offsets/preview" -H "Content-Type: application/json" -d '{}' \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const p=JSON.parse(s);console.log('closed:',p.closedDebts.length,'used:',p.usedAmount,'moves:',p.moves.length,'left:',p.remainingOverpayment,'unmatched:',p.unmatchedDebts.length)})"
```

**Sabit bir sayı beklenmez.** Canlı veri hareketli: 2026-08-14 sabahı ölçüm 11 kapanan borç / 1.236.935,07 TL iken, aynı gün öğlen 7 kapanan borç / 615.438,77 TL'ye döndü (aradaki gece 11 yeni dağıtım yapılmıştı). Kabul ölçütü şu üç şartın **aynı anda** sağlanmasıdır:

1. **Ekran = motor.** Sayfadaki özet, aynı dakikada çalıştırılan `preview` çıktısıyla birebir aynı olmalı.
2. **Hiçbir borç yarım kalmamalı.** `unmatchedDebts` içindeki her prosedür için, toplam fazlanın o borcu kapatmaya gerçekten yetmediği doğrulanır.
3. **Para korunmalı.** `usedAmount + remainingOverpayment`, `totalOverpayment`'a eşit olmalı.

Ayrıca `uncosted.count > 0` ise, hariç tutulan prosedürlerin gider tarafının gerçekten boş olduğu tek tek doğrulanır (yanlışlıkla elenen olmasın).

Şartlardan biri sağlanmıyorsa **sayıları tutturmak için algoritmayı değiştirme** — farkı araştır, açıklayamıyorsan yayına alma.

- [ ] **Step 4: Yetki kontrolü**

Muhasebeci olmayan bir kullanıcıyla (örn. `viewer` rolü) giriş yapıp `/offsets` sayfasına git.

Expected: Listeler görünür (GET serbest), ama "Uygula" / "Geri al" istekleri `403` döner ve kırmızı bildirim çıkar.

- [ ] **Step 5: Kullanıcı onayı**

Cem'e canlı ortamda ne olacağını göster ve **açık onay al**:
- Kaç aktarım yapılacak, hangi borçlar kapanacak
- Geri almanın tek tuş olduğunu göster

Onay alınmadan Step 6'ya geçme.

- [ ] **Step 6: Yayına al**

```bash
git checkout main
git merge --no-ff feature/payment-offset
git push origin main
```

Push, VPS'e otomatik deploy tetikler; `scripts/apply-manual-ddl.ts` yeni DDL'i uygular. Deploy sonrası:

```bash
curl -s "https://cncsohoimportmanager.com/api/offsets/candidates" | head -c 200
```

Expected: Canlı ortamdan JSON döner. Dönmüyorsa deploy günlüklerinde DDL adımını kontrol et — DDL hatası deploy'u durdurur.

---

## Self-Review Notları

**Spec kapsamı — her gereksinim bir task'a bağlı:**

| Spec bölümü | Task |
|---|---|
| Çift kayıt mekaniği | 5 |
| LIFO kaynak tüketme | 3, 5 |
| Ödeme tipi kuralı | 3, 5 |
| Dört değişmez | 5 (test), 11 (Step 3), 13 |
| Eşleştirme algoritması | 2 |
| `payment_offsets` + `offset_id` | 1 |
| Tek SQL aday listesi | 4 |
| 6 uç nokta + yetki | 7, 13 (Step 4) |
| Mahsuplaşma sayfası, filtreler | 8, 9 |
| Önizleme (hedefe göre gruplu) | 10 |
| Geçmiş + geri alma | 6, 11 |
| Prosedür detayı kısayolu | 12 |
| i18n TR/EN | 8 |
| Test planı | 2, 3, 5, 6, 13 |
| Eski ekran doğrulaması | 12 (Step 4) |
| Kabul ölçütü (ekran=motor, borç yarım kalmaz, para korunur) | 13 (Step 3) |
| Gideri girilmemiş prosedürlerin elenmesi (spec kararı 6) | 4 |

**Bilinen boşluk:** `TEST_DATABASE_URL` yoksa entegrasyon testleri atlanır. Bu durumda Task 11 Step 2-3 ve Task 13 Step 3 aynı değişmezleri elle doğrular. Neon'da bir test dalı açılabilirse tercih edilen yol odur.
