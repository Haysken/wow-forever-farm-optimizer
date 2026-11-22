import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import {
  computeSuffixMultiplier,
  resolveVariantMarketPrice,
  type AggregatedVariantCandidate,
  type VariantSnapshotRecord,
} from "@/domain/market/variant-pricing";
import {
  calculateCreatureProfitability,
  computeDropProbabilityMetrics,
  DEFAULT_MARKET_COMMISSIONS,
} from "@/domain/profitability";
import { ensureItemHydrated } from "@/ingestion/on-demand-hydrator";
import { EverlookDBVariantAdapter } from "@/providers/everlookdb-variants";
import type { MarketFaction } from "@/providers/types";

/**
 * Batch-loads all synced random-enchant variants and their direct scanned snapshots
 * for a list of base item IDs.
 */
export async function loadAggregatedVariantsByItemIds(
  itemIds: number[]
): Promise<Map<number, AggregatedVariantCandidate[]>> {
  const result = new Map<number, AggregatedVariantCandidate[]>();
  if (itemIds.length === 0) return result;

  const db = getDb();
  const uniqueIds = Array.from(new Set(itemIds));

  const rows = await db
    .select({
      variant: schema.itemVariants,
      snap: schema.itemVariantSnapshots,
    })
    .from(schema.itemVariants)
    .leftJoin(
      schema.itemVariantSnapshots,
      eq(schema.itemVariantSnapshots.variantId, schema.itemVariants.id)
    )
    .where(inArray(schema.itemVariants.itemId, uniqueIds));

  const byVariantId = new Map<string, AggregatedVariantCandidate>();

  for (const row of rows) {
    let cand = byVariantId.get(row.variant.id);
    if (!cand) {
      cand = {
        variantId: row.variant.id,
        itemId: row.variant.itemId,
        suffixId: row.variant.suffixId,
        fullName: row.variant.fullName,
        suffixName: row.variant.suffixName,
        directSnapshots: [],
        referenceSnapshots: [],
      };
      byVariantId.set(row.variant.id, cand);

      let list = result.get(row.variant.itemId);
      if (!list) {
        list = [];
        result.set(row.variant.itemId, list);
      }
      list.push(cand);
    }

    if (row.snap) {
      const rec: VariantSnapshotRecord = {
        variantId: row.variant.id,
        itemId: row.variant.itemId,
        suffixId: row.variant.suffixId,
        fullName: row.variant.fullName,
        suffixName: row.variant.suffixName,
        houseKey: row.snap.houseKey,
        region: row.snap.region,
        faction: row.snap.faction,
        realmLabel: row.snap.realmLabel,
        lowestBuyoutCopper: row.snap.lowestBuyoutCopper,
        p10Copper: row.snap.p10Copper,
        medianCopper: row.snap.medianCopper,
        clearingPriceCopper: row.snap.clearingPriceCopper,
        baseReferenceCopper: row.snap.baseReferenceCopper,
        availableQty: row.snap.availableQty,
        listingCount: row.snap.listingCount,
        timeLeftShort: row.snap.timeLeftShort,
        timeLeftMedium: row.snap.timeLeftMedium,
        timeLeftLong: row.snap.timeLeftLong,
        timeLeftVeryLong: row.snap.timeLeftVeryLong,
        snapshotAt: row.snap.snapshotAt,
      };
      cand.directSnapshots.push(rec);
      cand.referenceSnapshots.push(rec);
    }
  }

  // Deterministic ordering by suffixId ascending
  for (const list of result.values()) {
    list.sort((a, b) => a.suffixId - b.suffixId);
  }

  return result;
}

/**
 * Batch-loads live base-item clearing prices for a region's unified pool (`{region}:0`)
 * to anchor US/EU cross-region variant price calibration.
 */
export async function loadRegionUnifiedBasePrices(
  itemIds: number[],
  region: string
): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  if (itemIds.length === 0) return map;

  const db = getDb();
  const unifiedId = `${region.toLowerCase()}:0`;
  const snaps = await db
    .select({
      itemId: schema.itemMarketSnapshots.itemId,
      clearingPriceCopper: schema.itemMarketSnapshots.clearingPriceCopper,
      medianCopper: schema.itemMarketSnapshots.medianCopper,
      lowestBuyoutCopper: schema.itemMarketSnapshots.lowestBuyoutCopper,
    })
    .from(schema.itemMarketSnapshots)
    .where(
      and(
        eq(schema.itemMarketSnapshots.marketId, unifiedId),
        inArray(schema.itemMarketSnapshots.itemId, Array.from(new Set(itemIds))),
        eq(schema.itemMarketSnapshots.priceStatus, "ACTUAL")
      )
    );

  for (const s of snaps) {
    const p = s.clearingPriceCopper ?? s.medianCopper ?? s.lowestBuyoutCopper;
    if (p !== null && p > 0) {
      map.set(s.itemId, p);
    }
  }
  return map;
}

export interface VariantSummaryRow {
  variantId: string;
  itemId: number;
  suffixId: number;
  fullName: string;
  suffixName: string;
  suffixMultiplier: number | null;
  euClearingCopper: number | null;
  euPriceStatus: string;
  euSupplyQty: number;
  usClearingCopper: number | null;
  usPriceStatus: string;
  usCalibrationNote: string;
  usBaseUsedCopper: number | null;
}

/**
 * Returns every random-enchant variant for a base item with BOTH US & EU resolved prices.
 */
export async function getItemVariantsSummary(
  itemId: number,
  vendorSellCopper?: number
): Promise<VariantSummaryRow[]> {
  const db = getDb();
  let vendor = vendorSellCopper;
  if (vendor === undefined) {
    const [it] = await db
      .select({ vendorSellCopper: schema.items.vendorSellCopper })
      .from(schema.items)
      .where(eq(schema.items.id, itemId))
      .limit(1);
    vendor = it?.vendorSellCopper ?? 0;
  }

  const [variantsMap, usBaseMap, euBaseMap] = await Promise.all([
    loadAggregatedVariantsByItemIds([itemId]),
    loadRegionUnifiedBasePrices([itemId], "us"),
    loadRegionUnifiedBasePrices([itemId], "eu"),
  ]);

  const candidates = variantsMap.get(itemId) ?? [];
  if (candidates.length === 0) return [];

  const usBase = usBaseMap.get(itemId) ?? null;
  const euBase = euBaseMap.get(itemId) ?? null;

  const summary = candidates.map((cand): VariantSummaryRow => {
    const euResolved = resolveVariantMarketPrice({
      targetRegion: "eu",
      targetFaction: "unified",
      vendorSellCopper: vendor,
      targetMarketBaseCopper: euBase,
      targetRegionUnifiedBaseCopper: euBase,
      candidate: cand,
    });
    const usResolved = resolveVariantMarketPrice({
      targetRegion: "us",
      targetFaction: "unified",
      vendorSellCopper: vendor,
      targetMarketBaseCopper: usBase,
      targetRegionUnifiedBaseCopper: usBase,
      candidate: cand,
    });

    return {
      variantId: cand.variantId,
      itemId: cand.itemId,
      suffixId: cand.suffixId,
      fullName: cand.fullName,
      suffixName: cand.suffixName,
      suffixMultiplier: usResolved.suffixMultiplier ?? euResolved.suffixMultiplier,
      euClearingCopper: euResolved.clearingPriceCopper,
      euPriceStatus: euResolved.priceStatus,
      euSupplyQty: euResolved.availableQty,
      usClearingCopper: usResolved.clearingPriceCopper,
      usPriceStatus: usResolved.priceStatus,
      usCalibrationNote: usResolved.note,
      usBaseUsedCopper: usResolved.basePriceUsedCopper,
    };
  });

  summary.sort(
    (a, b) =>
      (b.usClearingCopper ?? b.euClearingCopper ?? 0) -
      (a.usClearingCopper ?? a.euClearingCopper ?? 0)
  );
  return summary;
}

/**
 * Full detail payload for a dedicated random-enchant variant page `/items/[id]/[suffixId]`,
 * providing BOTH US and EU pricing, direct scanned houses (with time_left breakdown),
 * US/EU faction calibrated markets, per-variant real history, sibling comparison,
 * and dropping creatures with effective drop rate (baseDropRate / N).
 */
export async function getItemVariantDetail(
  itemId: number,
  suffixId: number,
  marketId: string,
  options: {
    killsPerHour: number;
    hourlyExpensesCopper: number;
    region?: string;
  }
) {
  const db = getDb();
  const variantId = `${itemId}:${suffixId}`;

  const [[item], [variant]] = await Promise.all([
    db.select().from(schema.items).where(eq(schema.items.id, itemId)).limit(1),
    db
      .select()
      .from(schema.itemVariants)
      .where(eq(schema.itemVariants.id, variantId))
      .limit(1),
  ]);

  if (!item || !variant) return null;

  const region = (options.region ?? marketId.split(":")[0] ?? "us").toLowerCase();

  // Ensure live Forever AH base snapshots exist for both US and EU so cross-region calibration is fresh
  await Promise.all([
    ensureItemHydrated(itemId, "us", region === "us" ? marketId : "us:0"),
    ensureItemHydrated(itemId, "eu", region === "eu" ? marketId : "eu:0"),
  ]);

  const [variantsMap, siblingVariants, allRegionMarketRows] = await Promise.all([
    loadAggregatedVariantsByItemIds([itemId]),
    getItemVariantsSummary(itemId, item.vendorSellCopper),
    db
      .select({
        market: schema.ahMarkets,
        snapshot: schema.itemMarketSnapshots,
      })
      .from(schema.ahMarkets)
      .leftJoin(
        schema.itemMarketSnapshots,
        and(
          eq(schema.itemMarketSnapshots.marketId, schema.ahMarkets.id),
          eq(schema.itemMarketSnapshots.itemId, itemId)
        )
      )
      .where(inArray(schema.ahMarkets.region, ["us", "eu"]))
      .orderBy(asc(schema.ahMarkets.region), asc(schema.ahMarkets.houseId)),
  ]);

  const candidates = variantsMap.get(itemId) ?? [];
  const candidate = candidates.find((c) => c.suffixId === suffixId);
  if (!candidate) return null;

  const totalVariantsCount = Math.max(1, candidates.length);

  // Unified base prices for US & EU
  const usUnifiedSnap = allRegionMarketRows.find(
    (r) => r.market.id === "us:0" && r.snapshot?.priceStatus === "ACTUAL"
  )?.snapshot;
  const euUnifiedSnap = allRegionMarketRows.find(
    (r) => r.market.id === "eu:0" && r.snapshot?.priceStatus === "ACTUAL"
  )?.snapshot;

  const usUnifiedBase =
    usUnifiedSnap?.clearingPriceCopper ??
    usUnifiedSnap?.medianCopper ??
    usUnifiedSnap?.lowestBuyoutCopper ??
    null;
  const euUnifiedBase =
    euUnifiedSnap?.clearingPriceCopper ??
    euUnifiedSnap?.medianCopper ??
    euUnifiedSnap?.lowestBuyoutCopper ??
    null;

  const usSummary = resolveVariantMarketPrice({
    targetRegion: "us",
    targetFaction: "unified",
    vendorSellCopper: item.vendorSellCopper,
    targetMarketBaseCopper: usUnifiedBase,
    targetRegionUnifiedBaseCopper: usUnifiedBase,
    candidate,
  });

  const euSummary = resolveVariantMarketPrice({
    targetRegion: "eu",
    targetFaction: "unified",
    vendorSellCopper: item.vendorSellCopper,
    targetMarketBaseCopper: euUnifiedBase,
    targetRegionUnifiedBaseCopper: euUnifiedBase,
    candidate,
  });

  // Per-house calibrated pricing for ALL active US & EU Forever AH houses
  const regionalHouses = allRegionMarketRows
    .filter((r) => r.market.region === region)
    .map((r) => {
      const baseClearing =
        r.snapshot?.priceStatus === "ACTUAL"
          ? (r.snapshot.clearingPriceCopper ??
              r.snapshot.medianCopper ??
              r.snapshot.lowestBuyoutCopper ??
              null)
          : null;
      const unifiedBase = region === "us" ? usUnifiedBase : euUnifiedBase;
      const resolved = resolveVariantMarketPrice({
        targetRegion: region,
        targetFaction: r.market.faction,
        vendorSellCopper: item.vendorSellCopper,
        targetMarketBaseCopper: baseClearing,
        targetRegionUnifiedBaseCopper: unifiedBase,
        candidate,
      });

      return {
        marketId: r.market.id,
        houseId: r.market.houseId,
        region: r.market.region,
        faction: r.market.faction,
        displayName: r.market.displayName,
        defaultCommissionRate: Number(r.market.defaultCommissionRate),
        baseItemClearingCopper: baseClearing,
        variantClearingCopper: resolved.clearingPriceCopper,
        variantLowestCopper: resolved.lowestBuyoutCopper,
        variantMedianCopper: resolved.medianCopper,
        priceStatus: resolved.priceStatus,
        calibrationMethod: resolved.calibrationMethod,
        calibrationNote: resolved.note,
        suffixMultiplier: resolved.suffixMultiplier,
        baseAvailableQty: r.snapshot?.availableQty ?? 0,
        snapshotAt: r.snapshot?.snapshotAt?.toISOString() ?? null,
      };
    });

  // Direct scanned EverlookDB / addon variant snapshots (with time_left counts!)
  const directScannedHouses = candidate.directSnapshots.map((s) => ({
    houseKey: s.houseKey,
    region: s.region,
    faction: s.faction,
    realmLabel: s.realmLabel,
    lowestBuyoutCopper: s.lowestBuyoutCopper,
    p10Copper: s.p10Copper,
    medianCopper: s.medianCopper,
    clearingPriceCopper: s.clearingPriceCopper,
    baseReferenceCopper: s.baseReferenceCopper,
    suffixMultiplier: computeSuffixMultiplier(
      s.clearingPriceCopper,
      s.baseReferenceCopper,
      item.vendorSellCopper
    ),
    availableQty: s.availableQty,
    listingCount: s.listingCount,
    timeLeft: {
      short: s.timeLeftShort,
      medium: s.timeLeftMedium,
      long: s.timeLeftLong,
      veryLong: s.timeLeftVeryLong,
    },
    snapshotAt: s.snapshotAt.toISOString(),
  }));

  // Fetch real per-variant daily & hourly history from EverlookDB
  let historyHouseKey: string | null = null;
  let historyDaily: Array<{
    ts: string;
    minCopper: number | null;
    p10Copper: number | null;
    medianCopper: number | null;
    availableQty: number;
    listingCount: number;
  }> = [];
  let historyHourly: Array<{
    ts: string;
    minCopper: number | null;
    p10Copper: number | null;
    medianCopper: number | null;
    availableQty: number;
    listingCount: number;
  }> = [];

  try {
    const adapter = new EverlookDBVariantAdapter({ maxRps: 2 });
    const hist = await adapter.fetchVariantHistory(itemId, suffixId);
    historyHouseKey = hist.houseKey;
    historyDaily = hist.daily;
    historyHourly = hist.hourly;
  } catch {
    // Graceful fallback if EverlookDB history endpoint is transiently unavailable
  }

  // Dropping creatures with effective drop rate = baseDropRate / N
  const dropSources = await db
    .select({
      loot: schema.creatureLootResolved,
      creature: schema.creatures,
    })
    .from(schema.creatureLootResolved)
    .innerJoin(
      schema.creatures,
      eq(schema.creatureLootResolved.creatureId, schema.creatures.id)
    )
    .where(eq(schema.creatureLootResolved.itemId, itemId));

  const targetMarketRow =
    allRegionMarketRows.find((r) => r.market.id === marketId)?.market ??
    allRegionMarketRows.find((r) => r.market.id === `${region}:0`)?.market ??
    null;
  const targetFaction: MarketFaction = targetMarketRow?.faction ?? "unified";
  const targetCommission = targetMarketRow
    ? Number(targetMarketRow.defaultCommissionRate)
    : DEFAULT_MARKET_COMMISSIONS[targetFaction];

  const activeVariantClearing =
    (region === "us" ? usSummary.clearingPriceCopper : euSummary.clearingPriceCopper) ??
    item.vendorSellCopper;

  const creatureSources = dropSources
    .map((src) => {
      const baseDropRate = Number(src.loot.dropRate);
      const effectiveDropRate = baseDropRate / totalVariantsCount;
      const avgQty = Number(src.loot.avgQty);
      const dropMetrics = computeDropProbabilityMetrics(effectiveDropRate);

      const ahNet = activeVariantClearing * (1 - targetCommission);
      const unitNet = Math.max(item.vendorSellCopper, ahNet);
      const variantEvPerKillCopper = Math.round(effectiveDropRate * avgQty * unitNet);

      // Quick single-drop sanity profitability estimate for sorting
      const quickProf = calculateCreatureProfitability(
        {
          creatureId: src.creature.id,
          creatureName: src.creature.name,
          rawCoinMinCopper: src.creature.rawCoinMinCopper,
          rawCoinMaxCopper: src.creature.rawCoinMaxCopper,
          rawCoinSource: src.creature.rawCoinSource,
          loot: [
            {
              itemId: item.id,
              variantId,
              suffixId,
              suffixName: variant.suffixName,
              itemName: variant.fullName,
              quality: item.quality,
              bindType: item.bindType,
              vendorSellCopper: item.vendorSellCopper,
              isQuestOnly: src.loot.isQuestOnly,
              isCommodity: item.isCommodity,
              lootMethod: src.loot.lootMethod,
              dropRate: effectiveDropRate,
              minQty: src.loot.minQty,
              maxQty: src.loot.maxQty,
              avgQty,
              avgQtyIsAssumed: src.loot.avgQtyIsAssumed,
              confidenceTier: "ESTIMATED",
              sampleSize: src.loot.sampleSize,
              reporterCount: src.loot.reporterCount,
              ciLow: null,
              ciHigh: null,
              source: `${src.loot.source} · 1/${totalVariantsCount} suffix`,
              lowestBuyoutCopper: activeVariantClearing,
              p10Copper: activeVariantClearing,
              medianCopper: activeVariantClearing,
              marketValueCopper: activeVariantClearing,
              clearingPriceCopper: activeVariantClearing,
              availableQty: euSummary.availableQty,
              listingCount: euSummary.listingCount,
              trend7dPct: null,
              trend30dPct: null,
              priceStatus: region === "us" ? usSummary.priceStatus : euSummary.priceStatus,
              snapshotAt: null,
              estimatedSoldPerDay: null,
              daysSeen: null,
              salesDataStatus: "MISSING",
            },
          ],
        },
        {
          killsPerHour: options.killsPerHour,
          hourlyExpensesCopper: options.hourlyExpensesCopper,
          marketFaction: targetFaction,
          commissionRate: targetCommission,
        }
      );

      return {
        creatureId: src.creature.id,
        creatureName: src.creature.name,
        minLevel: src.creature.minLevel,
        maxLevel: src.creature.maxLevel,
        zoneName: src.creature.primaryZoneName,
        lootMethod: src.loot.lootMethod,
        baseDropRate,
        effectiveDropRate,
        avgQty,
        k50: dropMetrics.killsFor50Pct,
        k90: dropMetrics.killsFor90Pct,
        confidenceTier: "ESTIMATED" as const,
        baseConfidenceTier: src.loot.confidenceTier,
        sampleSize: src.loot.sampleSize,
        source: `${src.loot.source} · 1/${totalVariantsCount} suffix`,
        variantEvPerKillCopper,
        variantEvPerHourCopper: Math.round(
          variantEvPerKillCopper * options.killsPerHour
        ),
        quickGrossEgphCopper: quickProf.egphGrossEvCopper,
      };
    })
    .sort(
      (a, b) =>
        b.variantEvPerKillCopper - a.variantEvPerKillCopper ||
        b.effectiveDropRate - a.effectiveDropRate
    );

  return {
    item,
    variant: {
      id: variant.id,
      itemId: variant.itemId,
      suffixId: variant.suffixId,
      fullName: variant.fullName,
      suffixName: variant.suffixName,
      totalVariantsCount,
      source: variant.source,
    },
    region,
    selectedMarketId: marketId,
    usSummary: {
      ...usSummary,
      snapshotAt: usSummary.snapshotAt?.toISOString() ?? null,
    },
    euSummary: {
      ...euSummary,
      snapshotAt: euSummary.snapshotAt?.toISOString() ?? null,
    },
    directScannedHouses,
    regionalHouses,
    historyHouseKey,
    historyDaily,
    historyHourly,
    siblingVariants,
    creatureSources,
  };
}
