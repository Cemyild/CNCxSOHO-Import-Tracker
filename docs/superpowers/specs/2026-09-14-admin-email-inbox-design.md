# Admin Mail Takibi (Gmail → özet → prosedür eşleştirme) — Tasarım

**Tarih:** 2026-09-14
**Durum:** Onaylandı (brainstorming), uygulama planı bekleniyor
**Kapsam:** Yalnızca `admin` rolü

## Problem

Firmadan gelen mailler (tedarikçi, taşıyıcı, gümrük müşaviri) şu an tamamen
uygulama dışında kalıyor. Bir sevkiyatla ilgili evrak talebi, ödeme uyarısı veya
gümrük bilgisi maille geliyor; uygulamadaki prosedür kaydıyla bağı yalnızca
kullanıcının kafasında kuruluyor. Sonuç: gözden kaçan işler ve prosedür kaydına
hiç işlenmeyen ekler.

## Hedef

Admin'in mail kutusundaki iş maillerini otomatik okuyup özetleyen, yapılacakları
çıkaran ve mümkün olduğunda ilgili prosedürle eşleştiren bir sayfa. Mail
kutusuna ve prosedür verisine **hiçbir otomatik yazma yok**; ek kaydetme dahil
her yazma işlemi admin onayıyla.

## Kararlar (brainstorming çıktısı)

| Konu | Karar |
|---|---|
| Mail sağlayıcı | Google Workspace → Gmail API |
| Bağlantı yöntemi | Kullanıcı OAuth (tek seferlik izin), `gmail.readonly` |
| Tarama kapsamı | Yalnızca admin'in tanımladığı gönderen adres/alan adları |
| Sıklık | 15 dakikada bir + manuel "Şimdi kontrol et" |
| İlk dolum | Son 7 gün |
| Yetenek | Özet + yapılacaklar + prosedür eşleştirme + **onaylı** ek kaydetme |
| Model | `claude-sonnet-4-6` (projede kullanılan varsayılan) |

## Kapsam dışı (bu sürümde yapılmayacak)

- Mail gönderme, cevaplama, taslak oluşturma, etiketleme, silme
- Maildeki faturadan otomatik gider/servis faturası kaydı oluşturma
- Birden fazla kullanıcının mail kutusu (tek hesap, admin'in kendi kutusu)
- Gmail push/webhook (watch API) — sabit aralıklı çekme yeterli
- `nav` menü dizilerindeki mevcut tekrarın (her sayfa kendi `items` dizisini
  tanımlıyor) refaktörü

---

## 1. Veri modeli

Dört yeni tablo. **Enum kullanılmayacak**: mevcut tablolarda `status` kolonları
gerçek DB enum'ı olduğu için şema kayması yaşanıyor; yeni tablolarda tüm durum
kolonları düz `text` + uygulama seviyesinde doğrulama.

Tablolar `shared/schema.ts` içine Drizzle tanımı olarak, DDL ise
`db/manual-ddl/004_email_inbox.sql` içine idempotent (`CREATE TABLE IF NOT
EXISTS`) yazılır. `db:push` **kullanılmaz**; deploy sırasında
`scripts/apply-manual-ddl.ts` uygular.

### `email_accounts`
Bağlı Gmail hesabı. Pratikte tek satır olacak ama tablo çok satıra izin verir.

| Kolon | Tip | Not |
|---|---|---|
| `id` | serial PK | |
| `user_id` | int → `users.id`, NOT NULL | bağlantıyı kuran admin |
| `provider` | text NOT NULL default `'gmail'` | ileride başka sağlayıcı için |
| `email_address` | text NOT NULL | Google'dan dönen gerçek adres |
| `access_token` | text | şifreli (bkz. §5) |
| `refresh_token` | text | şifreli |
| `token_expires_at` | timestamp | |
| `last_synced_at` | timestamp | başarılı liste çekiminden sonra güncellenir |
| `status` | text NOT NULL default `'connected'` | `connected` / `error` / `disconnected` |
| `last_error` | text | son hata mesajı (kullanıcıya gösterilir) |
| `created_at`, `updated_at` | timestamp | |

UNIQUE(`user_id`, `email_address`).

### `email_watched_senders`

| Kolon | Tip | Not |
|---|---|---|
| `id` | serial PK | |
| `pattern` | text NOT NULL UNIQUE | küçük harfe indirgenmiş; `ali@dhl.com` ya da `@dhl.com` |
| `label` | text | firma adı, listede gösterilir |
| `active` | boolean NOT NULL default true | |
| `created_by` | int → `users.id` | |
| `created_at` | timestamp | |

`pattern` doğrulaması: ya geçerli bir mail adresi, ya `@` ile başlayan alan adı.

### `emails`

| Kolon | Tip | Not |
|---|---|---|
| `id` | serial PK | |
| `account_id` | int → `email_accounts.id` NOT NULL | |
| `gmail_message_id` | text NOT NULL UNIQUE | tekrar işlemeyi engelleyen anahtar |
| `gmail_thread_id` | text | "Gmail'de aç" linki için |
| `from_address`, `from_name`, `to_address` | text | |
| `subject` | text | |
| `sent_at` | timestamp | Gmail `internalDate` |
| `snippet` | text | Gmail'in kendi kısa önizlemesi |
| `body_text` | text | düz metin (yoksa HTML'den çıkarılmış) |
| `summary` | text | Claude çıktısı, Türkçe |
| `category` | text | `payment` / `document` / `customs` / `shipment` / `other` |
| `urgency` | text | `high` / `normal` / `low` |
| `action_items` | jsonb | `[{ id, text, done }]` |
| `extracted_refs` | jsonb | `{ procedureRefs, awbNumbers, invoiceNumbers, customsFileNumbers }` |
| `procedure_id` | int → `procedures.id` NULL | eşleşen prosedür |
| `match_confidence` | text | `exact` / `ai` / `manual` / `none` |
| `match_reason` | text | hangi numara/gerekçeyle eşleşti |
| `status` | text NOT NULL default `'new'` | `new` / `read` / `done` |
| `ai_status` | text NOT NULL default `'pending'` | `pending` / `ok` / `failed` |
| `ai_error` | text | |
| `ai_attempts` | int NOT NULL default 0 | |
| `has_attachments` | boolean NOT NULL default false | |
| `created_at`, `updated_at` | timestamp | |

İndeksler: `gmail_message_id` (unique), `sent_at DESC`, `status`, `procedure_id`.

### `email_attachments`

| Kolon | Tip | Not |
|---|---|---|
| `id` | serial PK | |
| `email_id` | int → `emails.id` ON DELETE CASCADE NOT NULL | |
| `gmail_attachment_id` | text NOT NULL | indirme için |
| `filename`, `mime_type` | text | |
| `size_bytes` | int | |
| `storage_path` | text NULL | S3 anahtarı; ancak prosedüre kaydedilince dolar |
| `procedure_document_id` | int → `procedure_documents.id` NULL | |
| `status` | text NOT NULL default `'pending'` | `pending` / `saved` / `dismissed` |
| `created_at` | timestamp | |

Ekler senkron sırasında **indirilmez**; yalnızca üst verisi kaydedilir. İndirme,
admin "prosedüre kaydet" dediğinde olur. Böylece depolama ve bant genişliği boşa
harcanmaz.

---

## 2. Sunucu mimarisi

Tüm yeni sunucu kodu `server/email/` altında, her dosya tek işli:

| Dosya | Sorumluluk | Bağımlılık |
|---|---|---|
| `token-crypto.ts` | AES-256-GCM ile token şifreleme/çözme | `EMAIL_TOKEN_ENC_KEY` |
| `gmail-client.ts` | OAuth token yenileme + Gmail REST çağrıları (`messages.list`, `messages.get`, `attachments.get`) | `googleapis` |
| `message-parser.ts` | Gmail ham mesajını `{from, subject, sentAt, bodyText, attachments[]}` yapısına çevirir — **saf fonksiyon, test edilir** | yok |
| `reference-extractor.ts` | Metinden referans/AWB/fatura/dosya no çıkarır — **saf fonksiyon, test edilir** | yok |
| `summarizer.ts` | Claude çağrısı: özet + kategori + aciliyet + yapılacaklar | `server/claude.ts` |
| `procedure-matcher.ts` | Önce kesin eşleşme, olmazsa Claude'a kısa liste sordurma | db, claude |
| `sync-service.ts` | Senkron turunu yürütür; kilitleme ve hata yönetimi | yukarıdakiler |
| `scheduler.ts` | 15 dakikalık zamanlayıcı; `server/index.ts` içinden başlatılır | sync-service |
| `oauth-routes.ts` | `auth-url` + `callback` uç noktaları | gmail-client |
| `routes.ts` | Admin API'si (aşağıda) | hepsi |

`server/email/routes.ts` bir `express.Router` döner ve `server/routes.ts` içinde
mevcut desenle bağlanır: `app.use("/api/email", emailRoutes)` (bkz.
`app.use("/api/offsets", offsetsRoutes)`, `server/routes.ts:5373`).

**Yeni bağımlılık:** `googleapis` (OAuth akışı + Gmail REST istemcisi).
Şifreleme `node:crypto` ile yapılır, ek paket gerekmez.

### Uç noktalar

Aşağıdakilerin **tamamı** `requireRole('admin')` ile korunur (OAuth callback
hariç, bkz. §5):

| Metot | Yol | İş |
|---|---|---|
| GET | `/api/email/account` | bağlantı durumu, adres, son senkron zamanı, son hata |
| GET | `/api/email/google/auth-url` | Google izin ekranının URL'i (imzalı `state` ile) |
| GET | `/api/email/google/callback` | Google dönüşü; token'ları kaydeder, `/settings`'e yönlendirir |
| DELETE | `/api/email/account` | bağlantıyı kes (Google'da token'ı da iptal et) |
| GET | `/api/email/senders` | takip listesi |
| POST | `/api/email/senders` | `{ pattern, label }` |
| PATCH | `/api/email/senders/:id` | `{ active, label }` |
| DELETE | `/api/email/senders/:id` | |
| GET | `/api/email/messages` | filtre: `status`, `category`, `urgency`, `matched`, `sender`, `from`, `to`, `q`; sayfalı |
| GET | `/api/email/messages/:id` | tam detay + ekler |
| PATCH | `/api/email/messages/:id` | `{ status?, procedureId?, actionItems? }` — elle eşleştirme `match_confidence='manual'` yazar |
| POST | `/api/email/messages/:id/reprocess` | özeti/eşleşmeyi yeniden üret |
| POST | `/api/email/sync` | "Şimdi kontrol et" |
| POST | `/api/email/attachments/:id/save` | `{ procedureId, documentType }` → Gmail'den indir, S3'e koy, `procedure_documents` satırı aç |
| POST | `/api/email/attachments/:id/dismiss` | ilgisiz ek işaretle |

Yazma isteklerinin hepsi istemcide `apiRequest` ile yapılır (ham `fetch` token
taşımaz → 401).

---

## 3. Senkron akışı

`sync-service.ts` tek bir `runSync()` fonksiyonu sunar. Modül seviyesinde bir
`isRunning` bayrağı tutar: zamanlayıcı ile manuel düğme çakışırsa ikincisi
"zaten çalışıyor" döner.

1. Bağlı hesap yoksa veya `status='disconnected'` ise çık.
2. Aktif gönderen listesini oku. Liste boşsa çık (hiçbir şey taranmaz).
3. Gmail sorgusunu kur:
   `(from:a@x.com OR from:dhl.com OR ...) after:<epoch>`
   - `after` = `last_synced_at - 10 dakika` (çakışma payı); ilk turda `now - 7
     gün`.
   - Gönderen sayısı 25'i geçerse sorgu parçalara bölünüp ayrı ayrı çağrılır
     (Gmail sorgu uzunluğu sınırı).
4. `messages.list` → id listesi. Veritabanında zaten olan `gmail_message_id`'ler
   elenir.
5. Kalan her id için `messages.get(format='full')` → `message-parser` → `emails`
   satırı (`ai_status='pending'`), ekler `email_attachments`'a.
6. Liste adımı hatasız bittiyse `last_synced_at` güncellenir. (Adım 5'teki tek
   tek hatalar `last_synced_at`'i engellemez; o mail bir sonraki turda tekrar
   listelenir ve `gmail_message_id` benzersizliği sayesinde çift kayıt olmaz.)
7. `ai_status='pending'` satırlar sırayla (en fazla tur başına 30 tane)
   işlenir: `summarizer` → `procedure-matcher` → satır güncellenir.
   `ai_attempts >= 3` olanlar bir daha denenmez, `ai_status='failed'` kalır.

Body 20.000 karakterle sınırlanır (uzun mail zincirlerinin sonu kırpılır;
en yeni mesaj metnin başında olduğu için baştan kırpma yapılmaz).

### Zamanlayıcı

`scheduler.ts`, `server/index.ts` içinde `registerRoutes` sonrası başlatılır:
`setInterval(runSync, 15 * 60 * 1000)` + açılıştan 30 saniye sonra bir ilk tur.
`EMAIL_SYNC_ENABLED=false` ortam değişkeni ile kapatılabilir; `NODE_ENV=test`
iken hiç başlamaz. Senkrondaki hiçbir hata süreci düşürmez — yakalanır,
loglanır, `email_accounts.last_error`'a yazılır.

---

## 4. Claude kullanımı

### Özetleme (`summarizer.ts`)

Mail başına tek çağrı. Model `claude-sonnet-4-6`, `max_tokens: 1024`. Girdi:
gönderen, konu, tarih, kırpılmış gövde, ek dosya adları. Çıktı **katı JSON**:

```json
{
  "summary": "Türkçe, 2-3 cümle",
  "category": "payment|document|customs|shipment|other",
  "urgency": "high|normal|low",
  "actionItems": ["Türkçe, emir kipinde tek cümle", "..."],
  "references": {
    "procedureRefs": ["CNCALO-112"],
    "awbNumbers": ["235-51135254"],
    "invoiceNumbers": ["1000873321"],
    "customsFileNumbers": ["26-13117"]
  }
}
```

Ayrıştırma başarısızsa bir kez daha denenir; yine olmazsa `ai_status='failed'`
ve `ai_error` yazılır, mail sayfada "özetlenemedi" rozetiyle görünür ve
"Yeniden dene" düğmesi sunulur.

`references`, Claude'un çıkarımıdır; `reference-extractor.ts`'in regex çıktısıyla
**birleştirilir** (ikisinin birleşimi kullanılır) — model bir numarayı atlarsa
regex, biçimi bozuk yazılmış bir numarayı regex kaçırırsa model yakalar.

### Maliyet

Yalnızca listedeki firmalar tarandığı için günde ~20-40 mail bekleniyor. Mail
başına ~3-4 bin girdi token'ı → aylık birkaç dolar. Aynı mail asla iki kez
işlenmez.

---

## 5. Prosedür eşleştirme (`procedure-matcher.ts`)

Gerçek veriden doğrulanmış biçimler (2026-09-14, 200 prosedür):

- Referans: `CNCALO-112`, `CNCALO-104 / 2` → `/\bCNC[A-Z]{2,6}\s*-\s*\d{2,5}(\s*\/\s*\d+)?/i`
- AWB: `235-51135254`, `716-97206071` → `/\b\d{3}-\d{8}\b/`
- Gümrük dosya no: `26-13117` → `/\b\d{2}-\d{5}\b/`
- Fatura no: serbest biçimli (`SHP0001LBNTR`, `1000873321`) → regex ile
  aranmaz, yalnızca Claude'un çıkardığı değerler veritabanında birebir sorgulanır.

**Adım 1 — kesin eşleşme.** Çıkarılan numaralar `procedures` üzerinde
aranır: `reference` (boşluk/normalize edilerek), `awb_number`, `customs_file_no`,
`invoice_no`. Tek bir prosedür dönerse `match_confidence='exact'`,
`match_reason` = eşleşen alan ve değer.

**Adım 2 — kısa listeyle Claude.** Adım 1 sonuçsuz veya birden fazla aday
verdiyse: gönderenin alan adı/firma adıyla `shipper ILIKE` eşleşen ve/veya son
90 günde güncellenmiş en fazla 20 prosedür (referans, shipper, invoice_no,
awb_number, tarihler) Claude'a verilir; "hangisi, yoksa null" sorulur.
`match_confidence='ai'`, gerekçe `match_reason`'a yazılır. Kısa liste boşsa bu
çağrı hiç yapılmaz.

**Adım 3 — eşleşme yok.** `match_confidence='none'`. Sayfada "eşleşmedi"
filtresiyle görünür, admin elle prosedür seçebilir (`manual`).

---

## 6. Ek kaydetme akışı

1. Sayfada mailin ekleri listelenir (ad, tür, boyut) — henüz indirilmemiş.
2. Admin "Prosedüre kaydet" der; prosedür (varsayılan: eşleşen prosedür) ve
   belge türü (`document_types`) seçer.
3. Sunucu: `attachments.get` ile Gmail'den indirir → mevcut S3 yükleme yardımcısı
   (`server/object-storage.ts`) ile yükler → `procedure_documents` satırı açar
   (`uploadedBy` = işlemi yapan admin) → `email_attachments.status='saved'`,
   `procedure_document_id` yazılır.
4. Hata olursa hiçbir satır yazılmaz; ek `pending` kalır.

Boyut sınırı: 25 MB üstü ekler indirilmez, kullanıcıya "Gmail'den elle indirin"
mesajı gösterilir.

---

## 7. İstemci — `/inbox` sayfası

`client/src/pages/inbox.tsx` + `client/src/components/inbox/` altında parçalar
(`EmailList`, `EmailDetail`, `AttachmentActions`, `SenderSettings`).

- `App.tsx`'e `/inbox` rotası `ProtectedRoute` içinde eklenir. Sayfa ayrıca
  `useAuth().user?.role !== 'admin'` ise `/dashboard`'a yönlendirir. Asıl koruma
  sunucudadır; bu yalnızca kullanıcı deneyimi.
- `PageLayout title={t('nav.emailInbox')}` ile mevcut sayfa deseni.
- Menü girdisi ("Mail Takibi" / "Email Inbox") yalnızca admin'e gösterilir;
  sayfaların `items` dizilerine role göre filtrelenerek eklenir.
- Sol sütun: mail listesi — gönderen, konu, tarih, aciliyet rozeti, eşleşen
  prosedür rozeti, okunmadı vurgusu. Üstte filtreler ve "Şimdi kontrol et".
- Sağ sütun: özet, tik atılabilir yapılacaklar (tik `action_items` jsonb'sine
  yazılır), eşleşen prosedür linki + elle değiştirme, ekler ve kaydet/yoksay,
  "Gmail'de aç" (`https://mail.google.com/mail/u/0/#inbox/<threadId>`), ham
  metni aç/kapa.
- Ayarlar sayfasına yeni bölüm: "Mail bağlantısı" (bağlan/kes, durum, son
  senkron) ve "Takip edilen gönderenler" (ekle/sil/aktif).
- Tüm metinler `tr.json` / `en.json` içine yeni `emailInbox` anahtarı altında;
  `nav.emailInbox` eklenir. Doğrulama mesajları mevcut `validation` bloğundan.

Veri çekme `@tanstack/react-query`; yazma işlemleri `apiRequest`.

---

## 8. Güvenlik

- Her uç nokta `requireRole('admin')`. Sayfadaki gizleme ek katman, koruma değil.
- **OAuth callback** istisnadır: tarayıcı Google'dan dönerken `Authorization`
  başlığı taşıyamaz. Koruma imzalı `state` ile: `auth-url` üretilirken
  `state = base64({userId, nonce, exp}) + "." + HMAC-SHA256(secret)`. Callback
  imzayı, süreyi (10 dk) doğrular, kullanıcıyı DB'den okur ve rolünün `admin`
  olduğunu **yeniden** kontrol eder.
- İzin kapsamı yalnızca `https://www.googleapis.com/auth/gmail.readonly`.
  Uygulama mail gönderemez, silemez, etiketleyemez.
- Token'lar `EMAIL_TOKEN_ENC_KEY` (32 baytlık hex) ile AES-256-GCM şifreli
  saklanır; loglara token, mail gövdesi veya ek içeriği yazılmaz.
- Yeni ortam değişkenleri: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
  `GOOGLE_OAUTH_REDIRECT_URI`, `EMAIL_TOKEN_ENC_KEY`, (opsiyonel)
  `EMAIL_SYNC_ENABLED`. Prod'a `gh secret set` + `deploy.yml` içindeki idempotent
  enjeksiyonla gider; `.env` git'e girmez.
- Mail içeriği kullanıcı verisidir, talimat değil: özetleme istemi maildeki
  metnin veri olarak ele alınacağını açıkça söyler, mailde geçen yönergeler
  uygulanmaz.

## 9. Hata durumları

| Durum | Davranış |
|---|---|
| Refresh token geçersiz / izin iptal | `status='error'`, sayfada "Bağlantı koptu, yeniden bağlan" uyarısı; senkron durur |
| Gmail 429 / 5xx | Üstel bekleme ile 3 deneme, sonra tur atlanır, `last_error` yazılır |
| Claude hatası | `ai_attempts++`, 3 denemeden sonra `ai_status='failed'`; mail listede kalır |
| Ek indirme hatası | Ek `pending` kalır, kullanıcıya hata mesajı |
| Gönderen listesi boş | Senkron hiçbir şey taramaz; sayfada "önce firma ekleyin" yönlendirmesi |
| Senkron zaten çalışıyor | Manuel istek 409 + "zaten çalışıyor" |

## 10. Test

Vitest (mevcut `vitest.config.ts`). Gerçek Gmail ve gerçek Claude çağrısı
yapılmaz — ikisi de mock'lanır.

- `reference-extractor.test.ts` — gerçek örneklerle (`CNCALO-104 / 2`,
  `235-51135254`, `26-13117`), yanlış pozitif vakaları (tarih, telefon no)
- `message-parser.test.ts` — çok parçalı (multipart) mail, yalnızca HTML gövde,
  ekli mail, Türkçe karakter/base64 kodlaması
- `procedure-matcher.test.ts` — kesin eşleşme, çoklu aday, aday yok (Claude hiç
  çağrılmamalı), elle eşleştirme
- `sync-service.test.ts` — çift kayıt olmaması, `isRunning` kilidi, liste hatası
  sonrası `last_synced_at`'in güncellenmemesi
- `token-crypto.test.ts` — şifrele/çöz turu, bozuk veri reddi

## 11. Kullanıcının yapacağı tek seferlik kurulum

Google Cloud Console'da: proje oluştur → Gmail API'yi etkinleştir → OAuth onay
ekranını **Internal** (Workspace içi) olarak yapılandır → `gmail.readonly`
kapsamını ekle → Web uygulaması tipinde kimlik bilgisi oluştur → yönlendirme
adresi olarak `https://cncsohoimportmanager.com/api/email/google/callback` gir
(yerel geliştirme için ikinci adres: `http://localhost:5000/api/email/google/callback`)
→ Client ID ve Client Secret'ı kopyala. Internal uygulamalar Google'ın doğrulama
sürecinden muaftır.

Uygulama planı bu adımların ekran ekran yazılı bir kılavuzunu da içerecek.
