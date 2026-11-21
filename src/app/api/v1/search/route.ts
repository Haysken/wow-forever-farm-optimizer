import { NextRequest, NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/db";
import { unifiedSearch } from "@/db/detail-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const q = request.nextUrl.searchParams.get("q") ?? "";
  if (q.trim().length < 1) {
    return NextResponse.json({ items: [], creatures: [], zones: [] });
  }

  try {
    const result = await unifiedSearch(q, 15);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Search failed" },
      { status: 500 }
    );
  }
}
