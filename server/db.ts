import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

function buildPoolConfig(connectionString: string): pg.PoolConfig {
  // The pg library does not reliably honour sslmode=prefer/disable in the
  // connection string — it may still attempt SSL and crash on servers that
  // don't support it (e.g. internal Docker postgres).
  // Rule: only use SSL when sslmode=require is explicitly set.
  try {
    const url = new URL(connectionString);
    const sslmode = url.searchParams.get("sslmode") ?? "";
    if (sslmode === "require") {
      return { connectionString };
    }
    // sslmode=prefer / disable / unset → force SSL off so pg doesn't try it
    return { connectionString, ssl: false };
  } catch {
    // If the URL can't be parsed, fall back to no SSL
    return { connectionString, ssl: false };
  }
}

export const pool = new pg.Pool(buildPoolConfig(process.env.DATABASE_URL));
export const db = drizzle({ client: pool, schema });
