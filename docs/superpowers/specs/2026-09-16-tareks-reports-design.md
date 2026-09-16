# Tareks Reports — Tasarım Notu

Tarih: 2026-09-16
Durum: Onaylandı (Cem, 2026-09-16)

## Amaç

Teste (Tareks / lab) giden ürünlerin test raporlarını uygulamada saklamak.
Raporlar **style numarasına göre** listelenir; kullanıcı checkbox ile tek tek
veya "tümünü seç" ile hepsini seçip indirebilir.

## Kapsam

- Yeni sol menü sekmesi: "Tareks Reports" → `/tareks-reports`
- PDF (ve JPG/PNG) rapor yükleme, çoklu dosya desteği
- Dosya adından otomatik style tespiti + kullanıcı düzeltmesi
- Style bazlı liste, arama, checkbox seçimi
- Seçilenleri indirme: tek dosya → doğrudan; çok dosya → ZIP
- Rapor silme

Kapsam dışı: rapor içeriğinin (PDF metninin) okunması/AI analizi, test sonucu
(pass/fail) takibi, otomatik prosedür eşleştirme.

## Veri modeli

İki yeni tablo (manual DDL ile eklenir — `db:push` YASAK, mevcut şema drift'i var):

### `tareks_reports`
| kolon | tip | not |
|---|---|---|
| id | serial PK | |
| original_filename | text NOT NULL | kullanıcının yüklediği ad |
| object_key | text NOT NULL | Hetzner S3 anahtarı |
| file_size | integer NOT NULL | |
| file_type | text NOT NULL | mime type |
| procedure_reference | text NULL | opsiyonel; `procedures.reference` FK, ON DELETE SET NULL |
| test_date | text NULL | opsiyonel, serbest |
| notes | text NULL | |
| uploaded_by | integer NULL → users.id | |
| created_at | timestamptz DEFAULT now() | |

### `tareks_report_styles`
| kolon | tip | not |
|---|---|---|
| id | serial PK | |
| report_id | integer NOT NULL → tareks_reports.id ON DELETE CASCADE | |
| style | text NOT NULL | büyük harfe normalize edilmiş |
| created_at | timestamptz DEFAULT now() | |

İndeksler: `tareks_report_styles(style)`, `tareks_report_styles(report_id)`,
UNIQUE `(report_id, style)`.

Bir rapor 1..n style'a bağlanabilir (kullanıcı kararı: "ikisi de olabilir").

## Dosya adından style tespiti

Gerçek dosya adları (kullanıcının arşivinden):

```
A0059U Test raporu
M3245R - BURGUNDY
AWFOSR1085-001
A0590V - 2606001012
M3193R - 260059838_-_TAREKS_NO_A26638221_-_MODEL_NO_
M3732R -  M5251R - 2856984 - Ticaret Bakanlığı (Softline) - A26857186 - SOHO PERAKENDE YATIRIM -
M3228R  EKOTEKS 2600003016 PASS SOHO ALO KAZAK MAVI A26410945
```

Çıkarımlar:
- Style genelde başta, ama bir dosyada birden fazla style olabilir (`M3732R - M5251R`)
- Dosya adında TAREKS numaraları var (`A26638221`, `A26410945`) — style'a benzer,
  style DEĞİL. Bunlar 1 harf + 8 rakam.
- Style formatları değişken: `W3956R`, `A0690U`, `AWSNSN1056`, `W31084R`, `AMTOJR1121`

Algoritma (iki aşamalı, `server/tareks-reports/style-matcher.ts`):
1. **Bilinen style eşleşmesi (birincil):** dosya adı büyük harfe çevrilir,
   `products.style` listesindeki (~1605 kayıt) her style için kelime sınırı
   kontrolüyle aranır. En uzun eşleşmeler önce (alt dize çakışmasını önlemek için).
2. **Yedek kalıp (bilinmeyen style'lar için):** `\b[A-Z]{1,6}\d{3,6}[A-Z]?\b`
   — 3-6 rakam sınırı TAREKS numaralarını (8 rakam) ve sipariş numaralarını
   (saf rakam) dışarıda bırakır.
3. Sonuç tekilleştirilir, sıra korunur. Kullanıcı onay ekranında düzeltir.

Yanlış pozitif riski kullanıcı onayıyla kapatılır — otomatik tespit bir
öneridir, kayıt değil.

## API uçları (`server/tareks-reports/routes.ts`)

| method | yol | iş |
|---|---|---|
| POST | `/api/tareks-reports/parse-filenames` | dosya adı listesi → her ad için önerilen style'lar (yükleme öncesi önizleme) |
| POST | `/api/tareks-reports` | multipart: dosyalar + her dosya için style listesi/prosedür → S3'e yükle + DB kaydı |
| GET | `/api/tareks-reports` | style bazlı satır listesi (arama + sayfalama) |
| GET | `/api/tareks-reports/:id/download` | tek rapor indir |
| POST | `/api/tareks-reports/download` | seçilen rapor id'leri → ZIP (archiver stream) |
| DELETE | `/api/tareks-reports/:id` | rapor + S3 nesnesi sil |

Auth: tüm yazma uçları `req.session.userId` kontrolü (mevcut desen).
Yazma isteklerinde front-end `apiRequest` kullanır (ham `fetch` token taşımaz).

ZIP yapısı: `<STYLE>/<dosya adı>`. Bir rapor birden çok style'a aitse her
style klasörüne bir kopya girer. Tek dosya seçiliyse ZIP yerine doğrudan
dosya indirilir.

## Arayüz (`client/src/pages/tareks-reports.tsx`)

- `PageLayout title={t('nav.tareksReports')}`
- Üst bar: arama kutusu (style no / dosya adı), "Rapor Yükle" butonu,
  "Seçilenleri İndir (n)" butonu
- Tablo: `[✓] | Style No | Rapor Dosyası | Yükleme Tarihi | Prosedür | işlemler`
  - Başlıktaki checkbox = tümünü seç (aramayla filtrelenmiş sonuçların tümü)
  - Bir rapor n style içeriyorsa n satırda görünür; seçim rapor id'si bazında
    tekilleştirilir (aynı dosya ZIP'e bir kez, ama ilgili her style klasörüne girer)
- Yükleme modalı: dosya seç → her dosya için tespit edilen style'lar "chip"
  olarak; silinebilir, elle eklenebilir; opsiyonel prosedür seçimi → Kaydet

i18n: `tr.json` + `en.json` altına `nav.tareksReports` ve `tareksReports.*`
anahtarları eklenir (mevcut %100 çeviri kuralı korunur).

## Test

- `server/tareks-reports/style-matcher.test.ts` — gerçek dosya adlarıyla
  (yukarıdaki liste) tespit testleri; TAREKS numaralarının style sanılmaması
  ve çift style'lı adın iki style vermesi dahil
- ZIP yol üretimi (style klasörü + ad tekilleştirme) birim testi

## Riskler

- **Şema drift:** `npm run db:push` kullanılmaz; `db/manual-ddl/005_tareks_reports.sql`
  idempotent olarak yazılır, deploy'da `scripts/apply-manual-ddl.ts` uygular.
- **nginx 60s timeout:** ZIP stream olarak yazılır (bulk-download ile aynı desen),
  büyük seçimlerde bile ilk byte hızlı gider.
- **`npm run check` kırmızı:** `pdf-data-transformer.ts` bozuk; typecheck'te
  yalnız yeni dosyaların hatasız olduğu kontrol edilir.
