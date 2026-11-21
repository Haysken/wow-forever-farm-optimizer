import { NextRequest, NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/db";
import { getMarketOpportunities } from "@/db/detail-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const marketId = request.nextUrl.searchParams.get("marketId") ?? "us:110";
  try {
    const data = await getMarketOpportunities(marketId);
    return NextResponse.json({ marketId, ...data });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load opportunities" },
      { status: 500 }
    );
  }
}
