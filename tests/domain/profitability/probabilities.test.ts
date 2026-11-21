import { describe, expect, it } from "vitest";
import {
  computeDropProbabilityMetrics,
  expectedKillsPerDrop,
  killsForTargetProbability,
  probabilityAtLeastOneDrop,
} from "@/domain/profitability";

describe("Drop probability metrics", () => {
  it("computes expected kills per drop (1/P) and handles 0% and 100% edge cases", () => {
    expect(expectedKillsPerDrop(0.25)).toBeCloseTo(4, 10);
    expect(expectedKillsPerDrop(0.01)).toBeCloseTo(100, 10);
    expect(expectedKillsPerDrop(1)).toBe(1);
    expect(expectedKillsPerDrop(0)).toBeNull();
    expect(expectedKillsPerDrop(-0.1)).toBeNull();
  });

  it("computes P(at least one drop) = 1 - (1 - p)^k accurately", () => {
    // p = 0.5, k = 1 -> 0.5; k = 2 -> 0.75; k = 3 -> 0.875
    expect(probabilityAtLeastOneDrop(0.5, 1)).toBeCloseTo(0.5, 10);
    expect(probabilityAtLeastOneDrop(0.5, 2)).toBeCloseTo(0.75, 10);
    expect(probabilityAtLeastOneDrop(0.5, 3)).toBeCloseTo(0.875, 10);
    // Edge cases
    expect(probabilityAtLeastOneDrop(0, 100)).toBe(0);
    expect(probabilityAtLeastOneDrop(0.5, 0)).toBe(0);
    expect(probabilityAtLeastOneDrop(1, 1)).toBe(1);
    expect(probabilityAtLeastOneDrop(1, 50)).toBe(1);
  });

  it("computes K50 = ln(0.5)/ln(1-p) and K90 = ln(0.1)/ln(1-p) with edge cases", () => {
    // For p = 0.05: K50 = ln(0.5)/ln(0.95) ≈ 13.51340733, K90 = ln(0.1)/ln(0.95) ≈ 44.89056748
    const metrics = computeDropProbabilityMetrics(0.05);
    expect(metrics.expectedKillsPerDrop).toBeCloseTo(20, 10);
    expect(metrics.killsFor50Pct).toBeCloseTo(13.51340733, 6);
    expect(metrics.killsFor90Pct).toBeCloseTo(44.89056748, 6);

    // 0% drop rate -> null
    expect(computeDropProbabilityMetrics(0)).toEqual({
      dropRate: 0,
      expectedKillsPerDrop: null,
      killsFor50Pct: null,
      killsFor90Pct: null,
    });

    // 100% drop rate -> 1 kill
    expect(computeDropProbabilityMetrics(1)).toEqual({
      dropRate: 1,
      expectedKillsPerDrop: 1,
      killsFor50Pct: 1,
      killsFor90Pct: 1,
    });

    // Target probability edge cases
    expect(killsForTargetProbability(0.1, 0)).toBe(0);
    expect(killsForTargetProbability(0.1, 1)).toBeNull();
  });
});
