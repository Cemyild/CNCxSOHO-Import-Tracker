# Gmail Bağlantısı Kurulumu (bir kerelik)

Bu adımlar Google Cloud Console'da yapılır ve yaklaşık 15 dakika sürer.
Sonunda elde edeceğiniz iki değeri (Client ID ve Client Secret) uygulamaya
tanıtacağız.

## 1. Proje oluştur
1. https://console.cloud.google.com adresine şirket hesabınızla girin.
2. Üst çubuktaki proje seçiciden **New Project** deyin.
3. Ada `CNCxSOHO Mail` yazıp **Create** deyin ve yeni projeye geçin.

## 2. Gmail API'yi aç
1. Sol menüden **APIs & Services → Library**.
2. Arama kutusuna `Gmail API` yazın, çıkan sonuca tıklayın.
3. **Enable** deyin.

## 3. İzin ekranını ayarla
1. **APIs & Services → OAuth consent screen**.
2. User Type olarak **Internal** seçin ve **Create** deyin.
   (Internal seçilebiliyorsa Google'ın uygulama inceleme süreci gerekmez.)
3. App name: `CNCxSOHO Import Tracker`. Support email ve developer email
   alanlarına kendi şirket adresinizi yazın. **Save and Continue**.
4. Scopes adımında **Add or Remove Scopes** deyip şu kapsamı seçin:
   `https://www.googleapis.com/auth/gmail.readonly`
   Başka hiçbir kapsam eklemeyin. **Update → Save and Continue → Back to Dashboard**.

## 4. Kimlik bilgisi oluştur
1. **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
2. Application type: **Web application**. Name: `CNCxSOHO Server`.
3. **Authorized redirect URIs** bölümüne şu iki adresi ekleyin:
   - `https://cncsohoimportmanager.com/api/email/google/callback`
   - `http://localhost:5000/api/email/google/callback`
4. **Create** deyin. Açılan kutudaki **Client ID** ve **Client Secret**
   değerlerini kopyalayın — bir sonraki adımda lazım olacak.

## 5. Değerleri uygulamaya tanıt
Bu adımı geliştirici yapar: değerler `GOOGLE_CLIENT_ID` ve
`GOOGLE_CLIENT_SECRET` olarak sunucuya tanımlanır. Ayrıca token'ları şifrelemek
için bir anahtar üretilir.

## 6. Bağlan
Uygulamada **Ayarlar → Mail Bağlantısı → Gmail'e bağlan** deyin, Google'ın
ekranında hesabınızı seçip izin verin. Ardından **Takip Edilen Firmalar**
bölümüne okunmasını istediğiniz firma adreslerini ekleyin.

## Bağlantıyı iptal etmek
İki yolu var: uygulamada **Bağlantıyı kes** düğmesi, veya
https://myaccount.google.com/permissions adresinden uygulamanın erişimini
kaldırmak. İkisi de anında etki eder.

## Sorun giderme
- Mail takibi geçici olarak kapatılmak istenirse (örneğin bir sorun
  araştırılırken), sunucu ortamına `EMAIL_SYNC_ENABLED=false` eklenip
  yeniden başlatılırsa arka plandaki otomatik senkronizasyon durur; uygulamanın
  geri kalanı normal çalışmaya devam eder. Tekrar açmak için bu değeri kaldırıp
  sunucuyu yeniden başlatmak yeterlidir.
