/**
 * migrate.ts — runs all pending Drizzle SQL migrations at container startup.
 * Compiled to dist/migrate.js by the Dockerfile builder stage.
 * Called before dist/index.js via the entrypoint script.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set — cannot run migrations");
  process.exit(1);
}

async function createPoolWithSslFallback(): Promise<pg.Pool> {
  const connectionString = process.env.DATABASE_URL!;

  // Try with the connection string as-is first
  const pool = new pg.Pool({ connectionString });
  try {
    const client = await pool.connect();
    client.release();
    return pool;
  } catch (err: any) {
    const isSslError =
      err?.message?.includes("SSL") ||
      err?.message?.includes("ssl") ||
      err?.code === "EPROTO";
    if (isSslError) {
      console.log("[migrate] SSL connection failed — retrying without SSL...");
      await pool.end().catch(() => {});
      // Strip any sslmode/ssl params from the URL and force ssl: false
      const noSslUrl = connectionString
        .replace(/([?&])sslmode=[^&]*/g, "$1")
        .replace(/([?&])ssl=[^&]*/g, "$1")
        .replace(/[?&]+$/, "")
        .replace(/\?&/, "?");
      return new pg.Pool({ connectionString: noSslUrl, ssl: false });
    }
    throw err;
  }
}

let pool: pg.Pool | undefined;
try {
  console.log("[migrate] Running database migrations...");
  pool = await createPoolWithSslFallback();
  const db = drizzle({ client: pool });
  // The migrations folder is copied to the same directory as this script at build time
  const migrationsFolder = path.join(__dirname, "migrations");
  await migrate(db, { migrationsFolder });
  console.log("[migrate] All migrations applied successfully.");
} catch (err) {
  console.error("[migrate] Migration failed:", err);
  process.exit(1);
} finally {
  await pool?.end();
}
