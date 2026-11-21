import { describe, expect, it } from "vitest";
import {
  simulateFarmingSession,
  type CreatureProfitInput,
  type LootDropInput,
} from "@/domain/profitability";

function makeLoot(overrides: Partial<LootDropInput>): LootDropInput {
  return {
    itemId: 2589,
    itemName: "Linen Cloth",
    quality: 1,
    bindType: "none",
    vendorSellCopper: 13,
    isQuestOnly: false,
    isCommodity: true,
    lootMethod: "kill",
    dropRate: 0.4,
    minQty: 1,
    maxQty: 1,
    avgQty: 1,
    avgQtyIsAssumed: false,
    confidenceTier: "VERIFIED",
    sampleSize: 200,
    reporterCount: 5,
    ciLow: 0.35,
    ciHigh: 0.45,
    source: "everloot",
    lowestBuyoutCopper: 100,
    p10Copper: 100,
    medianCopper: 100,
    marketValueCopper: 100,
    clearingPriceCopper: 100,
    availableQty: 100,
    listingCount: 10,
    trend7dPct: 0,
    trend30dPct: 0,
    priceStatus: "ACTUAL",
    snapshotAt: new Date("2026-11-21T12:00:00Z"),
    estimatedSoldPerDay: 2000,
    daysSeen: 14,
    salesDataStatus: "ESTIMATED",
    ...overrides,
  };
}

describe("simulateFarmingSession", () => {
  it("separates analytical EV from simulated outcomes and converges under Monte Carlo trials", () => {
    const creature: CreatureProfitInput = {
      creatureId: 95,
      creatureName: "Defias Smuggler",
      rawCoinMinCopper: 50,
      rawCoinMaxCopper: 50,
      rawCoinSource: "classic_db",
      loot: [
        makeLoot({
          itemId: 2589,
          dropRate: 0.5,
          clearingPriceCopper: 200,
        }),
      ],
    };

    const sim = simulateFarmingSession(
      creature,
      {
        killsPerHour: 100,
        hourlyExpensesCopper: 1000,
        marketFaction: "alliance",
      },
      {
        durationHours: 2,
        iterations: 1500,
        seed: 42,
      }
    );

    // Analytical: 200 kills * (50 coin + 0.5 * 200 * 0.95) - 2000 expenses = 200 * 145 - 2000 = 27,000c
    expect(sim.analytical.expectedKills).toBe(200);
    expect(sim.analytical.expectedGrossEvCopper).toBe(27_000);
    expect(sim.sampleRun.kills).toBe(200);
    expect(sim.distribution.iterations).toBe(1500);
    expect(sim.distribution.p10NetCopper).toBeLessThanOrEqual(
      sim.distribution.p50NetCopper
    );
    expect(sim.distribution.p50NetCopper).toBeLessThanOrEqual(
      sim.distribution.p90NetCopper
    );

    // Monte Carlo mean should be within ~5% of analytical liquidity-adjusted EV
    const relError =
      Math.abs(
        sim.distribution.meanNetCopper -
          sim.analytical.expectedLiquidityAdjustedCopper
      ) / Math.max(1, Math.abs(sim.analytical.expectedLiquidityAdjustedCopper));
    expect(relError).toBeLessThan(0.05);
  });

  it("is 100% deterministic for the same seed", () => {
    const creature: CreatureProfitInput = {
      creatureId: 95,
      creatureName: "Defias Smuggler",
      rawCoinMinCopper: 20,
      rawCoinMaxCopper: 40,
      rawCoinSource: "classic_db",
      loot: [makeLoot({ dropRate: 0.25, clearingPriceCopper: 500 })],
    };

    const a = simulateFarmingSession(
      creature,
      { killsPerHour: 60 },
      { durationHours: 1, iterations: 100, seed: 1337 }
    );
    const b = simulateFarmingSession(
      creature,
      { killsPerHour: 60 },
      { durationHours: 1, iterations: 100, seed: 1337 }
    );

    expect(a.sampleRun).toEqual(b.sampleRun);
    expect(a.distribution).toEqual(b.distribution);
  });
});
