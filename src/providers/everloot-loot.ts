import { z } from "zod";
import { fetchValidatedJson, RateLimiter } from "./http";
import type {
  ConfidenceTier,
  LootObservationProvider,
  NormalizedDropObservation,
} from "./types";

const EVERLOOT_DROPS_URL = "https://everloot.app/api/rollups/drops";

const everlootRateRowSchema = z.object({
  sourceNpcId: z.number().int().positive().nullable().optional(),
  sourceObjectId: z.number().int().positive().nullable().optional(),
  itemId: z.number().int().positive(),
  kills: z.number().int().nonnegative(),
  drops: z.number().int().nonnegative(),
  rate: z.number().min(0).max(1),
  rateLow: z.number().min(0).max(1).nullable().optional(),
  rateHigh: z.number().min(0).max(1).nullable().optional(),
  reporters: z.number().int().nonnegative(),
  tier: z.string(),
  public: z.boolean().optional(),
  settled: z.boolean().optional(),
  sourceName: z.string().nullable().optional(),
  sourceNameTier: z.string().nullable().optional(),
});

const everlootDropsResponseSchema = z.object({
  generatedAt: z.string(),
  dataAsOf: z.string(),
  unreachable: z.boolean().optional(),
  stats: z
    .object({
      uploads: z.number().int().nonnegative(),
      lootWindows: z.number().int().nonnegative(),
      records: z.number().int().nonnegative(),
    })
    .optional(),
  rates: z.array(everlootRateRowSchema),
});

export function classifyEverlootConfidence(row: {
  tier: string;
  reporters: number;
  kills: number;
  settled?: boolean;
}): ConfidenceTier {
  const tier = row.tier.toLowerCase();
  if (row.kills < 10) {
    return "OBSERVED";
  }
  if (
    (tier === "confirmed" || row.settled === true) &&
    row.reporters >= 3 &&
    row.kills >= 30
  ) {
    return "VERIFIED";
  }
  return "OBSERVED";
}

export interface EverlootLootOptions {
  fetchImpl?: typeof fetch;
}

/**
 * Primary adapter for real WoW Forever player-observed drop rates from Everloot
 * (CC BY-SA 4.0 observed data).
 *
 * Note: Everloot's rollup endpoint reports loot-window drop rates (windows with item / total kills)
 * without stack quantity per drop; `avgQty` is therefore left null here so the loot resolver
 * explicitly marks whether `avgQty = 1` was assumed or enriched by another Forever observed source.
 */
export class EverlootLootAdapter implements LootObservationProvider {
  public readonly sourceId = "everloot" as const;
  private readonly rateLimiter = new RateLimiter(500);
  private readonly fetchImpl?: typeof fetch;

  constructor(options: EverlootLootOptions = {}) {
    this.fetchImpl = options.fetchImpl;
  }

  async fetchDrops(): Promise<{
    dataAsOf: Date;
    observations: NormalizedDropObservation[];
    skippedNonCreatureRows: number;
  }> {
    const { data } = await fetchValidatedJson(
      EVERLOOT_DROPS_URL,
      everlootDropsResponseSchema,
      { fetchImpl: this.fetchImpl, timeoutMs: 25_000 },
      this.rateLimiter
    );

    const dataAsOf = new Date(data.dataAsOf);
    const observations: NormalizedDropObservation[] = [];
    let skippedNonCreatureRows = 0;

    for (const row of data.rates) {
      if (!row.sourceNpcId) {
        // Object/chest/gathering node rows are excluded from creature loot tables
        skippedNonCreatureRows++;
        continue;
      }

      if (row.kills <= 0 || row.drops > row.kills) {
        continue;
      }

      observations.push({
        creatureId: row.sourceNpcId,
        itemId: row.itemId,
        lootMethod: "kill",
        source: this.sourceId,
        killsObserved: row.kills,
        dropsObserved: row.drops,
        totalQtyObserved: null,
        minQty: null,
        maxQty: null,
        avgQty: null,
        dropRate: row.rate,
        ciLow: row.rateLow ?? null,
        ciHigh: row.rateHigh ?? null,
        reporterCount: row.reporters,
        confidenceTier: classifyEverlootConfidence(row),
        isQuestOnly: false,
        clientBuild: null,
        observedAt: dataAsOf,
      });
    }

    return {
      dataAsOf,
      observations,
      skippedNonCreatureRows,
    };
  }
}
