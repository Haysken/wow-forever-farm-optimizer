import type { DropProbabilityMetrics } from "./types";

/**
 * Expected number of kills to obtain one drop: Kills = 1 / P.
 * Returns null when P <= 0 (impossible drop).
 */
export function expectedKillsPerDrop(dropProbability: number): number | null {
  if (!Number.isFinite(dropProbability) || dropProbability <= 0) {
    return null;
  }
  if (dropProbability >= 1) {
    return 1;
  }
  return 1 / dropProbability;
}

/**
 * Probability of obtaining at least one drop in k independent kills:
 * P(at least one drop) = 1 - (1 - p)^k
 */
export function probabilityAtLeastOneDrop(
  dropProbability: number,
  kills: number
): number {
  if (!Number.isFinite(dropProbability) || !Number.isFinite(kills)) {
    return 0;
  }
  if (kills <= 0 || dropProbability <= 0) {
    return 0;
  }
  if (dropProbability >= 1) {
    return 1;
  }
  return 1 - Math.pow(1 - dropProbability, kills);
}

/**
 * Kills required to reach target probability T (e.g., 0.50 for K50, 0.90 for K90):
 * K_T = ln(1 - T) / ln(1 - p)
 *
 * Edge cases:
 * - p <= 0: null (impossible)
 * - p >= 1: 1 (guaranteed on first kill when T > 0)
 * - T <= 0: 0
 * - T >= 1: null (100% certainty impossible when p < 1)
 */
export function killsForTargetProbability(
  dropProbability: number,
  targetProbability: number
): number | null {
  if (!Number.isFinite(dropProbability) || !Number.isFinite(targetProbability)) {
    return null;
  }
  if (targetProbability <= 0) {
    return 0;
  }
  if (dropProbability <= 0) {
    return null;
  }
  if (dropProbability >= 1) {
    return 1;
  }
  if (targetProbability >= 1) {
    return null;
  }
  return Math.log(1 - targetProbability) / Math.log(1 - dropProbability);
}

export function computeDropProbabilityMetrics(
  dropProbability: number
): DropProbabilityMetrics {
  const clamped = Number.isFinite(dropProbability)
    ? Math.min(1, Math.max(0, dropProbability))
    : 0;

  return {
    dropRate: clamped,
    expectedKillsPerDrop: expectedKillsPerDrop(clamped),
    killsFor50Pct: killsForTargetProbability(clamped, 0.5),
    killsFor90Pct: killsForTargetProbability(clamped, 0.9),
  };
}
