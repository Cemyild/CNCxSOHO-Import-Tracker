# Claude Cowork ↔ CNCxSOHO Import Tracker: MCP Integration Design

**Tarih:** 2026-05-16
**Yazar:** Cem (av.cemyildirim@gmail.com) + Claude
**Statü:** Design — implementation planına geçmeden önce kullanıcı onay aşaması.

---

## 1. Amaç ve Kapsam

Claude Desktop'taki **Cowork** moduna (Anthropic-hosted agentic platform) CNCxSOHO Import Tracker uygulamasını bağlamak. Cowork'ten 3 tür iş tetiklenebilecek:

- **(A) Gmail-tetikli otomasyonlar** — örn. belirli bir göndericiden gelen fatura mailinde Cowork Dispatch otomatik task çalıştırır, task uygulamanın MCP tool'larını kullanarak tax calculation yapar ve kaydeder.
- **(B) İnteraktif çok-adımlı işler** — Cem Cowork sohbetinde "ALO için yeni prosedür yarat, vergileri hesapla, dağıtımı yap" der; Cowork birden çok MCP tool çağırarak işi tamamlar.
- **(C) Mevcut in-app AI özelliklerinin (PDF extraction, Q&A) Cowork'ten de kullanılabilmesi** — aynı backend mantığı hem React UI'dan hem Cowork'ten erişilebilir olur.

Kapsam dışı:
- Multi-user Cowork erişimi (OAuth) — bugün için sadece Cem.
- App-side cron / scheduler — Cowork'ün Scheduled özelliği kullanılacak.
- App-side Gmail entegrasyonu — Cowork'ün Dispatch özelliği kullanılacak.

## 2. Mimari

```
┌─────────────────────────────┐         HTTPS / Streamable HTTP        ┌──────────────────────────────────┐
│  Claude Cowork              │ ─────────────────────────────────────► │  cncsohoimportmanager.com        │
│  (Anthropic-hosted)         │                                         │  Express app (port 5000)         │
│                             │ ◄───── SSE stream (tool responses) ──── │                                  │
│  - Scheduled (cron)         │                                         │  ├─ existing /api/* routes       │
│  - Dispatch (Gmail trigger) │   Authorization: Bearer <MCP_TOKEN>     │  └─ NEW /mcp router              │
│  - Projects (context)       │                                         │     ├─ auth middleware           │
│                             │                                         │     ├─ transport (Streamable HTTP)│
└─────────────────────────────┘                                         │     ├─ tool registry             │
                                                                        │     ├─ audit logger              │
                                                                        │     └─ tools/*.ts                │
                                                                        │        (read, write, destructive,│
                                                                        │         ai wrappers)             │
                                                                        └──────────────┬───────────────────┘
                                                                                       │
                                                                                       ▼
                                                                            ┌──────────────────────┐
                                                                            │ Postgres (Neon)      │
                                                                            │ + agent_audit_log    │
                                                                            └──────────────────────┘
```

**Anahtar kararlar:**

- **Transport:** Streamable HTTP (MCP'nin güncel uzaktan transport'u). Tek endpoint: `POST /mcp` istemci mesajları için, `GET /mcp` SSE upgrade için.
- **Auth:** Tek long-lived bearer token (`MCP_BEARER_TOKEN` env). Token hash'i (sha256[:16]) audit log'a yazılır, plaintext asla.
- **Code yerleşim:** Yeni `server/mcp/` klasörü, Express sub-app olarak `app.use('/mcp', mcpRouter)` ile mount. `routes.ts` monolitine **dokunulmaz**.
- **Veri katmanı:** Mevcut `server/storage.ts`, `server/tax-calculation-service.ts` ve diğer servisler tool'lar tarafından çağrılır — kod tekrarı yok.
- **Reversibility:** Tüm write operasyonları `db.transaction()` içinde; audit log'a "before state" (patch tool'larda) ve "affected ids" kayıt edilir.

## 3. Klasör ve Dosya Yapısı

```
server/mcp/
├── index.ts            # mcpRouter, mount point
├── transport.ts        # Streamable HTTP handler (req→tool, res←stream)
├── auth.ts             # bearer token middleware + fingerprint
├── audit.ts            # writes to agent_audit_log; sanitize args
├── registry.ts         # tool registry (collects tool defs)
├── errors.ts           # MCP JSON-RPC error helpers
└── tools/
    ├── index.ts        # re-exports all tools
    ├── procedures.ts   # read_procedures, write_create_procedure, ...
    ├── taxes.ts        # read_taxes, write_calculate_tax, ...
    ├── expenses.ts     # read_expenses, write_create_expense, ...
    ├── payments.ts     # read_payments, write_create_payment, write_distribute_payment
    ├── invoices.ts     # read_invoices, write_create_invoice
    ├── products.ts     # read_products, write_create_product
    ├── reports.ts      # read_dashboard_snapshot, read_report
    ├── documents.ts    # ai_extract_pdf (wraps document-extraction.ts)
    ├── ai.ts           # ai_ask_internal (wraps ai-ask.ts)
    └── destructive.ts  # destructive_delete_record, destructive_close_procedure, destructive_bulk_update
```

## 4. Tool Katalogu

3 katman, hepsinde audit log zorunlu. Tier'a göre default davranış:

| Tier | Approval policy | Transaction | dry_run | Sayı |
|---|---|---|---|---|
| `read_*` | Otomatik | N/A | N/A | 10 |
| `write_*` | Cowork-side (kullanıcı policy'sine bağlı) | Zorunlu | Opsiyonel | 10 |
| `destructive_*` | Cowork-side **zorunlu** | Zorunlu | **Default true** | 3 |
| `ai_*` | Otomatik (read-like) | N/A | N/A | 2 |

### 4.1 Read tools

| Tool | Görev | Ana parametreler |
|---|---|---|
| `read_procedures` | Prosedür listesi (filtreli) | `company?`, `status?`, `date_from?`, `date_to?`, `limit?` |
| `read_procedure_detail` | Tek prosedür + ilişkili veriler | `id` |
| `read_taxes` | Vergi kayıtları | `procedure_id?`, `tax_type?`, `limit?` |
| `read_expenses` | Import & service masrafları | `procedure_id?`, `category?`, `issuer_contains?`, `limit?` |
| `read_payments` | Ödemeler + distributions | `procedure_id?`, `type?`, `status?`, `limit?` |
| `read_invoices` | Faturalar + line items | `procedure_id?`, `limit?` |
| `read_products` | Products & HS codes | `query?`, `limit?` |
| `read_dashboard_snapshot` | KPI'lar/totals | `company?`, `period?` |
| `read_report` | Var olan rapor üreticilerini çağırır | `type`, `filters` |
| `read_audit_log` | Agent'ın kendi audit log'u | `since?`, `tool?`, `limit?` |

### 4.2 Write tools

| Tool | Görev | Notlar |
|---|---|---|
| `write_create_procedure` | Yeni prosedür | Transaction; audit `before=null` |
| `write_update_procedure` | Patch prosedür | "before" snapshot audit'e |
| `write_create_expense` | Yeni masraf | FK doğrulaması, transaction |
| `write_create_invoice` | Yeni fatura + line items | Tek transaction |
| `write_create_payment` | Yeni ödeme | Currency parse, status init |
| `write_distribute_payment` | Allocations | Sum check, distribution_status güncellemesi |
| `write_calculate_tax` | Tax calc + kaydet | `tax-calculation-service.ts` wrapper |
| `write_import_excel` | Excel bulk import | `file_ref` (S3 key veya base64), `type` |
| `write_create_product` | Yeni ürün/HS code | Duplicate kontrolü |
| `write_attach_document` | Prosedüre doküman ekle | S3 upload + DB kayıt |

### 4.3 Destructive tools

| Tool | Görev | Default davranış |
|---|---|---|
| `destructive_delete_record` | Tek kayıt sil | `dry_run: true` default; ne silineceğini döndürür ama silmez |
| `destructive_close_procedure` | Prosedür kapat (status=closed) | `dry_run: true` default |
| `destructive_bulk_update` | Toplu güncelleme | `dry_run: true` default |

### 4.4 AI tool wrappers

| Tool | Görev | Wrapper |
|---|---|---|
| `ai_extract_pdf` | PDF'den veri çıkar | `server/document-extraction.ts` mevcut fonksiyonları |
| `ai_ask_internal` | Yapısal Q&A | `server/ai-ask.ts` `handleAskRequest` çağrısı |

Cowork bu wrapper'ları zincirleyebilir: "Gmail'den geldi → `ai_extract_pdf` → `write_calculate_tax`".

## 5. Audit Log Şeması

`shared/schema.ts`'ye eklenir, drizzle-kit migration ile uygulanır:

```ts
export const agentAuditLog = pgTable("agent_audit_log", {
  id: serial("id").primaryKey(),
  ts: timestamp("ts").defaultNow().notNull(),
  agentId: text("agent_id").notNull(),            // "cowork" (gelecek: "claude-code" vb.)
  tokenFingerprint: text("token_fingerprint").notNull(),  // sha256(token).slice(0,16)
  tool: text("tool").notNull(),                   // "write_create_procedure"
  tier: text("tier").notNull(),                   // 'read' | 'write' | 'destructive' | 'ai'
  argsJson: text("args_json").notNull(),          // sanitize edilmiş args (no secrets/file blobs)
  beforeJson: text("before_json"),                // patch/destructive için "before" state
  resultStatus: text("result_status").notNull(),  // 'ok' | 'error' | 'dry_run'
  resultSummary: text("result_summary"),          // kısa özet veya error msg
  affectedTable: text("affected_table"),
  affectedIds: text("affected_ids"),              // JSON array
  durationMs: integer("duration_ms"),
  transactionId: text("transaction_id"),          // bir Cowork task'ın tüm tool çağrılarını gruplar (request başında üretilir)
});
```

İndex'ler: `(ts DESC)`, `(tool, ts)`, `(transaction_id)`.

**Sanitization kuralları (audit.ts'de):**
- `file_ref` alanları: S3 key tutulur, içerik tutulmaz.
- Base64 içerikler (image_data, pdf_data) "[base64 elided, N bytes]" ile değiştirilir.
- Bearer token plaintext **asla** yazılmaz; fingerprint kullanılır.

## 6. Auth Modeli

- **Env:** `MCP_BEARER_TOKEN` — `openssl rand -base64 48` ile üretilir, `.env`'e eklenir, server restart'ta okunur.
- **Middleware:** `Authorization: Bearer <token>` header'ı sabit-time karşılaştırma (`crypto.timingSafeEqual`) ile doğrulanır.
- **Fingerprint:** Her istek için `sha256(token).slice(0,16)` audit log'a yazılır — token rotasyonunda hangi token'ın hangi çağrıyı yaptığı görülür.
- **Token rotasyonu:** İki token aynı anda kabul edilebilir (`MCP_BEARER_TOKEN_PRIMARY`, `MCP_BEARER_TOKEN_SECONDARY`) — zero-downtime rotasyon. v1'de tek token, rotasyon Phase 2.
- **Future (multi-user):** OAuth 2.1 server eklenir, kullanıcı `users` tablosunun row'una mapping yapılır. v1 kapsam dışı.

## 7. Cowork-side Konfigürasyon

Claude Desktop → Cowork → Settings → Custom MCP servers:
- **Name:** "CNCxSOHO Import Tracker"
- **URL:** `https://cncsohoimportmanager.com/mcp`
- **Auth:** Bearer, token Cem'in Cowork keychain'inden geliyor

**Gmail Dispatch senaryosu örnek konfigürasyon (Cowork-side):**
- Trigger: Gmail filter (örn. `from:supplier@example.com subject:"Invoice"`)
- Task prompt: "Process the incoming invoice email. Call `ai_extract_pdf` on the attachment. From the extracted data, call `write_calculate_tax` for the related procedure (match by invoice number). Reply with summary."
- Approval: write tools için Cowork onay sorar; "auto-approve `write_calculate_tax`" policy'si verilebilir.

**Scheduled örnek:**
- Cron: Her ayın 1'i, 09:00 TR saati
- Task: "Call `read_report` with type=monthly_tax_summary, period=last_month. Email me the summary."

## 8. Deployment ve Güvenlik

| Konu | Karar |
|---|---|
| TLS | Mevcut nginx + Let's Encrypt (cncsohoimportmanager.com) |
| nginx config | `location /mcp/ { proxy_read_timeout 300s; proxy_buffering off; proxy_http_version 1.1; chunked_transfer_encoding on; }` — SSE için zorunlu |
| Rate limit | Mevcut `express-rate-limit` kullanılır; `/mcp/*` için 120 req/dk ayrı limiter |
| CORS | MCP için CORS gerekmez (Cowork server-side); preflight tetiklenmez |
| Secret yönetimi | `.env` (PM2 üzerinden); secret asla repo'ya commit edilmez |
| Logging | Mevcut console logger; audit log DB'de, ayrıca route-level erişim log'u |
| IP allowlist | Anthropic egress IP listesi yayınlanırsa nginx-level allowlist eklenir; v1'de açık (token yeterli) |
| Health check | `GET /mcp/health` — auth'suz, sadece "ok" döner; uptime monitor için |

## 9. Mevcut AI Özelliklerinin Durumu

| Mevcut | Durum | Strateji |
|---|---|---|
| `server/ai-ask.ts` (in-app Q&A) | Korunur, refactor edilmez | `ai_ask_internal` MCP tool'u `handleAskRequest`'i çağırır |
| `server/claude.ts` (Claude vision) | Korunur | İç fonksiyon olarak kullanılır |
| `server/document-extraction.ts` (PDF) | Korunur | `ai_extract_pdf` MCP tool'u doğrudan çağırır |
| React UI'daki in-app AI butonları | Korunur, kullanıcılara açık kalmaya devam | Hiç etkilenmez |

Refactor yok → risk yok. Adapter pattern ile iki path da çalışır. `ai_ask_internal`'da mevcut `handleAskRequest` session middleware'ine bağımlıysa, MCP wrapper bunu bypass edip doğrudan iç fonksiyonu çağırır (bkz. Section 11).

## 10. Build Sırası (Phase'ler)

| Phase | İçerik | Çıktı |
|---|---|---|
| **0. Pre-flight** | Cowork'ün "Custom MCP server" desteğini Claude Desktop ayarlarında doğrula; Streamable HTTP transport beklenen; Anthropic egress IP listesi (varsa) not edilir | Go/no-go kararı |
| **1. Foundation** | Drizzle migration (agent_audit_log), env var, nginx config, `@modelcontextprotocol/sdk` install | DB tablosu, nginx hazır |
| **2. MCP skeleton** | `server/mcp/{index,transport,auth,registry,audit}.ts`, mount, healthcheck | Cowork bağlanır, tool listesi boş ama handshake çalışır |
| **3. Read tools** | 10 read tool, hepsi audit log'lu | Cowork sorgular yapabilir; v1 "read-only Cowork" hazır |
| **4. Write tools** | 10 write tool, hepsi transaction içinde | Cowork prosedür/masraf/ödeme yaratabilir |
| **5. AI wrapper tools** | `ai_extract_pdf`, `ai_ask_internal` | Cowork zincirleme PDF→Tax akışları yapabilir |
| **6. Destructive tools** | 3 destructive tool, default `dry_run=true` | Silme/kapama için Cowork onayıyla |
| **7. End-to-end test** | Cowork'tan smoke task'lar, Gmail Dispatch denemesi | Production-ready |

Her Phase ayrı PR / ayrı deploy. Phase 3 sonrası ilk gerçek kullanım denenebilir.

## 11. Riskler ve Açık Sorular

- **nginx 60s timeout:** Phase 1'de `300s` ile değiştirilmeli — uzun tool zincirleri kesilmesin. Mevcut config dosyasına erişim gerek.
- **Anthropic egress IP listesi:** Henüz yayınlanmadı; v1'de token yeterli, sonra eklenir.
- **`write_import_excel` boyut sınırı:** Express `limit: 50mb` zaten var; daha büyük dosyalar S3 reference ile geçilir.
- **`ai_ask_internal` session bağımlılığı:** Mevcut `ai-ask.ts` session middleware'i bekliyor olabilir — wrapper'da bypass edilmeli; doğrulanacak.
- **Reversibility derinliği:** v1 audit log + transaction ile yetinilir; gerçek "undo" tool'u Phase 2.

## 12. Onaylanmış Kararlar Özeti

- ✅ Yaklaşım B (yeni `server/mcp/` modülü)
- ✅ Production deployment (cncsohoimportmanager.com altında)
- ✅ Full autonomous + audit log + transaction-based reversibility (Seçenek 3)
- ✅ Single-user Cowork (Cem), bearer token auth
- ✅ Mevcut AI özellikleri korunur, MCP wrapper'lar eklenir
- ✅ Scheduling ve Gmail trigger = Cowork tarafında, app-side kod yok
