import { z } from "zod";
import { fetchValidatedJson, RateLimiter } from "./http";
import type { MarketFaction } from "./types";

const BASE_URL = "https://everlookdb.com";

const everlookAuctionHouseSchema = z.object({
  key: z.string(),
  region: z.string(),
  side: z.string(),
  realm: z.string().nullable().optional(),
  at: z.number().nullable().optional(),
  auctions: z.number().int().nonnegative().optional(),
  versions: z.number().int().nonnegative().optional(),
});

const everlookAuctionsIndexSchema = z.object({
  houses: z.array(everlookAuctionHouseSchema),
});

const everlookHousePayloadSchema = z.object({
  columns: z.array(z.string()),
  meta: z
    .object({
      key: z.string(),
      region: z.string().optional(),
      side: z.string().optional(),
      realm: z.string().nullable().optional(),
      at: z.number().nullable().optional(),
    })
    .optional(),
  rows: z.array(z.array(z.unknown())),
});

const everlookItemAuctionsSchema = z.object({
  id: z.number().int(),
  history_columns: z.array(z.string()).optional(),
  hourly_columns: z.array(z.string()).optional(),
  houses: z.array(
    z.object({
      meta: z.object({
        key: z.string(),
        region: z.string().optional(),
        side: z.string().optional(),
        realm: z.string().nullable().optional(),
        at: z.number().nullable().optional(),
      }),
      rows: z
        .array(
          z.object({
            id: z.number().int(),
            suffix: z.number().int(),
            name: z.string().optional(),
            low: z.number().nullable().optional(),
            p10: z.number().nullable().optional(),
            med: z.number().nullable().optional(),
            qty: z.number().int().nonnegative().default(0),
            n: z.number().int().nonnegative().default(0),
            tl: z.array(z.number().int()).optional(),
          })
        )
        .optional(),
      history: z.record(z.string(), z.array(z.array(z.number().nullable()))).optional(),
      hourly: z.record(z.string(), z.array(z.array(z.number().nullable()))).optional(),
    })
  ),
});

export interface EverlookVariantHouseMeta {
  houseKey: string;
  region: string;
  faction: MarketFaction;
  realmLabel: string | null;
  snapshotAt: Date;
}

export interface NormalizedVariantSnapshotRow {
  variantId: string;
  itemId: number;
  suffixId: number;
  fullName: string;
  suffixName: string;
  houseKey: string;
  region: string;
  faction: MarketFaction;
  realmLabel: string | null;
  lowestBuyoutCopper: number | null;
  p10Copper: number | null;
  medianCopper: number | null;
  clearingPriceCopper: number | null;
  baseReferenceCopper: number | null;
  availableQty: number;
  listingCount: number;
  timeLeftShort: number;
  timeLeftMedium: number;
  timeLeftLong: number;
  timeLeftVeryLong: number;
  snapshotAt: Date;
}

export interface VariantHistoryPoint {
  ts: string;
  minCopper: number | null;
  p10Copper: number | null;
  medianCopper: number | null;
  availableQty: number;
  listingCount: number;
  houseKey: string;
}

export function normalizeEverlookFaction(side: string): MarketFaction {
  const lower = side.toLowerCase();
  if (lower.includes("alliance")) return "alliance";
  if (lower.includes("horde")) return "horde";
  return "neutral";
}

export function extractSuffixLabel(fullName: string, baseName?: string | null): string {
  const trimmed = fullName.trim();
  if (baseName) {
    const baseTrim = baseName.trim();
    if (
      trimmed.length > baseTrim.length &&
      trimmed.toLowerCase().startsWith(baseTrim.toLowerCase())
    ) {
      const rest = trimmed.slice(baseTrim.length).trim();
      if (rest.length > 0) return rest;
    }
  }
  const ofIdx = trimmed.lastIndexOf(" of ");
  if (ofIdx > 0) {
    return trimmed.slice(ofIdx + 1).trim();
  }
  return trimmed;
}

function computeConservativeClearing(
  low: number | null,
  p10: number | null,
  median: number | null
): number | null {
  const robust = [p10, median].filter(
    (v): v is number => v !== null && Number.isFinite(v) && v > 0
  );
  if (robust.length > 0) return Math.round(Math.min(...robust));
  if (low !== null && Number.isFinite(low) && low > 0) return Math.round(low);
  return null;
}

function asNullableInt(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(v);
  return null;
}

export class EverlookDBVariantAdapter {
  public readonly sourceId = "everlookdb_ah" as const;
  private readonly rateLimiter: RateLimiter;
  private readonly fetchImpl?: typeof fetch;

  constructor(options: { maxRps?: number; fetchImpl?: typeof fetch } = {}) {
    const maxRps = options.maxRps ?? 2;
    this.rateLimiter = new RateLimiter(Math.ceil(1000 / Math.max(maxRps, 0.2)));
    this.fetchImpl = options.fetchImpl;
  }

  async fetchHouses(): Promise<EverlookVariantHouseMeta[]> {
    const { data } = await fetchValidatedJson(
      `${BASE_URL}/api/v1/auctions`,
      everlookAuctionsIndexSchema,
      { fetchImpl: this.fetchImpl, timeoutMs: 25_000 },
      this.rateLimiter
    );

    return data.houses.map((h) => ({
      houseKey: h.key,
      region: h.region.toLowerCase(),
      faction: normalizeEverlookFaction(h.side),
      realmLabel: h.realm ?? null,
      snapshotAt: h.at ? new Date(h.at * 1000) : new Date(),
    }));
  }

  async fetchHouseVariants(
    house: EverlookVariantHouseMeta,
    baseNamesByItemId?: ReadonlyMap<number, string>
  ): Promise<NormalizedVariantSnapshotRow[]> {
    const url = `${BASE_URL}/api/v1/auctions/house/${encodeURIComponent(house.houseKey)}`;
    const { data } = await fetchValidatedJson(
      url,
      everlookHousePayloadSchema,
      { fetchImpl: this.fetchImpl, timeoutMs: 45_000 },
      this.rateLimiter
    );

    const col = new Map<string, number>();
    data.columns.forEach((name, idx) => col.set(name, idx));

    const idxId = col.get("id") ?? -1;
    const idxSuffix = col.get("suffix") ?? -1;
    const idxName = col.get("name") ?? -1;
    const idxLow = col.get("low") ?? -1;
    const idxP10 = col.get("p10") ?? -1;
    const idxMedian = col.get("median") ?? -1;
    const idxQty = col.get("qty") ?? -1;
    const idxAuctions = col.get("auctions") ?? -1;
    const idxTimeLeft = col.get("time_left") ?? -1;

    if (idxId < 0 || idxSuffix < 0 || idxName < 0) {
      return [];
    }

    // First pass: capture base (suffix === 0) clearing prices and fallback medians per itemId
    const baseClearingByItem = new Map<number, number>();
    const variantClearingsByItem = new Map<number, number[]>();

    for (const row of data.rows) {
      const itemId = asNullableInt(row[idxId]);
      const suffix = asNullableInt(row[idxSuffix]);
      if (!itemId || suffix === null) continue;

      const low = idxLow >= 0 ? asNullableInt(row[idxLow]) : null;
      const p10 = idxP10 >= 0 ? asNullableInt(row[idxP10]) : null;
      const median = idxMedian >= 0 ? asNullableInt(row[idxMedian]) : null;
      const clearing = computeConservativeClearing(low, p10, median);
      if (clearing === null) continue;

      if (suffix === 0) {
        baseClearingByItem.set(itemId, clearing);
      } else if (suffix > 0) {
        let arr = variantClearingsByItem.get(itemId);
        if (!arr) {
          arr = [];
          variantClearingsByItem.set(itemId, arr);
        }
        arr.push(clearing);
      }
    }

    // Fallback base reference = median across all observed variants of that item in this house
    for (const [itemId, prices] of variantClearingsByItem.entries()) {
      if (!baseClearingByItem.has(itemId) && prices.length > 0) {
        const sorted = [...prices].sort((a, b) => a - b);
        baseClearingByItem.set(itemId, sorted[Math.floor(sorted.length / 2)]!);
      }
    }

    const snapshotAt = data.meta?.at ? new Date(data.meta.at * 1000) : house.snapshotAt;
    const results: NormalizedVariantSnapshotRow[] = [];

    for (const row of data.rows) {
      const itemId = asNullableInt(row[idxId]);
      const suffixId = asNullableInt(row[idxSuffix]);
      const rawName = row[idxName];
      if (!itemId || !suffixId || suffixId <= 0 || typeof rawName !== "string" || !rawName.trim()) {
        continue;
      }

      const fullName = rawName.trim();
      const baseName = baseNamesByItemId?.get(itemId) ?? null;
      const low = idxLow >= 0 ? asNullableInt(row[idxLow]) : null;
      const p10 = idxP10 >= 0 ? asNullableInt(row[idxP10]) : null;
      const median = idxMedian >= 0 ? asNullableInt(row[idxMedian]) : null;
      const clearing = computeConservativeClearing(low, p10, median);
      const qty = Math.max(0, (idxQty >= 0 ? asNullableInt(row[idxQty]) : 0) ?? 0);
      const auctions = Math.max(
        0,
        (idxAuctions >= 0 ? asNullableInt(row[idxAuctions]) : 0) ?? 0
      );
      const tlRaw = idxTimeLeft >= 0 ? row[idxTimeLeft] : null;
      const tl = Array.isArray(tlRaw) ? tlRaw : [];

      results.push({
        variantId: `${itemId}:${suffixId}`,
        itemId,
        suffixId,
        fullName,
        suffixName: extractSuffixLabel(fullName, baseName),
        houseKey: house.houseKey,
        region: house.region,
        faction: house.faction,
        realmLabel: data.meta?.realm ?? house.realmLabel,
        lowestBuyoutCopper: low,
        p10Copper: p10,
        medianCopper: median,
        clearingPriceCopper: clearing,
        baseReferenceCopper: baseClearingByItem.get(itemId) ?? null,
        availableQty: qty,
        listingCount: auctions,
        timeLeftShort: Math.max(0, asNullableInt(tl[0]) ?? 0),
        timeLeftMedium: Math.max(0, asNullableInt(tl[1]) ?? 0),
        timeLeftLong: Math.max(0, asNullableInt(tl[2]) ?? 0),
        timeLeftVeryLong: Math.max(0, asNullableInt(tl[3]) ?? 0),
        snapshotAt,
      });
    }

    return results;
  }

  /**
   * Fetches real daily and hourly historical series for a specific `itemId:suffixId`
   * variant from EverlookDB `/api/v1/auctions/item/{itemId}`.
   */
  async fetchVariantHistory(
    itemId: number,
    suffixId: number,
    preferredHouseKey?: string
  ): Promise<{
    houseKey: string | null;
    daily: VariantHistoryPoint[];
    hourly: VariantHistoryPoint[];
  }> {
    const url = `${BASE_URL}/api/v1/auctions/item/${itemId}`;
    const { data } = await fetchValidatedJson(
      url,
      everlookItemAuctionsSchema,
      { fetchImpl: this.fetchImpl, timeoutMs: 25_000 },
      this.rateLimiter
    );

    const key = `${itemId}:${suffixId}`;
    const histCols = data.history_columns ?? ["day", "low", "median", "qty", "p10", "auctions"];
    const hourCols = data.hourly_columns ?? ["hour", "low", "p10", "median", "qty", "auctions"];

    // Pick preferred house if it has data for this variant, otherwise house with richest history
    const candidates = data.houses
      .map((h) => ({
        houseKey: h.meta.key,
        dailyRaw: h.history?.[key] ?? [],
        hourlyRaw: h.hourly?.[key] ?? [],
      }))
      .filter((c) => c.dailyRaw.length > 0 || c.hourlyRaw.length > 0);

    if (candidates.length === 0) {
      return { houseKey: null, daily: [], hourly: [] };
    }

    const chosen =
      (preferredHouseKey
        ? candidates.find((c) => c.houseKey === preferredHouseKey)
        : undefined) ??
      candidates.sort(
        (a, b) =>
          b.hourlyRaw.length + b.dailyRaw.length - (a.hourlyRaw.length + a.dailyRaw.length)
      )[0]!;

    const mapRows = (
      raw: Array<Array<number | null>>,
      cols: string[],
      unitSeconds: number
    ): VariantHistoryPoint[] => {
      const cIdx = new Map<string, number>();
      cols.forEach((c, i) => cIdx.set(c, i));
      const tIdx = cIdx.get("day") ?? cIdx.get("hour") ?? 0;
      const lowIdx = cIdx.get("low") ?? 1;
      const p10Idx = cIdx.get("p10") ?? -1;
      const medIdx = cIdx.get("median") ?? 2;
      const qtyIdx = cIdx.get("qty") ?? 3;
      const aucIdx = cIdx.get("auctions") ?? 5;

      return raw
        .map((r) => {
          const epochUnit = r[tIdx];
          if (epochUnit === null || epochUnit === undefined || !Number.isFinite(epochUnit)) {
            return null;
          }
          return {
            ts: new Date(epochUnit * unitSeconds * 1000).toISOString(),
            minCopper: r[lowIdx] !== null && r[lowIdx] !== undefined ? Math.round(r[lowIdx]!) : null,
            p10Copper:
              p10Idx >= 0 && r[p10Idx] !== null && r[p10Idx] !== undefined
                ? Math.round(r[p10Idx]!)
                : null,
            medianCopper:
              r[medIdx] !== null && r[medIdx] !== undefined ? Math.round(r[medIdx]!) : null,
            availableQty: Math.max(0, Math.round(r[qtyIdx] ?? 0)),
            listingCount: Math.max(0, Math.round(r[aucIdx] ?? 0)),
            houseKey: chosen.houseKey,
          };
        })
        .filter((x): x is VariantHistoryPoint => x !== null)
        .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
    };

    return {
      houseKey: chosen.houseKey,
      daily: mapRows(chosen.dailyRaw, histCols, 86_400),
      hourly: mapRows(chosen.hourlyRaw, hourCols, 3_600),
    };
  }
}
