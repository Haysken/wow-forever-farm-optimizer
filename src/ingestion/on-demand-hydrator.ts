import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { resolveCreatureLoot } from "@/ingestion/loot-resolver";
import { TtlCache } from "@/lib/cache";
import { parseSavedVariablesLua } from "@/ingestion/savedvariables-parser";
import { EverlookDBLootAdapter } from "@/providers/everlookdb-loot";
import { ForeverAHMarketAdapter } from "@/providers/forever-ah-market";
import type {
  LootProviderId,
  NormalizedDropObservation,
  NormalizedItemMarketRow,
  NormalizedMarket,
} from "@/providers/types";

const creatureHydrationGuard = new TtlCache<boolean>(10 * 60_000, 1000);
const itemHydrationGuard = new TtlCache<boolean>(10 * 60_000, 2000);

function clampPct(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Math.min(99_999.999, Math.max(-9_999.999, value)).toFixed(3);
}

async function upsertMarkets(markets: NormalizedMarket[]): Promise<void> {
  if (markets.length === 0) return;
  const db = getDb();
  for (const m of markets) {
    await db
      .insert(schema.ahMarkets)
      .values({
        id: m.id,
        region: m.region,
        rulesetId: m.rulesetId,
        rulesetLabel: m.rulesetLabel,
        houseId: m.houseId,
        faction: m.faction,
        displayName: m.displayName,
        defaultCommissionRate: m.defaultCommissionRate.toFixed(4),
        providerSource: m.providerSource,
        providerKey: m.providerKey,
        lastSnapshotAt: m.lastSnapshotAt,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: schema.ahMarkets.id,
        set: {
          displayName: sql`excluded.display_name`,
          providerKey: sql`excluded.provider_key`,
          lastSnapshotAt: sql`excluded.last_snapshot_at`,
          updatedAt: new Date(),
        },
      });
  }
}

async function upsertMarketRows(rows: NormalizedItemMarketRow[]): Promise<void> {
  if (rows.length === 0) return;
  const db = getDb();
  const deduped = Array.from(
    new Map(rows.map((r) => [`${r.marketId}:${r.itemId}`, r])).values()
  );

  for (let i = 0; i < deduped.length; i += 200) {
    const chunk = deduped.slice(i, i + 200);
    await db
      .insert(schema.itemMarketSnapshots)
      .values(
        chunk.map((r) => ({
          marketId: r.marketId,
          itemId: r.itemId,
          lowestBuyoutCopper: r.lowestBuyoutCopper,
          p10Copper: r.p10Copper,
          medianCopper: r.medianCopper,
          meanCopper: r.meanCopper,
          marketValueCopper: r.marketValueCopper,
          historicalValueCopper: r.historicalValueCopper,
          clearingPriceCopper: r.clearingPriceCopper,
          availableQty: r.availableQty,
          listingCount: r.listingCount,
          change24hPct: clampPct(r.change24hPct),
          trend7dPct: clampPct(r.trend7dPct),
          trend30dPct: clampPct(r.trend30dPct),
          priceStatus: r.priceStatus,
          source: r.source,
          snapshotAt: r.snapshotAt,
        }))
      )
      .onConflictDoUpdate({
        target: [
          schema.itemMarketSnapshots.marketId,
          schema.itemMarketSnapshots.itemId,
        ],
        set: {
          lowestBuyoutCopper: sql`excluded.lowest_buyout_copper`,
          p10Copper: sql`excluded.p10_copper`,
          medianCopper: sql`excluded.median_copper`,
          meanCopper: sql`excluded.mean_copper`,
          marketValueCopper: sql`coalesce(excluded.market_value_copper, ${schema.itemMarketSnapshots.marketValueCopper})`,
          historicalValueCopper: sql`coalesce(excluded.historical_value_copper, ${schema.itemMarketSnapshots.historicalValueCopper})`,
          clearingPriceCopper: sql`excluded.clearing_price_copper`,
          availableQty: sql`excluded.available_qty`,
          listingCount: sql`excluded.listing_count`,
          change24hPct: sql`coalesce(excluded.change_24h_pct, ${schema.itemMarketSnapshots.change24hPct})`,
          trend7dPct: sql`coalesce(excluded.trend_7d_pct, ${schema.itemMarketSnapshots.trend7dPct})`,
          priceStatus: sql`excluded.price_status`,
          snapshotAt: sql`excluded.snapshot_at`,
        },
      });

    const withSales = chunk.filter((r) => r.salesDataStatus !== "MISSING");
    if (withSales.length > 0) {
      await db
        .insert(schema.itemSalesEstimates)
        .values(
          withSales.map((r) => ({
            marketId: r.marketId,
            itemId: r.itemId,
            estimatedSoldPerDay:
              r.estimatedSoldPerDay !== null
                ? r.estimatedSoldPerDay.toFixed(4)
                : null,
            daysSeen: r.daysSeen,
            liquidityScore: null,
            sellingProb24h: null,
            sellingProb7d: null,
            dataStatus: r.salesDataStatus,
            source: r.source,
            computedAt: r.snapshotAt,
          }))
        )
        .onConflictDoUpdate({
          target: [
            schema.itemSalesEstimates.marketId,
            schema.itemSalesEstimates.itemId,
          ],
          set: {
            estimatedSoldPerDay: sql`excluded.estimated_sold_per_day`,
            daysSeen: sql`excluded.days_seen`,
            dataStatus: sql`excluded.data_status`,
            computedAt: sql`excluded.computed_at`,
          },
        });
    }
  }
}

async function persistAndResolveObservations(
  observations: NormalizedDropObservation[]
): Promise<number> {
  if (observations.length === 0) return 0;
  const db = getDb();

  const itemIds = Array.from(new Set(observations.map((o) => o.itemId)));
  const creatureIds = Array.from(new Set(observations.map((o) => o.creatureId)));

  const [existingItems, existingCreatures] = await Promise.all([
    db
      .select({ id: schema.items.id })
      .from(schema.items)
      .where(inArray(schema.items.id, itemIds)),
    db
      .select({ id: schema.creatures.id })
      .from(schema.creatures)
      .where(inArray(schema.creatures.id, creatureIds)),
  ]);

  const validItemSet = new Set(existingItems.map((i) => i.id));
  const validCreatureSet = new Set(existingCreatures.map((c) => c.id));

  const validObs = observations.filter(
    (o) =>
      validItemSet.has(o.itemId) &&
      validCreatureSet.has(o.creatureId) &&
      Number.isFinite(o.dropRate) &&
      o.dropRate >= 0 &&
      o.dropRate <= 1
  );

  if (validObs.length === 0) return 0;

  for (let i = 0; i < validObs.length; i += 200) {
    const chunk = validObs.slice(i, i + 200);
    await db
      .insert(schema.dropObservations)
      .values(
        chunk.map((o) => ({
          creatureId: o.creatureId,
          itemId: o.itemId,
          lootMethod: o.lootMethod,
          source: o.source,
          killsObserved: o.killsObserved,
          dropsObserved: o.dropsObserved,
          totalQtyObserved: o.totalQtyObserved,
          minQty: o.minQty,
          maxQty: o.maxQty,
          avgQty: o.avgQty !== null ? o.avgQty.toFixed(4) : null,
          dropRate: o.dropRate.toFixed(8),
          ciLow: o.ciLow !== null ? o.ciLow.toFixed(8) : null,
          ciHigh: o.ciHigh !== null ? o.ciHigh.toFixed(8) : null,
          reporterCount: o.reporterCount,
          confidenceTier: o.confidenceTier,
          isQuestOnly: o.isQuestOnly,
          clientBuild: o.clientBuild,
          observedAt: o.observedAt,
        }))
      )
      .onConflictDoUpdate({
        target: [
          schema.dropObservations.creatureId,
          schema.dropObservations.itemId,
          schema.dropObservations.lootMethod,
          schema.dropObservations.source,
        ],
        set: {
          killsObserved: sql`excluded.kills_observed`,
          dropsObserved: sql`excluded.drops_observed`,
          totalQtyObserved: sql`excluded.total_qty_observed`,
          avgQty: sql`excluded.avg_qty`,
          dropRate: sql`excluded.drop_rate`,
          confidenceTier: sql`excluded.confidence_tier`,
          isQuestOnly: sql`excluded.is_quest_only`,
          observedAt: sql`excluded.observed_at`,
        },
      });
  }

  // Re-resolve affected creatures from ALL stored drop_observations so higher-priority
  // Forever observations are never overwritten by Classic 1.12 fallbacks.
  const storedRows = await db
    .select()
    .from(schema.dropObservations)
    .where(inArray(schema.dropObservations.creatureId, Array.from(validCreatureSet)));

  const normalizedStored: NormalizedDropObservation[] = storedRows.map((r) => ({
    creatureId: r.creatureId,
    itemId: r.itemId,
    lootMethod: r.lootMethod,
    source: r.source as LootProviderId,
    killsObserved: r.killsObserved,
    dropsObserved: r.dropsObserved,
    totalQtyObserved: r.totalQtyObserved,
    minQty: r.minQty,
    maxQty: r.maxQty,
    avgQty: r.avgQty !== null ? Number(r.avgQty) : null,
    dropRate: Number(r.dropRate),
    ciLow: r.ciLow !== null ? Number(r.ciLow) : null,
    ciHigh: r.ciHigh !== null ? Number(r.ciHigh) : null,
    reporterCount: r.reporterCount,
    confidenceTier: r.confidenceTier,
    isQuestOnly: r.isQuestOnly,
    clientBuild: r.clientBuild,
    observedAt: r.observedAt,
  }));

  const resolved = resolveCreatureLoot(normalizedStored);
  for (let i = 0; i < resolved.length; i += 200) {
    const chunk = resolved.slice(i, i + 200);
    await db
      .insert(schema.creatureLootResolved)
      .values(
        chunk.map((r) => ({
          creatureId: r.creatureId,
          itemId: r.itemId,
          lootMethod: r.lootMethod,
          dropRate: r.dropRate.toFixed(8),
          minQty: r.minQty,
          maxQty: r.maxQty,
          avgQty: r.avgQty.toFixed(4),
          avgQtyIsAssumed: r.avgQtyIsAssumed,
          sampleSize: r.sampleSize,
          reporterCount: r.reporterCount,
          ciLow: r.ciLow !== null ? r.ciLow.toFixed(8) : null,
          ciHigh: r.ciHigh !== null ? r.ciHigh.toFixed(8) : null,
          confidenceTier: r.confidenceTier,
          source: r.source,
          isQuestOnly: r.isQuestOnly,
          resolvedAt: r.resolvedAt,
        }))
      )
      .onConflictDoUpdate({
        target: [
          schema.creatureLootResolved.creatureId,
          schema.creatureLootResolved.itemId,
          schema.creatureLootResolved.lootMethod,
        ],
        set: {
          dropRate: sql`excluded.drop_rate`,
          minQty: sql`excluded.min_qty`,
          maxQty: sql`excluded.max_qty`,
          avgQty: sql`excluded.avg_qty`,
          avgQtyIsAssumed: sql`excluded.avg_qty_is_assumed`,
          sampleSize: sql`excluded.sample_size`,
          reporterCount: sql`excluded.reporter_count`,
          ciLow: sql`excluded.ci_low`,
          ciHigh: sql`excluded.ci_high`,
          confidenceTier: sql`excluded.confidence_tier`,
          source: sql`excluded.source`,
          isQuestOnly: sql`excluded.is_quest_only`,
          resolvedAt: sql`excluded.resolved_at`,
        },
      });
  }

  return resolved.length;
}

/**
 * Ensures any of the 9,994 catalog creatures has its loot table, HP, raw coin,
 * spawns, and live AH item prices hydrated on-demand into PostgreSQL when visited.
 */
export async function ensureCreatureHydrated(
  creatureId: number,
  marketId: string
): Promise<void> {
  const db = getDb();
  const guardKey = `${creatureId}:${marketId}`;
  if (creatureHydrationGuard.get(guardKey)) return;

  const existingLoot = await db
    .select({ itemId: schema.creatureLootResolved.itemId })
    .from(schema.creatureLootResolved)
    .where(eq(schema.creatureLootResolved.creatureId, creatureId));

  let lootItemIds = existingLoot.map((r) => r.itemId);

  if (lootItemIds.length === 0) {
    try {
      const everlook = new EverlookDBLootAdapter();
      const bundle = await everlook.fetchNpcLoot(creatureId);

      if (bundle.healthMin !== null || bundle.rawCoinMinCopper !== null) {
        await db
          .update(schema.creatures)
          .set({
            healthMin: bundle.healthMin,
            healthMax: bundle.healthMax,
            rawCoinMinCopper: bundle.rawCoinMinCopper,
            rawCoinMaxCopper: bundle.rawCoinMaxCopper,
            rawCoinSource: bundle.rawCoinSource,
            updatedAt: new Date(),
          })
          .where(eq(schema.creatures.id, creatureId));
      }

      if (bundle.spawns.length > 0) {
        await db
          .delete(schema.creatureSpawns)
          .where(eq(schema.creatureSpawns.creatureId, creatureId));
        await db.insert(schema.creatureSpawns).values(
          bundle.spawns.slice(0, 30).map((s) => ({
            creatureId: s.creatureId,
            zoneId: null,
            zoneName: s.zoneName,
            subzone: s.subzone,
            x: s.x.toFixed(2),
            y: s.y.toFixed(2),
            source: s.source,
            confidenceTier: s.confidenceTier,
            sampleSize: s.sampleSize,
          }))
        );
      }

      await persistAndResolveObservations(bundle.observations);
      const refreshed = await db
        .select({ itemId: schema.creatureLootResolved.itemId })
        .from(schema.creatureLootResolved)
        .where(eq(schema.creatureLootResolved.creatureId, creatureId));
      lootItemIds = refreshed.map((r) => r.itemId);
    } catch {
      // Graceful degradation: continue even if upstream EverlookDB is unreachable
    }
  }

  // Hydrate any missing AH prices for this creature's dropped items on the selected market
  if (lootItemIds.length > 0) {
    const [market] = await db
      .select()
      .from(schema.ahMarkets)
      .where(eq(schema.ahMarkets.id, marketId))
      .limit(1);

    if (market && market.providerSource === "forever_ah") {
      const existingSnaps = await db
        .select({ itemId: schema.itemMarketSnapshots.itemId })
        .from(schema.itemMarketSnapshots)
        .where(
          and(
            eq(schema.itemMarketSnapshots.marketId, marketId),
            inArray(schema.itemMarketSnapshots.itemId, lootItemIds)
          )
        );
      const haveSet = new Set(existingSnaps.map((s) => s.itemId));
      const missingIds = lootItemIds.filter((id) => !haveSet.has(id));

      if (missingIds.length > 0) {
        try {
          const ah = new ForeverAHMarketAdapter({ maxRps: 2 });
          const fetched = await ah.fetchMarketSnapshot(
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
            { itemIds: missingIds }
          );
          await upsertMarketRows(fetched);
        } catch {
          // Graceful fallback to existing snapshots / vendor values
        }
      }
    }
  }

  creatureHydrationGuard.set(guardKey, true);
}

/**
 * Ensures any of the 22,826 catalog items has live cross-house AH prices across
 * the region AND dropping creature sources hydrated on-demand into PostgreSQL.
 */
export async function ensureItemHydrated(
  itemId: number,
  region: string,
  selectedMarketId: string
): Promise<void> {
  const db = getDb();
  const guardKey = `${itemId}:${region}:${selectedMarketId}`;
  if (itemHydrationGuard.get(guardKey)) return;

  // 1. Hydrate live prices across ALL houses in the region from Forever AH (1 HTTP call)
  try {
    const ah = new ForeverAHMarketAdapter({ maxRps: 2 });
    const { markets, rows } = await ah.fetchItemAcrossHouses(itemId, region);
    await upsertMarkets(markets);
    await upsertMarketRows(rows);

    // Enrich selected house with market_value and sold_per_day stats
    const targetMarket =
      markets.find((m) => m.id === selectedMarketId) ??
      markets.find((m) => m.faction === "alliance") ??
      markets[0];
    if (targetMarket) {
      const stats = await ah.fetchItemStats(targetMarket.providerKey, itemId);
      if (stats) {
        await db
          .insert(schema.itemSalesEstimates)
          .values({
            marketId: targetMarket.id,
            itemId,
            estimatedSoldPerDay:
              stats.estimatedSoldPerDay !== null
                ? stats.estimatedSoldPerDay.toFixed(4)
                : null,
            daysSeen: stats.daysSeen,
            liquidityScore: null,
            sellingProb24h: null,
            sellingProb7d: null,
            dataStatus:
              stats.estimatedSoldPerDay !== null ? "ESTIMATED" : "MISSING",
            source: "forever_ah",
            computedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [
              schema.itemSalesEstimates.marketId,
              schema.itemSalesEstimates.itemId,
            ],
            set: {
              estimatedSoldPerDay: sql`excluded.estimated_sold_per_day`,
              daysSeen: sql`excluded.days_seen`,
              dataStatus: sql`excluded.data_status`,
              computedAt: sql`excluded.computed_at`,
            },
          });
      }
    }
  } catch {
    // Graceful degradation
  }

  // 2. Hydrate dropping creatures if none are stored yet for this item
  const existingDrops = await db
    .select({ creatureId: schema.creatureLootResolved.creatureId })
    .from(schema.creatureLootResolved)
    .where(eq(schema.creatureLootResolved.itemId, itemId))
    .limit(1);

  if (existingDrops.length === 0) {
    try {
      const everlook = new EverlookDBLootAdapter();
      const obs = await everlook.fetchItemDrops(itemId);
      await persistAndResolveObservations(obs);
    } catch {
      // Graceful degradation
    }
  }

  itemHydrationGuard.set(guardKey, true);
}

/**
 * Records a user-observed in-game drop (e.g., a newly discovered WoW Forever 250xxx item)
 * transparently as `source = "user_observation"`, `confidenceTier = "OBSERVED"`,
 * and immediately hydrates live AH prices for that item.
 */
export async function recordUserDropObservation(params: {
  creatureId: number;
  itemId: number;
  killsObserved: number;
  dropsObserved: number;
  avgQty?: number;
  marketId?: string;
}): Promise<{ resolvedCount: number; dropRate: number }> {
  const dropRate = params.dropsObserved / params.killsObserved;
  const obs: NormalizedDropObservation = {
    creatureId: params.creatureId,
    itemId: params.itemId,
    lootMethod: "kill",
    source: "user_observation",
    killsObserved: params.killsObserved,
    dropsObserved: params.dropsObserved,
    totalQtyObserved: Math.round(params.dropsObserved * (params.avgQty ?? 1)),
    minQty: 1,
    maxQty: Math.max(1, Math.ceil(params.avgQty ?? 1)),
    avgQty: params.avgQty ?? 1,
    dropRate,
    ciLow: null,
    ciHigh: null,
    reporterCount: 1,
    confidenceTier: "OBSERVED",
    isQuestOnly: false,
    clientBuild: "1.60.1.70959",
    observedAt: new Date(),
  };

  const resolvedCount = await persistAndResolveObservations([obs]);
  creatureHydrationGuard.clear();
  itemHydrationGuard.clear();

  const region = (params.marketId ?? "us:110").split(":")[0] || "us";
  await ensureItemHydrated(params.itemId, region, params.marketId ?? "us:110");

  return { resolvedCount, dropRate };
}

export interface AddonImportSummary {
  clientBuild: string | null;
  region: string | null;
  creaturesParsed: number;
  observationsSaved: number;
  spawnsSaved: number;
  itemsHydrated: number;
  creatures: Array<{
    npcId: number;
    name: string;
    kills: number;
    measuredKillsPerHour: number | null;
    dropsRecorded: number;
  }>;
}

/**
 * Imports a WoW Forever Farm Optimizer `SavedVariables/WoWForeverFarmOptimizer.lua`
 * file into PostgreSQL as `OBSERVED` (`source = "addon_import"`), updates spawns and
 * raw coin averages, and hydrates live AH prices across all regional houses for newly
 * observed items (including brand-new Forever 250xxx items).
 */
export async function importSavedVariablesToDb(
  luaContent: string,
  preferredMarketId = "us:0"
): Promise<AddonImportSummary> {
  const parsed = parseSavedVariablesLua(luaContent);
  const db = getDb();

  const observations: NormalizedDropObservation[] = [];
  let spawnsSaved = 0;
  const importedItemIds = new Set<number>();

  for (const c of parsed.creatures) {
    if (c.rawCoinCopper > 0 && c.lootedCorpses > 0) {
      const avgCoin = Math.round(c.rawCoinCopper / c.lootedCorpses);
      await db
        .update(schema.creatures)
        .set({
          rawCoinMinCopper: avgCoin,
          rawCoinMaxCopper: avgCoin,
          rawCoinSource: "addon_import",
          updatedAt: new Date(),
        })
        .where(eq(schema.creatures.id, c.npcId));
    }

    if (c.spawns.length > 0) {
      const [exists] = await db
        .select({ id: schema.creatures.id })
        .from(schema.creatures)
        .where(eq(schema.creatures.id, c.npcId))
        .limit(1);
      if (exists) {
        await db.insert(schema.creatureSpawns).values(
          c.spawns.slice(0, 20).map((s) => ({
            creatureId: c.npcId,
            zoneId: null,
            zoneName: null,
            subzone: null,
            x: s.x.toFixed(2),
            y: s.y.toFixed(2),
            source: "addon_import",
            confidenceTier: "OBSERVED" as const,
            sampleSize: c.kills,
          }))
        );
        spawnsSaved += Math.min(20, c.spawns.length);
      }
    }

    for (const drop of c.items) {
      importedItemIds.add(drop.itemId);
      observations.push({
        creatureId: c.npcId,
        itemId: drop.itemId,
        lootMethod: "kill",
        source: "addon_import",
        killsObserved: c.kills,
        dropsObserved: drop.drops,
        totalQtyObserved: drop.totalQty,
        minQty: drop.minQty,
        maxQty: drop.maxQty,
        avgQty: drop.totalQty / drop.drops,
        dropRate: drop.drops / c.kills,
        ciLow: null,
        ciHigh: null,
        reporterCount: 1,
        confidenceTier: "OBSERVED",
        isQuestOnly: false,
        clientBuild: parsed.clientBuild,
        observedAt: parsed.updatedAt,
      });
    }
  }

  const observationsSaved = await persistAndResolveObservations(observations);
  creatureHydrationGuard.clear();
  itemHydrationGuard.clear();

  const region =
    parsed.region && ["us", "eu", "kr", "tw"].includes(parsed.region.toLowerCase())
      ? parsed.region.toLowerCase()
      : preferredMarketId.split(":")[0] || "us";

  // Hydrate live AH prices for up to 25 newly observed items in parallel-safe sequence
  let itemsHydrated = 0;
  for (const itemId of Array.from(importedItemIds).slice(0, 25)) {
    await ensureItemHydrated(itemId, region, preferredMarketId);
    itemsHydrated++;
  }

  return {
    clientBuild: parsed.clientBuild,
    region: parsed.region,
    creaturesParsed: parsed.creatures.length,
    observationsSaved,
    spawnsSaved,
    itemsHydrated,
    creatures: parsed.creatures.map((c) => ({
      npcId: c.npcId,
      name: c.name,
      kills: c.kills,
      measuredKillsPerHour: c.measuredKillsPerHour,
      dropsRecorded: c.items.length,
    })),
  };
}
