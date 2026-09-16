-- Konu kimliği onarımı için deneme sayacı.
--
-- Mail takibinin ilk sürümü Gmail konu kimliğini çekmiyordu; o dönemde
-- kaydedilen mailler gruplanamıyor. Senkron turu bunları IMAP'ten tamamlıyor,
-- ama mail arşivlenmiş ya da silinmişse deneme hep başarısız olur. Sayaç
-- olmadan bu kayıtlar her turda yeniden denenir ve onarılabilir eski kayıtları
-- kuyrukta bloke eder.
--
-- 004 yeni kurulumlarda kolonu zaten oluşturuyor; buradaki ALTER mevcut
-- veritabanı için. Idempotent; tekrar uygulanması güvenlidir.

ALTER TABLE emails
  ADD COLUMN IF NOT EXISTS thread_repair_attempts INTEGER NOT NULL DEFAULT 0;
