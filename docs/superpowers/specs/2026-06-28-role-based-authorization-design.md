# Rol Bazlı Yetkilendirme (RBAC) — Tasarım Dokümanı

**Tarih:** 2026-06-28
**Durum:** Onaylandı (kullanıcı), uygulama planı bekliyor
**İlgili:** Güvenlik raporu madde 3 (rol ayrımı) + madde B (okuma kapıları açık)

## Problem

Şema'da `userRoleEnum ('admin' | 'user' | 'accountant')` tanımlı ([shared/schema.ts](../../../shared/schema.ts)) ve kullanıcılara rol atanmış durumda, ama hiçbir route bu rolü kontrol etmiyor. Sonuçlar:

1. **Yazma:** Giriş yapan herkes her şeyi yapabiliyor — sıradan bir `user` ödeme sileb, vergi değiştirebilir, hatta başka kullanıcıları yönetip kendini admin yapabilir.
2. **Okuma:** Görüntüleme (GET) uçları giriş bile istemiyor (rapor madde B). Daha önce eklenen auth gate yalnızca yazma metodlarını (POST/PUT/PATCH/DELETE) kapsıyor.

## Mevcut kullanıcılar (User Management ekranından, 2026-06-28)

| Kullanıcı | Rol (mevcut) | Rol (hedef) |
|-----------|--------------|-------------|
| cem.yildirim | admin | admin |
| admin | admin | admin |
| merve.vural | user | **accountant** |
| nilesh.kamble | user | user |
| burak.bulbul | user | user |

## Yetki kuralları

| İşlem sınıfı | user | accountant | admin |
|--------------|:----:|:----------:|:-----:|
| Görüntüleme (tüm veriler) — giriş şartıyla | ✅ | ✅ | ✅ |
| Oluşturma / düzenleme (operasyonel **ve** finansal) | ✅ | ✅ | ✅ |
| Finansal silme (ödeme, vergi, fatura, gider) | ❌ | ✅ | ✅ |
| Operasyonel silme (gümrük işlemi, ürün, HS kod) | ❌ | ❌ | ✅ |
| Toplu sıfırlama (reset-all / reset) | ❌ | ❌ | ✅ |
| Kullanıcı yönetimi | ❌ | ❌ | ✅ |

**Kapsam dışı (YAGNI):** Rol bazlı *görüntüleme* kısıtı yok — üç rol de her veriyi görür. Giriş yapmamış kullanıcı hiçbir veriyi göremez.

## Yaklaşım

Seçilen yaklaşım: **hedefli `requireRole` middleware'leri**.

Gerekçe: "user = silme hariç her şey" kuralı sayesinde oluşturma/düzenleme (POST/PUT) kapıları zaten mevcut "giriş şartı" auth gate'iyle yeterince korunuyor; bunlara dokunmaya gerek yok. Yalnızca:
- silme (DELETE) kapılarına,
- kullanıcı/admin yönetimi kapılarına

rol kontrolü eklenir; görüntüleme (GET) kapıları giriş şartına bağlanır.

Değerlendirilen alternatifler:
- **A — Her route'a tek tek etiket:** çok sayıda route'a dokunmak gerekir; gereksiz.
- **B — Merkezi path→rol haritası:** esnek ama `:id` parametreleri ve path pattern eşleşmesinde hata riski yüksek.

### Middleware tasarımı

Yeni dosya: `server/auth-middleware.ts`

```ts
// Pseudokod
export function requireRole(...allowed: Array<'admin'|'accountant'|'user'>) {
  return async (req, res, next) => {
    const userId = (req.session?.userId) ?? verifyToken(bearerHeader);
    if (!userId) return res.status(401).json({ message: 'Giriş gerekli' });
    const user = await storage.getUserById(userId);          // rolü taze oku
    if (!user || !allowed.includes(user.role)) {
      return res.status(403).json({ message: 'Bu işlem için yetkiniz yok' });
    }
    (req as any).currentUser = user;
    next();
  };
}
```

**Önemli karar:** Rol token'a gömülmez; her korumalı istekte veritabanından taze okunur. Böylece bir kullanıcının rolü değiştiğinde anında geçerli olur; eski (7 gün geçerli) anahtarlar yanlış yetki taşımaz. Silme/yönetim işlemleri seyrek olduğundan ek DB sorgusunun maliyeti önemsiz.

`verifyToken` mevcut [server/auth-token.ts](../../../server/auth-token.ts)'ten gelir; imzalı token doğrulaması bu işle uyumludur.

### Etkilenen route'lar (envanter)

**Finansal silme → `requireRole('admin','accountant')`**
- DELETE /api/payments/:id
- DELETE /api/incoming-payments/:id
- DELETE /api/payment-distributions/:id
- DELETE /api/service-invoices/:id
- DELETE /api/import-expenses/:id
- DELETE /api/expense-documents/:id
- DELETE /api/tax-calculation/calculations/:id
- DELETE /api/tax-calculation/items/:id
- DELETE /api/invoice-line-items/:id

**Toplu sıfırlama → `requireRole('admin')`**
- DELETE /api/payments/reset-all
- DELETE /api/all-payments/reset
- DELETE /api/all-payment-distributions/reset

**Operasyonel silme → `requireRole('admin')`**
- DELETE /api/procedures/:id
- DELETE /api/products/:id
- DELETE /api/hs-codes/:trHsCode
- DELETE /api/master-excel
- DELETE /api/procedure-status-details/:id
- DELETE /api/tax-calculation/products/:id
- DELETE /api/tax-calculation/hs-codes/:code

**Kullanıcı yönetimi → `requireRole('admin')`**
- POST /api/users, PUT /api/users/:id, DELETE /api/users/:id
- POST /api/admin/users, DELETE /api/admin/users/:id
- POST /api/admin/document-types

**Görüntüleme (GET) → giriş şartı:** [server/index.ts](../../../server/index.ts) içindeki mevcut auth gate, GET metodunu da kapsayacak şekilde genişletilir. Muaf: `/api/auth/login`, `/api/auth/me` (kendi auth mantığını yürütür). `/mcp/*` zaten `/api` dışındadır, etkilenmez.

### MCP / Cowork ajanı

MCP router `/mcp` altında, `/api` dışında ve kendi bearer-token auth'una sahip. Hiçbir auth gate veya `requireRole` MCP isteklerini etkilemez — değişiklik MCP akışına dokunmaz.

## Geçiş planı (sıra kritik)

1. **Önce roller atanır:** Kullanıcı, User Management ekranından `merve.vural`'ı `accountant` yapar. (Production veritabanına Claude dokunmaz; en güvenli yol kullanıcının kendi ekranı.)
2. **Sonra kurallar yayına alınır:** Kod değişiklikleri commit → push → otomatik deploy.

Bu sıra sayesinde kurallar aktifleştiğinde herkes doğru yetkiye zaten sahip olur; kimse mağdur olmaz. Adminler (cem.yildirim, admin) zaten admin rolünde olduğundan silme/yönetim yetkisi kesintisiz kalır.

## Doğrulama

Yayın sonrası canlı testler (curl):
- `user` anahtarıyla DELETE /api/payments/:id → **403** (finansal silme reddi)
- `accountant` anahtarıyla DELETE /api/payments/:id → **200/uygun** (izinli)
- `accountant` anahtarıyla DELETE /api/procedures/:id → **403** (operasyonel silme reddi)
- `accountant` anahtarıyla DELETE /api/payments/reset-all → **403** (toplu sıfırlama reddi)
- giriş yapmamış GET /api/procedures → **401** (madde B kapandı)
- giriş yapmış GET /api/procedures → **200**
- admin → tüm işlemler **izinli**

Ek olarak `requireRole` için birim testleri (rol eşleşmesi, yetkisiz rol reddi, geçersiz/eksik token reddi).

## Riskler ve azaltma

- **Yanlışlıkla bir DELETE route'unu atlamak:** envanter yukarıda; uygulama planında her madde tek tek işaretlenir.
- **GET giriş şartının bir public ucu kırması:** login akışı yalnızca `/api/auth/login` (POST) kullanır; muaf liste netleştirildi. Yayın sonrası gerçek giriş akışı test edilir.
- **Rolü değişen kullanıcının eski anahtarı:** rol DB'den taze okunduğu için sorun olmaz.
