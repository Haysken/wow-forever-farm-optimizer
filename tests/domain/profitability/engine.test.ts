import { describe, expect, it } from "vitest";
import {
  calculateCreatureProfitability,
  formatCopper,
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
    dropRate: 0.5,
    minQty: 1,
    maxQty: 1,
    avgQty: 1,
    avgQtyIsAssumed: false,
    confidenceTier: "VERIFIED",
    sampleSize: 200,
    reporterCount: 5,
    ciLow: 0.43,
    ciHigh: 0.57,
    source: "everloot",
    lowestBuyoutCopper: 100,
    p10Copper: 100,
    medianCopper: 100,
    marketValueCopper: 100,
    clearingPriceCopper: 100,
    availableQty: 100,
    listingCount: 10,
    trend7dPct: 1,
    trend30dPct: 2,
    priceStatus: "ACTUAL",
    snapshotAt: new Date("2026-11-21T12:00:00Z"),
    estimatedSoldPerDay: 1000,
    daysSeen: 14,
    salesDataStatus: "ESTIMATED",
    ...overrides,
  };
}

describe("calculateCreatureProfitability (Core EGPH Engine)", () => {
  it("sums ALL relevant drops + raw coins, applies commission C and expenses E accurately", () => {
    const creature: CreatureProfitInput = {
      creatureId: 95,
      creatureName: "Defias Smuggler",
      rawCoinMinCopper: 40,
      rawCoinMaxCopper: 60, // avg 50c/kill
      rawCoinSource: "classic_db",
      loot: [
        // Item 1 (AH): P=0.5, Q=2, V=100c, C=0.05 -> gross net EV/kill = 0.5 * 2 * 100 * 0.95 = 95c
        makeLoot({
          itemId: 2589,
          itemName: "Linen Cloth",
          dropRate: 0.5,
          avgQty: 2,
          clearingPriceCopper: 100,
          vendorSellCopper: 13,
        }),
        // Item 2 (Poor/Gray -> Vendor): P=0.2, Q=1, vendor=200c, C=0, S=1 -> EV/kill = 40c
        makeLoot({
          itemId: 752,
          itemName: "Red Burlap Bandana",
          quality: 0,
          vendorSellCopper: 200,
          dropRate: 0.2,
          avgQty: 1,
          clearingPriceCopper: 5000, // ignored for gray junk
        }),
        // Item 3 (Quest -> 0c): ignored
        makeLoot({
          itemId: 1931,
          itemName: "Quest Token",
          isQuestOnly: true,
          bindType: "quest",
          dropRate: 1.0,
          vendorSellCopper: 0,
          clearingPriceCopper: null,
        }),
      ],
    };

    // K = 100 kills/hr, E = 500c/hr, C = 0.05 (Alliance)
    // Total Gross EV/kill before expenses = 50 (coin) + 95 (AH) + 40 (vendor) = 185c
    // Gross EGPH = 100 * 185 - 500 = 18,000c (1g 80s 0c)
    // Gross EGPK = 180c
    const res = calculateCreatureProfitability(creature, {
      killsPerHour: 100,
      hourlyExpensesCopper: 500,
      marketFaction: "alliance",
    });

    expect(res.rawCoinPerKillCopper).toBe(50);
    expect(res.vendorValuePerKillCopper).toBe(40);
    expect(res.ahGrossValuePerKillCopper).toBe(95);
    expect(res.egphGrossEvCopper).toBe(18_000);
    expect(res.egpkGrossEvCopper).toBe(180);
    expect(res.egphLiquidityAdjustedCopper).toBeGreaterThan(17_500);
    expect(res.egphLiquidityAdjustedCopper).toBeLessThanOrEqual(18_000);
    expect(res.bestDrop?.itemId).toBe(2589);
    expect(res.overallConfidence).toBe("VERIFIED");
    expect(formatCopper(res.egphGrossEvCopper)).toBe("1g 80s 0c");
  });

  it("applies 15% Neutral Blackwater AH commission vs 5% Faction AH commission (configurable)", () => {
    const creature: CreatureProfitInput = {
      creatureId: 100,
      creatureName: "Test Mob",
      rawCoinMinCopper: 0,
      rawCoinMaxCopper: 0,
      rawCoinSource: null,
      loot: [
        makeLoot({
          dropRate: 1.0,
          avgQty: 1,
          clearingPriceCopper: 10_000, // 1g
          vendorSellCopper: 100,
        }),
      ],
    };

    const alliance = calculateCreatureProfitability(creature, {
      killsPerHour: 10,
      marketFaction: "alliance",
    });
    const neutral = calculateCreatureProfitability(creature, {
      killsPerHour: 10,
      marketFaction: "neutral",
    });
    const custom = calculateCreatureProfitability(creature, {
      killsPerHour: 10,
      commissionRate: 0.1,
    });

    // 10 * 10000 * (1 - 0.05) = 95,000c
    expect(alliance.egphGrossEvCopper).toBe(95_000);
    // 10 * 10000 * (1 - 0.15) = 85,000c
    expect(neutral.egphGrossEvCopper).toBe(85_000);
    // 10 * 10000 * (1 - 0.10) = 90,000c
    expect(custom.egphGrossEvCopper).toBe(90_000);
  });

  it("routes BoP items and AH items below vendor floor to NPC vendor with 0% commission", () => {
    const creature: CreatureProfitInput = {
      creatureId: 200,
      creatureName: "Vendor Floor Mob",
      rawCoinMinCopper: null,
      rawCoinMaxCopper: null,
      rawCoinSource: null,
      loot: [
        // BoP blue drop: must use vendorSellCopper even if an AH price existed
        makeLoot({
          itemId: 5001,
          itemName: "BoP Dungeon Blade",
          quality: 3,
          bindType: "bop",
          dropRate: 0.5,
          vendorSellCopper: 20_000,
          clearingPriceCopper: 100_000,
        }),
        // BoE green whose AH price after 5% cut (950c) is below vendor price (1000c)
        makeLoot({
          itemId: 5002,
          itemName: "Cheap BoE Bracers",
          quality: 2,
          bindType: "boe",
          dropRate: 0.5,
          vendorSellCopper: 1_000,
          clearingPriceCopper: 1_000,
        }),
      ],
    };

    const res = calculateCreatureProfitability(creature, {
      killsPerHour: 10,
      marketFaction: "alliance",
    });

    expect(res.items.every((i) => i.liquidationChannel === "vendor")).toBe(true);
    // Per kill: 0.5 * 20,000 + 0.5 * 1,000 = 10,500c -> 105,000c/hr
    expect(res.egphGrossEvCopper).toBe(105_000);
    expect(res.egphLiquidityAdjustedCopper).toBe(105_000);
  });

  it("never invents Si when sales velocity is MISSING, separating Gross EV from Adjusted EGPH", () => {
    const creature: CreatureProfitInput = {
      creatureId: 300,
      creatureName: "Rare Transmog Mob",
      rawCoinMinCopper: 0,
      rawCoinMaxCopper: 0,
      rawCoinSource: null,
      loot: [
        makeLoot({
          itemId: 9001,
          itemName: "Illiquid Epic BoE",
          quality: 4,
          bindType: "boe",
          dropRate: 0.01,
          vendorSellCopper: 5_000,
          clearingPriceCopper: 1_000_000, // 100g
          estimatedSoldPerDay: null,
          salesDataStatus: "MISSING",
        }),
      ],
    };

    const res = calculateCreatureProfitability(creature, {
      killsPerHour: 100,
      marketFaction: "alliance",
      unknownLiquidityPolicy: "exclude_from_adjusted",
    });

    // Gross EV: 100 * 0.01 * 1,000,000 * 0.95 = 950,000c (95g/hr)
    expect(res.egphGrossEvCopper).toBe(950_000);
    // Conservative Adjusted EGPH falls back to guaranteed vendor floor: 100 * 0.01 * 5,000 = 5,000c
    expect(res.egphLiquidityAdjustedCopper).toBe(5_000);
    expect(res.unknownLiquiditySharePct).toBe(100);
    expect(res.items[0]?.liquidity.status).toBe("UNKNOWN");
    expect(res.items[0]?.liquidity.sellingProbability).toBeNull();
  });

  it("throws on invalid killsPerHour <= 0 or commissionRate out of bounds", () => {
    const empty: CreatureProfitInput = {
      creatureId: 1,
      creatureName: "Empty",
      rawCoinMinCopper: 0,
      rawCoinMaxCopper: 0,
      rawCoinSource: null,
      loot: [],
    };
    expect(() =>
      calculateCreatureProfitability(empty, { killsPerHour: 0 })
    ).toThrow(/killsPerHour/i);
    expect(() =>
      calculateCreatureProfitability(empty, { killsPerHour: 50, commissionRate: 1 })
    ).toThrow(/commissionRate/i);
  });
});
