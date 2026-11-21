import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { loadCreatureProfitInput } from "@/db/profitability-service";
import {
  ensureCreatureHydrated,
  ensureItemHydrated,
} from "@/ingestion/on-demand-hydrator";
import {
  calculateCreatureProfitability,
  DEFAULT_MARKET_COMMISSIONS,
  evaluateMarketLiquidity,
  type CreatureProfitabilityResult,
} from "@/domain/profitability";
import { ForeverAHMarketAdapter } from "@/providers/forever-ah-market";
import type { MarketFaction } from "@/providers/types";

export async function getCreatureDetail(
  creatureId: number,
  marketId: string,
  options: {
    killsPerHour: number;
    hourlyExpensesCopper: number;
    commissionOverride?: number;
    timeHorizonDays?: number;
  }
) {
  const db = getDb();
  await ensureCreatureHydrated(creatureId, marketId);
  const loaded = await loadCreatureProfitInput(creatureId, marketId);
  if (!loaded) return null;

  const { creature, market, input } = loaded;
  const marketFaction: MarketFaction = market?.faction ?? "alliance";
  const commissionRate =
    options.commissionOverride ??
    (market
      ? Number(market.defaultCommissionRate)
      : DEFAULT_MARKET_COMMISSIONS[marketFaction]);

  const profitability = calculateCreatureProfitability(input, {
    killsPerHour: options.killsPerHour,
    hourlyExpensesCopper: options.hourlyExpensesCopper,
    marketFaction,
    commissionRate,
    timeHorizonDays: options.timeHorizonDays ?? 1,
  });

  const spawns = await db
    .select()
    .from(schema.creatureSpawns)
    .where(eq(schema.creatureSpawns.creatureId, creatureId))
    .limit(50);

  // Compare profitability across Alliance, Horde, and Neutral houses in the same region
  const region = market?.region ?? "us";
  const regionMarkets = await db
    .select()
    .from(schema.ahMarkets)
    .where(eq(schema.ahMarkets.region, region));

  const representativeByFaction = new Map<
    MarketFaction,
    typeof schema.ahMarkets.$inferSelect
  >();
  for (const rm of regionMarkets) {
    if (rm.faction === "unified") continue;
    if (!representativeByFaction.has(rm.faction)) {
      representativeByFaction.set(rm.faction, rm);
    }
  }

  const factionComparisons: Array<{
    faction: MarketFaction;
    marketId: string;
    displayName: string;
    egphLiquidityAdjustedCopper: number;
    egphGrossEvCopper: number;
    commissionRate: number;
  }> = [];

  for (const [faction, rm] of representativeByFaction.entries()) {
    const compLoaded =
      rm.id === marketId
        ? loaded
        : await loadCreatureProfitInput(creatureId, rm.id);
    if (!compLoaded) continue;
    const compComm = Number(rm.defaultCommissionRate);
    const compProf = calculateCreatureProfitability(compLoaded.input, {
      killsPerHour: options.killsPerHour,
      hourlyExpensesCopper: options.hourlyExpensesCopper,
      marketFaction: faction,
      commissionRate: compComm,
      timeHorizonDays: options.timeHorizonDays ?? 1,
    });
    factionComparisons.push({
      faction,
      marketId: rm.id,
      displayName: rm.displayName,
      egphLiquidityAdjustedCopper: compProf.egphLiquidityAdjustedCopper,
      egphGrossEvCopper: compProf.egphGrossEvCopper,
      commissionRate: compComm,
    });
  }

  factionComparisons.sort(
    (a, b) => b.egphLiquidityAdjustedCopper - a.egphLiquidityAdjustedCopper
  );

  // Historical profitability trend for top drop (real stored/fetched history only)
  let topDropHistory: Array<{
    bucketTs: string;
    medianCopper: number | null;
    minCopper: number | null;
    availableQty: number;
    estimatedCreatureEgphCopper: number;
  }> = [];

  if (profitability.bestDrop && market) {
    const hist = await getOrFetchItemHistory(
      market,
      profitability.bestDrop.itemId,
      "day"
    );
    const best = profitability.bestDrop;
    const otherDropsGrossPerKill =
      profitability.rawCoinPerKillCopper +
      profitability.items
        .filter((i) => i.itemId !== best.itemId)
        .reduce((acc, i) => acc + i.expectedGrossEvPerKillCopper, 0);

    topDropHistory = hist.map((pt) => {
      const unitPrice = pt.medianCopper ?? pt.minCopper ?? 0;
      const bestPerKill =
        best.dropRate * best.avgQty * unitPrice * (1 - commissionRate);
      const estEgph = Math.round(
        options.killsPerHour * (otherDropsGrossPerKill + bestPerKill) -
          options.hourlyExpensesCopper
      );
      return {
        bucketTs: pt.bucketTs.toISOString(),
        medianCopper: pt.medianCopper,
        minCopper: pt.minCopper,
        availableQty: pt.availableQty,
        estimatedCreatureEgphCopper: estEgph,
      };
    });
  }

  return {
    creature,
    market,
    spawns,
    profitability,
    verdict: {
      bestFactionMarket: factionComparisons[0] ?? null,
      factionComparisons,
      bestItem: profitability.bestDrop,
      k50BestDrop: profitability.bestDrop?.dropMetrics.killsFor50Pct ?? null,
      k90BestDrop: profitability.bestDrop?.dropMetrics.killsFor90Pct ?? null,
    },
    topDropHistory,
  };
}

/**
 * Fetches real historical price series from PostgreSQL, or populates it on-demand
 * from Forever AH when missing/stale (> 6 hours). Never fabricates historical points.
 */
export async function getOrFetchItemHistory(
  market: typeof schema.ahMarkets.$inferSelect,
  itemId: number,
  resolution: "hour" | "day" = "day"
) {
  const db = getDb();
  const existing = await db
    .select()
    .from(schema.itemPriceHistory)
    .where(
      and(
        eq(schema.itemPriceHistory.marketId, market.id),
        eq(schema.itemPriceHistory.itemId, itemId),
        eq(schema.itemPriceHistory.resolution, resolution)
      )
    )
    .orderBy(asc(schema.itemPriceHistory.bucketTs));

  const latestBucket = existing[existing.length - 1]?.bucketTs;
  const sixHoursAgo = Date.now() - 6 * 60 * 60 * 1000;
  const needsFetch =
    existing.length === 0 ||
    (latestBucket && latestBucket.getTime() < sixHoursAgo);

  if (!needsFetch || market.providerSource !== "forever_ah") {
    return existing;
  }

  try {
    const adapter = new ForeverAHMarketAdapter({ maxRps: 2 });
    const points = await adapter.fetchItemHistory(
      {
        id: market.id,
        region: market.region,
        rulesetId: market.rulesetId,
        rulesetLabel: market.rulesetLabel,
        houseId: market.houseId,
        faction: market.faction,
        displayName: market.displayName,
        defaultCommissionRate: Number(market.defaultCommissionRate),
        providerSource: "forever_ah",
        providerKey: market.providerKey,
        lastSnapshotAt: market.lastSnapshotAt,
      },
      itemId,
      resolution
    );

    if (points.length > 0) {
      await db
        .insert(schema.itemPriceHistory)
        .values(
          points.map((p) => ({
            marketId: p.marketId,
            itemId: p.itemId,
            resolution: p.resolution,
            bucketTs: p.bucketTs,
            minCopper: p.minCopper,
            p10Copper: p.p10Copper,
            medianCopper: p.medianCopper,
            meanCopper: p.meanCopper,
            availableQty: p.availableQty,
            listingCount: p.listingCount,
            source: p.source,
          }))
        )
        .onConflictDoUpdate({
          target: [
            schema.itemPriceHistory.marketId,
            schema.itemPriceHistory.itemId,
            schema.itemPriceHistory.resolution,
            schema.itemPriceHistory.bucketTs,
          ],
          set: {
            minCopper: sql`excluded.min_copper`,
            p10Copper: sql`excluded.p10_copper`,
            medianCopper: sql`excluded.median_copper`,
            meanCopper: sql`excluded.mean_copper`,
            availableQty: sql`excluded.available_qty`,
            listingCount: sql`excluded.listing_count`,
          },
        });

      return db
        .select()
        .from(schema.itemPriceHistory)
        .where(
          and(
            eq(schema.itemPriceHistory.marketId, market.id),
            eq(schema.itemPriceHistory.itemId, itemId),
            eq(schema.itemPriceHistory.resolution, resolution)
          )
        )
        .orderBy(asc(schema.itemPriceHistory.bucketTs));
    }
  } catch {
    // Graceful fallback: return any stored history without failing the page
  }

  return existing;
}

export async function getItemDetail(
  itemId: number,
  marketId: string,
  options: {
    killsPerHour: number;
    hourlyExpensesCopper: number;
    region?: string;
  }
) {
  const db = getDb();
  const [item] = await db
    .select()
    .from(schema.items)
    .where(eq(schema.items.id, itemId))
    .limit(1);

  if (!item) return null;

  const [selectedMarket] = await db
    .select()
    .from(schema.ahMarkets)
    .where(eq(schema.ahMarkets.id, marketId))
    .limit(1);

  const region = options.region ?? selectedMarket?.region ?? "us";

  await ensureItemHydrated(itemId, region, marketId);

  // All market snapshots for this item across the region (Alliance, Horde, Neutral)
  const marketRows = await db
    .select({
      market: schema.ahMarkets,
      snapshot: schema.itemMarketSnapshots,
      sales: schema.itemSalesEstimates,
    })
    .from(schema.ahMarkets)
    .leftJoin(
      schema.itemMarketSnapshots,
      and(
        eq(schema.itemMarketSnapshots.marketId, schema.ahMarkets.id),
        eq(schema.itemMarketSnapshots.itemId, itemId)
      )
    )
    .leftJoin(
      schema.itemSalesEstimates,
      and(
        eq(schema.itemSalesEstimates.marketId, schema.ahMarkets.id),
        eq(schema.itemSalesEstimates.itemId, itemId)
      )
    )
    .where(eq(schema.ahMarkets.region, region))
    .orderBy(asc(schema.ahMarkets.houseId));

  const marketsWithLiquidity = marketRows.map((row) => {
    const soldPerDay =
      row.sales?.estimatedSoldPerDay !== null &&
      row.sales?.estimatedSoldPerDay !== undefined
        ? Number(row.sales.estimatedSoldPerDay)
        : null;
    const trend7d =
      row.snapshot?.trend7dPct !== null && row.snapshot?.trend7dPct !== undefined
        ? Number(row.snapshot.trend7dPct)
        : null;
    const trend30d =
      row.snapshot?.trend30dPct !== null && row.snapshot?.trend30dPct !== undefined
        ? Number(row.snapshot.trend30dPct)
        : null;

    const liquidity = evaluateMarketLiquidity({
      estimatedSoldPerDay: soldPerDay,
      availableQty: row.snapshot?.availableQty ?? 0,
      trend7dPct: trend7d,
      trend30dPct: trend30d,
      daysSeen: row.sales?.daysSeen ?? null,
      salesDataStatus: row.sales?.dataStatus ?? "MISSING",
      timeHorizonDays: 1,
    });

    return {
      marketId: row.market.id,
      houseId: row.market.houseId,
      faction: row.market.faction,
      displayName: row.market.displayName,
      defaultCommissionRate: Number(row.market.defaultCommissionRate),
      lowestBuyoutCopper: row.snapshot?.lowestBuyoutCopper ?? null,
      p10Copper: row.snapshot?.p10Copper ?? null,
      medianCopper: row.snapshot?.medianCopper ?? null,
      clearingPriceCopper: row.snapshot?.clearingPriceCopper ?? null,
      availableQty: row.snapshot?.availableQty ?? 0,
      listingCount: row.snapshot?.listingCount ?? 0,
      change24hPct:
        row.snapshot?.change24hPct !== null &&
        row.snapshot?.change24hPct !== undefined
          ? Number(row.snapshot.change24hPct)
          : null,
      trend7dPct: trend7d,
      trend30dPct: trend30d,
      estimatedSoldPerDay: soldPerDay,
      daysSeen: row.sales?.daysSeen ?? null,
      salesDataStatus: row.sales?.dataStatus ?? "MISSING",
      priceStatus: row.snapshot?.priceStatus ?? "MISSING",
      snapshotAt: row.snapshot?.snapshotAt?.toISOString() ?? null,
      source: row.snapshot?.source ?? row.market.providerSource,
      liquidity,
    };
  });

  // Historical price points (hourly 24h/7d + daily 30d):
  // If requested market has no listings for this item, fall back to region's unified or first active house
  // so brand-new Forever items listed on e.g. House #111 immediately show their real chart.
  const selectedHasPrice = marketsWithLiquidity.some(
    (m) => m.marketId === selectedMarket?.id && m.priceStatus === "ACTUAL"
  );
  const fallbackActiveMarketRow = !selectedHasPrice
    ? (marketRows.find(
        (r) => r.market.faction === "unified" && r.snapshot?.priceStatus === "ACTUAL"
      ) ??
      marketRows.find((r) => r.snapshot?.priceStatus === "ACTUAL"))
    : undefined;
  const effectiveMarket = fallbackActiveMarketRow?.market ?? selectedMarket ?? null;

  const [historyHourly, historyDaily] = effectiveMarket
    ? await Promise.all([
        getOrFetchItemHistory(effectiveMarket, itemId, "hour"),
        getOrFetchItemHistory(effectiveMarket, itemId, "day"),
      ])
    : [[], []];

  // All known creatures that drop this item, ranked by total EGPH & item-specific efficiency
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

  const creatureSources: Array<{
    creatureId: number;
    creatureName: string;
    minLevel: number | null;
    maxLevel: number | null;
    zoneName: string | null;
    lootMethod: string;
    dropRate: number;
    avgQty: number;
    confidenceTier: string;
    sampleSize: number | null;
    source: string;
    itemEvPerKillCopper: number;
    totalEgpkCopper: number;
    totalEgphCopper: number;
    totalEgphGrossCopper: number;
  }> = [];

  const targetMarketId = selectedMarket?.id ?? marketId;
  const targetFaction: MarketFaction = selectedMarket?.faction ?? "alliance";
  const targetCommission = selectedMarket
    ? Number(selectedMarket.defaultCommissionRate)
    : DEFAULT_MARKET_COMMISSIONS[targetFaction];

  for (const src of dropSources) {
    const loaded = await loadCreatureProfitInput(src.creature.id, targetMarketId);
    if (!loaded) continue;
    const prof: CreatureProfitabilityResult = calculateCreatureProfitability(
      loaded.input,
      {
        killsPerHour: options.killsPerHour,
        hourlyExpensesCopper: options.hourlyExpensesCopper,
        marketFaction: targetFaction,
        commissionRate: targetCommission,
      }
    );
    const matchingItem = prof.items.find((i) => i.itemId === itemId);

    creatureSources.push({
      creatureId: src.creature.id,
      creatureName: src.creature.name,
      minLevel: src.creature.minLevel,
      maxLevel: src.creature.maxLevel,
      zoneName: src.creature.primaryZoneName,
      lootMethod: src.loot.lootMethod,
      dropRate: Number(src.loot.dropRate),
      avgQty: Number(src.loot.avgQty),
      confidenceTier: src.loot.confidenceTier,
      sampleSize: src.loot.sampleSize,
      source: src.loot.source,
      itemEvPerKillCopper: Math.round(
        matchingItem?.expectedLiquidityAdjustedPerKillCopper ?? 0
      ),
      totalEgpkCopper: prof.egpkLiquidityAdjustedCopper,
      totalEgphCopper: prof.egphLiquidityAdjustedCopper,
      totalEgphGrossCopper: prof.egphGrossEvCopper,
    });
  }

  creatureSources.sort(
    (a, b) => b.totalEgphCopper - a.totalEgphCopper || b.dropRate - a.dropRate
  );

  return {
    item,
    selectedMarket: effectiveMarket,
    region,
    markets: marketsWithLiquidity,
    historyHourly: historyHourly.map((p) => ({
      ts: p.bucketTs.toISOString(),
      minCopper: p.minCopper,
      p10Copper: p.p10Copper,
      medianCopper: p.medianCopper,
      meanCopper: p.meanCopper,
      availableQty: p.availableQty,
      listingCount: p.listingCount,
    })),
    historyDaily: historyDaily.map((p) => ({
      ts: p.bucketTs.toISOString(),
      minCopper: p.minCopper,
      p10Copper: p.p10Copper,
      medianCopper: p.medianCopper,
      meanCopper: p.meanCopper,
      availableQty: p.availableQty,
      listingCount: p.listingCount,
    })),
    creatureSources,
  };
}

export async function unifiedSearch(query: string, limit = 15) {
  const db = getDb();
  const q = query.trim();
  if (!q) return { items: [], creatures: [], zones: [] };

  const numericId = /^\d+$/.test(q) ? Number(q) : null;
  const pattern = `%${q}%`;

  const [foundItems, foundCreatures, foundZones] = await Promise.all([
    db
      .select({
        id: schema.items.id,
        name: schema.items.name,
        quality: schema.items.quality,
        itemClass: schema.items.itemClass,
        iconUrl: schema.items.iconUrl,
      })
      .from(schema.items)
      .where(
        numericId !== null
          ? or(eq(schema.items.id, numericId), ilike(schema.items.name, pattern))
          : ilike(schema.items.name, pattern)
      )
      .orderBy(asc(sql`length(${schema.items.name})`), desc(schema.items.id))
      .limit(limit),
    db
      .select({
        id: schema.creatures.id,
        name: schema.creatures.name,
        minLevel: schema.creatures.minLevel,
        maxLevel: schema.creatures.maxLevel,
        primaryZoneName: schema.creatures.primaryZoneName,
        classification: schema.creatures.classification,
      })
      .from(schema.creatures)
      .where(
        numericId !== null
          ? or(
              eq(schema.creatures.id, numericId),
              ilike(schema.creatures.name, pattern)
            )
          : ilike(schema.creatures.name, pattern)
      )
      .limit(limit),
    db
      .select({
        id: schema.zones.id,
        name: schema.zones.name,
        continent: schema.zones.continent,
        minLevel: schema.zones.minLevel,
        maxLevel: schema.zones.maxLevel,
      })
      .from(schema.zones)
      .where(ilike(schema.zones.name, pattern))
      .limit(10),
  ]);

  const itemIds = foundItems.map((i) => i.id);
  const priceByItem = new Map<number, { clearingPriceCopper: number | null; marketId: string }>();
  if (itemIds.length > 0) {
    const snaps = await db
      .select({
        itemId: schema.itemMarketSnapshots.itemId,
        marketId: schema.itemMarketSnapshots.marketId,
        clearingPriceCopper: schema.itemMarketSnapshots.clearingPriceCopper,
      })
      .from(schema.itemMarketSnapshots)
      .where(
        and(
          inArray(schema.itemMarketSnapshots.itemId, itemIds),
          eq(schema.itemMarketSnapshots.priceStatus, "ACTUAL")
        )
      );
    for (const s of snaps) {
      const existing = priceByItem.get(s.itemId);
      // Prefer unified pools (us:0 / eu:0) when available
      if (!existing || s.marketId.endsWith(":0")) {
        priceByItem.set(s.itemId, {
          clearingPriceCopper: s.clearingPriceCopper,
          marketId: s.marketId,
        });
      }
    }
  }

  return {
    items: foundItems.map((i) => {
      const p = priceByItem.get(i.id);
      return {
        ...i,
        isNewForever: i.id >= 200_000,
        clearingPriceCopper: p?.clearingPriceCopper ?? null,
        priceMarketId: p?.marketId ?? null,
      };
    }),
    creatures: foundCreatures,
    zones: foundZones,
  };
}

export interface BrowseMarketItemsOptions {
  marketId: string;
  search?: string;
  newForeverOnly?: boolean;
  itemClass?: string;
  minQuality?: number;
  sortBy?: "price_desc" | "price_asc" | "change_24h" | "sold_per_day" | "supply";
  limit?: number;
  offset?: number;
}

export async function browseMarketItems(options: BrowseMarketItemsOptions) {
  const db = getDb();
  const conditions = [
    eq(schema.itemMarketSnapshots.marketId, options.marketId),
    eq(schema.itemMarketSnapshots.priceStatus, "ACTUAL"),
  ];

  if (options.newForeverOnly) {
    conditions.push(sql`${schema.items.id} >= 200000`);
  }
  if (options.itemClass && options.itemClass.trim()) {
    conditions.push(eq(schema.items.itemClass, options.itemClass.trim()));
  }
  if (options.minQuality !== undefined) {
    conditions.push(sql`${schema.items.quality} >= ${options.minQuality}`);
  }
  if (options.search && options.search.trim()) {
    const q = options.search.trim();
    if (/^\d+$/.test(q)) {
      conditions.push(
        or(eq(schema.items.id, Number(q)), ilike(schema.items.name, `%${q}%`))!
      );
    } else {
      conditions.push(ilike(schema.items.name, `%${q}%`));
    }
  }

  const orderClause = (() => {
    switch (options.sortBy) {
      case "price_asc":
        return asc(schema.itemMarketSnapshots.clearingPriceCopper);
      case "change_24h":
        return sql`${schema.itemMarketSnapshots.change24hPct} DESC NULLS LAST`;
      case "sold_per_day":
        return sql`${schema.itemSalesEstimates.estimatedSoldPerDay} DESC NULLS LAST`;
      case "supply":
        return desc(schema.itemMarketSnapshots.availableQty);
      case "price_desc":
      default:
        return sql`${schema.itemMarketSnapshots.clearingPriceCopper} DESC NULLS LAST`;
    }
  })();

  const limit = Math.min(200, Math.max(1, options.limit ?? 50));
  const offset = Math.max(0, options.offset ?? 0);

  const [countRes, newForeverCountRes, totalInMarketRes, rows] =
    await Promise.all([
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.itemMarketSnapshots)
        .innerJoin(
          schema.items,
          eq(schema.itemMarketSnapshots.itemId, schema.items.id)
        )
        .where(and(...conditions)),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.itemMarketSnapshots)
        .innerJoin(
          schema.items,
          eq(schema.itemMarketSnapshots.itemId, schema.items.id)
        )
        .where(
          and(
            eq(schema.itemMarketSnapshots.marketId, options.marketId),
            eq(schema.itemMarketSnapshots.priceStatus, "ACTUAL"),
            sql`${schema.items.id} >= 200000`
          )
        ),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.itemMarketSnapshots)
        .where(
          and(
            eq(schema.itemMarketSnapshots.marketId, options.marketId),
            eq(schema.itemMarketSnapshots.priceStatus, "ACTUAL")
          )
        ),
      db
        .select({
          item: schema.items,
          snapshot: schema.itemMarketSnapshots,
          sales: schema.itemSalesEstimates,
        })
        .from(schema.itemMarketSnapshots)
        .innerJoin(
          schema.items,
          eq(schema.itemMarketSnapshots.itemId, schema.items.id)
        )
        .leftJoin(
          schema.itemSalesEstimates,
          and(
            eq(schema.itemSalesEstimates.itemId, schema.items.id),
            eq(schema.itemSalesEstimates.marketId, options.marketId)
          )
        )
        .where(and(...conditions))
        .orderBy(orderClause)
        .limit(limit)
        .offset(offset),
    ]);

  return {
    total: countRes[0]?.count ?? 0,
    totalActiveInMarket: totalInMarketRes[0]?.count ?? 0,
    newForeverCountInMarket: newForeverCountRes[0]?.count ?? 0,
    rows: rows.map((r) => ({
      itemId: r.item.id,
      name: r.item.name,
      quality: r.item.quality,
      itemClass: r.item.itemClass,
      itemSubclass: r.item.itemSubclass,
      iconUrl: r.item.iconUrl,
      isNewForever: r.item.id >= 200_000,
      vendorSellCopper: r.item.vendorSellCopper,
      lowestBuyoutCopper: r.snapshot.lowestBuyoutCopper,
      medianCopper: r.snapshot.medianCopper,
      clearingPriceCopper: r.snapshot.clearingPriceCopper,
      availableQty: r.snapshot.availableQty,
      listingCount: r.snapshot.listingCount,
      change24hPct:
        r.snapshot.change24hPct !== null ? Number(r.snapshot.change24hPct) : null,
      estimatedSoldPerDay:
        r.sales?.estimatedSoldPerDay !== null &&
        r.sales?.estimatedSoldPerDay !== undefined
          ? Number(r.sales.estimatedSoldPerDay)
          : null,
      snapshotAt: r.snapshot.snapshotAt.toISOString(),
    })),
  };
}

export async function getMarketOpportunities(marketId: string) {
  const db = getDb();

  // Only items that actually drop from known creatures in our resolved loot table
  const dropItemIdsRows = await db
    .selectDistinct({ itemId: schema.creatureLootResolved.itemId })
    .from(schema.creatureLootResolved);
  const dropItemIds = dropItemIdsRows.map((r) => r.itemId);
  if (dropItemIds.length === 0) {
    return { risingItems: [], scarceItems: [] };
  }

  const snapshots = await db
    .select({
      item: schema.items,
      snapshot: schema.itemMarketSnapshots,
      sales: schema.itemSalesEstimates,
    })
    .from(schema.itemMarketSnapshots)
    .innerJoin(schema.items, eq(schema.itemMarketSnapshots.itemId, schema.items.id))
    .leftJoin(
      schema.itemSalesEstimates,
      and(
        eq(schema.itemSalesEstimates.itemId, schema.items.id),
        eq(schema.itemSalesEstimates.marketId, marketId)
      )
    )
    .where(
      and(
        eq(schema.itemMarketSnapshots.marketId, marketId),
        inArray(schema.itemMarketSnapshots.itemId, dropItemIds)
      )
    )
    .orderBy(desc(schema.itemMarketSnapshots.change24hPct));

  const risingItems = snapshots
    .filter(
      (r) =>
        r.snapshot.change24hPct !== null &&
        Number(r.snapshot.change24hPct) >= 10 &&
        (r.snapshot.clearingPriceCopper ?? 0) >= 100
    )
    .slice(0, 20)
    .map((r) => ({
      itemId: r.item.id,
      name: r.item.name,
      quality: r.item.quality,
      iconUrl: r.item.iconUrl,
      clearingPriceCopper: r.snapshot.clearingPriceCopper,
      change24hPct: Number(r.snapshot.change24hPct),
      availableQty: r.snapshot.availableQty,
      estimatedSoldPerDay:
        r.sales?.estimatedSoldPerDay !== null &&
        r.sales?.estimatedSoldPerDay !== undefined
          ? Number(r.sales.estimatedSoldPerDay)
          : null,
      snapshotAt: r.snapshot.snapshotAt.toISOString(),
    }));

  const scarceItems = snapshots
    .filter((r) => {
      const sold =
        r.sales?.estimatedSoldPerDay !== null &&
        r.sales?.estimatedSoldPerDay !== undefined
          ? Number(r.sales.estimatedSoldPerDay)
          : 0;
      const qty = r.snapshot.availableQty;
      return (
        sold >= 2 &&
        qty > 0 &&
        qty / sold <= 1.5 &&
        (r.snapshot.clearingPriceCopper ?? 0) >= 100
      );
    })
    .sort(
      (a, b) =>
        (b.snapshot.clearingPriceCopper ?? 0) -
        (a.snapshot.clearingPriceCopper ?? 0)
    )
    .slice(0, 20)
    .map((r) => {
      const sold = Number(r.sales?.estimatedSoldPerDay ?? 0);
      return {
        itemId: r.item.id,
        name: r.item.name,
        quality: r.item.quality,
        iconUrl: r.item.iconUrl,
        clearingPriceCopper: r.snapshot.clearingPriceCopper,
        availableQty: r.snapshot.availableQty,
        estimatedSoldPerDay: sold,
        daysOfSupply: Number((r.snapshot.availableQty / Math.max(sold, 0.01)).toFixed(2)),
        snapshotAt: r.snapshot.snapshotAt.toISOString(),
      };
    });

  return { risingItems, scarceItems };
}
