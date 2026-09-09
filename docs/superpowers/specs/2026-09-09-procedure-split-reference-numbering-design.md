# Split Referans Numaralandırma — Tasarım

**Tarih:** 2026-09-09
**Durum:** Onaylandı (brainstorming), uygulama planı bekleniyor

## Problem

Tax calculation ekranında bir hesaplamadan ürün çıkarıldığında (split), çıkarılan
ürünler için yeni bir tax calculation ve ona bağlı yeni bir procedure oluşuyor.
Ama kaynak procedure'ın referansı olduğu gibi kalıyor — yani `CNCALO-108`'den
split yapıldığında ortada iki procedure oluyor ve ikisine bakan biri bunların
aynı sevkiyatın parçaları olduğunu anlayamıyor.

İstenen: split yapılan referans `CNCALO-108 / 1` olsun, çıkarılanlardan oluşan
yeni procedure `CNCALO-108 / 2` olsun.

**Asıl engel:** procedure referansı bir isim değil, veritabanında **anahtar**.
Sekiz tablo procedure'a `procedure_reference` metniyle bağlı. Bu yüzden
`client/src/pages/edit-procedure.tsx` içindeki referans alanı bilerek `disabled`
(açıklaması: `procedurePages.edit.referenceLocked`) — referansı değiştirmenin
güvenli bir yolu yok.

## Mevcut durum (canlı veriden, 2026-09-09)

CNCALO-108 vakası tam olarak bu sorunun yaşandığı hâlde duruyor:

| Kayıt | Referans |
|---|---|
| `procedures` #263 (kaynak) | `CNCALO-108` |
| `tax_calculations` #303 | `CNCALO-108 /1` |
| `procedures` #273 (split çıktısı) | `CNCALO-108 /2` |
| `tax_calculations` #313 | `CNCALO-108 /2` |

Hesaplama tarafı elle `/1` yapılmış, procedure kilitli olduğu için değişmemiş.

### Referansa bağlı tablolar

`procedures.reference` UNIQUE. Referansı metin olarak taşıyan 10 tablodan
üçünde canlı veritabanında gerçek FK var ve **ON UPDATE CASCADE** tanımlı —
bunlar referans değişince kendiliğinden takip eder:

- `import_expenses.procedure_reference`
- `import_service_invoices.procedure_reference`
- `taxes.procedure_reference`

Kalan altısında FK **yok** — referans değişirse kopar, elle güncellenmeleri
gerekir:

- `invoice_line_items.procedure_reference` (CNCALO-108 için 81 satır)
- `expense_documents.procedure_reference` (CNCALO-108 için 6 satır)
- `payments.procedure_reference`
- `payment_distributions.procedure_reference`
- `procedure_status_details.procedure_reference`
- `invoice_line_items_config.procedure_reference`

Ayrıca `tax_calculations.reference` (UNIQUE) procedure'a `procedure_id` ile
bağlı; referans metnini ayrıca kendisi de tutuyor.

### S3 dosyaları

`expense_documents.object_key` referansı içeriyor
(`SOHO/CNCALO-108/1788312082608-TR00056 Final CI PL.pdf`). Bu anahtar
veritabanında ayrı bir kolonda tutulduğu için **referans değişince dosyalar
kopmaz**; yalnızca bulut klasörünün adı eski referansla kalır. S3 nesneleri
taşınmayacak.

### Mevcut format karışıklığı

Canlı veride slash içeren 56 procedure referansı var ve formatları tutarsız:
`CNCALO-4/1`, `CNCALO-49 / 1`, `CNCALO-85 /1 ` (sonda boşluk),
`CNCALO-33 - GARMENTS/1`. Bu 56 kayıt bu iş kapsamında normalize
**edilmeyecek** (bkz. Kapsam dışı).

## Kararlar

Brainstorming'de netleşen kullanıcı kararları:

1. **Format:** `CNCALO-108 / 1` — slash'ın iki yanında birer boşluk.
2. **Otomatiklik:** Split tamamlandığında referanslar sorulmadan atanır.
3. **Geçmiş veri:** Yalnızca CNCALO-108 düzeltilecek; diğer 55 kayda dokunulmayacak.
4. **Elle düzenleme:** Procedure düzenleme sayfasındaki referans kilidi açılacak.

## Tasarım

### 1. `server/procedure-reference-rename.ts` — güvenli yeniden adlandırma

Tek sorumluluğu olan yeni bir modül. Dışa açtığı yüzey:

```ts
renameProcedureReference(oldRef: string, newRef: string, tx?: Tx): Promise<RenameResult>
countReferenceUsage(ref: string): Promise<Record<string, number>>
```

`tx` verilmezse fonksiyon kendi transaction'ını açar (elle düzenleme yolu);
verilirse çağıranın transaction'ına katılır (split akışı, procedure yaratmayla
aynı işlemde olması için).

`renameProcedureReference` tek transaction içinde, bu sırayla:

1. `UPDATE procedures SET reference = newRef WHERE reference = oldRef`
   → `import_expenses`, `import_service_invoices`, `taxes` DB cascade ile takip eder.
2. FK'sız altı tabloda `procedure_reference = oldRef` olan satırları `newRef` yapar.
3. `tax_calculations` hizalaması:
   - Referansı tam olarak `oldRef` olan satırlar `newRef` yapılır.
   - Ek olarak, procedure'a bağlı **tek** bir tax_calculation varsa referansı
     `oldRef`'ten farklı olsa bile `newRef`'e eşitlenir (CNCALO-108 vakasında
     `CNCALO-108 /1` → `CNCALO-108 / 1` normalizasyonu bunu gerektiriyor).
   - Birden fazla bağlı hesaplama varsa yalnızca tam eşleşen güncellenir;
     kalanlara dokunulmaz (UNIQUE ihlali riski).

Hata durumları:

- `newRef` başka bir procedure'da zaten varsa → transaction başlamadan reddedilir,
  net hata mesajı döner.
- `oldRef` bulunamazsa → hata.
- `newRef` boş/yalnızca boşluksa → hata.
- Herhangi bir adım patlarsa transaction geri alınır; kısmi güncelleme oluşmaz.

`countReferenceUsage` aynı tablo listesini sayarak döner; UI'daki onay uyarısını
besler.

### 2. `server/procedure-split-reference.ts` — numara hesabı

Saf (veritabanı erişimi olmayan) yardımcılar + tek bir sorgulayıcı:

```ts
parseReference(ref: string): { root: string; part: number | null }
formatSplitReference(root: string, part: number): string   // `${root} / ${part}`
isSiblingOf(root: string, candidate: string): boolean
planSplit(sourceRef: string, siblings: string[]): SplitPlan
```

`parseReference` regex'i: `^(.+?)\s*\/\s*(\d+)$` (girdi önce `trim()` edilir).
Yani `CNCALO-108 / 1`, `CNCALO-108/1`, `CNCALO-85 /1 ` ve
`CNCALO-33 - GARMENTS/1` doğru ayrışır; numarasız referansta `part = null`.

Kardeş tespiti iki aşamalı:

1. SQL'de `reference LIKE <root>%` ile aday çekilir (root içindeki `%` ve `_`
   karakterleri escape edilir).
2. JS'te elenir: aday ya trim sonrası tam `root`'a eşit olmalı (part yok), ya da
   `^<root>\s*/\s*(\d+)$` kalıbına uymalı. Böylece `CNCALO-108` ararken
   `CNCALO-1080` kardeş sayılmaz.

`planSplit` çıktısı:

- `sourceRename` — kaynağın numarası yoksa `{ from: 'CNCALO-108', to: 'CNCALO-108 / 1' }`,
  numarası varsa `null` (kaynak olduğu gibi kalır).
- `newReference` — `root + " / " + (mevcut en yüksek numara + 1)`. Numarasız kaynak
  1 sayılır.

CNCALO-108 için bugünkü veriyle sonuç: kaynak `CNCALO-108 / 1` olur, yeni
procedure `CNCALO-108 / 3` olur (çünkü `CNCALO-108 /2` zaten var). Bu doğru
davranıştır — mevcut kardeşin numarası tekrar kullanılmaz.

### 3. Split akışına bağlanması

Mevcut akış:

1. `tax-calculation-edit.tsx` → `handleCreateNewCalculationWithRemovedItems`
   sessionStorage'a `reference: "<ref>-SPLIT"` yazar, `/tax-calculation/new?fromRemoved=true`'ya gider.
2. `tax-calculation-new.tsx` sessionStorage'ı okur, referansı forma koyar.
3. Hesaplama kaydedilince `POST /api/tax-calculation/calculations/:id/create-procedure`
   çağrılır; procedure `calculation.reference` ile oluşturulur.

Değişiklikler:

- **Yeni endpoint:** `GET /api/procedures/:id/split-reference-preview` →
  `{ sourceCurrent, sourceAfter, nextReference }`. Salt okunur, hiçbir şeyi değiştirmez.
- **Edit sayfası:** `-SPLIT` yerine bu endpoint'ten gelen `nextReference`
  sessionStorage'a yazılır. `sourceProcedureId` de sessionStorage'a eklenir.
  Endpoint başarısız olursa mevcut `-SPLIT` davranışına düşülür (akış kırılmaz).
- **New sayfası:** `inheritedProcedureRef` deseninin aynısıyla `sourceProcedureIdRef`
  tutulur ve `create-procedure` gövdesine eklenir.
- **`create-procedure` endpoint'i:** gövdede `sourceProcedureId` varsa split modu:

  ```
  transaction:
    kaynağı oku → planSplit(kaynakRef, kardeşler)
    plan.sourceRename varsa → renameProcedureReference(from, to, tx)
    yeni procedure'ı plan.newReference ile oluştur
    bu hesaplamanın tax_calculations.reference'ını plan.newReference yap
    yeni invoice_line_items satırlarını plan.newReference ile ekle
  ```

  Son iki satır yeni kayıtları ilgilendirir — mevcut satırların toplu
  güncellenmesi değil. Endpoint bugün line item'ları `calculation.reference` ile
  ekliyor; split modunda bunun yerine `plan.newReference` kullanılır.

  `sourceProcedureId` yoksa endpoint bugünkü davranışını aynen sürdürür — MCP
  aracı (`server/mcp/tools/taxes.ts:873`) bu endpoint'i split olmadan çağırdığı
  için geriye dönük uyumluluk şart.

Numaralandırma kararının sunucuda, procedure yaratılırken verilmesi bilinçli:
kullanıcı split'i yarıda bırakırsa kaynak referansı değişmemiş olur.

### 4. Referans kilidinin açılması

- `edit-procedure.tsx`: referans Input'undan `disabled` kaldırılır.
  `procedurePages.edit.referenceLocked` açıklaması, referansın bağlı kayıtlarla
  birlikte güncelleneceğini anlatan yeni bir metinle değiştirilir (TR + EN).
- Kaydetmeden önce referans değiştiyse onay diyaloğu çıkar; "şu kadar kayıt da
  güncellenecek" bilgisini yeni `GET /api/procedures/:id/reference-impact`
  endpoint'inden alır. Bu endpoint `countReferenceUsage`'ı çağırır, salt okunur.
- `PUT /api/procedures/:id` route'u: gövdedeki `reference` mevcut referanstan
  farklıysa önce `renameProcedureReference` çalışır, sonra kalan alanlar
  güncellenir. `storage.updateProcedure`'a referans değişimi bırakılmaz — o düz
  UPDATE yaptığı için FK'sız altı tabloyu koparırdı.

### 5. CNCALO-108 düzeltmesi

Ayrı bir veri migration'ı yazılmayacak. Kilit açıldıktan sonra procedure #263
düzenleme sayfasından `CNCALO-108` → `CNCALO-108 / 1` yapılır; düzeltme test
edilmiş kod yolundan geçer. `db/manual-ddl/` altına elle SQL koymaya gerek yok.

## Test

`vitest` (`npm test`), mevcut `server/*.test.ts` deseniyle:

**`procedure-split-reference.test.ts`** (saf fonksiyonlar, DB yok):

- `parseReference`: `CNCALO-108 / 1`, `CNCALO-108/1`, `CNCALO-85 /1 `,
  `CNCALO-33 - GARMENTS/1`, numarasız `CNCALO-108`, `CNCALO-42 -GARMENTS/3`.
- `isSiblingOf`: `CNCALO-108` kökü `CNCALO-1080`'ı kardeş saymaz;
  `CNCALO-10` kökü `CNCALO-108`'i kardeş saymaz.
- `planSplit`: numarasız kaynak → `sourceRename` dolu + `newReference` `/ 2`;
  `/ 1` kaynağı → `sourceRename` null + `newReference` `/ 3`; CNCALO-108'in
  gerçek verisi (`CNCALO-108`, `CNCALO-108 /2`) → `/ 1` ve `/ 3`.
- Çıktı formatı her zaman ` / ` boşluklu.

**`procedure-reference-rename.test.ts`:** transaction davranışı sahte `tx` ile
doğrulanır — hangi tabloların hangi sırayla güncellendiği, cascade'li üç tablonun
elle güncellenmediği, çakışan `newRef`'in reddedildiği, bir adım patladığında
hiçbir yazmanın kalıcı olmadığı.

Canlı veritabanına yazan otomatik test yazılmayacak.

## Kapsam dışı

- Slash içeren mevcut 55 kaydın (CNCALO-108 hariç) format normalizasyonu.
- S3 nesnelerinin yeni referans altına taşınması.
- Yerel diskteki `C:\Users\cem\Desktop\SOHO\...` klasör adları — elle değiştirilir.
- Split'i geri alma / birleştirme özelliği.
- Eşzamanlı iki split'in aynı numarayı istemesi: `procedures.reference` UNIQUE
  olduğu için ikincisi hata alır ve transaction geri alınır. Otomatik yeniden
  deneme eklenmeyecek.

## Riskler

| Risk | Önlem |
|---|---|
| FK'sız altı tablonun elle güncellenmesi unutulur/eksik kalır | Tablo listesi tek modülde sabit; rename testleri listeyi doğrular |
| `tax_calculations.reference` UNIQUE çakışması | Rename öncesi kontrol, çakışmada transaction reddi |
| Kilidi açılan referans alanının kazara değiştirilmesi | Kaydetmeden önce etkilenen kayıt sayısını gösteren onay diyaloğu |
| MCP `create-procedure` çağrısının bozulması | Split modu yalnızca `sourceProcedureId` geldiğinde devreye girer |
