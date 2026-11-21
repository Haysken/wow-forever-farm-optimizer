import { z } from "zod";
import { fetchValidatedJson, RateLimiter } from "./http";
import type {
  LootMethod,
  NormalizedDropObservation,
  NormalizedSpawn,
} from "./types";

const BASE_URL = "https://everlookdb.com";

const playerLootItemSchema = z.object({
  id: z.number().int().positive(),
  drops: z.number().int().nonnegative(),
  qty: z.number().int().nonnegative().optional(),
  rate: z.number().min(0).max(1),
});

const playerLootBucketSchema = z.object({
  n: z.number().int().nonnegative().optional(),
  items: z.array(playerLootItemSchema).default([]),
});

const everlookNpcDetailSchema = z.object({
  id: z.number().int().positive(),
  build: z.string().nullable().optional(),
  name: z.string().optional(),
  players: z
    .object({
      loot: z
        .object({
          corpse: playerLootBucketSchema.nullable().optional(),
          skinning: playerLootBucketSchema.nullable().optional(),
          pickpocket: playerLootBucketSchema.nullable().optional(),
        })
        .nullable()
        .optional(),
    })
    .nullable()
    .optional(),
  classic_db: z
    .object({
      at: z.array(z.tuple([z.number().int(), z.number(), z.number()])).optional(),
      at_zones: z.array(z.string()).optional(),
      drops: z
        .array(
          z.union([
            z.tuple([z.number().int().positive(), z.number().min(0).max(1)]),
            z.tuple([
              z.number().int().positive(),
              z.number().min(0).max(1),
              z.number().int(),
            ]),
          ])
        )
        .optional(),
      gold: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]).nullable().optional(),
      hp: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]).nullable().optional(),
    })
    .nullable()
    .optional(),
});

export interface EverlookNpcLootBundle {
  creatureId: number;
  clientBuild: string | null;
  healthMin: number | null;
  healthMax: number | null;
  rawCoinMinCopper: number | null;
  rawCoinMaxCopper: number | null;
  rawCoinSource: string | null;
  spawns: NormalizedSpawn[];
  /** Strictly separated: real WoW Forever player observations (OBSERVED) + Classic 1.12 baseline (ESTIMATED). */
  observations: NormalizedDropObservation[];
}

export interface EverlookDBLootOptions {
  apiKey?: string;
  maxRps?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Fetches per-NPC merged records from EverlookDB, preserving strict separation between:
 * - `players`: real WoW Forever observations (tagged `OBSERVED`, source `everlookdb_players`)
 * - `classic_db`: CMaNGOS Classic 1.12 fallback estimates (tagged `ESTIMATED`, source `classic_db`, GPL-3.0)
 */
export class EverlookDBLootAdapter {
  private readonly rateLimiter: RateLimiter;
  private readonly headers: Record<string, string>;
  private readonly fetchImpl?: typeof fetch;

  constructor(options: EverlookDBLootOptions = {}) {
    const apiKey = options.apiKey?.trim() || process.env.EVERLOOKDB_API_KEY?.trim();
    const defaultRps = apiKey ? 20 : 5;
    const maxRps = options.maxRps ?? defaultRps;
    this.rateLimiter = new RateLimiter(Math.ceil(1000 / Math.max(maxRps, 1)));
    this.headers = apiKey ? { "X-API-Key": apiKey } : {};
    this.fetchImpl = options.fetchImpl;
  }

  async fetchNpcLoot(npcId: number): Promise<EverlookNpcLootBundle> {
    const { data } = await fetchValidatedJson(
      `${BASE_URL}/npc/${npcId}.json`,
      everlookNpcDetailSchema,
      { headers: this.headers, fetchImpl: this.fetchImpl, timeoutMs: 20_000 },
      this.rateLimiter
    );

    const now = new Date();
    const clientBuild = data.build ?? null;
    const observations: NormalizedDropObservation[] = [];

    // 1. Real WoW Forever player observations (OBSERVED)
    const buckets: Array<{
      method: LootMethod;
      bucket: z.infer<typeof playerLootBucketSchema> | null | undefined;
    }> = [
      { method: "kill", bucket: data.players?.loot?.corpse },
      { method: "skinning", bucket: data.players?.loot?.skinning },
      { method: "pickpocket", bucket: data.players?.loot?.pickpocket },
    ];

    for (const { method, bucket } of buckets) {
      if (!bucket?.items) continue;
      for (const item of bucket.items) {
        const avgQty =
          item.qty !== undefined && item.drops > 0
            ? item.qty / item.drops
            : null;
        observations.push({
          creatureId: npcId,
          itemId: item.id,
          lootMethod: method,
          source: "everlookdb_players",
          killsObserved: bucket.n ?? null,
          dropsObserved: item.drops,
          totalQtyObserved: item.qty ?? null,
          minQty: null,
          maxQty: null,
          avgQty,
          dropRate: item.rate,
          ciLow: null,
          ciHigh: null,
          reporterCount: null,
          confidenceTier: "OBSERVED",
          isQuestOnly: false,
          clientBuild,
          observedAt: now,
        });
      }
    }

    // 2. Classic 1.12 fallback baseline (strictly tagged ESTIMATED)
    const classicDrops = data.classic_db?.drops ?? [];
    for (const tuple of classicDrops) {
      const [itemId, chance, questFlag] = tuple;
      observations.push({
        creatureId: npcId,
        itemId,
        lootMethod: "kill",
        source: "classic_db",
        killsObserved: null,
        dropsObserved: null,
        totalQtyObserved: null,
        minQty: null,
        maxQty: null,
        avgQty: null,
        dropRate: chance,
        ciLow: null,
        ciHigh: null,
        reporterCount: null,
        confidenceTier: "ESTIMATED",
        isQuestOnly: questFlag === 1,
        clientBuild,
        observedAt: now,
      });
    }

    // 3. Classic 1.12 spawn coordinates (tagged ESTIMATED)
    const spawns: NormalizedSpawn[] = [];
    const atCoords = data.classic_db?.at ?? [];
    const atZones = data.classic_db?.at_zones ?? [];
    for (let i = 0; i < atCoords.length; i++) {
      const coord = atCoords[i];
      if (!coord) continue;
      const [zoneId, x, y] = coord;
      spawns.push({
        creatureId: npcId,
        zoneId,
        zoneName: atZones[i] ?? null,
        subzone: null,
        x,
        y,
        source: "classic_db",
        confidenceTier: "ESTIMATED",
        sampleSize: null,
      });
    }

    const hp = data.classic_db?.hp ?? null;
    const gold = data.classic_db?.gold ?? null;

    return {
      creatureId: npcId,
      clientBuild,
      healthMin: hp ? hp[0] : null,
      healthMax: hp ? hp[1] : null,
      rawCoinMinCopper: gold ? gold[0] : null,
      rawCoinMaxCopper: gold ? gold[1] : null,
      rawCoinSource: gold ? "classic_db" : null,
      spawns,
      observations,
    };
  }
}
