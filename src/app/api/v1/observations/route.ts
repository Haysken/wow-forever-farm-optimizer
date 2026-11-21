import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hasDatabaseUrl } from "@/db";
import { recordUserDropObservation } from "@/ingestion/on-demand-hydrator";

export const dynamic = "force-dynamic";

const observationSchema = z
  .object({
    creatureId: z.number().int().positive(),
    itemId: z.number().int().positive(),
    killsObserved: z.number().int().positive().max(1_000_000),
    dropsObserved: z.number().int().positive().max(1_000_000),
    avgQty: z.number().positive().max(1000).optional(),
    marketId: z.string().min(2).optional(),
  })
  .refine((v) => v.dropsObserved <= v.killsObserved, {
    message: "dropsObserved cannot exceed killsObserved",
  });

export async function POST(request: NextRequest) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json(
      { error: "Database not configured" },
      { status: 503 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = observationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid drop observation", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const res = await recordUserDropObservation(parsed.data);
    if (res.resolvedCount === 0) {
      return NextResponse.json(
        { error: "Creature ID or Item ID not found in catalog" },
        { status: 404 }
      );
    }
    return NextResponse.json({
      ok: true,
      source: "user_observation",
      confidenceTier: "OBSERVED",
      dropRate: res.dropRate,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to record observation",
      },
      { status: 500 }
    );
  }
}
