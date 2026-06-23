const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
(async () => {
  try {
    const r = await pool.query("SELECT column_name, is_nullable, column_default FROM information_schema.columns WHERE table_name='students' AND column_name IN ('invite_token','invite_expiry','account_status','invite_sent_at') ORDER BY column_name");
    console.log("COLUMNS:", JSON.stringify(r.rows, null, 2));
  } catch (e) {
    console.error("ERR", e.message);
  } finally {
    await pool.end();
  }
})();
