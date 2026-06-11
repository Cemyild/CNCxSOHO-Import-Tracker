import { rawDb } from "../server/db";

(async () => {
  await rawDb.query(`
    CREATE TABLE IF NOT EXISTS invoice_maker_history (
      id SERIAL PRIMARY KEY,
      invoice_no TEXT NOT NULL,
      total_qty INTEGER NOT NULL,
      total_amount DECIMAL(14,2) NOT NULL,
      filename TEXT NOT NULL,
      payload JSONB NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);
  const res = await rawDb.query(
    `SELECT column_name, data_type FROM information_schema.columns
     WHERE table_name = 'invoice_maker_history' ORDER BY ordinal_position`,
  );
  console.log("invoice_maker_history columns:");
  for (const r of res.rows) console.log(`  ${r.column_name}: ${r.data_type}`);
  await rawDb.end();
})();
