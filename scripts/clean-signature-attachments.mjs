/**
 * Mail imzalarındaki gömülü resimleri ek listesinden temizler.
 *
 * Mail takibi ilk sürümünde imza logoları, Outlook'un gömdüğü resimler ve
 * takip pikselleri de "ek" olarak kaydedilmişti; bir mailde 7-8 sahte ek
 * çıkıyordu. Ayrıştırıcı artık bunları hiç kaydetmiyor (isSignatureImage);
 * bu betik geçmişte kaydedilmiş olanları siler.
 *
 * GÜVENLİK: yalnızca hiç kullanılmamış kayıtlara dokunur —
 * status='pending' VE procedure_document_id IS NULL. Bir prosedüre
 * kaydedilmiş hiçbir ek silinmez.
 *
 * Kullanım:
 *   node --env-file=.env scripts/clean-signature-attachments.mjs           (deneme)
 *   node --env-file=.env scripts/clean-signature-attachments.mjs --apply   (siler)
 */

import pg from "pg";

const apply = process.argv.includes("--apply");

// Geçmiş kayıtlarda Content-ID saklanmadığı için resim olma şartı + hiç
// kaydedilmemiş olma şartıyla yetiniyoruz. Bu mail kutusunda gerçek belgelerin
// tamamı PDF/Excel/Word; resimlerin tamamı imza gürültüsü.
const TARGET = `
  mime_type ILIKE 'image/%'
  AND status = 'pending'
  AND procedure_document_id IS NULL
`;

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL yok");
    process.exitCode = 1;
    return;
  }

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const before = await pool.query("SELECT COUNT(*)::int c FROM email_attachments");
    const target = await pool.query(`SELECT COUNT(*)::int c FROM email_attachments WHERE ${TARGET}`);
    const protectedRows = await pool.query(
      `SELECT COUNT(*)::int c FROM email_attachments
       WHERE mime_type ILIKE 'image/%' AND NOT (${TARGET})`,
    );

    console.log(`Toplam ek kaydı        : ${before.rows[0].c}`);
    console.log(`Silinecek imza resmi   : ${target.rows[0].c}`);
    console.log(`Korunan resim (kayıtlı): ${protectedRows.rows[0].c}`);

    if (!apply) {
      console.log("\nDeneme modu — hiçbir şey silinmedi. Silmek için --apply ekleyin.");
      return;
    }

    const deleted = await pool.query(`DELETE FROM email_attachments WHERE ${TARGET}`);
    // Eki kalmayan maillerin ataş rozeti kalkmalı.
    const flags = await pool.query(`
      UPDATE emails e
      SET has_attachments = EXISTS (SELECT 1 FROM email_attachments a WHERE a.email_id = e.id)
      WHERE e.has_attachments <> EXISTS (SELECT 1 FROM email_attachments a WHERE a.email_id = e.id)
    `);
    const after = await pool.query("SELECT COUNT(*)::int c FROM email_attachments");

    console.log(`\nSilinen kayıt          : ${deleted.rowCount}`);
    console.log(`Rozeti düzeltilen mail : ${flags.rowCount}`);
    console.log(`Kalan ek kaydı         : ${after.rows[0].c}`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("HATA:", error.message);
  process.exitCode = 1;
});
