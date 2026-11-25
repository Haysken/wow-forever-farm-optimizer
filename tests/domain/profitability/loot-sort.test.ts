import { describe, expect, it } from "vitest";
import {
  collapseVariantLootRows,
  defaultDirectionForLootColumn,
  sortCreatureLoot,
  type SortableLootItem,
} from "@/domain/profitability/loot-sort";

const SAMPLE_ITEMS: SortableLootItem[] = [
  {
    itemId: 1,
    itemName: "Elemental Earth",
    quality: 1,
    lootMethod: "kill",
    dropRate: 0.08,
    avgQty: 1.0,
    avgQtyIsAssumed: false,
    liquidationChannel: "auction_house",
    unitGrossCopper: 35_000,
    effectiveCommissionRate: 0.05,
    expectedGrossEvPerKillCopper: 2660,
    expectedLiquidityAdjustedPerKillCopper: 2400,
    confidenceTier: "OBSERVED",
    sampleSize: 250,
    source: "everloot",
    liquidity: { score: 85, sellingProbability: 0.9, status: "ESTIMATED" },
    dropMetrics: { expectedKillsPerDrop: 12.5, killsFor50Pct: 9, killsFor90Pct: 28 },
  },
  {
    itemId: 2,
    itemName: "Solid Stone",
    quality: 1,
    lootMethod: "kill",
    dropRate: 0.25,
    avgQty: 2.5,
    avgQtyIsAssumed: false,
    liquidationChannel: "auction_house",
    unitGrossCopper: 1_500,
    effectiveCommissionRate: 0.05,
    expectedGrossEvPerKillCopper: 890,
    expectedLiquidityAdjustedPerKillCopper: 700,
    confidenceTier: "VERIFIED",
    sampleSize: 600,
    source: "everloot",
    liquidity: { score: 70, sellingProbability: 0.78, status: "ESTIMATED" },
    dropMetrics: { expectedKillsPerDrop: 4, killsFor50Pct: 3, killsFor90Pct: 8 },
  },
  {
    itemId: 3,
    itemName: "Cracked Boulder",
    quality: 0,
    lootMethod: "kill",
    dropRate: 0.4,
    avgQty: 1.0,
    avgQtyIsAssumed: false,
    liquidationChannel: "vendor",
    unitGrossCopper: 400,
    effectiveCommissionRate: 0,
    expectedGrossEvPerKillCopper: 160,
    expectedLiquidityAdjustedPerKillCopper: 160,
    confidenceTier: "ESTIMATED",
    sampleSize: null,
    source: "classic_db",
    liquidity: { score: null, sellingProbability: null, status: "UNKNOWN" },
    dropMetrics: { expectedKillsPerDrop: 2.5, killsFor50Pct: 2, killsFor90Pct: 5 },
  },
  {
    itemId: 4,
    itemName: "Ancient Relic of Unknown Liquidity",
    quality: 3,
    lootMethod: "kill",
    dropRate: 0.005,
    avgQty: 1.0,
    avgQtyIsAssumed: false,
    liquidationChannel: "auction_house",
    unitGrossCopper: 90_000,
    effectiveCommissionRate: 0.05,
    expectedGrossEvPerKillCopper: 427,
    expectedLiquidityAdjustedPerKillCopper: 10,
    confidenceTier: "ESTIMATED",
    sampleSize: 50,
    source: "classic_db",
    liquidity: { score: null, sellingProbability: null, status: "UNKNOWN" },
    dropMetrics: { expectedKillsPerDrop: 200, killsFor50Pct: null, killsFor90Pct: null },
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

  it("collapses expanded variant rows into one base row preserving exact total dropRate and EV/kill", () => {
    const variants: SortableLootItem[] = [
      SAMPLE_ITEMS[0]!,
      {
        ...SAMPLE_ITEMS[0]!,
        itemId: 727,
        variantId: "727:12721",
        suffixId: 12721,
        suffixName: "of the Monkey",
        itemName: "Notched Shortsword of the Monkey",
        dropRate: 0.02,
        unitGrossCopper: 12_000,
        expectedGrossEvPerKillCopper: 228,
        expectedLiquidityAdjustedPerKillCopper: 200,
        source: "classic_db · 1/2 suffix",
      },
      {
        ...SAMPLE_ITEMS[0]!,
        itemId: 727,
        variantId: "727:12718",
        suffixId: 12718,
        suffixName: "of the Eagle",
        itemName: "Notched Shortsword of the Eagle",
        dropRate: 0.02,
        liquidationChannel: "vendor",
        unitGrossCopper: 244,
        expectedGrossEvPerKillCopper: 4.88,
        expectedLiquidityAdjustedPerKillCopper: 4.88,
        source: "classic_db · 1/2 suffix",
      },
    ];

    const collapsed = collapseVariantLootRows(variants);
    expect(collapsed).toHaveLength(2);
    const sword = collapsed.find((i) => i.itemId === 727);
    expect(sword).toMatchObject({
      itemName: "Notched Shortsword",
      suffixId: null,
      collapsedVariantCount: 2,
      collapsedMaxUnitCopper: 12_000,
      source: "classic_db",
    });
    expect(sword?.dropRate).toBeCloseTo(0.04, 10);
    expect(sword?.expectedLiquidityAdjustedPerKillCopper).toBeCloseTo(204.88, 6);
  });
});
