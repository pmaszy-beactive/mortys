/**
 * db-migrate.ts — non-interactive schema sync for post-merge / dev.
 *
 * Replaces `drizzle-kit push` in the post-merge step. `push` compares
 * shared/schema.ts against the live DB, which (a) prompts interactively on
 * ambiguous drift (renames vs. new columns) and (b) silently applies
 * pre-existing schema drift. Both are unsafe when stdin is closed during a
 * task merge.
 *
 * Instead this applies the committed SQL migration files in ./migrations via
 * the Drizzle ORM migrator. It only ever runs SQL that is checked into git, so
 * no drift from schema.ts is ever applied, and it never prompts.
 *
 * Adoption / baseline:
 * The dev database was originally built with `db:push`, so it has the full
 * schema but no `drizzle.__drizzle_migrations` tracking table. Running the
 * migrator against it as-is would try to replay 0000 (bare CREATE TABLE) and
 * fail because the tables already exist. To handle this, on the very first run
 * (tracking table absent/empty) against an already-populated database, we
 * baseline: record every currently-committed migration as already applied,
 * using Drizzle's own hashing so the records match what the migrator expects.
 * After baseline, only genuinely new migrations are applied on later runs.
 *
 * Run with: npx tsx scripts/db-migrate.ts
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import pg from "pg";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(__dirname, "..", "migrations");

if (!process.env.DATABASE_URL) {
  console.error("[db-migrate] DATABASE_URL is not set — cannot run migrations");
  process.exit(1);
}

async function createPoolWithSslFallback(): Promise<pg.Pool> {
  const connectionString = process.env.DATABASE_URL!;
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
      console.log("[db-migrate] SSL connection failed — retrying without SSL...");
      await pool.end().catch(() => {});
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

const MIGRATIONS_SCHEMA = "drizzle";
const MIGRATIONS_TABLE = "__drizzle_migrations";

/**
 * If the DB already has the application schema but no migration tracking table
 * (the legacy `db:push` case), record every committed migration as applied so
 * the migrator does not try to replay them. Returns the number of baselined
 * migrations (0 when no baseline was needed).
 */
async function baselineIfNeeded(pool: pg.Pool): Promise<number> {
  await pool.query(`CREATE SCHEMA IF NOT EXISTS "${MIGRATIONS_SCHEMA}"`);
  await pool.query(
    `CREATE TABLE IF NOT EXISTS "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )`,
  );

  const tracked = await pool.query(
    `SELECT count(*)::int AS count FROM "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}"`,
  );
  if (tracked.rows[0].count > 0) {
    return 0; // already adopted — normal incremental path
  }

  // Tracking table is empty. Only baseline if the application schema already
  // exists; otherwise this is a fresh DB and the migrator should build it.
  const populated = await pool.query(
    `SELECT to_regclass('public.users') IS NOT NULL AS exists`,
  );
  if (!populated.rows[0].exists) {
    return 0; // fresh DB — let the migrator apply everything
  }

  const migrations = readMigrationFiles({ migrationsFolder });
  for (const m of migrations) {
    await pool.query(
      `INSERT INTO "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" (hash, created_at) VALUES ($1, $2)`,
      [m.hash, m.folderMillis],
    );
  }
  return migrations.length;
}

let pool: pg.Pool | undefined;
try {
  console.log("[db-migrate] Connecting to database...");
  pool = await createPoolWithSslFallback();

  const baselined = await baselineIfNeeded(pool);
  if (baselined > 0) {
    console.log(
      `[db-migrate] Existing schema detected without migration tracking — ` +
        `baselined ${baselined} migration(s) as already applied.`,
    );
  }

  console.log("[db-migrate] Applying pending migrations...");
  const db = drizzle({ client: pool });
  await migrate(db, { migrationsFolder });
  console.log("[db-migrate] Schema is up to date.");
} catch (err) {
  console.error("[db-migrate] Migration failed:", err);
  process.exit(1);
} finally {
  await pool?.end();
}
