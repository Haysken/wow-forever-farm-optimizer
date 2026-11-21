import { loadLocalEnv } from "@/lib/env";
import { sql } from "drizzle-orm";
import { closeDb, getDb } from "@/db";

loadLocalEnv();

/**
 * Applies PostgreSQL pg_trgm GIN indexes for fast substring search on items,
 * creatures, and zones, plus composite snapshot indexes, and runs ANALYZE.
 */
export async function optimizeDatabase(): Promise<void> {
  const db = getDb();

  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS items_name_trgm_idx ON items USING gin (name gin_trgm_ops)`
  );
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS creatures_name_trgm_idx ON creatures USING gin (name gin_trgm_ops)`
  );
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS zones_name_trgm_idx ON zones USING gin (name gin_trgm_ops)`
  );
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS item_snapshots_market_clearing_idx ON item_market_snapshots (market_id, clearing_price_copper DESC)`
  );
  await db.execute(sql`ANALYZE`);
}

const isMain = process.argv[1]?.endsWith("optimize-db.ts");
if (isMain) {
  optimizeDatabase()
    .then(() => {
      console.log("[db:optimize] PostgreSQL trigram & composite indexes applied + ANALYZE complete.");
    })
    .catch((err) => {
      console.error("[db:optimize] failed:", err);
      process.exitCode = 1;
    })
    .finally(() => closeDb());
}
