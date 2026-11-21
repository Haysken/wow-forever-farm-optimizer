import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hasDatabaseUrl } from "@/db";
import { getItemDetail } from "@/db/detail-service";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  marketId: z.string().min(2).default("us:110"),
  region: z.string().min(2).max(4).optional(),
  killsPerHour: z.coerce.number().positive().max(10_000).default(60),
  hourlyExpensesCopper: z.coerce.number().min(0).default(0),
});

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const { id } = await context.params;
  const itemId = Number(id);
  if (!Number.isInteger(itemId) || itemId <= 0) {
    return NextResponse.json({ error: "Invalid item ID" }, { status: 400 });
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
    const detail = await getItemDetail(itemId, parsed.data.marketId, {
      killsPerHour: parsed.data.killsPerHour,
      hourlyExpensesCopper: parsed.data.hourlyExpensesCopper,
      region: parsed.data.region,
    });
    if (!detail) {
      return NextResponse.json({ error: "Item not found" }, { status: 404 });
    }
    return NextResponse.json(detail);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load item" },
      { status: 500 }
    );
  }
}
