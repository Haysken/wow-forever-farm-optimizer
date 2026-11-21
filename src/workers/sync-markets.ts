import { truncateError } from "@/lib/cache";
import { loadLocalEnv } from "@/lib/env";
import { eq, sql } from "drizzle-orm";

loadLocalEnv();
import { closeDb, getDb, schema } from "@/db";
import { validateMarketRows } from "@/ingestion/validators";
import { BlizzardMarketAdapter } from "@/providers/blizzard-market";
import { ForeverAHMarketAdapter } from "@/providers/forever-ah-market";
import type { MarketDataProvider } from "@/providers/types";

export interface SyncMarketsOptions {
  regions?: string[];
  includeUnified?: boolean;
  maxHouses?: number;
  provider?: MarketDataProvider;
}

const QUALITY_TO_CODE: Record<string, number> = {
  POOR: 0,
  COMMON: 1,
  UNCOMMON: 2,
  RARE: 3,
  EPIC: 4,
  LEGENDARY: 5,
  ARTIFACT: 6,
  HEIRLOOM: 7,
};

function clampPct(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  const clamped = Math.min(99_999.999, Math.max(-9_999.999, value));
  return clamped.toFixed(3);
}

export async function runMarketSync(options: SyncMarketsOptions = {}): Promise<{
  provider: string;
  marketsSynced: number;
  itemSnapshotsUpserted: number;
  rowsRejected: number;
}> {
  const db = getDb();
  const regions =
    options.regions ??
    (process.env.SYNC_REGIONS ?? "us,eu")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

  const blizzard = new BlizzardMarketAdapter();
  const provider: MarketDataProvider =
    options.provider ??
    (process.env.USE_BLIZZARD_PRIMARY === "1" && blizzard.isConfigured()
      ? blizzard
      : new ForeverAHMarketAdapter());

  const [run] = await db
    .insert(schema.syncRuns)
    .values({
      provider: provider.sourceId,
      jobType: "market_snapshot",
      status: "running",
    })
    .returning();

  const runId = run?.id;

  try {
    const itemRows = await db.select({ id: schema.items.id }).from(schema.items);
    const knownItemIds = new Set(itemRows.map((r) => r.id));

    const houseFilter = process.env.SYNC_HOUSE_IDS
      ? new Set(
          process.env.SYNC_HOUSE_IDS.split(",")
            .map((s) => Number(s.trim()))
            .filter((n) => Number.isInteger(n))
        )
      : null;

    const allMarkets = await provider.fetchMarkets(regions);
    const includeUnified = options.includeUnified ?? true;
    const selectedMarkets = allMarkets
      .filter((m) => includeUnified || m.faction !== "unified")
      .filter((m) => !houseFilter || houseFilter.has(m.houseId))
      .slice(0, options.maxHouses ?? allMarkets.length);

    for (const m of selectedMarkets) {
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
            rulesetLabel: sql`coalesce(excluded.ruleset_label, ${schema.ahMarkets.rulesetLabel})`,
            displayName: sql`excluded.display_name`,
            providerSource: sql`excluded.provider_source`,
            providerKey: sql`excluded.provider_key`,
            lastSnapshotAt: sql`excluded.last_snapshot_at`,
            updatedAt: new Date(),
          },
        });
    }

    let totalUpserted = 0;
    let totalRejected = 0;

    // Optional fast mode: sync only items that drop from known creatures when SYNC_LOOT_ITEMS_ONLY=1
    let targetItemIds: number[] | undefined;
    if (process.env.SYNC_LOOT_ITEMS_ONLY === "1") {
      const lootItems = await db
        .selectDistinct({ itemId: schema.creatureLootResolved.itemId })
        .from(schema.creatureLootResolved);
      targetItemIds = lootItems.map((r) => r.itemId);
    }

    for (const market of selectedMarkets) {
      const rawRows = await provider.fetchMarketSnapshot(market, {
        itemIds: targetItemIds,
      });

      // Auto-register any brand-new WoW Forever item present on the live AH that is not yet in catalog
      const missingCatalogItems = rawRows.filter(
        (r) => !knownItemIds.has(r.itemId) && r.itemMeta?.name
      );
      if (missingCatalogItems.length > 0) {
        const uniqueNew = Array.from(
          new Map(missingCatalogItems.map((r) => [r.itemId, r])).values()
        );
        for (let i = 0; i < uniqueNew.length; i += 200) {
          const chunk = uniqueNew.slice(i, i + 200);
          await db
            .insert(schema.items)
            .values(
              chunk.map((r) => {
                const qName = (r.itemMeta?.quality ?? "COMMON").toUpperCase();
                return {
                  id: r.itemId,
                  name: r.itemMeta!.name,
                  quality: QUALITY_TO_CODE[qName] ?? 1,
                  qualityName: qName,
                  itemClass: r.itemMeta?.itemClass ?? null,
                  itemSubclass: r.itemMeta?.itemSubclass ?? null,
                  itemLevel: r.itemMeta?.itemLevel ?? null,
                  requiredLevel: r.itemMeta?.requiredLevel ?? null,
                  bindType: "none" as const,
                  vendorSellCopper: r.itemMeta?.vendorSellCopper ?? 0,
                  vendorBuyCopper: 0,
                  maxStack: 1,
                  isCommodity: r.itemMeta?.itemClass === "Trade Goods" || r.itemMeta?.itemClass === "Consumable",
                  iconId: null,
                  iconUrl: `https://forever-ah.com/v1/items/${r.itemId}/icon`,
                  description: null,
                  foreverStatus: r.itemId >= 200_000 ? "new" : "unknown",
                  source: provider.sourceId,
                  clientBuild: null,
                  updatedAt: new Date(),
                };
              })
            )
            .onConflictDoNothing();
          for (const r of chunk) {
            knownItemIds.add(r.itemId);
          }
        }
      }

      const { valid, rejected } = validateMarketRows(
        rawRows,
        knownItemIds.size > 0 ? knownItemIds : undefined
      );
      totalRejected += rejected.length;

      const dedupedValid = Array.from(
        new Map(valid.map((r) => [r.itemId, r])).values()
      );

      for (let i = 0; i < dedupedValid.length; i += 250) {
        const chunk = dedupedValid.slice(i, i + 250);
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
              marketValueCopper: sql`excluded.market_value_copper`,
              historicalValueCopper: sql`excluded.historical_value_copper`,
              clearingPriceCopper: sql`excluded.clearing_price_copper`,
              availableQty: sql`excluded.available_qty`,
              listingCount: sql`excluded.listing_count`,
              change24hPct: sql`excluded.change_24h_pct`,
              trend7dPct: sql`excluded.trend_7d_pct`,
              priceStatus: sql`excluded.price_status`,
              source: sql`excluded.source`,
              snapshotAt: sql`excluded.snapshot_at`,
            },
          });

        await db
          .insert(schema.itemSalesEstimates)
          .values(
            chunk.map((r) => ({
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
              source: sql`excluded.source`,
              computedAt: sql`excluded.computed_at`,
            },
          });

        totalUpserted += chunk.length;
      }
    }

    if (runId) {
      await db
        .update(schema.syncRuns)
        .set({
          status: totalRejected > 0 ? "partial" : "succeeded",
          recordsProcessed: totalUpserted,
          recordsFailed: totalRejected,
          finishedAt: new Date(),
        })
        .where(eq(schema.syncRuns.id, runId));
    }

    return {
      provider: provider.sourceId,
      marketsSynced: selectedMarkets.length,
      itemSnapshotsUpserted: totalUpserted,
      rowsRejected: totalRejected,
    };
  } catch (error) {
    if (runId) {
      await db
        .update(schema.syncRuns)
        .set({
          status: "failed",
          errorSummary: truncateError(error, 500),
          finishedAt: new Date(),
        })
        .where(eq(schema.syncRuns.id, runId));
    }
    throw error;
  }
}

const isMain = process.argv[1]?.endsWith("sync-markets.ts");
if (isMain) {
  runMarketSync()
    .then((res) => {
      console.log("[sync:markets] completed:", res);
    })
    .catch((err) => {
      console.error("[sync:markets] failed:", err);
      process.exitCode = 1;
    })
    .finally(() => closeDb());
}
