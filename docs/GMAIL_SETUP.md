# Mail Bağlantısı Kurulumu (bir kerelik)

Uygulama, firmalardan gelen mailleri okuyabilmek için Gmail hesabınıza
**uygulama şifresi** ile bağlanır. Google Cloud Console'a girmeniz gerekmez.

Toplam süre: yaklaşık 5 dakika.

---

## 1. Gmail'de IMAP'i açın

1. Gmail'i açın, sağ üstteki dişli çarka tıklayın, **"Tüm ayarları görüntüle"** deyin.
2. Üstteki sekmelerden **"Yönlendirme ve POP/IMAP"** sekmesine geçin.
3. **"IMAP erişimi"** bölümünde **"IMAP'i etkinleştir"** seçili olsun.
4. Sayfanın altındaki **"Değişiklikleri kaydet"** düğmesine basın.

Bu seçenek görünmüyorsa veya yönetici tarafından kapatılmışsa bu yöntem
kullanılamaz — durumu bana bildirin, başka bir yol deneriz.

## 2. Uygulama şifresi oluşturun

1. Tarayıcıda <https://myaccount.google.com/apppasswords> adresini açın.
   (Uygulamadaki Ayarlar sayfasında da bu adrese giden bir bağlantı var.)
2. Google sizden iki adımlı doğrulamayı açmanızı isterse önce onu açın; uygulama
   şifresi ancak iki adımlı doğrulama açıkken oluşturulabiliyor.
3. Açılan kutuya bir isim yazın — örneğin `CNCxSOHO Mail Takibi`. İsim yalnızca
   sizin hatırlamanız içindir.
4. **"Oluştur"** deyin. Google size 16 harflik bir şifre gösterecek
   (`abcd efgh ijkl mnop` gibi). **Bu ekranı kapatmadan kopyalayın** — Google
   bu şifreyi bir daha göstermez.

> Bu şifre, Google hesabınızın normal şifresi değildir. Yalnızca bu uygulamaya
> aittir ve dilediğiniz an aynı sayfadan silebilirsiniz.

## 3. Uygulamaya girin

1. Uygulamada **Ayarlar** sayfasını açın.
2. **"Mail Bağlantısı"** kartında mail adresinizi ve az önce kopyaladığınız
   uygulama şifresini yazıp **"Bağlan"** deyin.
3. Uygulama şifreyi kaydetmeden önce bağlantıyı dener. Bir hata varsa ne
   yapmanız gerektiğini söyleyen bir mesaj görürsünüz; şifre yanlışsa hiçbir şey
   kaydedilmez.

## 4. Takip edilecek firmaları ekleyin

Aynı sayfadaki **"Takip Edilen Firmalar"** kartına, maillerini okumasını
istediğiniz adresleri ekleyin:

- Tek bir adres için: `ops@firma.com`
- Firmanın bütün adresleri için: `@firma.com`

**Bu liste boşken hiçbir mail taranmaz.** Uygulama yalnızca buraya yazdığınız
adreslerden gelen mailleri okur; kutunuzdaki diğer hiçbir maile dokunmaz.

## 5. İlk kontrolü başlatın

**Mail Takibi** sayfasına gidip **"Şimdi kontrol et"** deyin. İlk kontrol son 7
günü tarar ve birkaç dakika sürebilir; sayfa bu sırada kullanılabilir durumda
kalır. Sonrasında uygulama 15 dakikada bir kendiliğinden bakar.

---

## Erişimi sonlandırmak

İki adımı birlikte yapın:

1. Uygulamada **Ayarlar → Mail Bağlantısı → "Bağlantıyı kes"**. Bu, bizdeki
   şifre kopyasını siler; kayıtlı mailler ve özetler durmaya devam eder.
2. <https://myaccount.google.com/apppasswords> adresinden o uygulama şifresini
   silin. Asıl erişimi kesen adım budur.

## Sık karşılaşılan hatalar

| Mesaj | Anlamı |
|---|---|
| "Giriş başarısız… uygulama şifresi girilmeli" | Normal Google şifreniz yazılmış olabilir; 2. adımdaki 16 harfli şifreyi kullanın. |
| "Gmail'de IMAP kapalı görünüyor" | 1. adımı atlamışsınız ya da ayar kaydedilmemiş. |
| "Mail sunucusuna bağlanılamadı" | Geçici ağ sorunu; birkaç dakika sonra tekrar deneyin. |

## Geliştirici notu

Sunucunun ihtiyaç duyduğu tek gizli değer, uygulama şifresini şifreleyerek
saklamak için kullanılan `EMAIL_TOKEN_ENC_KEY`. 64 karakterlik hex üretmek için:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
gh secret set EMAIL_TOKEN_ENC_KEY
```

Bu anahtar değişirse kayıtlı uygulama şifresi çözülemez ve kullanıcının yeniden
bağlanması gerekir. Senkronu tamamen durdurmak için `EMAIL_SYNC_ENABLED=false`.
