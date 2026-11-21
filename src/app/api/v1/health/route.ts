import { desc, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb, hasDatabaseUrl, schema } from "@/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const startedMs = Date.now();
  if (!hasDatabaseUrl()) {
    return NextResponse.json(
      {
        status: "unconfigured",
        database: "missing_database_url",
        checkedAt: new Date().toISOString(),
      },
      { status: 503 }
    );
  }

  try {
    const db = getDb();
    await db.execute(sql`select 1`);

    const [latestSyncs, marketFreshness] = await Promise.all([
      db
        .select({
          provider: schema.syncRuns.provider,
          jobType: schema.syncRuns.jobType,
          status: schema.syncRuns.status,
          recordsProcessed: schema.syncRuns.recordsProcessed,
          recordsFailed: schema.syncRuns.recordsFailed,
          finishedAt: schema.syncRuns.finishedAt,
        })
        .from(schema.syncRuns)
        .orderBy(desc(schema.syncRuns.startedAt))
        .limit(10),
      db
        .select({
          oldestSnapshot: sql<Date | null>`min(${schema.ahMarkets.lastSnapshotAt})`,
          newestSnapshot: sql<Date | null>`max(${schema.ahMarkets.lastSnapshotAt})`,
          marketCount: sql<number>`count(*)::int`,
        })
        .from(schema.ahMarkets),
    ]);

    const freshness = marketFreshness[0];
    const now = Date.now();
    const newestAgeMin = freshness?.newestSnapshot
      ? Math.max(0, Math.round((now - new Date(freshness.newestSnapshot).getTime()) / 60_000))
      : null;
    const oldestAgeMin = freshness?.oldestSnapshot
      ? Math.max(0, Math.round((now - new Date(freshness.oldestSnapshot).getTime()) / 60_000))
      : null;

    return NextResponse.json({
      status: "ok",
      database: "connected",
      dbLatencyMs: Date.now() - startedMs,
      markets: {
        count: freshness?.marketCount ?? 0,
        newestSnapshotAgeMin: newestAgeMin,
        oldestSnapshotAgeMin: oldestAgeMin,
        staleWarning: newestAgeMin !== null && newestAgeMin > 120,
      },
      latestSyncs,
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: "error",
        database: "unreachable",
        message: error instanceof Error ? error.message : "Database check failed",
        checkedAt: new Date().toISOString(),
      },
      { status: 503 }
    );
  }
}
