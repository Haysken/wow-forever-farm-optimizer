import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hasDatabaseUrl } from "@/db";
import { getItemVariantDetail } from "@/db/variant-service";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  marketId: z.string().min(2).default("us:0"),
  region: z.string().optional(),
  killsPerHour: z.coerce.number().positive().max(5000).default(60),
  hourlyExpensesCopper: z.coerce.number().min(0).default(0),
});

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string; suffixId: string }> }
) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json(
      { error: "Database not configured" },
      { status: 503 }
    );
  }

  const { id, suffixId } = await context.params;
  const itemId = Number(id);
  const parsedSuffix = Number(suffixId);
  if (
    !Number.isInteger(itemId) ||
    itemId <= 0 ||
    !Number.isInteger(parsedSuffix) ||
    parsedSuffix <= 0
  ) {
    return NextResponse.json(
      { error: "Invalid item or suffix ID" },
      { status: 400 }
    );
  }

  const parsed = querySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams.entries())
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query parameters", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const detail = await getItemVariantDetail(
      itemId,
      parsedSuffix,
      parsed.data.marketId,
      {
        killsPerHour: parsed.data.killsPerHour,
        hourlyExpensesCopper: parsed.data.hourlyExpensesCopper,
        region: parsed.data.region,
      }
    );

    if (!detail) {
      return NextResponse.json(
        { error: "Item enchantment variant not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(detail, {
      headers: {
        "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to load variant detail",
      },
      { status: 500 }
    );
  }
}
