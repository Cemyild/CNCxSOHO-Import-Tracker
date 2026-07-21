# Excel Enrichment (Toplu Veri Tamamlama) — Yeniden Tasarım

**Tarih:** 2026-07-21
**Durum:** Onaylandı (brainstorming), uygulama planı bekleniyor
**Referans dosya:** `soho enrich örnek.xlsx` (gümrükçü "İthalat Raporu" çıktısı)

## Problem

Procedures sayfasındaki **Enrich Data (Excel)** butonu, gümrükçüden gelen ithalat
raporunu yükleyip mevcut procedure kayıtlarındaki eksik/boş alanları toplu
doldurmak için yapılmış. Gerçek dosyayla test edildiğinde **hiç çalışmıyor** —
dosya okunamadan hata veriyor.

Mevcut kod: [`server/excel-enrichment.ts`](../../../server/excel-enrichment.ts) (360 satır),
[`client/src/components/ExcelDataEnrichment.tsx`](../../../client/src/components/ExcelDataEnrichment.tsx),
router bağlantısı [`server/routes.ts:197`](../../../server/routes.ts).

### Tespit edilen arızalar

Sıralama, arızanın akışı durdurma sırasına göre:

**A. Ölümcül — akış hiç başlamıyor**

1. **Yanlış sekme okunuyor.** Kod `workbook.SheetNames[0]` ile körlemesine ilk
   sekmeyi açıyor. Örnek dosyada sekmeler: `Sayfa1` (tamamen boş) ve
   `İthalat Raporu` (asıl veri). Sonuç: `Excel file is empty or missing headers`
   → HTTP 400 → arayüzde "failedToProcess" hatası. Özellik burada bitiyor.

2. **Başlık satırı sabit varsayılıyor.** Kod `rows[0]`'ı başlık kabul ediyor.
   Örnek dosyada 1. satır rapor künyesi (`Alıcı : SOHO PERAK`,
   `Baş. Kur. Tar. : 01.07.2026`, `Bit. Kur. Tar. : 21.07.2026`,
   `Gtip No :`), gerçek başlıklar **2. satırda**. Sekme sorunu çözülse bile
   hiçbir sütun tanınmaz, tüm satırlar atlanır, sonuç boş liste olur.

3. **Toplam satırı veri sanılıyor.** Son satır `TOPLAM KAYIT : 24` + BRUT/NET KG
   toplamları (37975.12). Veri olarak işlenmeye çalışılıyor.

**B. Yanlış sütun okuma**

4. **Fatura No yanlış sütundan alınıyor.** Sözlükte hem `faturano` hem
   `faturano0100` var; `mappedData[dbField]` her seferinde üzerine yazdığı için
   sözlükte **en sonda duran** kazanıyor. Bu dosyada tesadüfen doğru sütun
   (`FATURA NO(0100)`) kazanıyor ama bu bir tesadüf, kural değil.

   Veritabanı doğrulaması (175 procedure kaydı üzerinde):
   | Excel sütunu | DB `invoice_no` ile eşleşme |
   |---|---|
   | `FATURA NO` (örn. `CNC2026000018712`) | **0/7** — gümrükçünün kendi dosya no'su |
   | `FATURA NO(0100)` (örn. `53598059`) | **13/13** ✅ |

5. **Fatura Tarihi yanlış sütundan alınıyor.** Sözlükte `faturatarihi` var ama
   `faturatarihi0100` yok. Doğrulama:
   - `CNCALO-91` DB `invoice_date` = `2026-06-29`; Excel `FATURA TARİHİ(0100)` =
     `29.06.2026` ✅, `FATURA TARİHİ` = `07.07.2026` ❌
   - `CNCALO-95` DB `invoice_date` = `2026-07-01`; Excel `FATURA TARİHİ(0100)` =
     `01.07.2026` ✅, `FATURA TARİHİ` = `21.07.2026` ❌

   Yani hem fatura no hem fatura tarihi için `(0100)` sütunları doğru olan.

6. **Kap sütunu çakışıyor.** `KOLİ` ve `KAP` sütunlarının ikisi de `package`
   alanına eşleniyor. `KAP` sütunu bu dosyada çöp (`X` veya tek boşluk).
   Sözlük sırası sayesinde `KOLİ` kazanıyor — yine tesadüf.

**C. Hiç okunmayan dolu sütunlar**

| Excel sütunu | Gitmesi gereken alan | Dosyada doluluk | DB'de eksik kayıt |
|---|---|---|---|
| `GUM.` | `customs` | 24/25 | 9 boş |
| `FAT.BEDELİ` | `amount` | 24/25 | — |
| `DÖVİZ KURU` | `usdtl_rate` | 24/25 | 4 boş + 9 sıfır |
| `NAVLUN` | `freight_amount` | 24/25 | 165 kayıt sıfır |
| `DOSYA NO` | *(karşılığı yok)* | 25/25 | — |

`GUM.` normalize edilince `gum` oluyor, sözlükte `gumruk`/`gumrukidaresi` var —
tutmuyor. `DÖVİZ KURU` ve `NAVLUN` sözlükte hiç yok.

**D. Veri kalitesi**

7. **Tarih çevrimi yapılmıyor.** `excelDateToJSDate` içinde nokta/tire/eğik çizgi
   gören metin **olduğu gibi** dönüyor. Excel `03.07.2026` verirken uygulama
   `2026-07-03` kullanıyor. Sonuç: karışık formatlı `invoice_date` /
   `import_dec_date` kolonu.

8. **Çöp değerler DB'ye yazılıyor.** `BEYAN TARİHİ` 6 satırda tek nokta (`.`).
   Bu değer `.` içerdiği için "tarih metni" sayılıp aynen kaydediliyor.
   Aynı şekilde `-`, `X`, tek boşluk gibi değerler de dolu sayılıyor.

9. **Gümrük adı uyumsuzluğu.** Excel `ERENKÖY GÜMRÜK MÜDÜRLÜĞÜ` yazıyor;
   uygulamadaki mevcut değerler `Erenköy`, `Muratbey`, `Ambarlı`, `Gemlik`,
   `Istanbul Airport`. Normalizasyon yok → aynı gümrük iki farklı yazımla
   veritabanında durur.

**E. Eşleştirme mantığı**

10. **Belirsiz eşleşmede ilk bulunan alınıyor.** `allProcedures.find(...)` ilk
    eşleşeni döndürüyor. DB'de `CNCALO-83 /1` (tutar 396240.00) ve
    `CNCALO-83 / 2` (tutar 5108.77) **aynı** `invoice_no` = `54702017` değerini
    taşıyor. Excel satırı 5108.77 tutarlı olmasına rağmen kod `/1` kaydına yazar.

11. **AN/IM satırları ayrı kayıt sanılıyor.** Her sevkiyat raporda iki kez geçiyor:
    antrepo girişi (`AN`) ve ithalat (`IM`). Örnek: fatura `55559417` →
    satır 2 (`26341200AN00154190`) ve satır 6 (`26341200IM00163105`).
    DB'de `CNCALO-91` kaydındaki beyanname `26341200IM00163105`, yani **IM
    doğrusu**. Kod ikisini de ayrı `matches` girdisi olarak listeliyor; aynı
    `procedureId` iki kez çıkıyor (React'te tekrarlanan `key`, checkbox seçimi
    ikisini birden açıp kapatıyor) ve uygulama sırasında sonraki satır öncekinin
    üzerine yazıyor.

12. **Eşleşmeyen satırlar sessizce kayboluyor.** Hangi satırın neden atlandığı
    hiçbir yerde görünmüyor.

**F. Yapısal / güvenlik**

13. **Ölü kod.** `mapExcelRowToDbFields` (satır 129-173) hiçbir yerden
    çağrılmıyor. İçindeki "sütun 10/11/12 → Gümrük/Beyanname No/Beyanname
    Tarihi" indeks kuralı hiç devrede değil. Aynı dosyada iki farklı, birbiriyle
    çelişen haritalama uygulaması bulunuyor.

14. **`arrival_date` eşleşemez.** Kod tarih çevrimi listesinde `arrival_date`'i
    sayıyor ama `COLUMN_MAPPING` içinde bu alana giden tek bir başlık yok.

15. **Yetki kontrolü yok.** `app.use("/api/enrichment", excelEnrichmentRouter)`
    hiçbir auth middleware'i ile sarılmamış. `/preview` ve `/apply` uçlarına
    kimliksiz erişilip 175 kaydın tamamı topluca değiştirilebilir.

16. **`/apply` gelen alan adlarını doğrulamıyor.** İstemciden gelen `changes`
    nesnesi doğrudan `db.update(...).set()` içine yayılıyor.

## Hedef

Gümrükçüden gelen aylık ithalat raporunu yükleyip mevcut procedure kayıtlarındaki
**eksik ve boş** alanları güvenle toplu doldurmak; ne eşlendiğini ve neyin
eşleşmediğini kullanıcıya açıkça göstermek.

## Kapsam dışı

- Eşleşmeyen satırlardan **yeni procedure oluşturma** (kararlaştırıldı: sadece
  raporlanacak).
- `MAL TESLİM TARİHİ` → `arrival_date`, `KONŞİMENTO NO` → `awb_number`,
  `NAKLİYECİ` → `carrier` eşleştirmeleri (kararlaştırıldı: eşleştirilmeyecek).
- Vergi/masraf sütunları (`TOPLAM VERGİ`, `KKDF`, `ARDİYE`, `SİGORTA`,
  `BANKA KOM` vb.) — bunlar `taxes` / `expenses` tablolarına ait, ayrı bir iş.
- Birden fazla gümrükçü/rapor formatı için genel profil altyapısı (YAGNI).

## Alınan kararlar

| Karar | Seçim |
|---|---|
| Sütun haritalama | **Otomatik tespit + onay ekranı** — program bulur, kullanıcı görür ve gerekirse düzeltir |
| Güncelleme kuralı | **Boş + sıfır duran alanlar** doldurulur; dolu alana dokunulmaz |
| Ek sütunlar | Yalnızca `DOSYA NO` için **yeni alan açılacak** |
| Eşleşmeyen satırlar | **Ayrı listede raporlanacak**, kayıt oluşturulmayacak |

## Tasarım

### 1. Mimari — modüllere ayırma

Mevcut tek dosyalı yapı (parse + map + match + diff + HTTP, hepsi bir arada)
bölünür. Yeni yapı `server/enrichment/` altında:

| Dosya | Sorumluluk | Girdi → Çıktı |
|---|---|---|
| `parse-workbook.ts` | Sekme seçimi, başlık satırı tespiti, veri satırı ayıklama | Buffer → `{ sheetName, headerRowIndex, headers[], dataRows[][], skipped[] }` |
| `column-profile.ts` | Başlık normalizasyonu + sütun→alan sözlüğü | `headers[]` → `{ mapped: {field, colIndex, header}[], unmapped: header[] }` |
| `normalize.ts` | Tarih, gümrük adı, sayı, çöp değer temizliği | ham hücre → temiz değer veya `null` |
| `match.ts` | Procedure bulma + AN/IM birleştirme | satırlar + procedure'lar → `{ matched[], unmatched[] }` |
| `diff.ts` | Hangi alanın güncelleneceğini hesaplama | eşleşmiş satır + procedure → `changes[]` |

`server/excel-enrichment.ts` yalnızca üç HTTP ucu bırakır ve bu modülleri
sırayla çağırır. Her modül saf fonksiyonlardan oluşur (DB'ye ve Express'e
bağımlı değil) — tek başına test edilebilir.

### 2. HTTP uçları

| Uç | İş |
|---|---|
| `POST /api/enrichment/analyze` | Dosyayı çözümler, **tespit özetini** döner (sekme, başlık satırı, satır sayısı, eşlenen/eşlenmeyen sütunlar). DB'ye dokunmaz. |
| `POST /api/enrichment/preview` | Dosya + (opsiyonel) kullanıcı düzeltmeleri ile eşleştirmeyi çalıştırır, `matched[]` + `unmatched[]` döner. |
| `POST /api/enrichment/apply` | Seçilen güncellemeleri uygular. |

Üçü de **admin yetkisi** ister (bkz. §9).

`analyze` ve `preview` ayrı uçlar olduğu için dosya iki kez yüklenir. Alternatif
(sunucuda geçici saklama) durum yönetimi ve temizlik yükü getirdiği için tercih
edilmedi; dosya ~100 KB seviyesinde.

### 3. Kullanıcı akışı

```
[Enrich Data (Excel)] → dosya seç
        ↓  POST /analyze
┌─ ADIM 1: Tespit Özeti ────────────────────────┐
│ Sayfa:        İthalat Raporu    [değiştir ▾]  │
│ Başlık satırı: 2                [değiştir ▾]  │
│ Veri satırı:   24  (1 toplam satırı atlandı)  │
│                                               │
│ Eşlenen sütunlar (13)          [aç/kapa]      │
│   FATURA NO(0100)     → Invoice No    [▾]     │
│   FAT.BEDELİ          → Tutar         [▾]     │
│   ...                                         │
│ ⚠ FATURA NO sütunu kullanılmadı               │
│ Kullanılmayan 87 sütun          [göster]      │
│                              [Devam →]        │
└───────────────────────────────────────────────┘
        ↓  POST /preview
┌─ ADIM 2: Önizleme ────────────────────────────┐
│ ☑ GÜNCELLENECEK (16 kayıt)                    │
│   CNCALO-91  · fatura no ile eşleşti          │
│     Gümrük:  (boş) → Erenköy                  │
│     Kur:     (boş) → 46.6920                  │
│   ...                                         │
│                                               │
│ ⚠ EŞLEŞMEYEN (1 satır)                        │
│   Excel satır 23 · Dosya No 26-11128          │
│   Fatura No "STN1" bulunamadı;                │
│   120.00 USD tutarıyla da eşleşme yok         │
│                        [Uygula (16)]          │
└───────────────────────────────────────────────┘
```

### 4. Dosya okuma kuralları (`parse-workbook.ts`)

**Sekme seçimi**
1. `!ref` değeri olmayan (tamamen boş) sekmeler elenir.
2. Kalanlar arasında §5'teki sözlükten en çok başlık tanınan sekme seçilir.
3. Seçim ve alternatifler tespit özetinde gösterilir; kullanıcı değiştirebilir.

**Başlık satırı tespiti**
1. İlk 10 satır taranır.
2. Her satır için sözlükte karşılığı bulunan hücre sayısı sayılır.
3. En yüksek skorlu satır başlık kabul edilir. Skor 3'ün altındaysa hata döner:
   *"Bu dosyada tanınan sütun bulunamadı"* + bulunan başlıkların listesi.
4. Kullanıcı başlık satırını elle değiştirebilir.

**Veri satırı ayıklama** — şu satırlar atlanır ve `skipped[]` içinde sebebiyle raporlanır:
- İlk hücresinde `TOPLAM` geçen satır (örn. `TOPLAM KAYIT : 24`)
- Eşlenen sütunların **hepsi** boş olan satır
- Tamamen boş satır

### 5. Sütun haritası (`column-profile.ts`)

Başlık normalizasyonu bugünkü kuralla aynı: küçük harfe çevir → Türkçe karakter
sadeleştir → `a-z0-9` dışındaki her şeyi sil. `FATURA NO(0100)` → `faturano0100`.

Sözlük **tek yönlü ve tekil** olur: her hedef alan için **öncelik sıralı** aday
başlık listesi. Bugünkü "son yazan kazanır" tesadüfü ortadan kalkar.

| Hedef alan | Aday başlıklar (öncelik sırasıyla) | Örnek dosyada bulunan |
|---|---|---|
| `invoice_no` | `faturano0100`, `faturanumarasi`, `faturano`, `invoiceno`, `invno` | `FATURA NO(0100)` |
| `invoice_date` | `faturatarihi0100`, `faturatarihi`, `invoicedate` | `FATURA TARİHİ(0100)` |
| `amount` | `fatbedeli`, `faturatutari`, `dovizkiymeti`, `malbedeli`, `tutar`, `amount` | `FAT.BEDELİ` |
| `currency` | `doviz`, `parabirimi`, `currency` | `DÖVİZ` |
| `usdtl_rate` | `dovizkuru`, `kur`, `exchangerate` | `DÖVİZ KURU` |
| `import_dec_number` | `beyanno`, `beyannameno`, `beyannamenumarasi`, `tcgbno` | `BEYAN NO` |
| `import_dec_date` | `beyantarihi`, `beyannametarihi`, `tcgbtarihi` | `BEYAN TARİHİ` |
| `customs` | `gum`, `gumruk`, `gumrukidaresi`, `customs` | `GUM.` |
| `shipper` | `gonderen`, `gonderici`, `shipper`, `sender` | `GONDEREN` |
| `package` | `koli`, `kap`, `paket`, `package` | `KOLİ` |
| `kg` | `brutkg`, `kilo`, `kg`, `grossweight` | `BRUT KG.` |
| `freight_amount` | `navlun`, `freight` | `NAVLUN` |
| `customs_file_no` | `dosyano`, `dosyanumarasi` | `DOSYA NO` |

Aynı alana birden fazla aday bulunursa listede **önce gelen** kazanır ve diğeri
tespit özetinde *"kullanılmadı"* olarak işaretlenir. Örnek dosyada:
- `invoice_no`: `FATURA NO(0100)` kazanır, `FATURA NO` kullanılmaz ⚠
- `package`: `KOLİ` kazanır, `KAP` kullanılmaz ⚠

`piece`, `awb_number`, `carrier`, `arrival_date` alanları bu profilde **yer almaz**
(karar gereği).

### 6. Değer temizleme (`normalize.ts`)

**Çöp değer tespiti** — şunlar `null` sayılır (yani "değer yok"):
`null`, `undefined`, `""`, yalnızca boşluk, `-`, `--`, `.`, `X`, `N/A`.

**Tarih** — çıktı daima `YYYY-MM-DD` veya `null`:
- `03.07.2026` / `03/07/2026` / `03-07-2026` → `2026-07-03` (gün.ay.yıl varsayımı)
- `2026-07-03` → değişmeden
- Excel seri numarası (`45845` gibi sayı) → UTC gün hesabıyla çevrilir
- Çöp değer (`.`) → `null`

Gün.ay.yıl varsayımı bu rapor için doğru: dosyadaki `13.07.2026` gibi değerler
ay olarak yorumlanamaz (13. ay yoktur) ve `BEYAN TARİHİ` sütunundaki tüm
değerler DB'deki mevcut beyanname tarihleriyle bu okumada tutarlı.

**Sayı** — `"3510,98"` → `3510.98`; binlik ayıracı temizlenir; sayıya
çevrilemeyen değer `null`.

**Gümrük adı** — Excel'deki uzun resmî adı DB'deki mevcut kısa yazıma eşler:
| Excel | DB |
|---|---|
| `ERENKÖY GÜMRÜK MÜDÜRLÜĞÜ` | `Erenköy` |
| `MURATBEY GÜMRÜK MÜDÜRLÜĞÜ` | `Muratbey` |
| `İSTANBUL HAVALİMANI GÜMRÜK MÜDÜRLÜĞÜ` | `Istanbul Airport` |
| `AMBARLI GÜMRÜK MÜDÜRLÜĞÜ` | `Ambarlı` |
| `GEMLİK GÜMRÜK MÜDÜRLÜĞÜ` | `Gemlik` |

Eşleşme, normalize edilmiş adın (`GÜMRÜK MÜDÜRLÜĞÜ` eki atılmış hâli) tabloda
aranmasıyla yapılır. Tanınmayan gümrük **olduğu gibi** yazılır ve önizlemede
*"yeni gümrük adı"* rozetiyle işaretlenir.

### 7. Eşleştirme (`match.ts`)

**Adım 1 — satırları procedure'lara bağla.** Her veri satırı için:

1. `invoice_no` doluysa: her iki taraf `trim()` edilerek aday procedure'lar bulunur.
   - 1 aday → **eşleşti** (`matchMethod: "invoice_no"`)
   - >1 aday → `amount` ile daraltılır (`|fark| < 0.01`).
     - Tek kalırsa → **eşleşti** (`matchMethod: "invoice_no+amount"`)
     - Hâlâ >1 → **belirsiz**, raporlanır
2. `invoice_no` boş veya aday bulunamadıysa: `amount` ile aranır.
   - 1 aday → **eşleşti** (`matchMethod: "amount"`)
   - >1 aday → **belirsiz**, raporlanır
3. Hiçbiri tutmazsa → **eşleşmeyen**, sebebiyle raporlanır

Adım 1.1 gerçek bir sorunu çözer: `CNCALO-83 /1` ve `CNCALO-83 / 2` kayıtları
aynı `invoice_no` = `54702017` değerini taşıyor. Tutar (5108.77) ile daraltma
doğru kaydı (`/ 2`) seçer.

**Adım 2 — AN/IM birleştirme.** Aynı `procedureId`'ye bağlanan satırlar tek bir
mantıksal kayda indirgenir:
- `import_dec_number` ve `import_dec_date`: beyanname numarasında **`IM`** geçen
  satır esas alınır. Hiçbirinde `IM` yoksa dolu olan ilk değer kullanılır.
- Diğer tüm alanlar: satırlar arasında dolu (çöp olmayan) ilk değer kullanılır.
- Birleştirilen satır numaraları önizlemede gösterilir
  (*"Excel satır 2 + 6 birleştirildi"*).

Bu kural DB'deki mevcut veriyle doğrulandı: `CNCALO-91` → `26341200IM00163105`
(IM satırı), `CNCALO-95` → `26341200IM00170502` (IM satırı).

**Çıktı** iki liste: `matched[]` ve `unmatched[]`. Her `unmatched` girdisi Excel
satır numarası, `DOSYA NO`, okunabilir sebep ve makine-okur bir `reason` kodu
taşır:

| `reason` | Anlamı | Önizlemede gösterim |
|---|---|---|
| `not_found` | Ne fatura no ne tutar ile karşılık bulundu | *"Fatura No `X` bulunamadı; `Y` tutarıyla da eşleşme yok"* |
| `ambiguous` | Birden fazla aday kaldı, daraltılamadı | *"`N` farklı kayıt aynı ölçütlere uyuyor: `REF1`, `REF2`"* |
| `no_key` | Satırda ne fatura no ne tutar var | *"Eşleştirme için yeterli bilgi yok"* |

Belirsiz (`ambiguous`) satırlar ayrı bir liste değil, aynı "eşleşmeyen"
bölümünde farklı sebep etiketiyle görünür — böylece kullanıcı tek yere bakar.

### 8. Güncelleme kuralı (`diff.ts`)

Bir alan **boş** sayılır (yani güncellenebilir) ise:
- `null` veya `undefined`
- `trim()` sonrası `""`
- `-`, `.`, `X` gibi çöp değerlerden biri
- Sayısal alanlarda (`amount`, `kg`, `usdtl_rate`, `freight_amount`) değer `0`

Dolu bir alana **asla** dokunulmaz — Excel'deki değer farklı olsa bile. Fark
raporlanmaz (karar gereği).

Yeni değer `null` ise (çöp temizlenmişse) değişiklik önerilmez.

Değişiklik listesi `{ field, oldValue, newValue }` biçiminde önizlemeye gider.

### 9. Güvenlik

- `/api/enrichment/*` uçlarının üçü de `requireRole('admin')`
  ([`server/auth-middleware.ts`](../../../server/auth-middleware.ts)) ile
  sarılır — projedeki diğer yazma uçlarıyla aynı desen.
- Arayüzde buton da admin'e kısıtlanır. Şu an
  [`procedures-table.tsx:848`](../../../client/src/components/ui/procedures-table.tsx)
  içinde `<ExcelDataEnrichment />` koşulsuz render ediliyor; hemen altındaki
  "Add Procedure" butonu ise `{isAdmin && ...}` ile sarılı. Aynı koşul buna da
  uygulanır.
- `/apply` gelen `changes` nesnesinin anahtarlarını **beyaz listeye** göre
  süzer: yalnızca §5 tablosundaki hedef alanlar kabul edilir. Listede olmayan
  anahtar sessizce atılır ve sunucu logunda uyarılır.
- `/apply` her `procedureId` için güncellemeden hemen önce kaydı tekrar okur ve
  alanın **hâlâ boş** olduğunu doğrular. Boş değilse o alan atlanır ve sonuçta
  `skipped` olarak döner (önizleme ile uygulama arasında başka biri düzenlemiş
  olabilir).
- Multer'a dosya boyutu limiti eklenir (10 MB) ve yalnızca `.xlsx`/`.xls`
  kabul edilir.

### 10. Yeni alan: Gümrükçü Dosya No

`procedures` tablosuna `customs_file_no` (text, nullable) kolonu eklenir.

- Migration: `db/manual-ddl/002_procedures_customs_file_no.sql`, idempotent
  (`ALTER TABLE procedures ADD COLUMN IF NOT EXISTS customs_file_no text;`).
  Mevcut dosyalar `000_`, `001_` olduğu için sıradaki numara `002`. Push'ta
  `scripts/apply-manual-ddl.ts` otomatik uygular. **`db:push` kullanılmaz.**
- `shared/schema.ts` içindeki `procedures` tanımına eklenir.
- Procedure detay sayfasında ve procedures tablosunda görüntülenir.
- Add/Edit Procedure formuna eklenir.
- i18n: `tr.json` ve `en.json` içine etiket eklenir (proje %100 çevrili durumda).

### 11. Hata yönetimi

| Durum | Davranış |
|---|---|
| Dosya bozuk / Excel değil | 400 + *"Dosya okunamadı, geçerli bir Excel dosyası mı?"* |
| Tüm sekmeler boş | 400 + *"Dosyada veri bulunamadı"* |
| Hiçbir sütun tanınmadı | 400 + bulunan başlıkların listesi + *"Bu dosya beklenen rapor formatında değil"* |
| Eşleşen kayıt yok | 200 + boş `matched[]` + dolu `unmatched[]` (sessiz başarısızlık değil) |
| `/apply` sırasında bir kayıt hata verir | Diğerleri devam eder; sonuçta kayıt bazında `success` / `skipped` / `error` döner |

Sunucu logları her adımda özet yazar: seçilen sekme, başlık satırı, eşlenen
sütun sayısı, eşleşme/eşleşmeme sayıları.

### 12. Doğrulama ve testler

Proje **vitest** kullanıyor (`npm run test`) ve test dosyaları kaynağın yanında
duruyor (`server/document-router.test.ts`, `server/procedure-document-import.test.ts`).
Aynı desen izlenir: `server/enrichment/*.test.ts`.

`soho enrich örnek.xlsx` referans fixture olarak
`server/enrichment/__fixtures__/soho-enrich-ornek.xlsx` altına kopyalanır
(dosya adındaki boşluk ve Türkçe karakter kaldırılır). Testler DB'ye
dokunmaz — procedure listesi sabit bir test verisiyle taklit edilir.

Saf modüller üzerinde birim testleri:

| Test | Beklenen |
|---|---|
| Sekme seçimi | `Sayfa1` değil, `İthalat Raporu` seçilir |
| Başlık satırı | index 1 (2. satır) bulunur |
| Veri satırı sayısı | 24 (toplam satırı atlanır) |
| Sütun haritası | `FATURA NO(0100)` → `invoice_no`; `FATURA NO` kullanılmaz |
| Sütun haritası | `FATURA TARİHİ(0100)` → `invoice_date` |
| Sütun haritası | `KOLİ` → `package`; `KAP` kullanılmaz |
| Tarih çevrimi | `03.07.2026` → `2026-07-03`; `.` → `null` |
| Gümrük normalizasyonu | `ERENKÖY GÜMRÜK MÜDÜRLÜĞÜ` → `Erenköy` |
| Sayı çevrimi | `"3510,98"` → `3510.98` |
| AN/IM birleştirme | Fatura `55559417` tek kayda iner, beyanname `26341200IM00163105` |
| Belirsizlik çözümü | Fatura `54702017` + tutar 5108.77 → `CNCALO-83 / 2` |
| Eşleşmeyen | `STN1` / 120 USD satırı `unmatched[]` içinde çıkar |

Uçtan uca doğrulama (gerçek DB kopyası üzerinde, salt-okunur `preview`):
**~16 procedure eşleşir, 1 satır eşleşmez.** En çok kazanç `CNCALO-98`,
`CNCALO-100`, `CNCALO-101` gibi neredeyse hiçbir alanı dolu olmayan kayıtlarda.

### 13. Silinecekler

- `mapExcelRowToDbFields` (ölü kod, satır 129-173)
- `debug-excel.ts`, `debug-excel-db.ts` (kök dizindeki geçici hata ayıklama
  dosyaları — bu özelliğe ait, artık gereksiz)
- `COLUMN_MAPPING` içindeki bu formatta karşılığı olmayan ve hiçbir DB alanına
  güvenilir biçimde bağlanmayan girdiler

## Riskler

| Risk | Azaltma |
|---|---|
| Gümrükçü rapor formatını değiştirirse | Tespit özeti ekranı her yüklemede ne bulunduğunu gösterir; sessiz bozulma yerine görünür uyarı |
| Gün.ay.yıl varsayımı yanlış olursa | Önizlemede tarihler `YYYY-MM-DD` olarak gösterilir; kullanıcı uygulamadan önce görür |
| Tutar ile eşleşme yanlış kayda giderse | Tek aday şartı; birden fazla aday varsa uygulanmaz, raporlanır |
| Yeni kolon migration'ı prod'da hata verirse | Idempotent DDL; hata deploy'u durdurur (mevcut mekanizma) |
