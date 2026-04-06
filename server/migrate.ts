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

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle({ client: pool });

try {
  console.log("[migrate] Running database migrations...");
  // The migrations folder is copied to the same directory as this script at build time
  const migrationsFolder = path.join(__dirname, "migrations");
  await migrate(db, { migrationsFolder });
  console.log("[migrate] All migrations applied successfully.");
} catch (err) {
  console.error("[migrate] Migration failed:", err);
  process.exit(1);
} finally {
  await pool.end();
}
