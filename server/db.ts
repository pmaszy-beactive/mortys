import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

function buildPoolConfig(connectionString: string): pg.PoolConfig {
  // Parse the sslmode from the connection string so we can make an informed
  // decision about SSL negotiation.
  //
  // Historical note: the previous version forced ssl:false for sslmode=prefer.
  // That broke the backbone production environment whose pg_hba.conf requires
  // SSL (hostssl rule) even though the deploy script sends sslmode=prefer.
  // The fix is to let pg handle SSL negotiation naturally for prefer/require,
  // and only hard-disable SSL when the caller explicitly says sslmode=disable.
  try {
    const url = new URL(connectionString);
    const sslmode = url.searchParams.get("sslmode") ?? "";

    if (sslmode === "disable") {
      // Caller explicitly opted out of SSL — honour it.
      url.searchParams.delete("sslmode");
      url.searchParams.delete("ssl");
      const cleanUrl = url.toString().replace(/\?$/, "");
      return { connectionString: cleanUrl, ssl: false };
    }

    if (sslmode === "require" || sslmode === "prefer") {
      // Pass the connection string through unchanged so pg can negotiate SSL.
      // For sslmode=require the pg library skips cert verification (matching
      // standard PostgreSQL client behaviour).
      // For sslmode=prefer pg will try SSL first and succeed when the server
      // supports it (backbone production), or skip SSL gracefully otherwise.
      return { connectionString };
    }

    // No sslmode set — local / dev environment without SSL.
    // Strip any stale ssl params and disable SSL explicitly.
    url.searchParams.delete("sslmode");
    url.searchParams.delete("ssl");
    const cleanUrl = url.toString().replace(/\?$/, "");
    return { connectionString: cleanUrl, ssl: false };
  } catch {
    // URL parsing failed — conservative default: no SSL.
    return { connectionString, ssl: false };
  }
}

export const pool = new pg.Pool(buildPoolConfig(process.env.DATABASE_URL));
export const db = drizzle({ client: pool, schema });
