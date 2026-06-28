# Rol Bazlı Yetkilendirme (RBAC) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Giriş yapan kullanıcının rolüne (admin / accountant / user) göre silme ve kullanıcı-yönetimi işlemlerini kısıtlamak; görüntülemeyi giriş şartına bağlamak.

**Architecture:** Saf rol-karar mantığı (`auth-roles.ts`) + bu mantığı kullanan `requireRole` Express middleware'i (`auth-middleware.ts`). Middleware yalnızca silme ve yönetim route'larına eklenir; oluşturma/düzenleme zaten mevcut "giriş şartı" auth gate'iyle korunur. Görüntüleme için `index.ts`'teki auth gate GET metodunu da kapsayacak şekilde genişletilir. Rol her istekte veritabanından taze okunur.

**Tech Stack:** TypeScript, Express, express-session, Drizzle ORM, Node `crypto` (mevcut `verifyToken`), `tsx` (birim test çalıştırma).

## Global Constraints

- Rol token'a gömülmez; her korumalı istekte `storage.getUserById()` ile taze okunur — verbatim spec kararı.
- Yetkisiz rol → HTTP **403** `{ message: 'Bu işlem için yetkiniz yok' }`. Giriş yok → HTTP **401** `{ message: 'Giriş gerekli' }`.
- Formal test framework yok; saf mantık `tsx` ile test edilir, route davranışı yayın sonrası `curl` ile doğrulanır.
- MCP (`/mcp/*`) `/api` dışındadır; hiçbir değişiklik MCP'ye dokunmaz.
- Geçiş (kullanıcı tercihi): **önce kod yayına alınır, sonra** kullanıcı `merve.vural`'ı `accountant` yapar. Bu güvenli — merve rol atanana kadar `user` yetkisinde kalır (finansal silemez), adminler kesintisiz tam yetkilidir. Bunun için User Management ekranına `accountant` seçeneği eklenmelidir (Task 6b).
- Roller: `admin` = cem.yildirim, admin · `accountant` = merve.vural · `user` = nilesh.kamble, burak.bulbul.

---

### Task 1: Saf rol-karar mantığı

**Files:**
- Create: `server/auth-roles.ts`
- Test: `_auth-roles-test.ts` (proje kökünde geçici, test sonrası silinir)

**Interfaces:**
- Produces: `type Role = 'admin' | 'accountant' | 'user'` ve `roleSatisfies(userRole: string | undefined, allowed: readonly Role[]): boolean`

- [ ] **Step 1: Saf mantık dosyasını oluştur**

`server/auth-roles.ts`:
```ts
export type Role = "admin" | "accountant" | "user";

/** True if the user's role is one of the allowed roles. */
export function roleSatisfies(
  userRole: string | undefined | null,
  allowed: readonly Role[],
): boolean {
  return !!userRole && (allowed as readonly string[]).includes(userRole);
}
```

- [ ] **Step 2: Birim testini yaz**

Proje kökünde `_auth-roles-test.ts`:
```ts
import { roleSatisfies } from "./server/auth-roles";
let pass = 0, fail = 0;
const check = (n: string, c: boolean) => { console.log((c ? "✓" : "✗ FAIL") + "  " + n); c ? pass++ : fail++; };

check("admin, [admin] -> true", roleSatisfies("admin", ["admin"]) === true);
check("user, [admin] -> false", roleSatisfies("user", ["admin"]) === false);
check("accountant, [admin,accountant] -> true", roleSatisfies("accountant", ["admin", "accountant"]) === true);
check("user, [admin,accountant] -> false", roleSatisfies("user", ["admin", "accountant"]) === false);
check("admin, [admin,accountant] -> true", roleSatisfies("admin", ["admin", "accountant"]) === true);
check("undefined -> false", roleSatisfies(undefined, ["admin"]) === false);
check("null -> false", roleSatisfies(null, ["admin"]) === false);
check("bilinmeyen rol -> false", roleSatisfies("superuser", ["admin"]) === false);

console.log(`\nSonuç: ${pass} geçti, ${fail} kaldı`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 3: Testi çalıştır, GEÇMESİNİ doğrula**

Run: `npx tsx "_auth-roles-test.ts"; code=$?; rm -f "_auth-roles-test.ts"; exit $code`
Expected: `Sonuç: 8 geçti, 0 kaldı`

- [ ] **Step 4: Tip kontrolü**

Run: `npx tsc 2>&1 | grep -iE "auth-roles" || echo "OK"`
Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add server/auth-roles.ts
git commit -m "feat(rbac): pure role-decision helper (roleSatisfies)"
```

---

### Task 2: requireRole middleware

**Files:**
- Create: `server/auth-middleware.ts`

**Interfaces:**
- Consumes: `roleSatisfies`, `Role` (Task 1); `verifyToken` ([server/auth-token.ts](../../../server/auth-token.ts)); `storage.getUserById(id: number): Promise<User | undefined>` ([server/storage.ts](../../../server/storage.ts)).
- Produces: `requireRole(...allowed: Role[]): (req, res, next) => Promise<void>`

- [ ] **Step 1: Middleware dosyasını oluştur**

`server/auth-middleware.ts`:
```ts
import type { Request, Response, NextFunction } from "express";
import { storage } from "./storage";
import { verifyToken } from "./auth-token";
import { roleSatisfies, type Role } from "./auth-roles";

/** Resolve the acting user id from session cookie or signed bearer token. */
function resolveUserId(req: Request): number | null {
  const sessionUserId = (req.session as any)?.userId;
  if (sessionUserId) return sessionUserId;
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    return verifyToken(authHeader.substring(7));
  }
  return null;
}

/**
 * Express middleware: allow the request only if the acting user's role
 * (read fresh from the DB) is one of `allowed`. 401 if not logged in,
 * 403 if logged in but role not permitted.
 */
export function requireRole(...allowed: Role[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const userId = resolveUserId(req);
    if (!userId) {
      return res.status(401).json({ message: "Giriş gerekli" });
    }
    const user = await storage.getUserById(userId);
    if (!user || !roleSatisfies(user.role, allowed)) {
      return res.status(403).json({ message: "Bu işlem için yetkiniz yok" });
    }
    (req as any).currentUser = user;
    next();
  };
}
```

- [ ] **Step 2: Tip kontrolü**

Run: `npx tsc 2>&1 | grep -iE "auth-middleware" || echo "OK"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add server/auth-middleware.ts
git commit -m "feat(rbac): requireRole middleware with fresh DB role lookup"
```

---

### Task 3: Görüntülemeyi giriş şartına bağla (auth gate'i GET'e genişlet)

**Files:**
- Modify: `server/index.ts` (auth gate bloğu, ~satır 81-100)

**Interfaces:**
- Consumes: mevcut `verifyToken` importu, mevcut auth gate yapısı.

- [ ] **Step 1: Auth gate'i tüm /api isteklerini (GET dahil) kapsayacak şekilde değiştir**

`server/index.ts` içinde mevcut auth gate bloğunu bul (yorum satırı `// Auth gate:` ile başlar) ve şununla değiştir:
```ts
// Auth gate: tüm /api istekleri giriş gerektirir (görüntüleme dahil).
// Giriş; oturum çerezi VEYA imzalı Bearer anahtarı ile sağlanabilir.
// Muaf: login (giriş yapmak için) ve /api/auth/me (giriş durumunu kendi kontrol eder).
const AUTH_EXEMPT_PATHS = new Set(['/api/auth/login', '/api/auth/me']);
app.use((req, res, next) => {
  if (!req.path.startsWith('/api')) return next();
  if (AUTH_EXEMPT_PATHS.has(req.path)) return next();

  const sessionUserId = (req.session as any)?.userId;
  let headerUserId: number | null = null;
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    headerUserId = verifyToken(authHeader.substring(7));
  }

  if (!(sessionUserId || headerUserId)) {
    return res.status(401).json({ message: 'Giriş gerekli' });
  }
  next();
});
```

- [ ] **Step 2: Tip kontrolü**

Run: `npx tsc 2>&1 | grep -iE "server/index" || echo "OK"`
Expected: `OK`

- [ ] **Step 3: Yerel akıllı kontrol — auth gate mantığı**

Run: `grep -n "req.path.startsWith('/api')" server/index.ts`
Expected: tek eşleşme (method filtresi kaldırıldığı için GET dahil tüm /api korunuyor).

- [ ] **Step 4: Commit**

```bash
git add server/index.ts
git commit -m "fix(rbac): require login for all /api reads (close open GET endpoints)"
```

---

### Task 4: Finansal silme route'larına requireRole('admin','accountant')

**Files:**
- Modify: `server/routes.ts` (import + 9 DELETE route)

**Interfaces:**
- Consumes: `requireRole` (Task 2).

- [ ] **Step 1: routes.ts'e import ekle**

`server/routes.ts` üstündeki importlara (`import { signToken, verifyToken } from "./auth-token";` satırının altına) ekle:
```ts
import { requireRole } from "./auth-middleware";
```

- [ ] **Step 2: 9 finansal silme route'una middleware ekle**

Her biri için `app.delete("<path>", async (req, res) =>` kalıbını
`app.delete("<path>", requireRole('admin', 'accountant'), async (req, res) =>`
yap. Path'leri grep ile bul (satır numaraları kaymış olabilir):

```bash
grep -n 'app.delete("/api/payments/:id"\|app.delete("/api/incoming-payments/:id"\|app.delete("/api/payment-distributions/:id"\|app.delete("/api/service-invoices/:id"\|app.delete("/api/import-expenses/:id"\|app.delete("/api/expense-documents/:id"\|app.delete("/api/tax-calculation/calculations/:id"\|app.delete("/api/tax-calculation/items/:id"\|app.delete("/api/invoice-line-items/:id"' server/routes.ts
```

Hedef route listesi (tam 9 adet):
- `/api/payments/:id`
- `/api/incoming-payments/:id`
- `/api/payment-distributions/:id`
- `/api/service-invoices/:id`
- `/api/import-expenses/:id`
- `/api/expense-documents/:id`
- `/api/tax-calculation/calculations/:id`
- `/api/tax-calculation/items/:id`
- `/api/invoice-line-items/:id`

Örnek (payments):
```ts
// ÖNCE
app.delete("/api/payments/:id", async (req, res) => {
// SONRA
app.delete("/api/payments/:id", requireRole('admin', 'accountant'), async (req, res) => {
```

> Dikkat: `/api/payments/reset-all` ve `/api/all-payments/reset` Task 5'e aittir (admin-only). Bu adımda yalnızca `:id` ile biten tekil silmeleri değiştir.

- [ ] **Step 3: Doğru sayıda eklendiğini doğrula**

Run: `grep -c "requireRole('admin', 'accountant')" server/routes.ts`
Expected: `9`

- [ ] **Step 4: Tip kontrolü**

Run: `npx tsc 2>&1 | grep -iE "routes.ts" || echo "OK"`
Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add server/routes.ts
git commit -m "feat(rbac): restrict financial deletes to admin+accountant"
```

---

### Task 5: Toplu sıfırlama + operasyonel silme route'larına requireRole('admin')

**Files:**
- Modify: `server/routes.ts` (10 DELETE route)

**Interfaces:**
- Consumes: `requireRole` (Task 2, import Task 4'te eklendi).

- [ ] **Step 1: 3 toplu sıfırlama route'una admin kısıtı ekle**

`app.delete("<path>", async` → `app.delete("<path>", requireRole('admin'), async`:
- `/api/payments/reset-all`
- `/api/all-payments/reset`
- `/api/all-payment-distributions/reset`

- [ ] **Step 2: 7 operasyonel silme route'una admin kısıtı ekle**

Aynı kalıpla:
- `/api/procedures/:id`
- `/api/products/:id`
- `/api/hs-codes/:trHsCode`
- `/api/master-excel`
- `/api/procedure-status-details/:id`
- `/api/tax-calculation/products/:id`
- `/api/tax-calculation/hs-codes/:code`

Grep ile bul:
```bash
grep -n 'app.delete("/api/payments/reset-all"\|app.delete("/api/all-payments/reset"\|app.delete("/api/all-payment-distributions/reset"\|app.delete("/api/procedures/:id"\|app.delete("/api/products/:id"\|app.delete("/api/hs-codes/:trHsCode"\|app.delete("/api/master-excel"\|app.delete("/api/procedure-status-details/:id"\|app.delete("/api/tax-calculation/products/:id"\|app.delete("/api/tax-calculation/hs-codes/:code"' server/routes.ts
```

- [ ] **Step 3: Doğru sayıda eklendiğini doğrula**

Run: `grep -c "requireRole('admin')" server/routes.ts`
Expected: `10` (3 toplu + 7 operasyonel; Task 6'daki kullanıcı yönetimi henüz eklenmedi)

- [ ] **Step 4: Tip kontrolü**

Run: `npx tsc 2>&1 | grep -iE "routes.ts" || echo "OK"`
Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add server/routes.ts
git commit -m "feat(rbac): restrict bulk-reset and operational deletes to admin"
```

---

### Task 6: Kullanıcı yönetimi route'larına requireRole('admin')

**Files:**
- Modify: `server/routes.ts` (6 route)

**Interfaces:**
- Consumes: `requireRole` (Task 2).

- [ ] **Step 1: 6 yönetim route'una admin kısıtı ekle**

`app.<method>("<path>", async` → `app.<method>("<path>", requireRole('admin'), async`:
- POST `/api/users`
- PUT `/api/users/:id`
- DELETE `/api/users/:id`
- POST `/api/admin/users`
- DELETE `/api/admin/users/:id`
- POST `/api/admin/document-types`

Grep ile bul:
```bash
grep -n 'app.post("/api/users"\|app.put("/api/users/:id"\|app.delete("/api/users/:id"\|app.post("/api/admin/users"\|app.delete("/api/admin/users/:id"\|app.post("/api/admin/document-types"' server/routes.ts
```

- [ ] **Step 2: Toplam admin kısıtı sayısını doğrula**

Run: `grep -c "requireRole('admin')" server/routes.ts`
Expected: `16` (Task 5'ten 10 + bu task'tan 6)

- [ ] **Step 3: Tip kontrolü (tam proje, değiştirdiğimiz dosyalar temiz mi)**

Run: `npx tsc 2>&1 | grep -iE "auth-roles|auth-middleware|server/index|routes.ts" || echo "OK: değiştirilen dosyalarda tip hatası yok"`
Expected: `OK: değiştirilen dosyalarda tip hatası yok`

- [ ] **Step 4: Commit**

```bash
git add server/routes.ts
git commit -m "feat(rbac): restrict user management to admin"
```

---

### Task 6b: Frontend — User Management'a Muhasebeci (accountant) seçeneği

**Files:**
- Modify: `client/src/pages/settings.tsx` (rol tipleri + iki rol dropdown)

**Interfaces:** yok (UI değişikliği).

- [ ] **Step 1: Rol tiplerini genişlet**

`settings.tsx` içinde `'admin' | 'user'` geçen 4 yeri `'admin' | 'user' | 'accountant'` yap (satır ~66 tip tanımı, ~154 başlangıç state, ~992 ve ~1044 onChange cast'leri):
```bash
grep -n "'admin' | 'user'" client/src/pages/settings.tsx
```
Her birini `'admin' | 'user' | 'accountant'` ile değiştir.

- [ ] **Step 2: Create User dropdown'una accountant ekle**

`settings.tsx` ~995-996 (Create User dialog):
```tsx
// ÖNCE
<option value="user">User</option>
<option value="admin">Admin</option>
// SONRA
<option value="user">User</option>
<option value="accountant">Muhasebeci</option>
<option value="admin">Admin</option>
```

- [ ] **Step 3: Edit User dropdown'una accountant ekle**

`settings.tsx` ~1047-1048 (Edit User dialog) — aynı üç option'lı blokla değiştir.

- [ ] **Step 4: Tip kontrolü**

Run: `npx tsc 2>&1 | grep -iE "settings.tsx" || echo "OK"`
Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/settings.tsx
git commit -m "feat(rbac): add accountant role option to User Management UI"
```

---

### Task 7: Yayın ve canlı doğrulama

**Not:** Geçiş sırası kullanıcı tercihiyle değişti — önce yayın, **sonra** kullanıcı `merve.vural`'ı `accountant` yapar (Step 5'te). Adminler zaten admin olduğundan yayın güvenlidir.

**Files:** yok (deploy + doğrulama)

- [ ] **Step 1: Push (otomatik deploy tetikler)**

```bash
git push origin main
```

- [ ] **Step 2: Deploy'u izle**

```bash
gh run list --workflow=deploy.yml --limit 1
# en son run id ile:
gh run watch <RUN_ID> --exit-status
```
Expected: deploy exit 0, loglarda `OK /mcp/health`.

- [ ] **Step 3: Canlı doğrulama — giriş yapmamış okuma reddi (madde B)**

```bash
curl -s -o /dev/null -w "GET /api/procedures (auth yok) -> %{http_code}\n" https://cncsohoimportmanager.com/api/procedures
```
Expected: `401`

- [ ] **Step 4: Canlı doğrulama — sahte/yetkisiz silme reddi**

```bash
BASE="https://cncsohoimportmanager.com"
curl -s -o /dev/null -w "DELETE payments (Bearer 1, sahte) -> %{http_code}\n" -X DELETE "$BASE/api/payments/999999" -H "Authorization: Bearer 1"
```
Expected: `401` (sahte imzasız anahtar → giriş yok)

- [ ] **Step 5: Kullanıcı tarafı fonksiyonel doğrulama (manuel)**

Kullanıcıdan teyit iste:
- `merve.vural` (accountant) ile giriş → bir ödeme silebilmeli (izinli), ama bir gümrük işlemi (procedure) silmeye çalışınca "yetkiniz yok" almalı.
- `nilesh.kamble` (user) ile giriş → ödeme oluşturabilmeli ama silme seçeneği reddedilmeli (403).
- `cem.yildirim` (admin) → her şey çalışmalı.

> Not: admin/accountant token'larıyla otomatik curl testi gerçek giriş gerektirdiğinden (gerçek imzalı token), bu adım kullanıcı teyidiyle kapatılır.

- [ ] **Step 6: Frontend 403 davranışı kontrolü (kullanıcı teyidi)**

Kullanıcı `user` hesabıyla silme denediğinde arayüzün çökmeden "yetkiniz yok" benzeri bir uyarı gösterdiğini teyit eder. Çökme/donma varsa frontend'de 403 ele alımı ayrı bir düzeltme olarak not edilir (bu planın kapsamı dışında).

---

## Self-Review Notları

- **Spec kapsamı:** Yetki matrisinin her satırı bir task'a bağlı — görüntüleme (Task 3), finansal silme (Task 4), operasyonel+toplu silme (Task 5), kullanıcı yönetimi (Task 6), oluşturma/düzenleme (mevcut auth gate, değişiklik gerektirmez). ✓
- **Geçiş:** Task 7 ön koşulu rol atamasını zorunlu kılıyor. ✓
- **Tip tutarlılığı:** `Role`, `roleSatisfies`, `requireRole` imzaları tasklar arası tutarlı. ✓
- **Sayım doğrulamaları:** Task 4 → 9 `admin,accountant`; Task 5 → 10 `admin`; Task 6 → toplam 16 `admin`. Bu sayımlar route envanteriyle eşleşir.
- **Sınır kararı:** `invoice-line-items/:id` finansal kabul edildi (Task 4). Spec'te de böyle.
