// One-off cleanup of the test records created while building the Invoice
// Maker export feature (user-approved deletion).
import { rawDb } from "../server/db";

(async () => {
  const res = await rawDb.query(
    `DELETE FROM invoice_maker_history
     WHERE invoice_no IN ('88887777', 'SIGTEST1', 'SIZETEST')
     RETURNING id, invoice_no`,
  );
  console.log(
    "Silinen test kayıtları:",
    res.rows.map((r) => `#${r.id} ${r.invoice_no}`).join(", ") || "(yok)",
  );
  const left = await rawDb.query(
    `SELECT id, invoice_no FROM invoice_maker_history ORDER BY id`,
  );
  console.log(
    "Kalan kayıtlar:",
    left.rows.map((r) => `#${r.id} ${r.invoice_no}`).join(", ") || "(boş)",
  );
  await rawDb.end();
})();
