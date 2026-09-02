# Prosedürler Arası Mahsuplaşma (Payment Offset)

**Tarih:** 2026-08-06
**Durum:** Onaylandı (brainstorming), uygulama planı bekleniyor
**Kapsam:** Fazla ödemeli prosedürlerden borçlu prosedürlere para aktarımı — elle ve tek tuşla otomatik

## Problem

Gelen ödemeler (`incoming_payments`) prosedürlere dağıtılıyor (`payment_distributions`).
Dağıtım prosedürün giderinden azsa **borç**, fazlaysa **fazla ödeme** çıkıyor.

Bugün fazla ödemeyi başka bir prosedüre aktarmanın yolu yok. Elle çözüm için mevcut
dağıtımı silip yeniden yapmak gerekiyor — hem uzun, hem izi kayboluyor.

### Canlı veriden mevcut durum (2026-08-06 ölçümü)

| | Adet | Tutar |
|---|---|---|
| Fazla ödemeli prosedür | 13 | 1.254.083,29 TL |
| Borçlu prosedür | 15 | 5.098.800,34 TL |
| Dengede | 157 | — |

Onaylanan algoritmanın canlı veri üzerinde simülasyonu: **15 borcun 11'i tam kapanıyor**,
1.236.935,07 TL aktarılıyor, 20 aktarım oluşuyor, 17.148,22 TL fazla artıyor.
Bu rakamlar uygulama sonrası doğrulama ölçütüdür (bkz. Test planı).

### Ölçümü mümkün kılan iki tespit

1. **Tek para birimi.** `incoming_payments` tablosundaki 83 kaydın tamamı `TL`.
   `procedures.currency` (USD/EUR) ürün faturasının para birimidir, ödeme tarafını
   ilgilendirmez. Mahsuplaşma tek para biriminde çalışır, kur dönüşümü yoktur.

2. **Fazla ödemelerin kaynağı tamamen `payment_distributions`.** Fazla ödemesi olan
   13 prosedürün hiçbirinde eski usul `payments` kaydı yok (hepsinde 0 kayıt).
   Mahsup mekaniği yalnızca dağıtım kayıtları üzerinden kurgulanabilir.

### Bakiye formülü (mevcut, değişmiyor)

`server/storage.ts:2253` `calculateFinancialSummary`:

```
totalExpenses  = import_expenses + import_service_invoices + taxes
                 (customs + additional_customs + kkdf + vat + stamp)
totalPayments  = payments + payment_distributions
remainingBalance = totalExpenses - totalPayments
```

`remainingBalance > 0` → borç, `< 0` → fazla ödeme.

## Alınan kararlar

| # | Konu | Karar |
|---|---|---|
| 1 | Aktarım sınırı | Aynı müşteri. Sistemde müşteri alanı yok (yalnızca `procedures.shipper`) ve fiilen tek müşteri var → **kural yerine isteğe bağlı gönderici filtresi**. Müşteri alanı eklenirse kural oraya bağlanır. |
| 2 | Otomatik eşleştirme mantığı | **Önce tam kapanan borçlar** — mümkün olan en çok sayıda borcu tamamen kapat. |
| 3 | Yer ve kapsam | **Ayrı "Mahsuplaşma" sayfası**, toplu otomatik + elle aktarım. |
| 4 | Kapalı prosedürler | **Tamamen dahil** (hem fazlası kullanılır hem borcu kapatılır), listede turuncu "kapalı" rozetiyle işaretlenir. |
| 5 | Kayıt yöntemi | **Çift kayıt**: kaynağa eksi, hedefe artı satır. Eski kayıtlara dokunulmaz. |
| 6 | Gideri girilmemiş prosedürler | **Listeye hiç girmez.** (2026-08-14'te uygulama sırasında ortaya çıktı, bkz. aşağıda.) |
| 7 | Elle aktarımda üst sınır | **Yalnızca kaynak sınırlıdır.** Hedefin borcundan fazlası aktarılabilir; hedef fazla ödemeye geçer. (2026-08-14, kullanıcı talebi.) |

### Karar 7'nin gerekçesi

İlk sürümde elle aktarım, hedefin borcuyla sınırlıydı. Gerçek kullanımda bunun
yetmediği görüldü: `CNCALO-101`'deki 125.826,55 TL fazlanın tamamı, borcu
49.674,59 TL olan `CNCALO-101 / 2`'ye aktarılmak istendi — kalan 76.151,96 TL o
prosedürde fazla ödeme olarak beklesin diye. Bu, aynı işin devam eden
parçalarında paranın ileri taşınmasının normal bir yolu.

Sunucu tarafı bunu zaten kabul ediyordu (`applyOffsets` yalnızca kaynağın
fazlasını kontrol eder); kısıt sadece arayüzdeydi ve kaldırıldı. Kaynak sınırı
korunur: bir prosedür sahip olmadığı parayı veremez.

**Otomatik eşleştirme bundan etkilenmez** — orada bir borcu aşan aktarım
üretilmez, hedefler tam kapatılır.

Arayüz, borcu aşan bir tutar girildiğinde hedefte ne kadar fazla ödeme
oluşacağını yazar; kaynağın fazlasını aşan tutarda ise kırmızı uyarı verir ve
buton pasif kalır.

### Karar 6'nın gerekçesi

Uygulama sırasında canlı veride şu durum çıktı: `CNCALO-98` (11.411.500 TL),
`CNCALO-103` (5.151.000 TL) ve `CNCALO-100` (2.334.500 TL) prosedürlerine avans
ödemesi dağıtılmış ama gider, hizmet faturası ve vergi tarafı **hiç girilmemiş**
(üçünde de toplam gider 0). Bakiye formülü bunları 18.897.000 TL'lik "fazla ödeme"
olarak gösteriyordu — toplam fazlanın %94'ü.

Bu para fazla değil, o işin masrafları için bekliyor. Mahsuplaşsaydı, giderler
girildiği anda prosedür aynı tutarda borçlu çıkardı.

**Kural:** gider + hizmet faturası + vergi toplamı `0` olan bir prosedür fazla ödeme
adayı sayılmaz. Sessizce elenmez: `getOffsetCandidates` bu prosedürlerin sayısını ve
tutarını `uncosted` alanında döndürür, ekranda dipnot olarak görünür. Gider girildiği
anda prosedür kendiliğinden listeye döner.

## Kayıt mekaniği

### Çift kayıt

Bir aktarım = `payment_distributions` tablosunda iki satır, **aynı `incoming_payment_id`** ile:

| Prosedür | `distributed_amount` | `payment_type` | `offset_id` |
|---|---|---|---|
| Kaynak (CNCALO-96) | −66.896,97 | tüketilen kaydın tipi | 42 |
| Hedef (CNCALO-94) | +66.896,97 | `balance` | 42 |

Aynı gelen ödemeye bağlı olmaları zorunludur: `updatePaymentDistributionStatus`
(`server/storage.ts:2104`) gelen ödemenin `amount_distributed` / `remaining_balance` /
`distribution_status` alanlarını dağıtım satırlarını toplayarak yeniden hesaplar.
−X ve +X aynı ödemeye bağlıysa net toplam değişmez, gelen ödeme kaydı hiç etkilenmez.

`remaining_balance` hesabında `Math.max(0, ...)` var; net toplam korunduğu için bu
kısıt tetiklenmez.

### Kaynak tüketme (LIFO)

Kaynak prosedürde birden fazla dağıtım kaydı olabilir (örn. CNCALO-62 GARMENTS 2: 5 kayıt).
Aktarılacak tutar, **en yeni dağıtım kaydından başlayarak geriye doğru** tüketilir
(`distribution_date` azalan, eşitlikte `id` azalan).

Bir dağıtım kaydının tüketilebilir üst sınırı, o kaydın pozitif tutarından aynı kayda
daha önce yazılmış mahsup çıkışlarının düşülmesiyle bulunur. Tutar tek kayda sığmazsa
birden fazla gelen ödemeye bölünür → **her bölüm için ayrı çift kayıt**, hepsi aynı
`payment_offsets` satırına bağlanır.

### Ödeme tipi

- Çıkış satırı: tükettiği kaydın `payment_type` değerini alır (avans ise `advance`) —
  böylece o tipin toplamı doğru düşer.
- Giriş satırı: `balance` (borç kapatıyor).

### Değişmezler

Her aktarımdan sonra doğru kalması gereken kurallar:

1. `incoming_payments` satırının `total_amount`, `amount_distributed`,
   `remaining_balance`, `distribution_status` değerleri **değişmez**.
2. Tüm prosedürlerin `remainingBalance` toplamı değişmez (para yaratılmaz/yok edilmez).
3. Kaynak prosedürün fazlası aktarım kadar azalır, hedefin borcu aktarım kadar azalır.
4. Hiçbir prosedürün net dağıtım toplamı eksiye düşmez.

## Eşleştirme algoritması

Saf fonksiyon, veritabanı bilmez. Girdi: fazla listesi + borç listesi. Çıktı: aktarım listesi.

```
TOLERANS = 1.00 TL      // altındaki farklar yok sayılır
KURUS    = 0.005        // yuvarlama epsilonu

fazlalar = fazla > TOLERANS olanlar, tutara göre büyükten küçüğe
borclar  = borç  > TOLERANS olanlar, tutara göre KÜÇÜKTEN büyüğe

for borç in borclar:
    if toplam_kalan_fazla + KURUS < borç.tutar:
        continue                      // tam kapatamıyorsa hiç dokunma
    for fazla in fazlalar:
        if borç.kalan <= KURUS: break
        if fazla.kalan <= KURUS: continue
        tutar = min(fazla.kalan, borç.kalan)
        aktarımlar += { kaynak: fazla.ref, hedef: borç.ref, tutar }
        fazla.kalan -= tutar; borç.kalan -= tutar
```

Küçükten büyüğe sıralama, "en çok sayıda borcu tam kapat" hedefinin karşılığıdır.
Tam kapatılamayan borca **hiç dokunulmaz** — otomatik modda kısmi ödeme yapılmaz,
fazla artar. (Kısmi ödeme yalnızca elle aktarımda mümkündür.)

Not: bir borcun birden fazla fazladan beslenmesi (`CNCALO-94` ← `CNCALO-96` + `CNCALO-74`)
normaldir ve her biri ayrı çift kayıt üretir.

## Veri modeli

### Yeni tablo: `payment_offsets`

| Kolon | Tip | Açıklama |
|---|---|---|
| `id` | serial PK | |
| `batch_id` | text | Toplu işlemi gruplar; elle aktarımda da dolar (tek elemanlı parti) |
| `from_reference` | text → procedures.reference | Kaynak prosedür |
| `to_reference` | text → procedures.reference | Hedef prosedür |
| `amount` | decimal(15,2) | Aktarılan tutar (daima pozitif) |
| `offset_date` | timestamp | |
| `mode` | text | `auto` \| `manual` |
| `notes` | text null | |
| `created_by` | integer → users.id | |
| `created_at` | timestamp | |
| `reversed_at` | timestamp null | Geri alındıysa dolu |
| `reversed_by` | integer → users.id null | |

### Mevcut tabloya ek: `payment_distributions.offset_id`

`integer null references payment_offsets(id)`. Çıkış ve giriş satırlarını künyeye bağlar.
`null` = normal dağıtım (mevcut tüm 272 kayıt).

Ek kolona ihtiyaç yok: taraf bilgisi tutarın işaretinden, karşı prosedür
`payment_offsets` satırından okunur.

### DDL

`db/manual-ddl/003_payment_offsets.sql` — idempotent (`create table if not exists`,
`alter table ... add column if not exists`). Push'ta `scripts/apply-manual-ddl.ts` uygular.
`db:push` **kullanılmaz** (şema sürüklenmesi riski).

`shared/schema.ts` içine Drizzle tanımı + insert şeması + tipler eklenir.

## Sunucu

`server/routes.ts` 395 KB'lık monolit; yeni kod oraya girmez. Üç yeni dosya:

### `server/offset-engine.ts` — saf hesap

- `matchOffsets(overpayments, debts)` → aktarım listesi (yukarıdaki algoritma)
- `planSourceConsumption(distributions, amount)` → hangi gelen ödemeden ne kadar (LIFO)
- Tolerans/yuvarlama yardımcıları

Veritabanı bağımlılığı yok → doğrudan test edilir.

### `server/offset-service.ts` — veritabanı işleri

- `getOffsetCandidates(filter)` — **tek SQL sorgusu** ile tüm prosedürlerin bakiyesi.
  Mevcut `calculateFinancialSummary` prosedür başına ~5 sorgu atıyor; 185 prosedür için
  900+ sorgu, nginx'in 60 sn `proxy_read_timeout` sınırına takılır. Tek sorgulu sürüm
  bugün canlı veride çalıştırıldı, doğrulandı.
- `previewOffsets(filter)` — motoru çağırır, **hiçbir şey yazmaz**
- `applyOffsets(moves, userId)` — tek `db.transaction` içinde:
  1. Bakiyeleri yeniden hesapla, her hareketi kaynak fazlasına karşı doğrula
  2. `payment_offsets` satırını yaz
  3. LIFO planına göre çift kayıtları yaz
  4. Etkilenen her `incoming_payment_id` için `updatePaymentDistributionStatus`
  5. `logActivity` ile prosedür geçmişine düş
  Herhangi bir adım hata verirse tüm işlem geri alınır.
- `reverseOffset(id, userId)` / `reverseBatch(batchId, userId)` — bağlı dağıtım
  satırlarını siler, `reversed_at` / `reversed_by` doldurur, ödeme durumlarını tazeler
- `getOffsetHistory()` — partiler hâlinde, geri alınanlar işaretli

### `server/offsets-routes.ts` — uç noktalar

| Metot | Yol | Yetki |
|---|---|---|
| GET | `/api/offsets/candidates` | oturum |
| POST | `/api/offsets/preview` | oturum |
| POST | `/api/offsets/apply` | `admin`, `accountant` |
| GET | `/api/offsets/history` | oturum |
| POST | `/api/offsets/:id/reverse` | `admin`, `accountant` |
| POST | `/api/offsets/batch/:batchId/reverse` | `admin`, `accountant` |

GET uçlarına zorunlu auth eklenmez (mevcut ön yüz deseni GET'lerde token taşımıyor;
zorlamak export/detay/dashboard akışlarını kırar). Yazan uçlar `requireRole` ile korunur —
`routes.ts:2499`'daki mevcut desen.

Router `server/routes.ts` içinde tek satırlık `app.use(...)` benzeri bağlantıyla kaydedilir.

## Arayüz

### `client/src/pages/offsets.tsx`

İki sekme: **Eşleştirme** ve **Geçmiş**.

Eşleştirme sekmesi:
- Üstte üç özet kart: toplam fazla, toplam borç, tek tuşla kapanacak. Üçüncü kart
  `POST /api/offsets/preview` sonucundan gelir; sayfa açılışında bir kez çağrılır
  (yazma yapmadığı için güvenli), filtre değişince tazelenir.
- Filtreler: gönderici (`shipper`) seçimi, "kapalıları göster" anahtarı
- Yan yana iki liste: fazla ödemeler | borçlular. Her satırda referans, tutar,
  gönderici, ödeme durumu; kapalıysa turuncu rozet
- Alt eylemler: `⚡ Tümünü otomatik eşleştir` ve `Seçilenleri aktar →`
- Elle aktarım: soldan bir fazla + sağdan bir borç seçilir, tutar ikisinin küçüğü olarak
  önerilir ve değiştirilebilir; her iki tarafın sınırını aşamaz

Geçmiş sekmesi: partiler hâlinde liste, satır bazlı ve parti bazlı `Geri al`;
geri alınmış kayıtlar soluk ve "geri alındı" etiketli.

### `client/src/components/offset-preview-modal.tsx`

- Özet satırı: kapanacak borç sayısı, toplam tutar, işlem adedi, artan fazla
- Aktarımlar **hedef prosedüre göre gruplanır**. Bir hedef birden fazla kaynaktan
  beslenebildiği için satır bazlı "kapanır/kapanmaz" etiketi yanıltıcı olur; etiket
  grup başlığında durur: `CNCALO-94 → 214.006,91 TL · ✓ kapanır (2 kaynaktan)`.
  Otomatik modda her grup daima "kapanır" olur — kapatılamayan borç önizlemeye hiç
  girmez; kapatılamayanlar özet satırında sayı olarak belirtilir.
- Her aktarım için onay kutusu; işaret kaldırıldığında özet **anında** yeniden hesaplanır
  (istemci tarafında, sunucuya gitmeden). Bir gruptaki satır çıkarılırsa o hedef artık
  tam kapanmayacağı için grup etiketi "kısmi" olarak güncellenir — kullanıcı bunu
  bilerek yapabilir, engellenmez.
- `Vazgeç` / `N aktarımı uygula`

### Diğer dokunuşlar

- `client/src/App.tsx`: `/offsets` rotası
- Sol menü: "Gelen Ödemeler" altına "Mahsuplaşma"
- `client/src/pages/procedure-details.tsx:1863` fazla ödeme kutusunun altına
  "Bu fazlayı mahsuplaştır →" bağlantısı (kaynak seçili olarak sayfaya gider)
- Prosedür ödeme geçmişi tablosunda mahsup satırları → / ← işaretiyle ayrışır
- `client/src/locales/tr.json` + `en.json`: tüm metinler (uygulamanın çeviri
  bütünlüğü korunur), doğrulama mesajları merkezî `FormMessage` desenine uyar
- Tüm yazma istekleri `apiRequest` ile (ham `fetch` token taşımaz → 401)

## Test planı

Projede henüz test dosyası yok; `vitest` kurulu (`npm test` → `vitest run`).
İlk testler bu özellikle gelir.

### Birim — `server/offset-engine.test.ts`

| Senaryo | Beklenen |
|---|---|
| Fazla, tüm borçlara yetiyor | Hepsi kapanır, artan doğru |
| Fazla yetmiyor | En çok sayıda borç **tam** kapanır; kapanamayana dokunulmaz |
| Tek borç, çok fazla kaynağı | Borç birden fazla kaynaktan beslenir, toplam tutar birebir |
| 1 TL altı bakiyeler | Listeye girmez |
| Kuruşlu tutarlar | Yuvarlama artığı kalmaz, toplamlar birebir tutar |
| Borç = fazla (birebir) | Tek hareketle kapanır, artan 0 |
| Fazla/borç listesi boş | Boş sonuç, hata yok |
| LIFO planı: tek kayıt | En yeni kayıttan tam düşer |
| LIFO planı: çok kayıt | Sırayla tüketilir, bölünme doğru |
| LIFO planı: aşırı tutar | Hata verir |

### Entegrasyon — `server/offset-service.test.ts`

Test veritabanı üzerinde (canlı veriye dokunmadan):

- Uygula sonrası kaynak ve hedef bakiyeleri beklenen değerde
- **`incoming_payments` satırı hiç değişmemiş** (dört alan da birebir aynı)
- Tüm prosedürlerin bakiye toplamı işlem öncesi/sonrası eşit
- Aşırı aktarım denemesi reddedilir, hiçbir satır yazılmaz
- Ortada hata → transaction geri alınır, yarım kayıt kalmaz
- Geri al → bakiyeler ve ödeme durumu tam olarak eski hâline döner
- Parti geri alma → tüm hareketler tek seferde geri döner

### Kabul doğrulaması (yayına almadan önce)

Ekranın ürettiği otomatik eşleştirme önizlemesi, bu belgedeki simülasyon sonucuyla
karşılaştırılır: **11 borç kapanır, 1.236.935,07 TL, 20 aktarım, 17.148,22 TL artan.**
(Bu arada canlı veri değişmediyse.) Tutmazsa yayına alınmaz.

Ayrıca elle gözden geçirilecek ekranlar — eksi tutarlı satırların anlaşılır göründüğü
doğrulanır: ödemeler sayfası, `view-distribution-modal`, prosedür PDF'i
(`routes.ts:7937` civarı ödeme bölümü), Excel raporları.

## Riskler

1. **Eksi tutarlı dağıtım satırları eski ekranlarda.** Toplamlar kendiliğinden doğru
   çıkar (hepsi toplama dayalı), ancak satır gösterimi tek tek doğrulanmalı.
2. **Eşzamanlılık.** İki kullanıcı aynı anda uygularsa: `applyOffsets` transaction
   içinde bakiyeleri yeniden hesaplar; kaynak fazlası yetmiyorsa işlem reddedilir ve
   istemciye güncel önizleme döner.
3. **Kapalı prosedürlere aktarım** kapanmış işlerin rakamlarını değiştirir (bilinçli
   karar). Turuncu rozet ve geçmiş kaydı ile izlenebilir kalır.

## Kapsam dışı (bu sürümde yapılmayacak)

- Otomatik modda kısmi ödeme (yalnızca elle)
- Çoklu para birimi / kur dönüşümü (veri tek para biriminde)
- Prosedürlere müşteri alanı eklenmesi (gönderici filtresi yeterli)
- Mahsuplaşmanın zamanlanmış/otomatik çalışması — her zaman kullanıcı tetikler
- Mahsup kayıtları için ayrı PDF/Excel çıktısı
