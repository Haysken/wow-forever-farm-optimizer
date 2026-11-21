import type { DataStatus } from "@/providers/types";
import type { LiquidityAssessment } from "./types";

export interface LiquidityInput {
  estimatedSoldPerDay: number | null;
  availableQty: number;
  trend7dPct: number | null;
  trend30dPct: number | null;
  daysSeen: number | null;
  salesDataStatus: DataStatus;
  timeHorizonDays: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Evaluates market liquidity (0..100) and estimated selling probability Si within
 * `timeHorizonDays`, kept strictly separate from drop probability Pi.
 *
 * Never invents liquidity when sales estimates are missing: returns `status: "UNKNOWN"`
 * with `score: null` and `sellingProbability: null`.
 */
export function evaluateMarketLiquidity(
  input: LiquidityInput
): LiquidityAssessment {
  const {
    estimatedSoldPerDay,
    availableQty,
    trend7dPct,
    trend30dPct,
    daysSeen,
    salesDataStatus,
    timeHorizonDays,
  } = input;

  if (
    salesDataStatus === "MISSING" ||
    estimatedSoldPerDay === null ||
    !Number.isFinite(estimatedSoldPerDay) ||
    estimatedSoldPerDay < 0
  ) {
    return {
      score: null,
      sellingProbability: null,
      daysOfSupply: null,
      status: "UNKNOWN",
      factors: {
        demandScore: null,
        supplyCompetitionScore: null,
        stabilityScore: null,
        observationScore: null,
      },
    };
  }

  const safeHorizon = Math.max(0.01, timeHorizonDays);
  const safeAvailable = Math.max(0, availableQty);

  if (estimatedSoldPerDay === 0) {
    return {
      score: 0,
      sellingProbability: 0,
      daysOfSupply: safeAvailable > 0 ? Number.POSITIVE_INFINITY : 0,
      status: "ESTIMATED",
      factors: {
        demandScore: 0,
        supplyCompetitionScore: 0,
        stabilityScore: 50,
        observationScore:
          daysSeen !== null ? clamp((daysSeen / 14) * 100, 0, 100) : 50,
      },
    };
  }

  const daysOfSupply = safeAvailable / estimatedSoldPerDay;

  // 1. Demand velocity score (log10 scale: 0.1/day -> ~10, 1/day -> ~30, 10/day -> ~55, 100/day -> ~80, 1000+/day -> 100)
  const demandScore = clamp(
    (Math.log10(estimatedSoldPerDay + 0.1) + 1) * 25,
    0,
    100
  );

  // 2. Supply overhang / competition score (<= 1 day supply -> ~100, 5 days -> ~50, 30+ days -> ~10)
  const supplyCompetitionScore = clamp(
    100 / (1 + Math.max(0, daysOfSupply - 0.5) / 4),
    0,
    100
  );

  // 3. Price stability score from 7d / 30d variation (smaller swings = higher stability)
  const volatilitySignals = [trend7dPct, trend30dPct]
    .filter((v): v is number => v !== null && Number.isFinite(v))
    .map((v) => Math.abs(v));
  const avgAbsSwing =
    volatilitySignals.length > 0
      ? volatilitySignals.reduce((acc, v) => acc + v, 0) / volatilitySignals.length
      : null;
  const stabilityScore =
    avgAbsSwing !== null ? clamp(100 - avgAbsSwing * 1.2, 10, 100) : 70;

  // 4. Observation breadth score (reaches 100 after 14 days observed)
  const observationScore =
    daysSeen !== null && Number.isFinite(daysSeen)
      ? clamp((daysSeen / 14) * 100, 15, 100)
      : 60;

  const compositeScore = clamp(
    0.45 * demandScore +
      0.3 * supplyCompetitionScore +
      0.15 * stabilityScore +
      0.1 * observationScore,
    0,
    100
  );

  // Selling probability Si over horizon T days:
  // Competitively listed unit faces effective hazard rate lambda = soldPerDay / (1 + daysOfSupply * 0.5)
  // Higher daily demand raises Si; higher supply overhang (daysOfSupply) dampens Si; longer horizon raises Si.
  const effectiveDailyHazard =
    estimatedSoldPerDay / (1 + daysOfSupply * 0.5);
  const sellingProbability = clamp(
    1 - Math.exp(-effectiveDailyHazard * safeHorizon),
    0,
    0.995
  );

  return {
    score: Number(compositeScore.toFixed(2)),
    sellingProbability: Number(sellingProbability.toFixed(4)),
    daysOfSupply: Number(daysOfSupply.toFixed(2)),
    status: "ESTIMATED",
    factors: {
      demandScore: Number(demandScore.toFixed(2)),
      supplyCompetitionScore: Number(supplyCompetitionScore.toFixed(2)),
      stabilityScore: Number(stabilityScore.toFixed(2)),
      observationScore: Number(observationScore.toFixed(2)),
    },
  };
}
