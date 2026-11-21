import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hasDatabaseUrl } from "@/db";
import { computeFarmRankings } from "@/db/profitability-service";
import { TtlCache } from "@/lib/cache";
import type { ConfidenceTier } from "@/providers/types";

export const dynamic = "force-dynamic";

const rankingsCache = new TtlCache<Awaited<ReturnType<typeof computeFarmRankings>>>(
  60_000,
  150
);

const querySchema = z.object({
  marketId: z.string().min(2).default("us:110"),
  killsPerHour: z.coerce.number().positive().max(10_000).default(60),
  hourlyExpensesCopper: z.coerce.number().min(0).default(0),
  commissionOverride: z.coerce.number().min(0).max(0.99).optional(),
  timeHorizonDays: z.coerce.number().positive().max(30).default(1),
  zone: z.string().optional(),
  minLevel: z.coerce.number().int().min(1).max(70).optional(),
  maxLevel: z.coerce.number().int().min(1).max(70).optional(),
  minQuality: z.coerce.number().int().min(0).max(7).optional(),
  itemCategory: z.string().optional(),
  minDropRate: z.coerce.number().min(0).max(1).optional(),
  minItemPriceCopper: z.coerce.number().min(0).optional(),
  minEgphCopper: z.coerce.number().optional(),
  confidence: z.string().optional(),
  search: z.string().optional(),
  sortBy: z
    .enum([
      "egph_adjusted",
      "egph_gross",
      "egpk",
      "best_item_value",
      "drop_rate",
      "liquidity",
      "price_trend",
    ])
    .default("egph_adjusted"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const VALID_TIERS = new Set<ConfidenceTier>([
  "VERIFIED",
  "OBSERVED",
  "ESTIMATED",
  "UNKNOWN",
]);

export async function GET(request: NextRequest) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json(
      { error: "Database not configured" },
      { status: 503 }
    );
  }

  const rawParams = Object.fromEntries(request.nextUrl.searchParams.entries());
  const parsed = querySchema.safeParse(rawParams);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query parameters", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const p = parsed.data;
  const allowedConfidenceTiers = p.confidence
    ? p.confidence
        .split(",")
        .map((s) => s.trim().toUpperCase() as ConfidenceTier)
        .filter((t) => VALID_TIERS.has(t))
    : undefined;

  try {
    const cacheKey = request.nextUrl.searchParams.toString();
    const cached = rankingsCache.get(cacheKey);
    if (cached) {
      return NextResponse.json(cached, {
        headers: {
          "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
          "X-Cache": "HIT",
        },
      });
    }

    const data = await computeFarmRankings({
      marketId: p.marketId,
      killsPerHour: p.killsPerHour,
      hourlyExpensesCopper: p.hourlyExpensesCopper,
      commissionOverride: p.commissionOverride,
      timeHorizonDays: p.timeHorizonDays,
      zoneName: p.zone,
      minLevel: p.minLevel,
      maxLevel: p.maxLevel,
      minQuality: p.minQuality,
      itemCategory: p.itemCategory,
      minDropRate: p.minDropRate,
      minItemPriceCopper: p.minItemPriceCopper,
      minEgphCopper: p.minEgphCopper,
      allowedConfidenceTiers,
      search: p.search,
      sortBy: p.sortBy,
      limit: p.limit,
      offset: p.offset,
    });
    rankingsCache.set(cacheKey, data);
    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
        "X-Cache": "MISS",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Ranking query failed" },
      { status: 500 }
    );
  }
}
