# Çift Dil Desteği (Türkçe / İngilizce) — Tasarım Dokümanı

**Tarih:** 2026-06-28
**Durum:** Onaylandı (kullanıcı), aşamalı uygulama planı bekliyor
**İlgili:** Güvenlik/kalite raporu madde 9 (dil tutarlılığı / i18n)

## Problem

Arayüz tamamen İngilizce sabit (kod içine gömülü metinler: "Dashboard", "Procedures", "Expenses"...), kullanıcılar ise Türk. Bir dil katmanı yok. Amaç: kullanıcının İngilizce ↔ Türkçe arasında geçiş yapabildiği, kalıcı bir dil desteği.

## Kapsam

- **Hedef:** Tüm uygulama (~29 sayfa, ~154 dosya) zamanla iki dilli olacak.
- **Strateji:** Aşamalı. Tek seferde tüm uygulama çevrilmeyecek. Önce altyapı, sonra **sayfa sayfa** çeviri. Her aşama kendi içinde çalışır ve test edilir; çevrilmemiş sayfalar İngilizce kalır, hata vermez.
- **Bu spec'in kapsamı:** Mimari + Aşama 0 (altyapı, sabit dil değiştirici, menü). Sonraki aşamalar (sayfa çevirileri) aynı desene göre eklenir; her biri küçük bir tekrar işidir.

## Kararlar

| Konu | Karar |
|------|-------|
| Kütüphane | `react-i18next` + `i18next` (React i18n standardı) |
| Varsayılan dil | **İngilizce** (mevcut hâl korunur) |
| Diller | `en`, `tr` |
| Dil seçici konumu | **Sağ üst köşede sabit (fixed), her sayfada her zaman görünür** |
| Tercih saklama | `localStorage` (`appLang`), sayfa yenilense de kalır |
| Çeviri dosyaları | `client/src/locales/en.json`, `client/src/locales/tr.json` |
| Çeviri anahtar yapısı | Alana göre gruplu: `nav.*`, `common.*`, `<sayfa>.*` |

## Mimari

### Bileşenler

1. **i18n config** — `client/src/lib/i18n.ts`
   - `i18next` + `initReactI18next` ile kurulum.
   - `en.json` ve `tr.json` kaynakları yüklenir.
   - `fallbackLng: 'en'`, `lng: localStorage.getItem('appLang') || 'en'` (yani localStorage boşsa kesin İngilizce; tarayıcı diline bakılmaz — `languagedetector` kullanılmaz).
   - `interpolation.escapeValue: false` (React zaten kaçışlar).
   - Uygulama girişinde (`main.tsx`) bir kez import edilir.

2. **Çeviri kaynakları** — `client/src/locales/{en,tr}.json`
   - Aşama 0'da yalnızca `nav.*` (11 menü öğesi) + `common.*` (birkaç ortak terim: dil adları, kaydet/iptal vb.) doldurulur.
   - Sonraki aşamalarda her sayfa kendi grubunu ekler.

3. **Dil değiştirici** — `client/src/components/LanguageSwitcher.tsx`
   - `TR | EN` düğmesi. Aktif dil vurgulanır.
   - Tıklayınca `i18n.changeLanguage(lng)` çağırır ve `localStorage.setItem('appLang', lng)` ile seçimi kalıcılaştırır.
   - Konum: ekranın **sağ üst köşesinde `position: fixed`**, yüksek `z-index`, her sayfada görünür ve scroll'da kaybolmaz.
   - Uygulama kökünde (`App.tsx`) bir kez render edilir ki login dahil her ekranda bulunsun.

4. **Menü çevirisi** — `client/src/lib/nav-items.ts` + `PageLayout.tsx`
   - `NavItem.title: string` yerine `NavItem.titleKey: string` (örn. `'nav.dashboard'`).
   - `PageLayout` menüyü çizerken `t(item.titleKey)` ile çevirir (`useTranslation` hook).

### Veri akışı

`localStorage` → `i18n.ts` başlangıç dili → `useTranslation()` hook → `t('grup.anahtar')` → o anki dile göre metin. Dil değiştirici `changeLanguage` çağırınca tüm `t()` çağrıları yeniden render olur, arayüz anında değişir.

## Aşamalar

- **Aşama 0 (bu spec + ilk plan):** Kütüphane kurulumu, `i18n.ts`, `en/tr.json` (nav + common), `LanguageSwitcher` (sabit sağ üst), menünün `titleKey`'e geçişi ve `PageLayout`'ta çevirisi. **Sonuç:** Dil değiştirici çalışır; menü iki dilli; gerisi İngilizce.
- **Aşama 1+:** Her aşamada bir sayfa. O sayfanın gömülü İngilizce metinleri `t('<sayfa>.*')`'a taşınır, `en.json`/`tr.json`'a karşılıkları eklenir. Sıra önerisi: Dashboard → Procedures → Payments → Expenses → Tax Calculation → ... → Settings.

## Hata yönetimi

- Eksik anahtar: i18next `fallbackLng: 'en'` ile İngilizce'ye düşer; düşemezse anahtarı gösterir (geliştirme sırasında fark edilir). Çevrilmemiş sayfalar zaten düz İngilizce string taşır, etkilenmez.
- Bozuk/eksik `localStorage` değeri: i18next `fallbackLng`'e döner.

## Test

- Formal test altyapısı yok. Doğrulama yöntemi:
  - **Tip kontrolü:** `npx tsc` (değiştirilen dosyalarda hata yok).
  - **Manuel/görsel:** Uygulamayı çalıştırıp dil değiştiriciyle TR↔EN geçişi; menünün değiştiğini, seçimin sayfa yenilemede kaldığını (localStorage), değiştiricinin her sayfada sağ üstte sabit durduğunu doğrulama.
  - JSON geçerliliği: `en.json` ve `tr.json` aynı anahtar kümesine sahip olmalı (aşama sonu kontrolü).

## Kapsam dışı (YAGNI)

- İkiden fazla dil.
- Tarayıcı diline göre otomatik algılama (varsayılan sabit İngilizce).
- Tarih/sayı/para birimi yerelleştirmesi (sadece metin çevirisi).
- Sunucu tarafı / e-posta / PDF / Excel çıktılarının çevirisi (yalnızca web arayüzü).
