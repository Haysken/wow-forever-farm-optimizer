import "dotenv/config";
import { eq, sql } from "drizzle-orm";
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

    const allMarkets = await provider.fetchMarkets(regions);
    const selectedMarkets = allMarkets
      .filter((m) => options.includeUnified || m.faction !== "unified")
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

    for (const market of selectedMarkets) {
      const rawRows = await provider.fetchMarketSnapshot(market);
      const { valid, rejected } = validateMarketRows(
        rawRows,
        knownItemIds.size > 0 ? knownItemIds : undefined
      );
      totalRejected += rejected.length;

      for (let i = 0; i < valid.length; i += 250) {
        const chunk = valid.slice(i, i + 250);
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
              change24hPct:
                r.change24hPct !== null ? r.change24hPct.toFixed(3) : null,
              trend7dPct:
                r.trend7dPct !== null ? r.trend7dPct.toFixed(3) : null,
              trend30dPct:
                r.trend30dPct !== null ? r.trend30dPct.toFixed(3) : null,
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
          errorSummary: error instanceof Error ? error.message : String(error),
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
