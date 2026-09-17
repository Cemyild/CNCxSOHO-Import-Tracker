-- Mailin yönü: gelen mi, bizim gönderdiğimiz mi?
--
-- Senkron artık yalnızca gelen kutusuna değil, takip edilen firmalara GİDEN
-- maillere de bakıyor. Giden mailler yeni iş üretmez (insan kendine iş yazmaz);
-- bunun yerine aynı konuşmadaki açık işleri kapatmak için kullanılır.
--
-- 004 yeni kurulumlarda kolonu zaten oluşturuyor; buradaki ALTER mevcut
-- veritabanı için. Idempotent; tekrar uygulanması güvenlidir.

ALTER TABLE emails
  ADD COLUMN IF NOT EXISTS direction TEXT NOT NULL DEFAULT 'incoming';

CREATE INDEX IF NOT EXISTS emails_direction_idx ON emails (direction);
