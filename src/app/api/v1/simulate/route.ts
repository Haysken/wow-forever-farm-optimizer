import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hasDatabaseUrl } from "@/db";
import { loadCreatureProfitInput } from "@/db/profitability-service";
import {
  DEFAULT_MARKET_COMMISSIONS,
  simulateFarmingSession,
} from "@/domain/profitability";
import type { MarketFaction } from "@/providers/types";

export const dynamic = "force-dynamic";

const simulateBodySchema = z.object({
  creatureId: z.number().int().positive(),
  marketId: z.string().min(2).default("us:110"),
  durationHours: z.number().positive().max(100),
  killsPerHour: z.number().positive().max(10_000),
  hourlyExpensesCopper: z.number().min(0).default(0),
  commissionOverride: z.number().min(0).max(0.99).optional(),
  iterations: z.number().int().min(10).max(2000).default(500),
  seed: z.number().int().optional(),
});

export async function POST(request: NextRequest) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = simulateBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid simulation parameters", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const loaded = await loadCreatureProfitInput(
      parsed.data.creatureId,
      parsed.data.marketId
    );
    if (!loaded) {
      return NextResponse.json({ error: "Creature not found" }, { status: 404 });
    }

    const faction: MarketFaction = loaded.market?.faction ?? "alliance";
    const commissionRate =
      parsed.data.commissionOverride ??
      (loaded.market
        ? Number(loaded.market.defaultCommissionRate)
        : DEFAULT_MARKET_COMMISSIONS[faction]);

    const result = simulateFarmingSession(
      loaded.input,
      {
        killsPerHour: parsed.data.killsPerHour,
        hourlyExpensesCopper: parsed.data.hourlyExpensesCopper,
        marketFaction: faction,
        commissionRate,
      },
      {
        durationHours: parsed.data.durationHours,
        iterations: parsed.data.iterations,
        seed: parsed.data.seed,
      }
    );

    return NextResponse.json({
      creature: {
        id: loaded.creature.id,
        name: loaded.creature.name,
        zoneName: loaded.creature.primaryZoneName,
      },
      market: loaded.market,
      simulation: result,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Simulation failed" },
      { status: 500 }
    );
  }
}
