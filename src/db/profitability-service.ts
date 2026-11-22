import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import {
  loadAggregatedVariantsByItemIds,
  loadRegionUnifiedBasePrices,
} from "@/db/variant-service";
import { expandLootDropsWithVariants } from "@/domain/market/variant-pricing";
import {
  calculateCreatureProfitability,
  DEFAULT_MARKET_COMMISSIONS,
  type CreatureProfitabilityResult,
  type CreatureProfitInput,
  type LootDropInput,
  type ProfitabilityParams,
} from "@/domain/profitability";
import type { ConfidenceTier, MarketFaction } from "@/providers/types";

export interface RankingQueryOptions {
  marketId: string;
  killsPerHour: number;
  hourlyExpensesCopper?: number;
  commissionOverride?: number;
  timeHorizonDays?: number;
  zoneName?: string;
  minLevel?: number;
  maxLevel?: number;
  minQuality?: number;
  itemCategory?: string;
  minDropRate?: number;
  minItemPriceCopper?: number;
  minEgphCopper?: number;
  allowedConfidenceTiers?: ConfidenceTier[];
  search?: string;
  sortBy?:
    | "egph_adjusted"
    | "egph_gross"
    | "egpk"
    | "best_item_value"
    | "drop_rate"
    | "liquidity"
    | "price_trend";
  limit?: number;
  offset?: number;
}

export interface RankedCreatureRow {
  rank: number;
  creatureId: number;
  creatureName: string;
  minLevel: number | null;
  maxLevel: number | null;
  creatureType: string | null;
  classification: string;
  zoneName: string | null;
  profitability: CreatureProfitabilityResult;
  bestDropTrend7dPct: number | null;
}

export async function getAvailableMarkets() {
  const db = getDb();
  return db
    .select()
    .from(schema.ahMarkets)
    .orderBy(schema.ahMarkets.region, schema.ahMarkets.houseId);
}

/**
 * Loads a single creature's complete resolved loot table joined with live item
 * and market snapshot data for a specific AH market.
 */
export async function loadCreatureProfitInput(
  creatureId: number,
  marketId: string
): Promise<{
  creature: typeof schema.creatures.$inferSelect;
  market: typeof schema.ahMarkets.$inferSelect | null;
  input: CreatureProfitInput;
} | null> {
  const db = getDb();

  const [creature] = await db
    .select()
    .from(schema.creatures)
    .where(eq(schema.creatures.id, creatureId))
    .limit(1);

  if (!creature) return null;

  const [market] = await db
    .select()
    .from(schema.ahMarkets)
    .where(eq(schema.ahMarkets.id, marketId))
    .limit(1);

  const rows = await db
    .select({
      loot: schema.creatureLootResolved,
      item: schema.items,
      snapshot: schema.itemMarketSnapshots,
      sales: schema.itemSalesEstimates,
    })
    .from(schema.creatureLootResolved)
    .innerJoin(
      schema.items,
      eq(schema.creatureLootResolved.itemId, schema.items.id)
    )
    .leftJoin(
      schema.itemMarketSnapshots,
      and(
        eq(schema.itemMarketSnapshots.itemId, schema.items.id),
        eq(schema.itemMarketSnapshots.marketId, marketId)
      )
    )
    .leftJoin(
      schema.itemSalesEstimates,
      and(
        eq(schema.itemSalesEstimates.itemId, schema.items.id),
        eq(schema.itemSalesEstimates.marketId, marketId)
      )
    )
    .where(eq(schema.creatureLootResolved.creatureId, creatureId));

  const baseLoot: LootDropInput[] = rows.map((r) => ({
    itemId: r.item.id,
    itemName: r.item.name,
    quality: r.item.quality,
    bindType: r.item.bindType,
    vendorSellCopper: r.item.vendorSellCopper,
    isQuestOnly: r.loot.isQuestOnly,
    isCommodity: r.item.isCommodity,
    lootMethod: r.loot.lootMethod,
    dropRate: Number(r.loot.dropRate),
    minQty: r.loot.minQty,
    maxQty: r.loot.maxQty,
    avgQty: Number(r.loot.avgQty),
    avgQtyIsAssumed: r.loot.avgQtyIsAssumed,
    confidenceTier: r.loot.confidenceTier,
    sampleSize: r.loot.sampleSize,
    reporterCount: r.loot.reporterCount,
    ciLow: r.loot.ciLow !== null ? Number(r.loot.ciLow) : null,
    ciHigh: r.loot.ciHigh !== null ? Number(r.loot.ciHigh) : null,
    source: r.loot.source,
    lowestBuyoutCopper: r.snapshot?.lowestBuyoutCopper ?? null,
    p10Copper: r.snapshot?.p10Copper ?? null,
    medianCopper: r.snapshot?.medianCopper ?? null,
    marketValueCopper: r.snapshot?.marketValueCopper ?? null,
    clearingPriceCopper: r.snapshot?.clearingPriceCopper ?? null,
    availableQty: r.snapshot?.availableQty ?? 0,
    listingCount: r.snapshot?.listingCount ?? 0,
    trend7dPct:
      r.snapshot?.trend7dPct !== null && r.snapshot?.trend7dPct !== undefined
        ? Number(r.snapshot.trend7dPct)
        : null,
    trend30dPct:
      r.snapshot?.trend30dPct !== null && r.snapshot?.trend30dPct !== undefined
        ? Number(r.snapshot.trend30dPct)
        : null,
    priceStatus: r.snapshot?.priceStatus ?? "MISSING",
    snapshotAt: r.snapshot?.snapshotAt ?? null,
    estimatedSoldPerDay:
      r.sales?.estimatedSoldPerDay !== null &&
      r.sales?.estimatedSoldPerDay !== undefined
        ? Number(r.sales.estimatedSoldPerDay)
        : null,
    daysSeen: r.sales?.daysSeen ?? null,
    salesDataStatus: r.sales?.dataStatus ?? "MISSING",
  }));

  const targetRegion = market?.region ?? marketId.split(":")[0] ?? "us";
  const targetFaction: MarketFaction = market?.faction ?? "unified";
  const lootItemIds = baseLoot.map((l) => l.itemId);
  const [variantsByItem, regionUnifiedBase] = await Promise.all([
    loadAggregatedVariantsByItemIds(lootItemIds),
    loadRegionUnifiedBasePrices(lootItemIds, targetRegion),
  ]);

  const loot = expandLootDropsWithVariants(baseLoot, variantsByItem, {
    targetRegion,
    targetFaction,
    regionUnifiedBaseByItem: regionUnifiedBase,
  });

  return {
    creature,
    market: market ?? null,
    input: {
      creatureId: creature.id,
      creatureName: creature.name,
      rawCoinMinCopper: creature.rawCoinMinCopper,
      rawCoinMaxCopper: creature.rawCoinMaxCopper,
      rawCoinSource: creature.rawCoinSource,
      loot,
    },
  };
}

/**
 * Computes live farm rankings across all creatures with resolved loot tables
 * for the selected Auction House market and user farming parameters.
 */
export async function computeFarmRankings(options: RankingQueryOptions): Promise<{
  market: typeof schema.ahMarkets.$inferSelect | null;
  total: number;
  rows: RankedCreatureRow[];
}> {
  const db = getDb();

  const [market] = await db
    .select()
    .from(schema.ahMarkets)
    .where(eq(schema.ahMarkets.id, options.marketId))
    .limit(1);

  const marketFaction: MarketFaction = market?.faction ?? "alliance";
  const commissionRate =
    options.commissionOverride ??
    (market
      ? Number(market.defaultCommissionRate)
      : DEFAULT_MARKET_COMMISSIONS[marketFaction]);

  const allowedTiers =
    options.allowedConfidenceTiers && options.allowedConfidenceTiers.length > 0
      ? options.allowedConfidenceTiers
      : (["VERIFIED", "OBSERVED", "ESTIMATED"] as ConfidenceTier[]);

  // Fetch all resolved loot joined with creatures, items, market snapshots, and sales estimates
  const joined = await db
    .select({
      creature: schema.creatures,
      loot: schema.creatureLootResolved,
      item: schema.items,
      snapshot: schema.itemMarketSnapshots,
      sales: schema.itemSalesEstimates,
    })
    .from(schema.creatureLootResolved)
    .innerJoin(
      schema.creatures,
      eq(schema.creatureLootResolved.creatureId, schema.creatures.id)
    )
    .innerJoin(
      schema.items,
      eq(schema.creatureLootResolved.itemId, schema.items.id)
    )
    .leftJoin(
      schema.itemMarketSnapshots,
      and(
        eq(schema.itemMarketSnapshots.itemId, schema.items.id),
        eq(schema.itemMarketSnapshots.marketId, options.marketId)
      )
    )
    .leftJoin(
      schema.itemSalesEstimates,
      and(
        eq(schema.itemSalesEstimates.itemId, schema.items.id),
        eq(schema.itemSalesEstimates.marketId, options.marketId)
      )
    )
    .where(inArray(schema.creatureLootResolved.confidenceTier, allowedTiers));

  const byCreature = new Map<
    number,
    {
      creature: typeof schema.creatures.$inferSelect;
      loot: LootDropInput[];
      trendByItem: Map<number, number | null>;
      categories: Set<string>;
    }
  >();

  for (const row of joined) {
    let entry = byCreature.get(row.creature.id);
    if (!entry) {
      entry = {
        creature: row.creature,
        loot: [],
        trendByItem: new Map(),
        categories: new Set(),
      };
      byCreature.set(row.creature.id, entry);
    }

    if (row.item.itemClass) {
      entry.categories.add(row.item.itemClass.toLowerCase());
    }

    const trend7d =
      row.snapshot?.trend7dPct !== null &&
      row.snapshot?.trend7dPct !== undefined
        ? Number(row.snapshot.trend7dPct)
        : null;
    entry.trendByItem.set(row.item.id, trend7d);

    entry.loot.push({
      itemId: row.item.id,
      itemName: row.item.name,
      quality: row.item.quality,
      bindType: row.item.bindType,
      vendorSellCopper: row.item.vendorSellCopper,
      isQuestOnly: row.loot.isQuestOnly,
      isCommodity: row.item.isCommodity,
      lootMethod: row.loot.lootMethod,
      dropRate: Number(row.loot.dropRate),
      minQty: row.loot.minQty,
      maxQty: row.loot.maxQty,
      avgQty: Number(row.loot.avgQty),
      avgQtyIsAssumed: row.loot.avgQtyIsAssumed,
      confidenceTier: row.loot.confidenceTier,
      sampleSize: row.loot.sampleSize,
      reporterCount: row.loot.reporterCount,
      ciLow: row.loot.ciLow !== null ? Number(row.loot.ciLow) : null,
      ciHigh: row.loot.ciHigh !== null ? Number(row.loot.ciHigh) : null,
      source: row.loot.source,
      lowestBuyoutCopper: row.snapshot?.lowestBuyoutCopper ?? null,
      p10Copper: row.snapshot?.p10Copper ?? null,
      medianCopper: row.snapshot?.medianCopper ?? null,
      marketValueCopper: row.snapshot?.marketValueCopper ?? null,
      clearingPriceCopper: row.snapshot?.clearingPriceCopper ?? null,
      availableQty: row.snapshot?.availableQty ?? 0,
      listingCount: row.snapshot?.listingCount ?? 0,
      trend7dPct: trend7d,
      trend30dPct:
        row.snapshot?.trend30dPct !== null &&
        row.snapshot?.trend30dPct !== undefined
          ? Number(row.snapshot.trend30dPct)
          : null,
      priceStatus: row.snapshot?.priceStatus ?? "MISSING",
      snapshotAt: row.snapshot?.snapshotAt ?? null,
      estimatedSoldPerDay:
        row.sales?.estimatedSoldPerDay !== null &&
        row.sales?.estimatedSoldPerDay !== undefined
          ? Number(row.sales.estimatedSoldPerDay)
          : null,
      daysSeen: row.sales?.daysSeen ?? null,
      salesDataStatus: row.sales?.dataStatus ?? "MISSING",
    });
  }

  const targetRegion = market?.region ?? options.marketId.split(":")[0] ?? "us";
  const allLootItemIds = Array.from(new Set(joined.map((r) => r.item.id)));
  const [variantsByItem, regionUnifiedBase] = await Promise.all([
    loadAggregatedVariantsByItemIds(allLootItemIds),
    loadRegionUnifiedBasePrices(allLootItemIds, targetRegion),
  ]);

  const profitParams: ProfitabilityParams = {
    killsPerHour: options.killsPerHour,
    hourlyExpensesCopper: options.hourlyExpensesCopper ?? 0,
    marketFaction,
    commissionRate,
    timeHorizonDays: options.timeHorizonDays ?? 1,
  };

  const searchLower = options.search?.trim().toLowerCase() ?? "";
  const zoneLower = options.zoneName?.trim().toLowerCase() ?? "";
  const categoryLower = options.itemCategory?.trim().toLowerCase() ?? "";

  const evaluated: Omit<RankedCreatureRow, "rank">[] = [];

  for (const { creature, loot: baseLoot, trendByItem, categories } of byCreature.values()) {
    const loot = expandLootDropsWithVariants(baseLoot, variantsByItem, {
      targetRegion,
      targetFaction: marketFaction,
      regionUnifiedBaseByItem: regionUnifiedBase,
    });
    if (zoneLower && (creature.primaryZoneName ?? "").toLowerCase() !== zoneLower) {
      continue;
    }
    if (
      options.minLevel !== undefined &&
      creature.maxLevel !== null &&
      creature.maxLevel < options.minLevel
    ) {
      continue;
    }
    if (
      options.maxLevel !== undefined &&
      creature.minLevel !== null &&
      creature.minLevel > options.maxLevel
    ) {
      continue;
    }

    if (searchLower) {
      const nameHit = creature.name.toLowerCase().includes(searchLower);
      const zoneHit = (creature.primaryZoneName ?? "")
        .toLowerCase()
        .includes(searchLower);
      const itemHit = loot.some(
        (l) =>
          l.itemName.toLowerCase().includes(searchLower) ||
          String(l.itemId) === searchLower
      );
      if (!nameHit && !zoneHit && !itemHit) continue;
    }

    if (options.minQuality !== undefined) {
      if (!loot.some((l) => l.quality >= options.minQuality!)) continue;
    }
    if (categoryLower) {
      if (!categories.has(categoryLower)) continue;
    }
    if (options.minDropRate !== undefined) {
      if (!loot.some((l) => l.dropRate >= options.minDropRate!)) continue;
    }
    if (options.minItemPriceCopper !== undefined) {
      if (
        !loot.some(
          (l) => (l.clearingPriceCopper ?? l.vendorSellCopper) >= options.minItemPriceCopper!
        )
      ) {
        continue;
      }
    }

    const profitability = calculateCreatureProfitability(
      {
        creatureId: creature.id,
        creatureName: creature.name,
        rawCoinMinCopper: creature.rawCoinMinCopper,
        rawCoinMaxCopper: creature.rawCoinMaxCopper,
        rawCoinSource: creature.rawCoinSource,
        loot,
      },
      profitParams
    );

    if (
      options.minEgphCopper !== undefined &&
      profitability.egphLiquidityAdjustedCopper < options.minEgphCopper
    ) {
      continue;
    }

    const bestDropTrend7dPct = profitability.bestDrop
      ? (trendByItem.get(profitability.bestDrop.itemId) ?? null)
      : null;

    evaluated.push({
      creatureId: creature.id,
      creatureName: creature.name,
      minLevel: creature.minLevel,
      maxLevel: creature.maxLevel,
      creatureType: creature.creatureType,
      classification: creature.classification,
      zoneName: creature.primaryZoneName,
      profitability,
      bestDropTrend7dPct,
    });
  }

  const sortBy = options.sortBy ?? "egph_adjusted";
  evaluated.sort((a, b) => {
    switch (sortBy) {
      case "egph_gross":
        return b.profitability.egphGrossEvCopper - a.profitability.egphGrossEvCopper;
      case "egpk":
        return (
          b.profitability.egpkLiquidityAdjustedCopper -
          a.profitability.egpkLiquidityAdjustedCopper
        );
      case "best_item_value":
        return (
          (b.profitability.bestDrop?.unitGrossCopper ?? 0) -
          (a.profitability.bestDrop?.unitGrossCopper ?? 0)
        );
      case "drop_rate":
        return (
          (b.profitability.bestDrop?.dropRate ?? 0) -
          (a.profitability.bestDrop?.dropRate ?? 0)
        );
      case "liquidity":
        return (
          (b.profitability.weightedLiquidityScore ?? -1) -
          (a.profitability.weightedLiquidityScore ?? -1)
        );
      case "price_trend":
        return (b.bestDropTrend7dPct ?? -9999) - (a.bestDropTrend7dPct ?? -9999);
      case "egph_adjusted":
      default:
        return (
          b.profitability.egphLiquidityAdjustedCopper -
            a.profitability.egphLiquidityAdjustedCopper ||
          b.profitability.egphGrossEvCopper - a.profitability.egphGrossEvCopper
        );
    }
  });

  const offset = Math.max(0, options.offset ?? 0);
  const limit = Math.min(200, Math.max(1, options.limit ?? 50));
  const paged: RankedCreatureRow[] = evaluated
    .slice(offset, offset + limit)
    .map((row, idx) => ({
      rank: offset + idx + 1,
      ...row,
    }));

  return {
    market: market ?? null,
    total: evaluated.length,
    rows: paged,
  };
}

export async function getDatabaseCounts() {
  const db = getDb();
  const [zonesRes, itemsRes, creaturesRes, resolvedRes, marketsRes, snapshotsRes] =
    await Promise.all([
      db.select({ count: sql<number>`count(*)::int` }).from(schema.zones),
      db.select({ count: sql<number>`count(*)::int` }).from(schema.items),
      db.select({ count: sql<number>`count(*)::int` }).from(schema.creatures),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.creatureLootResolved),
      db.select({ count: sql<number>`count(*)::int` }).from(schema.ahMarkets),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.itemMarketSnapshots),
    ]);

  const latestSync = await db
    .select()
    .from(schema.syncRuns)
    .orderBy(desc(schema.syncRuns.startedAt))
    .limit(5);

  return {
    zones: zonesRes[0]?.count ?? 0,
    items: itemsRes[0]?.count ?? 0,
    creatures: creaturesRes[0]?.count ?? 0,
    resolvedLoot: resolvedRes[0]?.count ?? 0,
    markets: marketsRes[0]?.count ?? 0,
    marketSnapshots: snapshotsRes[0]?.count ?? 0,
    latestSync,
  };
}
