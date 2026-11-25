import { describe, expect, it } from "vitest";
import {
  defaultDirectionForLootColumn,
  sortCreatureLoot,
  type SortableLootItem,
} from "@/domain/profitability/loot-sort";

const SAMPLE_ITEMS: SortableLootItem[] = [
  {
    itemId: 1,
    itemName: "Elemental Earth",
    dropRate: 0.08,
    avgQty: 1.0,
    liquidationChannel: "auction_house",
    unitGrossCopper: 35_000,
    expectedGrossEvPerKillCopper: 2660,
    expectedLiquidityAdjustedPerKillCopper: 2400,
    confidenceTier: "OBSERVED",
    sampleSize: 250,
    liquidity: { score: 85, sellingProbability: 0.9, status: "ESTIMATED" },
    dropMetrics: { killsFor50Pct: 9, killsFor90Pct: 28 },
  },
  {
    itemId: 2,
    itemName: "Solid Stone",
    dropRate: 0.25,
    avgQty: 2.5,
    liquidationChannel: "auction_house",
    unitGrossCopper: 1_500,
    expectedGrossEvPerKillCopper: 890,
    expectedLiquidityAdjustedPerKillCopper: 700,
    confidenceTier: "VERIFIED",
    sampleSize: 600,
    liquidity: { score: 70, sellingProbability: 0.78, status: "ESTIMATED" },
    dropMetrics: { killsFor50Pct: 3, killsFor90Pct: 8 },
  },
  {
    itemId: 3,
    itemName: "Cracked Boulder",
    dropRate: 0.4,
    avgQty: 1.0,
    liquidationChannel: "vendor",
    unitGrossCopper: 400,
    expectedGrossEvPerKillCopper: 160,
    expectedLiquidityAdjustedPerKillCopper: 160,
    confidenceTier: "ESTIMATED",
    sampleSize: null,
    liquidity: { score: null, sellingProbability: null, status: "UNKNOWN" },
    dropMetrics: { killsFor50Pct: 2, killsFor90Pct: 5 },
  },
  {
    itemId: 4,
    itemName: "Ancient Relic of Unknown Liquidity",
    dropRate: 0.005,
    avgQty: 1.0,
    liquidationChannel: "auction_house",
    unitGrossCopper: 90_000,
    expectedGrossEvPerKillCopper: 427,
    expectedLiquidityAdjustedPerKillCopper: 10,
    confidenceTier: "ESTIMATED",
    sampleSize: 50,
    liquidity: { score: null, sellingProbability: null, status: "UNKNOWN" },
    dropMetrics: { killsFor50Pct: null, killsFor90Pct: null },
  },
];

describe("sortCreatureLoot", () => {
  it("sorts alphabetically by item name", () => {
    const asc = sortCreatureLoot(SAMPLE_ITEMS, "item", "asc");
    expect(asc.map((i) => i.itemId)).toEqual([4, 3, 1, 2]);
    const desc = sortCreatureLoot(SAMPLE_ITEMS, "item", "desc");
    expect(desc.map((i) => i.itemId)).toEqual([2, 1, 3, 4]);
  });

  it("sorts numerically by dropRate, avgQty, unitPrice, and evPerKill", () => {
    expect(sortCreatureLoot(SAMPLE_ITEMS, "dropRate", "desc").map((i) => i.itemId)).toEqual([
      3, 2, 1, 4,
    ]);
    expect(sortCreatureLoot(SAMPLE_ITEMS, "avgQty", "desc")[0]?.itemId).toBe(2);
    expect(sortCreatureLoot(SAMPLE_ITEMS, "unitPrice", "desc").map((i) => i.itemId)).toEqual([
      4, 1, 2, 3,
    ]);
    expect(sortCreatureLoot(SAMPLE_ITEMS, "evPerKill", "desc").map((i) => i.itemId)).toEqual([
      1, 2, 3, 4,
    ]);
  });

  it("ranks liquidity with vendor=100% and pushes unknown liquidity & null K50 to bottom", () => {
    const liqDesc = sortCreatureLoot(SAMPLE_ITEMS, "liquidity", "desc");
    expect(liqDesc.map((i) => i.itemId)).toEqual([3, 1, 2, 4]);

    const k50Asc = sortCreatureLoot(SAMPLE_ITEMS, "k50", "asc");
    expect(k50Asc.map((i) => i.itemId)).toEqual([3, 2, 1, 4]);
    const k50Desc = sortCreatureLoot(SAMPLE_ITEMS, "k50", "desc");
    expect(k50Desc.map((i) => i.itemId)).toEqual([1, 2, 3, 4]);
  });

  it("sorts provenance by confidence tier then sample size and chooses ergonomic defaults", () => {
    const prov = sortCreatureLoot(SAMPLE_ITEMS, "provenance", "desc");
    expect(prov.map((i) => i.itemId)).toEqual([2, 1, 4, 3]);
    expect(defaultDirectionForLootColumn("item")).toBe("asc");
    expect(defaultDirectionForLootColumn("k50")).toBe("asc");
    expect(defaultDirectionForLootColumn("evPerKill")).toBe("desc");
  });
});
