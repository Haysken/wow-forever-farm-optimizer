import { desc, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb, hasDatabaseUrl, schema } from "@/db";

export const dynamic = "force-dynamic";

export async function GET() {
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
    const latestSyncs = await db
      .select({
        provider: schema.syncRuns.provider,
        jobType: schema.syncRuns.jobType,
        status: schema.syncRuns.status,
        recordsProcessed: schema.syncRuns.recordsProcessed,
        finishedAt: schema.syncRuns.finishedAt,
      })
      .from(schema.syncRuns)
      .orderBy(desc(schema.syncRuns.startedAt))
      .limit(10);

    return NextResponse.json({
      status: "ok",
      database: "connected",
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
