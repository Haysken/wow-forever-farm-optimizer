import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hasDatabaseUrl } from "@/db";
import { getCreatureDetail } from "@/db/detail-service";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  marketId: z.string().min(2).default("us:110"),
  killsPerHour: z.coerce.number().positive().max(10_000).default(60),
  hourlyExpensesCopper: z.coerce.number().min(0).default(0),
  commissionOverride: z.coerce.number().min(0).max(0.99).optional(),
  timeHorizonDays: z.coerce.number().positive().max(30).default(1),
});

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const { id } = await context.params;
  const creatureId = Number(id);
  if (!Number.isInteger(creatureId) || creatureId <= 0) {
    return NextResponse.json({ error: "Invalid creature ID" }, { status: 400 });
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
    const detail = await getCreatureDetail(creatureId, parsed.data.marketId, {
      killsPerHour: parsed.data.killsPerHour,
      hourlyExpensesCopper: parsed.data.hourlyExpensesCopper,
      commissionOverride: parsed.data.commissionOverride,
      timeHorizonDays: parsed.data.timeHorizonDays,
    });
    if (!detail) {
      return NextResponse.json({ error: "Creature not found" }, { status: 404 });
    }
    return NextResponse.json(detail);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load creature" },
      { status: 500 }
    );
  }
}
