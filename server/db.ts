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
  // connection string — passing ssl: false alongside a URL that still contains
  // sslmode=prefer is NOT enough; pg still attempts SSL.
  // Solution: if SSL is not strictly required, strip the sslmode param from
  // the URL entirely AND set ssl: false so pg never negotiates SSL.
  try {
    const url = new URL(connectionString);
    const sslmode = url.searchParams.get("sslmode") ?? "";

    if (sslmode === "require") {
      // External services (e.g. Neon) — keep SSL on
      return { connectionString };
    }

    // sslmode=prefer / disable / unset (internal Docker postgres, etc.)
    // Strip the param so pg can't read it, then hard-disable SSL.
    url.searchParams.delete("sslmode");
    url.searchParams.delete("ssl");
    // Remove trailing ? if no params remain
    const cleanUrl = url.toString().replace(/\?$/, "");
    return { connectionString: cleanUrl, ssl: false };
  } catch {
    // URL parsing failed — fall back to disabling SSL
    return { connectionString, ssl: false };
  }
}

export const pool = new pg.Pool(buildPoolConfig(process.env.DATABASE_URL));
export const db = drizzle({ client: pool, schema });
