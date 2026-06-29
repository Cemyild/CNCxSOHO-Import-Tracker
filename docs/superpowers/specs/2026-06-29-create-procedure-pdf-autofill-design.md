# Tasarım: Create Procedure'de PDF'ten Otomatik Doldurma

**Tarih:** 2026-06-29
**Durum:** Onaylandı (tasarım) — uygulama planına hazır
**Sahip:** Cem

## 1. Amaç

Küçük/biten ithalat işlerinde kullanıcı tüm evrakı (beyanname, fatura, masraf
belgeleri, kendi kestiği hizmet faturaları) tek bir birleşik PDF olarak elinde
tutuyor. Bugün yeni prosedür oluşturmak için **add-procedure** sayfasındaki tüm
alanlar elle dolduruluyor, ardından prosedürün içine girilip masraflar/vergiler
ayrıca ekleniyor.

Bu özellik ile kullanıcı **Create Procedure** sayfasında tek bir PDF yükleyecek;
sistem PDF'i okuyup prosedür başlığını, vergileri, ithalat masraflarını, hizmet
faturalarını ve ürün kalemlerini çıkaracak, önizleme ekranında gösterecek;
kullanıcı onaylayınca hepsi tek seferde kaydedilecek ve ilgili belgeler doğru
yerlere iliştirilecek. Yani "işlemi başlatırken aslında bitirmiş olmak".

**Önemli kısıt:** Hiçbir vergi/masraf/ürün **hesaplaması yapılmaz.** Belgede yazan
gerçekte ödenmiş/geçerli rakamlar olduğu gibi kaydedilir. (Bu, prosedürün içindeki
mevcut "Add/Edit Expense" PDF okuma davranışının aynısıdır.)

## 2. Kapsam

### Dahil
- Tek birleşik PDF yükleme (çok sayfalı).
- Çıkarılacak ve kaydedilecek veriler:
  - **Prosedür başlığı** (beyanname + yükleme + fatura başlığı).
  - **Vergiler** (gümrük, ek gümrük, KKDF, KDV, damga) — gerçek rakamlar.
  - **İthalat masrafları** (kategori bazlı, satır satır).
  - **Hizmet faturaları** (kullanıcının kestiği).
  - **Ürün kalemleri** (style, adet, birim fiyat, tutar, HS kodu) — hesaplama yok.
- "Önce göster, sonra kaydet": tüm çıkan veri önizleme ekranında düzenlenebilir;
  kayıt kullanıcının onayıyla, atomik olarak yapılır.
- Belge yerleştirme:
  1. Her masraf ve hizmet faturası kaydına ilgili PDF sayfası iliştirilir
     (mevcut `extract-page` mekanizması).
  2. Sınıflandırılan belgeler (beyanname, fatura, çeki listesi, AWB) doğru
     etiketle prosedürün "Import Documents" alanına yüklenir.

### Hariç (YAGNI)
- Vergi/masraf/ürün **hesaplaması** (bilerek dışarıda).
- Çoklu dosya yükleme (şimdilik tek birleşik PDF; ileride eklenebilir).
- HS kodu otomatik eşleştirme garanti edilmez ("elinden geleni yap"; bulunamazsa
  alan boş bırakılır, kullanıcı doldurur).
- Mevcut manuel form akışı korunur; bu özellik ona **ek** bir yoldur, onun yerine
  geçmez.

## 3. Mevcut altyapı (yeniden kullanılacak)

Aşağıdakiler hâlihazırda var; bu tasarım bunları birleştirir.

### Sayfalar / form
- Create Procedure formu: `client/src/pages/add-procedure.tsx`
  (zod şeması ~satır 82-103), `POST /api/procedures` (`server/routes.ts:916-1008`),
  başarıda `/procedures`'a yönlenir.
- Prosedür detayındaki "Products" bölümü: `client/src/pages/procedure-details.tsx`
  (~satır 301-328, 1877-1906) → `GET /api/procedures/:reference/products`
  (`server/routes.ts:1181-1206`).

### Veri modeli (`shared/schema.ts`)
- `procedures` (121-155): `reference` (unique), shipper, invoice_no, invoice_date,
  amount, currency, package (text), kg (decimal), piece (int), arrival_date,
  awb_number, carrier, customs, import_dec_number, import_dec_date, usdtl_rate.
- `taxes` (157-181): prosedür başına **tek** kayıt (unique procedureReference);
  customsTax, additionalCustomsTax, kkdf, vat, stampTax.
- `importExpenses` (218-243): category (enum), amount, currency, invoiceNumber,
  invoiceDate, documentNumber, policyNumber, issuer, notes.
- `importServiceInvoices` (254-273): amount, currency, invoiceNumber, date, notes.
- `expenseDocuments` (276-301): expenseType (tax | import_expense |
  service_invoice | import_document), expenseId, objectKey, originalFilename,
  fileSize, fileType, importDocumentType (87-98: import_declaration, invoice,
  packing_list, awb, insurance, freight_invoice, transit_declaration, pod,
  expense_receipt, ...), procedureReference.
- `taxCalculations` (466-483): reference (unique), invoice_no, invoice_date,
  total_value, total_quantity, currency_rate, status (default 'draft'),
  procedure_id (FK → procedures.id).
- `taxCalculationItems` (485-515): tax_calculation_id (FK, notNull), line_number
  (notNull), style (notNull), cost (notNull), unit_count (notNull), total_value
  (notNull); color, category, description, fabric_content, country_of_origin,
  hts_code, tr_hs_code (hepsi nullable); hesaplama alanları (customs_tax, vat, ...)
  default '0'. Kayıt şeması hesaplama alanlarını dışlar (537-545) → **ham veriyle
  insert mümkün, hesaplama gerekmez.**

> Sonuç: Ürün kalemleri + HS kodu için **veritabanı değişikliği gerekmez.**
> Products bölümü `taxCalculationItems`'tan beslenir; `tr_hs_code` kolonu zaten var.

### Okuyucu motorlar (Claude)
- **Beyanname:** `POST /api/procedures/analyze-customs-declaration`
  (`server/routes.ts:10466-11068`). Girdi: multipart `pdf` (max 20MB). Çıktı:
  `data: { shipper, package, weight, pieces, awbNumber, customs,
  importDeclarationNumber, importDeclarationDate, usdTlRate }`. Claude vision,
  maxTokens 3000, temp 0.
- **Akıllı masraf:** `POST /api/expenses/analyze-pdf/expense-receipt`
  (`server/routes.ts:9744-10145`). Girdi: multipart `pdf`. Çıktı:
  `data: { documentType, pageCount, items: [{ description, amount, currency,
  suggestedCategory, type ('tax'|'expense'|'service_invoice'), invoiceNumber,
  invoiceDate, receiptNumber, issuer, pageNumber }], taxes: { customsTax,
  additionalCustomsTax, kkdf, vat, stampTax } }`, `pdfFile: { objectKey, ... }`.
  PDF'i S3'e yükler. Claude maxTokens 8000, temp 0.
- **Tek sayfa yeniden tara:** `POST /api/expenses/analyze-pdf/single-page`
  (`server/routes.ts:10152`). Girdi body: `{ objectKey, pageNumber }`.
- **Ürün okuyucu:** `extractFromPdf(buffer)` (`server/document-extraction.ts`),
  `POST /api/tax-calculation/extract-products` (`server/routes.ts:5562-5594`)
  tarafından kullanılır. Çıktı: `products: [{ style, color, category,
  fabric_content, cost, unit_count, country_of_origin, hts_code, total_value }]`,
  `invoiceMetadata: { invoice_no, invoice_date, shipper }`.

### Yardımcılar
- Claude istemcisi: `server/claude.ts` (varsayılan `claude-sonnet-4-6`;
  `analyzePdfWithClaude` → `document` content type, base64). Ucuz model:
  `claude-haiku-4-5-20251001`.
- Depolama: `server/object-storage.ts` → `uploadFile(buffer, filename, mimeType,
  prefix)` (Hetzner S3, prefix `SOHO/`, local fallback).
- PDF işleme: `pdf-lib` (sayfa ayırma), `pdfjs-dist`.
- Belge iliştirme: `POST /api/expense-documents/extract-page`
  (kayda sayfa iliştirir), `POST /api/expense-documents` ve import-document-upload
  (`client/src/components/ui/import-document-upload.tsx`) — "Import Documents".
- Yükleme bileşeni: `client/src/components/ui/pdf-upload-dropzone.tsx`.

## 4. Seçilen yaklaşım: A+ (sınıflandır → yönlendir → topla-kaydet)

Naif yöntemde aynı PDF her okuyucuya gönderilir (N sayfa × 3 okuyucu = 3N tarama).
Bunun yerine **önce ucuz bir ön-tarama ile her sayfa sınıflandırılır**, sonra her
sayfa **sadece ait olduğu okuyucuya** gönderilir → ~2N tarama (~%33 tasarruf).

### Akış (uçtan uca)
1. **Yükle + sakla:** Kullanıcı tek PDF yükler; orijinal PDF S3'e **bir kez**
   kaydedilir (`SOHO/procedure-imports/` benzeri prefix).
2. **Ön-tarama (sınıflandırıcı):** Tüm sayfalar tek seferde **Haiku** ile okunur;
   her sayfaya etiket atanır: `customs_declaration | expense_tax_service |
   commercial_invoice | packing_list | awb | other`. Çıktı küçük (sayfa→tip).
3. **Sayfaları ayır:** `pdf-lib` ile tipe göre alt-PDF'ler oluşturulur. Her
   alt-PDF için `altSayfa → orijinalSayfa` haritası tutulur (belge iliştirmede
   doğru orijinal sayfayı bulmak için).
4. **Yönlendir (paralel):**
   - `customs_declaration` alt-PDF'i → beyanname çıkarımı → başlık alanları.
   - `expense_tax_service` alt-PDF'i → akıllı masraf çıkarımı → vergiler +
     masraflar + hizmet faturaları (her kalemin `pageNumber`'ı orijinale remap).
   - `commercial_invoice` alt-PDF'i → ürün çıkarımı → ürün kalemleri + fatura
     başlığı (invoice_no/date/amount).
5. **Topla:** Tek birleşik yanıt döner (bkz. §5).
6. **Önizleme ekranı:** Başlık alanları dolu gelir; vergiler/masraflar/hizmet
   faturaları seçilebilir-düzenlenebilir liste; ürünler düzenlenebilir tablo.
   Kullanıcı `reference` (TR000xx) girer (PDF'te yoktur), düzeltmeleri yapar.
   "Bir kalem eksik mi? Şu sayfayı tara" düğmesi `single-page` ile yeniden tarar.
7. **Atomik kayıt:** "Oluştur" → §6'daki kayıt sırası.

### Refactor notu
Çıkarım mantığı bugün endpoint handler'larının içinde, multipart dosya alacak
şekilde. Orkestratörün alt-PDF buffer'larıyla **yeniden yükleme yapmadan**
çağırabilmesi için çekirdek çıkarım, saf fonksiyonlara ayrılmalı:
- `extractCustomsDeclaration(buffer)` (mevcut handler'dan çıkarılır),
- `extractExpenseReceipt(buffer)` (mevcut handler'dan çıkarılır),
- `extractFromPdf(buffer)` (zaten fonksiyon),
- `classifyPdfPages(buffer)` (**yeni**, Haiku).
Mevcut endpoint'ler bu fonksiyonları kullanacak şekilde sadeleştirilir (davranış
değişmez).

## 5. Yeni backend: çözümleme endpoint'i

**`POST /api/procedures/analyze-document`** (auth gerekli, mevcut Claude auth
muhafazası ile tutarlı).

- Girdi: multipart `pdf` (max 20MB, mevcut limitle tutarlı).
- İşlem: sakla → `classifyPdfPages` → ayır → paralel çıkarım → orijinal sayfa
  remap → birleştir.
- Çıktı (öneri şema):
```json
{
  "success": true,
  "pdfFile": { "objectKey": "...", "originalFilename": "...", "fileSize": 0,
               "fileType": "application/pdf", "pageCount": 0 },
  "header": {
    "shipper": "", "package": 0, "kg": 0, "piece": 0, "awbNumber": "",
    "customs": "", "importDeclarationNumber": "", "importDeclarationDate": "",
    "usdTlRate": 0, "invoice_no": "", "invoice_date": "", "amount": 0,
    "currency": "USD"
  },
  "taxes": { "customsTax": 0, "additionalCustomsTax": 0, "kkdf": 0, "vat": 0,
             "stampTax": 0 },
  "expenses": [ { "category": "", "amount": 0, "currency": "TRY",
                  "invoiceNumber": "", "invoiceDate": "", "issuer": "",
                  "documentNumber": "", "originalPage": 0 } ],
  "serviceInvoices": [ { "amount": 0, "currency": "TRY", "invoiceNumber": "",
                         "date": "", "notes": "", "originalPage": 0 } ],
  "products": [ { "style": "", "unit_count": 0, "cost": 0, "total_value": 0,
                  "tr_hs_code": "", "hts_code": "" } ],
  "documents": [ { "importDocumentType": "import_declaration",
                   "originalPages": [1,2] },
                 { "importDocumentType": "invoice", "originalPages": [3] } ]
}
```
- Notlar:
  - `products[].tr_hs_code` ham çıkarımdaki `hts_code` ile ön-doldurulur (en iyi
    çaba); kullanıcı düzenler. Bulunamazsa boş.
  - Sınıflandırıcı beyanname bulamazsa `header` boş döner; kullanıcı elle girer.
  - Her okuyucu bağımsız; biri boş dönerse diğerleri etkilenmez (kısmi sonuç).

## 6. Yeni backend: atomik oluşturma endpoint'i

**`POST /api/procedures/create-from-document`** (auth gerekli).

- Girdi: önizlemede düzenlenmiş payload + `reference` + `pdfFile.objectKey` +
  belge/sayfa haritaları (`documents`, ve her expense/serviceInvoice için
  `originalPage`).
- İşlem sırası:
  1. **DB transaction:**
     a. `procedures` insert (mevcut create mantığı/validasyon ile; `reference`
        benzersizlik kontrolü).
     b. `taxes` insert (sıfırdan fazla bir vergi varsa).
     c. `importExpenses` insert (her seçili masraf).
     d. `importServiceInvoices` insert (her seçili hizmet faturası).
     e. `taxCalculations` insert (`procedure_id`, `reference`, `invoice_no`,
        `invoice_date`, `total_value`, `total_quantity`, `currency_rate`,
        `status: 'draft'`) + `taxCalculationItems` insert (ham alanlarla;
        hesaplama alanları default 0). → Products bölümü dolar.
  2. **Belge iliştirme (transaction dışı, en iyi çaba, per-dosya statü):**
     a. Her masraf/hizmet faturası için `extract-page` ile ilgili orijinal sayfa
        kesilip kayda iliştirilir (expenseType `import_expense` / `service_invoice`).
     b. `documents[]`'taki her belge için ilgili orijinal sayfa(lar) alt-PDF olarak
        kesilip S3'e yüklenir ve `expenseDocuments`'a `expenseType:
        'import_document'` + doğru `importDocumentType` ile yazılır
        ("Import Documents" alanı).
  3. Yanıt: `{ success, reference, attachments: { ok, failed } }`.
- Hata davranışı: DB transaction başarısızsa hiçbir kayıt yapılmaz (yarım prosedür
  yok). Belge iliştirme başarısızlıkları prosedürü iptal etmez; kullanıcıya
  "şu belgeler iliştirilemedi" bildirilir (sonradan elle yüklenebilir).
- Başarıda kullanıcı prosedür detayına (`/procedures/:reference` veya mevcut
  yönlendirme) gönderilir.

## 7. Frontend

- `add-procedure.tsx` üstüne **"PDF yükle ve otomatik doldur"** alanı
  (`PdfUploadDropzone` yeniden kullanılır). Yükleme → `analyze-document`.
- **Önizleme/inceleme UI** (yeni bileşen, ör. `ProcedureDocumentImportReview`):
  - Başlık alanlarını mevcut forma doldurur (kullanıcı düzenleyebilir).
  - Vergiler/masraflar/hizmet faturaları için seçilebilir-düzenlenebilir liste —
    `expense-entry.tsx`'teki "RecognizedItem" tablo desenini örnek alır
    (`client/src/pages/expense-entry.tsx:331-347, 1288+`).
  - Ürünler için düzenlenebilir tablo (style, adet, birim fiyat, tutar, TR HS Code);
    satır ekle/sil; boş HS kodu kullanıcı tarafından doldurulabilir.
  - "Şu sayfayı tekrar tara" (single-page) ve sonucu listeye ekleme.
- "Oluştur" → `create-from-document`.
- **i18n:** Tüm yeni metinler TR/EN kaynaklarına eklenir; mevcut desenlere uyulur
  (FormMessage merkezî validation; PageLayout başlığı `nav.*`).

## 8. Bilinen kısıtlar ve riskler

- **Proxy zaman aşımı:** Üretimde nginx önünde ~60s `proxy_read_timeout` var.
  Ön-tarama + 3 okuyucu zinciri büyük PDF'lerde bunu zorlayabilir. Azaltma:
  okuyucuları paralel çalıştır; ön-taramada Haiku kullan; hedef < 60s. Çok büyük
  PDF'ler bu sınırı aşarsa **v2'de** çözümlemeyi arka plan işi + durum sorgusu
  (job + poll) haline getir. v1 senkron, < 60s hedefiyle.
- **Yanlış sınıflandırma:** Bir sayfa yanlış etiketlenirse kalem atlanabilir.
  Azaltma: "şu sayfayı tara" emniyet kemeri + her şeyin düzenlenebilir önizlemesi.
- **HS kodu kaynağı:** Ticari faturada TR GTIP olmayabilir; beyannamede olabilir
  ama kalem-style eşleştirmesi v1 kapsamı dışı. v1: en iyi çaba ön-doldurma +
  manuel düzenleme.
- **Maliyet:** İşlem başına ~2N sayfa tarama; kabul edilebilir (birkaç sent
  mertebesinde). Beyanname/masraf okuyucuları Sonnet, sınıflandırıcı Haiku.
- **MCP politikası:** Bu özellik tamamen app'in UI/endpoint'leri içinde çalışır;
  hiçbir MCP write/extract tool'u kullanılmaz.
- **Akıllı masraf okuyucusunun sayfa-sayısı sezgisi:** Mevcut okuyucu, belgeyi
  sayfa sayısına göre (1-2 sayfa → hizmet faturası, 3+ → masraf makbuzu) ayırıyor.
  Sadece `expense_tax_service` sayfaları gönderildiğinde bu sezgi yanıltabilir.
  Azaltma: yönlendirmede masraf/vergi sayfaları ile hizmet faturası sayfalarını
  ayrı alt-PDF'lere bölmeyi veya okuyucudan dönen kalem bazlı `type` alanına
  güvenmeyi (sayfa-sayısı sezgisi yerine) uygulama planında netleştir.

## 9. Test stratejisi

- **Birim:** `classifyPdfPages` (örnek belgelerle sayfa→tip), PDF ayırıcı
  (`altSayfa→orijinalSayfa` doğruluğu), payload→tablo eşlemesi.
- **Entegrasyon:** `analyze-document` birleşik şema; `create-from-document` tüm
  kayıtları oluşturur + belgeleri iliştirir; DB transaction rollback (referans
  çakışması) yarım kayıt bırakmaz.
- **Manuel:** Repodaki örnek dosyalarla (ör. `attached_assets/TR00025 ...`,
  `TR00023 CI & PL.xlsx` karşılıkları / birleşik PDF örnekleri) uçtan uca.

## 10. Başarı kriterleri

- Kullanıcı Create Procedure'de tek PDF yükleyip, en fazla `reference` girerek ve
  birkaç düzeltme yaparak, prosedürü + vergileri + masrafları + hizmet faturalarını
  + ürünleri tek tıkla oluşturabiliyor.
- Hesaplama yapılmıyor; gerçek rakamlar kaydediliyor.
- Her masraf/hizmet faturası kaydında ilgili sayfa belge olarak duruyor; beyanname
  ve fatura "Import Documents" alanında doğru etiketle bulunuyor.
- Yanlış/eksik okuma önizlemede düzeltilebiliyor; yarım prosedür oluşmuyor.
