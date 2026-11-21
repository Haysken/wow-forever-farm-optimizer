import { z } from "zod";
import { fetchValidatedJson, RateLimiter } from "./http";
import type {
  BindType,
  CatalogProvider,
  NormalizedCreature,
  NormalizedItem,
  NormalizedZone,
} from "./types";

const BASE_URL = "https://everlookdb.com";

const QUALITY_MAP: Record<string, { code: number; label: string }> = {
  poor: { code: 0, label: "POOR" },
  common: { code: 1, label: "COMMON" },
  uncommon: { code: 2, label: "UNCOMMON" },
  rare: { code: 3, label: "RARE" },
  epic: { code: 4, label: "EPIC" },
  legendary: { code: 5, label: "LEGENDARY" },
  artifact: { code: 6, label: "ARTIFACT" },
  heirloom: { code: 7, label: "HEIRLOOM" },
};

const COMMODITY_CATEGORIES = new Set([
  "Trade Goods",
  "Consumable",
  "Reagent",
  "Projectile",
  "Gem",
]);

function normalizeQuality(raw: string | number | null | undefined): {
  code: number;
  label: string;
} {
  if (typeof raw === "number" && Number.isInteger(raw) && raw >= 0 && raw <= 7) {
    const entry = Object.values(QUALITY_MAP).find((q) => q.code === raw);
    return entry ?? { code: raw, label: "UNKNOWN" };
  }
  if (typeof raw === "string") {
    const entry = QUALITY_MAP[raw.trim().toLowerCase()];
    if (entry) return entry;
  }
  return { code: 1, label: "COMMON" };
}

function normalizeBindType(raw: string | number | null | undefined): BindType {
  if (typeof raw === "number") {
    if (raw === 1) return "bop";
    if (raw === 2) return "boe";
    if (raw === 3) return "bou";
    if (raw === 4) return "quest";
    return "none";
  }
  const s = (raw ?? "").toString().trim().toLowerCase();
  if (s === "bop" || s === "pickup" || s === "binds when picked up") return "bop";
  if (s === "boe" || s === "equip" || s === "binds when equipped") return "boe";
  if (s === "bou" || s === "use" || s === "binds when used") return "bou";
  if (s === "quest" || s === "quest item") return "quest";
  return "none";
}

const everlookZoneRowSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  continent: z.string().nullable().optional(),
  faction: z.string().nullable().optional(),
  kind: z.string().nullable().optional(),
  min_level: z.number().int().nullable().optional(),
  max_level: z.number().int().nullable().optional(),
});

const everlookZonesEnvelopeSchema = z.object({
  build: z.string().nullable().optional(),
  data: z.array(everlookZoneRowSchema),
});

const everlookItemRowSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  quality: z.union([z.string(), z.number()]).nullable().optional(),
  category: z.string().nullable().optional(),
  type: z.string().nullable().optional(),
  ilvl: z.number().int().nullable().optional(),
  reqlevel: z.number().int().nullable().optional(),
  binds: z.union([z.string(), z.number()]).nullable().optional(),
  sell: z.number().nullable().optional(),
  buy: z.number().nullable().optional(),
  stack: z.number().int().nullable().optional(),
  icon: z.number().int().nullable().optional(),
  description: z.string().nullable().optional(),
  internal: z.number().int().nullable().optional(),
});

const everlookItemsEnvelopeSchema = z.object({
  build: z.string().nullable().optional(),
  data: z.array(everlookItemRowSchema),
});

const everlookNpcRowSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  level: z.number().int().nullable().optional(),
  maxlevel: z.number().int().nullable().optional(),
  type: z.string().nullable().optional(),
  family: z.string().nullable().optional(),
  classification: z.string().nullable().optional(),
  zone: z.string().nullable().optional(),
  internal: z.number().int().nullable().optional(),
});

const everlookNpcsEnvelopeSchema = z.object({
  build: z.string().nullable().optional(),
  data: z.array(everlookNpcRowSchema),
});

export interface EverlookDBCatalogOptions {
  apiKey?: string;
  maxRps?: number;
  fetchImpl?: typeof fetch;
}

export class EverlookDBCatalogAdapter implements CatalogProvider {
  public readonly sourceId = "everlookdb" as const;
  private readonly rateLimiter: RateLimiter;
  private readonly headers: Record<string, string>;
  private readonly fetchImpl?: typeof fetch;

  constructor(options: EverlookDBCatalogOptions = {}) {
    const apiKey = options.apiKey?.trim() || process.env.EVERLOOKDB_API_KEY?.trim();
    const defaultRps = apiKey ? 20 : 5;
    const maxRps = options.maxRps ?? defaultRps;
    this.rateLimiter = new RateLimiter(Math.ceil(1000 / Math.max(maxRps, 1)));
    this.headers = apiKey ? { "X-API-Key": apiKey } : {};
    this.fetchImpl = options.fetchImpl;
  }

  async fetchZones(): Promise<{ build: string | null; zones: NormalizedZone[] }> {
    const { data } = await fetchValidatedJson(
      `${BASE_URL}/downloads/zones.json`,
      everlookZonesEnvelopeSchema,
      { headers: this.headers, fetchImpl: this.fetchImpl, timeoutMs: 30_000 },
      this.rateLimiter
    );

    const build = data.build ?? null;
    const zones: NormalizedZone[] = data.data.map((zRow) => {
      const kind = (zRow.kind ?? "zone").toLowerCase();
      return {
        id: zRow.id,
        name: zRow.name,
        continent: zRow.continent && zRow.continent.length > 0 ? zRow.continent : null,
        faction: zRow.faction && zRow.faction.length > 0 ? zRow.faction : null,
        kind,
        minLevel: zRow.min_level ?? null,
        maxLevel: zRow.max_level ?? null,
        isInstance: kind === "dungeon" || kind === "raid" || kind === "instance",
        source: this.sourceId,
        clientBuild: build,
      };
    });

    return { build, zones };
  }

  async fetchItems(): Promise<{ build: string | null; items: NormalizedItem[] }> {
    const { data } = await fetchValidatedJson(
      `${BASE_URL}/downloads/items.json`,
      everlookItemsEnvelopeSchema,
      { headers: this.headers, fetchImpl: this.fetchImpl, timeoutMs: 60_000 },
      this.rateLimiter
    );

    const build = data.build ?? null;
    const items: NormalizedItem[] = data.data
      .filter((row) => (row.internal ?? 0) === 0)
      .map((row) => {
        const q = normalizeQuality(row.quality);
        const bindType = normalizeBindType(row.binds);
        const maxStack = row.stack && row.stack > 0 ? row.stack : 1;
        const itemClass = row.category && row.category.length > 0 ? row.category : null;
        const isCommodity =
          bindType !== "bop" &&
          bindType !== "quest" &&
          (maxStack > 1 || (itemClass !== null && COMMODITY_CATEGORIES.has(itemClass)));

        return {
          id: row.id,
          name: row.name,
          quality: q.code,
          qualityName: q.label,
          itemClass,
          itemSubclass: row.type && row.type.length > 0 ? row.type : null,
          itemLevel: row.ilvl ?? null,
          requiredLevel: row.reqlevel ?? null,
          bindType,
          vendorSellCopper: Math.max(0, Math.round(row.sell ?? 0)),
          vendorBuyCopper: Math.max(0, Math.round(row.buy ?? 0)),
          maxStack,
          isCommodity,
          iconId: row.icon && row.icon > 0 ? row.icon : null,
          iconUrl: `https://forever-ah.com/v1/items/${row.id}/icon`,
          description: row.description && row.description.length > 0 ? row.description : null,
          foreverStatus: null,
          source: this.sourceId,
          clientBuild: build,
        };
      });

    return { build, items };
  }

  async fetchCreatures(): Promise<{ build: string | null; creatures: NormalizedCreature[] }> {
    const { data } = await fetchValidatedJson(
      `${BASE_URL}/downloads/npcs.json`,
      everlookNpcsEnvelopeSchema,
      { headers: this.headers, fetchImpl: this.fetchImpl, timeoutMs: 45_000 },
      this.rateLimiter
    );

    const build = data.build ?? null;
    const creatures: NormalizedCreature[] = data.data
      .filter((row) => (row.internal ?? 0) === 0)
      .map((row) => {
        const minLevel = row.level && row.level > 0 ? row.level : null;
        const maxLevel =
          row.maxlevel && row.maxlevel > 0 ? row.maxlevel : minLevel;

        return {
          id: row.id,
          name: row.name,
          minLevel,
          maxLevel,
          creatureType: row.type && row.type.length > 0 ? row.type : null,
          creatureFamily: row.family && row.family.length > 0 ? row.family : null,
          classification:
            row.classification && row.classification.length > 0
              ? row.classification.toLowerCase()
              : "normal",
          factionRestriction: null,
          healthMin: null,
          healthMax: null,
          primaryZoneName: row.zone && row.zone.length > 0 ? row.zone : null,
          rawCoinMinCopper: null,
          rawCoinMaxCopper: null,
          rawCoinSource: null,
          source: this.sourceId,
          clientBuild: build,
        };
      });

    return { build, creatures };
  }
}
