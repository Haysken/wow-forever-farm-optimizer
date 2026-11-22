import { describe, expect, it } from "vitest";
import {
  computeSuffixMultiplier,
  expandLootDropsWithVariants,
  resolveVariantMarketPrice,
  type AggregatedVariantCandidate,
  type VariantSnapshotRecord,
} from "@/domain/market/variant-pricing";
import { calculateCreatureProfitability } from "@/domain/profitability/engine";
import type { LootDropInput } from "@/domain/profitability/types";

function makeSnap(overrides: Partial<VariantSnapshotRecord> = {}): VariantSnapshotRecord {
  return {
    variantId: "727:12721",
    itemId: 727,
    suffixId: 12721,
    fullName: "Notched Shortsword of the Monkey",
    suffixName: "of the Monkey",
    houseKey: "EU-6946-Alliance",
    region: "eu",
    faction: "alliance",
    realmLabel: "CAMWOW EU5 Realm 4 PvP",
    lowestBuyoutCopper: 12_950,
    p10Copper: 12_950,
    medianCopper: 12_950,
    clearingPriceCopper: 12_950,
    baseReferenceCopper: 1_000,
    availableQty: 2,
    listingCount: 2,
    timeLeftShort: 0,
    timeLeftMedium: 0,
    timeLeftLong: 0,
    timeLeftVeryLong: 2,
    snapshotAt: new Date("2026-11-22T12:00:00Z"),
    ...overrides,
  };
}

function makeBaseLoot(overrides: Partial<LootDropInput> = {}): LootDropInput {
  return {
    itemId: 727,
    itemName: "Notched Shortsword",
    quality: 2,
    bindType: "boe",
    vendorSellCopper: 244,
    isQuestOnly: false,
    isCommodity: false,
    lootMethod: "kill",
    dropRate: 0.04,
    minQty: 1,
    maxQty: 1,
    avgQty: 1,
    avgQtyIsAssumed: false,
    confidenceTier: "OBSERVED",
    sampleSize: 200,
    reporterCount: 5,
    ciLow: 0.02,
    ciHigh: 0.07,
    source: "everloot",
    lowestBuyoutCopper: 2_000,
    p10Copper: 2_000,
    medianCopper: 2_200,
    marketValueCopper: 2_000,
    clearingPriceCopper: 2_000,
    availableQty: 15,
    listingCount: 15,
    trend7dPct: 0,
    trend30dPct: null,
    priceStatus: "ACTUAL",
    snapshotAt: new Date("2026-11-22T12:00:00Z"),
    estimatedSoldPerDay: 4,
    daysSeen: 7,
    salesDataStatus: "ESTIMATED",
    ...overrides,
  };
}

describe("variant-pricing (US & EU random-enchant engine)", () => {
  it("computes clamped suffix multipliers safely", () => {
    expect(computeSuffixMultiplier(12_950, 1_000, 244)).toBe(12.95);
    // Clamps extreme single-listing outliers at 25x
    expect(computeSuffixMultiplier(5_000_000, 1_000, 244)).toBe(25);
    // Clamps below 0.25x
    expect(computeSuffixMultiplier(10, 1_000, 244)).toBe(0.25);
  });

  it("returns ACTUAL price for direct EU scans and calibrated ESTIMATED price for US markets", () => {
    const euSnap = makeSnap({ clearingPriceCopper: 12_000, baseReferenceCopper: 2_000 });
    const candidate: AggregatedVariantCandidate = {
      variantId: "727:12721",
      itemId: 727,
      suffixId: 12721,
      fullName: "Notched Shortsword of the Monkey",
      suffixName: "of the Monkey",
      directSnapshots: [euSnap],
      referenceSnapshots: [euSnap],
    };

    // EU Alliance -> direct scan ACTUAL
    const euRes = resolveVariantMarketPrice({
      targetRegion: "eu",
      targetFaction: "alliance",
      vendorSellCopper: 244,
      targetMarketBaseCopper: 2_000,
      targetRegionUnifiedBaseCopper: 2_000,
      candidate,
    });
    expect(euRes.priceStatus).toBe("ACTUAL");
    expect(euRes.clearingPriceCopper).toBe(12_000);
    expect(euRes.suffixMultiplier).toBe(6);

    // US Alliance (live US base = 3_000c, EU suffix ratio = 6x -> US calibrated = 18_000c)
    const usRes = resolveVariantMarketPrice({
      targetRegion: "us",
      targetFaction: "alliance",
      vendorSellCopper: 244,
      targetMarketBaseCopper: 3_000,
      targetRegionUnifiedBaseCopper: 3_000,
      candidate,
    });
    expect(usRes.priceStatus).toBe("ESTIMATED");
    expect(usRes.calibrationMethod).toBe("region_base_scaled");
    expect(usRes.clearingPriceCopper).toBe(18_000);
    expect(usRes.suffixMultiplier).toBe(6);
  });

  it("expands base drops without EV inflation (sum of variant drop rates === base drop rate) and routes cheap vs jackpot suffixes independently", () => {
    const monkeySnap = makeSnap({
      variantId: "727:12721",
      suffixId: 12721,
      fullName: "Notched Shortsword of the Monkey",
      suffixName: "of the Monkey",
      clearingPriceCopper: 12_000,
      baseReferenceCopper: 2_000,
    });
    const whaleSnap = makeSnap({
      variantId: "727:12718",
      suffixId: 12718,
      fullName: "Notched Shortsword of the Whale",
      suffixName: "of the Whale",
      clearingPriceCopper: 250, // below vendor after 5% AH cut (237.5 < 244)
      lowestBuyoutCopper: 250,
      p10Copper: 250,
      medianCopper: 250,
      baseReferenceCopper: 2_000,
    });

    const variantsByItem = new Map<number, AggregatedVariantCandidate[]>([
      [
        727,
        [
          {
            variantId: "727:12721",
            itemId: 727,
            suffixId: 12721,
            fullName: "Notched Shortsword of the Monkey",
            suffixName: "of the Monkey",
            directSnapshots: [monkeySnap],
            referenceSnapshots: [monkeySnap],
          },
          {
            variantId: "727:12718",
            itemId: 727,
            suffixId: 12718,
            fullName: "Notched Shortsword of the Whale",
            suffixName: "of the Whale",
            directSnapshots: [whaleSnap],
            referenceSnapshots: [whaleSnap],
          },
        ],
      ],
    ]);

    const expanded = expandLootDropsWithVariants([makeBaseLoot()], variantsByItem, {
      targetRegion: "eu",
      targetFaction: "alliance",
    });

    expect(expanded).toHaveLength(2);
    const totalDropRate = expanded.reduce((acc, d) => acc + d.dropRate, 0);
    expect(totalDropRate).toBeCloseTo(0.04, 10);

    const prof = calculateCreatureProfitability(
      {
        creatureId: 1,
        creatureName: "Test Mob",
        rawCoinMinCopper: 0,
        rawCoinMaxCopper: 0,
        rawCoinSource: null,
        loot: expanded,
      },
      { killsPerHour: 60, marketFaction: "alliance", commissionRate: 0.05 }
    );

    const monkeyItem = prof.items.find((i) => i.suffixId === 12721);
    const whaleItem = prof.items.find((i) => i.suffixId === 12718);
    expect(monkeyItem?.liquidationChannel).toBe("auction_house");
    expect(whaleItem?.liquidationChannel).toBe("vendor");
    expect(prof.bestDrop?.variantId).toBe("727:12721");
  });
});
