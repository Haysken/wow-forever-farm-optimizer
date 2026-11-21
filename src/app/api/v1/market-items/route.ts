import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hasDatabaseUrl } from "@/db";
import { browseMarketItems } from "@/db/detail-service";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  marketId: z.string().min(2).default("us:0"),
  search: z.string().optional(),
  newForeverOnly: z
    .enum(["true", "false", "1", "0"])
    .optional()
    .transform((v) => v === "true" || v === "1"),
  itemClass: z.string().optional(),
  minQuality: z.coerce.number().int().min(0).max(7).optional(),
  sortBy: z
    .enum(["price_desc", "price_asc", "change_24h", "sold_per_day", "supply"])
    .default("price_desc"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function GET(request: NextRequest) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const parsed = querySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams.entries())
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid parameters", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const data = await browseMarketItems(parsed.data);
    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load market items" },
      { status: 500 }
    );
  }
}
