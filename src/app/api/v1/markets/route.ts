import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/db";
import { getAvailableMarkets, getDatabaseCounts } from "@/db/profitability-service";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!hasDatabaseUrl()) {
    return NextResponse.json(
      { error: "Database not configured" },
      { status: 503 }
    );
  }
  try {
    const [markets, counts] = await Promise.all([
      getAvailableMarkets(),
      getDatabaseCounts(),
    ]);
    return NextResponse.json({ markets, counts });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load markets" },
      { status: 500 }
    );
  }
}
