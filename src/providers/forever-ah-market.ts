import { z } from "zod";
import { fetchValidatedJson, RateLimiter } from "./http";
import type {
  MarketDataProvider,
  MarketFaction,
  NormalizedItemMarketRow,
  NormalizedMarket,
  NormalizedPricePoint,
} from "./types";

const BASE_URL = "https://forever-ah.com";

export const FACTION_AH_COMMISSION = 0.05;
export const NEUTRAL_AH_COMMISSION = 0.15;

// Verified Blizzard WoW Forever house_id faction groupings from forever-ah.com/v1/houses
const ALLIANCE_HOUSE_IDS = new Set([110, 111, 112, 119, 123]);
const HORDE_HOUSE_IDS = new Set([113, 114, 115, 120, 124]);
const NEUTRAL_HOUSE_IDS = new Set([116, 117, 118, 121, 125]);

export function inferFactionFromHouse(house: {
  house_id: number;
  house_type: string;
  name: string;
}): MarketFaction {
  if (house.house_type === "unified" || house.house_id === 0) {
    return "unified";
  }
  if (ALLIANCE_HOUSE_IDS.has(house.house_id)) return "alliance";
  if (HORDE_HOUSE_IDS.has(house.house_id)) return "horde";
  if (NEUTRAL_HOUSE_IDS.has(house.house_id)) return "neutral";

  const lower = house.name.toLowerCase();
  if (lower.includes("alliance")) return "alliance";
  if (lower.includes("horde")) return "horde";
  if (lower.includes("blackwater") || lower.includes("neutral")) return "neutral";
  return "neutral";
}

export function defaultCommissionForFaction(faction: MarketFaction): number {
  return faction === "neutral" ? NEUTRAL_AH_COMMISSION : FACTION_AH_COMMISSION;
}

/**
 * Computes a conservative realistic clearing price in copper from available market
 * statistics without inventing data. Uses the minimum of available robust price points
 * (p10, median, market_value) when present, falling back to lowest buyout.
 */
export function computeClearingPriceCopper(prices: {
  minUnit: number | null;
  p10Unit: number | null;
  medianUnit: number | null;
  marketValue: number | null;
}): number | null {
  const robust = [prices.p10Unit, prices.medianUnit, prices.marketValue].filter(
    (v): v is number => v !== null && Number.isFinite(v) && v > 0
  );
  if (robust.length > 0) {
    return Math.round(Math.min(...robust));
  }
  if (prices.minUnit !== null && Number.isFinite(prices.minUnit) && prices.minUnit > 0) {
    return Math.round(prices.minUnit);
  }
  return null;
}

const foreverAhHouseSchema = z.object({
  house_key: z.number().int(),
  region: z.string(),
  ruleset_id: z.number().int(),
  house_id: z.number().int(),
  name: z.string(),
  last_snapshot: z.string().nullable().optional(),
  house_type: z.string(),
});

const foreverAhMarketRowSchema = z.object({
  item: z.object({
    item_id: z.number().int().positive(),
    name: z.string().optional(),
    sell_price: z.number().nullable().optional(),
  }),
  current: z
    .object({
      ts: z.string(),
      min_unit: z.number().nullable().optional(),
      p10_unit: z.number().nullable().optional(),
      median_unit: z.number().nullable().optional(),
      mean_unit: z.number().nullable().optional(),
      quantity: z.number().int().nonnegative().default(0),
      listings: z.number().int().nonnegative().default(0),
    })
    .nullable()
    .optional(),
  median_change_pct: z.number().nullable().optional(),
  stats: z
    .object({
      market_value: z.number().nullable().optional(),
      historical_value: z.number().nullable().optional(),
      trend_pct: z.number().nullable().optional(),
      days_seen: z.number().int().nonnegative().nullable().optional(),
      sold_per_day: z.number().nonnegative().nullable().optional(),
    })
    .nullable()
    .optional(),
});

const foreverAhMarketResponseSchema = z.object({
  house: foreverAhHouseSchema,
  as_of: z.string().nullable().optional(),
  total: z.number().int().nonnegative(),
  rows: z.array(foreverAhMarketRowSchema),
});

const foreverAhHistoryResponseSchema = z.object({
  resolution: z.enum(["hour", "day"]),
  points: z.array(
    z.object({
      ts: z.string(),
      min_unit: z.number().nullable().optional(),
      p10_unit: z.number().nullable().optional(),
      median_unit: z.number().nullable().optional(),
      mean_unit: z.number().nullable().optional(),
      quantity: z.number().int().nonnegative().default(0),
      listings: z.number().int().nonnegative().default(0),
    })
  ),
});

export interface ForeverAHAdapterOptions {
  maxRps?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Primary MVP market data adapter backed by Forever AH (https://forever-ah.com/v1).
 * Attribution required: "Forever AH" and "Blizzard Battle.net API".
 */
export class ForeverAHMarketAdapter implements MarketDataProvider {
  public readonly sourceId = "forever_ah" as const;
  private readonly rateLimiter: RateLimiter;
  private readonly fetchImpl?: typeof fetch;

  constructor(options: ForeverAHAdapterOptions = {}) {
    const maxRps = options.maxRps ?? Number(process.env.FOREVER_AH_MAX_RPS ?? "1");
    this.rateLimiter = new RateLimiter(Math.ceil(1000 / Math.max(maxRps, 0.2)));
    this.fetchImpl = options.fetchImpl;
  }

  async fetchMarkets(regions?: string[]): Promise<NormalizedMarket[]> {
    const { data } = await fetchValidatedJson(
      `${BASE_URL}/v1/houses`,
      z.array(foreverAhHouseSchema),
      { fetchImpl: this.fetchImpl, timeoutMs: 20_000 },
      this.rateLimiter
    );

    const regionFilter = regions
      ? new Set(regions.map((r) => r.trim().toLowerCase()))
      : null;

    return data
      .filter((h) => !regionFilter || regionFilter.has(h.region.toLowerCase()))
      .map((h) => {
        const region = h.region.toLowerCase();
        const faction = inferFactionFromHouse(h);
        const factionTitle =
          faction === "alliance"
            ? "Alliance"
            : faction === "horde"
              ? "Horde"
              : faction === "neutral"
                ? "Blackwater (Neutral)"
                : "All Auction Houses";

        return {
          id: `${region}:${h.house_id}`,
          region,
          rulesetId: h.ruleset_id,
          // Ruleset name (Normal/PvP/RP/RP-PvP) is intentionally null until verified from Blizzard API
          rulesetLabel: null,
          houseId: h.house_id,
          faction,
          displayName:
            faction === "unified"
              ? `${region.toUpperCase()} — All Auction Houses`
              : `${region.toUpperCase()} House #${h.house_id} — ${factionTitle}`,
          defaultCommissionRate: defaultCommissionForFaction(faction),
          providerSource: this.sourceId,
          providerKey: String(h.house_key),
          lastSnapshotAt: h.last_snapshot ? new Date(h.last_snapshot) : null,
        };
      });
  }

  async fetchMarketSnapshot(
    market: NormalizedMarket,
    options: { maxPages?: number; pageSize?: number } = {}
  ): Promise<NormalizedItemMarketRow[]> {
    const pageSize = Math.min(Math.max(options.pageSize ?? 500, 1), 1000);
    const maxPages = options.maxPages ?? 50;
    const rows: NormalizedItemMarketRow[] = [];

    for (let page = 1; page <= maxPages; page++) {
      const offset = (page - 1) * pageSize;
      const url = `${BASE_URL}/v1/houses/${encodeURIComponent(market.providerKey)}/market?limit=${pageSize}&offset=${offset}`;
      const { data } = await fetchValidatedJson(
        url,
        foreverAhMarketResponseSchema,
        { fetchImpl: this.fetchImpl, timeoutMs: 30_000 },
        this.rateLimiter
      );

      const fallbackTs = data.as_of ? new Date(data.as_of) : new Date();

      for (const row of data.rows) {
        const cur = row.current ?? null;
        const stats = row.stats ?? null;
        const minUnit = cur?.min_unit ?? null;
        const p10Unit = cur?.p10_unit ?? null;
        const medianUnit = cur?.median_unit ?? null;
        const meanUnit = cur?.mean_unit ?? null;
        const marketValue = stats?.market_value ?? null;
        const historicalValue = stats?.historical_value ?? null;
        const clearing = computeClearingPriceCopper({
          minUnit,
          p10Unit,
          medianUnit,
          marketValue,
        });

        const hasSoldPerDay =
          stats?.sold_per_day !== null && stats?.sold_per_day !== undefined;

        rows.push({
          marketId: market.id,
          itemId: row.item.item_id,
          lowestBuyoutCopper: minUnit !== null ? Math.round(minUnit) : null,
          p10Copper: p10Unit !== null ? Math.round(p10Unit) : null,
          medianCopper: medianUnit !== null ? Math.round(medianUnit) : null,
          meanCopper: meanUnit !== null ? Math.round(meanUnit) : null,
          marketValueCopper: marketValue !== null ? Math.round(marketValue) : null,
          historicalValueCopper:
            historicalValue !== null ? Math.round(historicalValue) : null,
          clearingPriceCopper: clearing,
          availableQty: cur?.quantity ?? 0,
          listingCount: cur?.listings ?? 0,
          change24hPct: row.median_change_pct ?? null,
          trend7dPct: stats?.trend_pct ?? null,
          trend30dPct: null,
          estimatedSoldPerDay: hasSoldPerDay ? (stats?.sold_per_day ?? null) : null,
          daysSeen: stats?.days_seen ?? null,
          // Forever AH sold_per_day is algorithmically estimated from snapshot diffs
          salesDataStatus: hasSoldPerDay ? "ESTIMATED" : "MISSING",
          priceStatus: cur ? "ACTUAL" : "MISSING",
          source: this.sourceId,
          snapshotAt: cur?.ts ? new Date(cur.ts) : fallbackTs,
        });
      }

      if (data.rows.length < pageSize || offset + data.rows.length >= data.total) {
        break;
      }
    }

    return rows;
  }

  async fetchItemHistory(
    market: NormalizedMarket,
    itemId: number,
    resolution: "hour" | "day" = "day"
  ): Promise<NormalizedPricePoint[]> {
    const url = `${BASE_URL}/v1/houses/${encodeURIComponent(market.providerKey)}/items/${itemId}/history?resolution=${resolution}`;
    const { data } = await fetchValidatedJson(
      url,
      foreverAhHistoryResponseSchema,
      { fetchImpl: this.fetchImpl, timeoutMs: 20_000 },
      this.rateLimiter
    );

    return data.points.map((pt) => ({
      marketId: market.id,
      itemId,
      resolution: data.resolution,
      bucketTs: new Date(pt.ts),
      minCopper: pt.min_unit !== null && pt.min_unit !== undefined ? Math.round(pt.min_unit) : null,
      p10Copper: pt.p10_unit !== null && pt.p10_unit !== undefined ? Math.round(pt.p10_unit) : null,
      medianCopper:
        pt.median_unit !== null && pt.median_unit !== undefined
          ? Math.round(pt.median_unit)
          : null,
      meanCopper:
        pt.mean_unit !== null && pt.mean_unit !== undefined ? Math.round(pt.mean_unit) : null,
      availableQty: pt.quantity,
      listingCount: pt.listings,
      source: this.sourceId,
    }));
  }
}
