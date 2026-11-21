import { z } from "zod";
import { fetchValidatedJson, RateLimiter } from "./http";
import {
  computeClearingPriceCopper,
  defaultCommissionForFaction,
  inferFactionFromHouse,
} from "./forever-ah-market";
import type {
  MarketDataProvider,
  NormalizedItemMarketRow,
  NormalizedMarket,
} from "./types";

const OAUTH_TOKEN_URL = "https://oauth.battle.net/token";

const oauthTokenSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string(),
  expires_in: z.number().positive(),
});

const rulesetIndexSchema = z.object({
  rulesets: z.array(
    z.object({
      id: z.number().int(),
      name: z.union([z.string(), z.record(z.string())]).optional(),
    })
  ),
});

const auctionHouseIndexSchema = z.object({
  auctions: z.array(
    z.object({
      id: z.number().int(),
      name: z.union([z.string(), z.record(z.string())]).optional(),
    })
  ),
});

const blizzardAuctionEntrySchema = z.object({
  id: z.number().int(),
  item: z.object({
    id: z.number().int().positive(),
  }),
  quantity: z.number().int().positive().default(1),
  unit_price: z.number().nonnegative().optional(),
  buyout: z.number().nonnegative().optional(),
  bid: z.number().nonnegative().optional(),
});

const blizzardAuctionsPayloadSchema = z.object({
  auctions: z.array(blizzardAuctionEntrySchema).default([]),
});

function extractLocalizedName(
  raw: string | Record<string, string> | undefined,
  fallback: string
): string {
  if (!raw) return fallback;
  if (typeof raw === "string") return raw;
  return raw.en_US ?? raw.en_GB ?? Object.values(raw)[0] ?? fallback;
}

export interface RawListingUnit {
  itemId: number;
  unitPriceCopper: number;
  quantity: number;
}

/**
 * Aggregates raw Blizzard auction/commodity listings into quantity-weighted market statistics
 * (min, p10, median, mean, total quantity, listing count).
 */
export function aggregateBlizzardListings(
  marketId: string,
  listings: RawListingUnit[],
  snapshotAt: Date
): NormalizedItemMarketRow[] {
  const byItem = new Map<number, Array<{ price: number; qty: number }>>();

  for (const entry of listings) {
    if (entry.unitPriceCopper <= 0 || entry.quantity <= 0) continue;
    const bucket = byItem.get(entry.itemId);
    if (bucket) {
      bucket.push({ price: entry.unitPriceCopper, qty: entry.quantity });
    } else {
      byItem.set(entry.itemId, [{ price: entry.unitPriceCopper, qty: entry.quantity }]);
    }
  }

  const results: NormalizedItemMarketRow[] = [];

  for (const [itemId, entries] of byItem.entries()) {
    entries.sort((a, b) => a.price - b.price);
    let totalQty = 0;
    let weightedSum = 0;
    for (const e of entries) {
      totalQty += e.qty;
      weightedSum += e.price * e.qty;
    }

    const quantilePrice = (q: number): number => {
      const target = Math.max(1, Math.ceil(totalQty * q));
      let acc = 0;
      for (const e of entries) {
        acc += e.qty;
        if (acc >= target) return e.price;
      }
      return entries[entries.length - 1]!.price;
    };

    const minUnit = entries[0]!.price;
    const p10Unit = quantilePrice(0.1);
    const medianUnit = quantilePrice(0.5);
    const meanUnit = Math.round(weightedSum / totalQty);

    results.push({
      marketId,
      itemId,
      lowestBuyoutCopper: Math.round(minUnit),
      p10Copper: Math.round(p10Unit),
      medianCopper: Math.round(medianUnit),
      meanCopper: meanUnit,
      marketValueCopper: null,
      historicalValueCopper: null,
      clearingPriceCopper: computeClearingPriceCopper({
        minUnit,
        p10Unit,
        medianUnit,
        marketValue: null,
      }),
      availableQty: totalQty,
      listingCount: entries.length,
      change24hPct: null,
      trend7dPct: null,
      trend30dPct: null,
      // Official Blizzard API does not expose sales velocity
      estimatedSoldPerDay: null,
      daysSeen: null,
      salesDataStatus: "MISSING",
      priceStatus: "ACTUAL",
      source: "blizzard_api",
      snapshotAt,
    });
  }

  return results;
}

export interface BlizzardMarketOptions {
  clientId?: string;
  clientSecret?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Canonical first-party Blizzard Battle.net Game Data API adapter for WoW Forever ruleset auctions.
 * Requires server-side BLIZZARD_CLIENT_ID and BLIZZARD_CLIENT_SECRET.
 */
export class BlizzardMarketAdapter implements MarketDataProvider {
  public readonly sourceId = "blizzard_api" as const;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly fetchImpl?: typeof fetch;
  private readonly rateLimiter = new RateLimiter(100);
  private cachedToken: { token: string; expiresAtMs: number } | null = null;

  constructor(options: BlizzardMarketOptions = {}) {
    this.clientId =
      options.clientId?.trim() ?? process.env.BLIZZARD_CLIENT_ID?.trim() ?? "";
    this.clientSecret =
      options.clientSecret?.trim() ?? process.env.BLIZZARD_CLIENT_SECRET?.trim() ?? "";
    this.fetchImpl = options.fetchImpl;
  }

  isConfigured(): boolean {
    return this.clientId.length > 0 && this.clientSecret.length > 0;
  }

  private assertConfigured(): void {
    if (!this.isConfigured()) {
      throw new Error(
        "Blizzard API credentials are not configured. Set BLIZZARD_CLIENT_ID and BLIZZARD_CLIENT_SECRET in .env.local."
      );
    }
  }

  async getAccessToken(): Promise<string> {
    this.assertConfigured();
    if (this.cachedToken && Date.now() < this.cachedToken.expiresAtMs - 60_000) {
      return this.cachedToken.token;
    }

    const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64");
    const { data } = await fetchValidatedJson(
      OAUTH_TOKEN_URL,
      oauthTokenSchema,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${credentials}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
        fetchImpl: this.fetchImpl,
      },
      this.rateLimiter
    );

    this.cachedToken = {
      token: data.access_token,
      expiresAtMs: Date.now() + data.expires_in * 1000,
    };
    return data.access_token;
  }

  async fetchMarkets(regions: string[] = ["us", "eu"]): Promise<NormalizedMarket[]> {
    const token = await this.getAccessToken();
    const markets: NormalizedMarket[] = [];

    for (const regionRaw of regions) {
      const region = regionRaw.toLowerCase();
      const namespace = `dynamic-forever-${region}`;
      const base = `https://${region}.api.blizzard.com`;

      const { data: rulesetIdx } = await fetchValidatedJson(
        `${base}/data/wow/ruleset/index?namespace=${namespace}&locale=en_US`,
        rulesetIndexSchema,
        {
          headers: { Authorization: `Bearer ${token}` },
          fetchImpl: this.fetchImpl,
        },
        this.rateLimiter
      );

      for (const rs of rulesetIdx.rulesets) {
        const rulesetLabel = extractLocalizedName(rs.name, `Ruleset ${rs.id}`);
        // Trailing slash is required by Blizzard's WoW Forever ruleset auctions endpoint
        const { data: houseIdx } = await fetchValidatedJson(
          `${base}/data/wow/ruleset/${rs.id}/auctions/?namespace=${namespace}&locale=en_US`,
          auctionHouseIndexSchema,
          {
            headers: { Authorization: `Bearer ${token}` },
            fetchImpl: this.fetchImpl,
          },
          this.rateLimiter
        );

        for (const h of houseIdx.auctions) {
          const houseName = extractLocalizedName(h.name, `House ${h.id}`);
          const faction = inferFactionFromHouse({
            house_id: h.id,
            house_type: "real",
            name: houseName,
          });
          markets.push({
            id: `${region}:${h.id}`,
            region,
            rulesetId: rs.id,
            rulesetLabel,
            houseId: h.id,
            faction,
            displayName: `${region.toUpperCase()} ${rulesetLabel} — ${houseName}`,
            defaultCommissionRate: defaultCommissionForFaction(faction),
            providerSource: this.sourceId,
            providerKey: `${region}:${rs.id}:${h.id}`,
            lastSnapshotAt: null,
          });
        }
      }
    }

    return markets;
  }

  async fetchMarketSnapshot(market: NormalizedMarket): Promise<NormalizedItemMarketRow[]> {
    const token = await this.getAccessToken();
    const region = market.region.toLowerCase();
    const namespace = `dynamic-forever-${region}`;
    const base = `https://${region}.api.blizzard.com`;
    const authHeader = { Authorization: `Bearer ${token}` };

    const [gearRes, commoditiesRes] = await Promise.all([
      fetchValidatedJson(
        `${base}/data/wow/ruleset/${market.rulesetId}/auctions/${market.houseId}?namespace=${namespace}`,
        blizzardAuctionsPayloadSchema,
        { headers: authHeader, fetchImpl: this.fetchImpl, timeoutMs: 45_000 },
        this.rateLimiter
      ),
      fetchValidatedJson(
        `${base}/data/wow/ruleset/${market.rulesetId}/auctions/${market.houseId}/commodities?namespace=${namespace}`,
        blizzardAuctionsPayloadSchema,
        { headers: authHeader, fetchImpl: this.fetchImpl, timeoutMs: 45_000 },
        this.rateLimiter
      ),
    ]);

    const listings: RawListingUnit[] = [];
    for (const a of [...gearRes.data.auctions, ...commoditiesRes.data.auctions]) {
      const unitPrice =
        a.unit_price ??
        (a.buyout !== undefined && a.buyout > 0
          ? Math.round(a.buyout / Math.max(a.quantity, 1))
          : 0);
      if (unitPrice > 0) {
        listings.push({
          itemId: a.item.id,
          unitPriceCopper: unitPrice,
          quantity: a.quantity,
        });
      }
    }

    return aggregateBlizzardListings(market.id, listings, new Date());
  }
}
