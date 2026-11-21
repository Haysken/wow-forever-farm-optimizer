import type {
  ConfidenceTier,
  LootMethod,
  LootProviderId,
  NormalizedDropObservation,
} from "@/providers/types";

export interface ResolvedLootEntry {
  creatureId: number;
  itemId: number;
  lootMethod: LootMethod;
  dropRate: number;
  minQty: number;
  maxQty: number;
  avgQty: number;
  avgQtyIsAssumed: boolean;
  sampleSize: number | null;
  reporterCount: number | null;
  ciLow: number | null;
  ciHigh: number | null;
  confidenceTier: ConfidenceTier;
  source: LootProviderId;
  isQuestOnly: boolean;
  resolvedAt: Date;
}

const CONFIDENCE_RANK: Record<ConfidenceTier, number> = {
  VERIFIED: 4,
  OBSERVED: 3,
  ESTIMATED: 2,
  UNKNOWN: 1,
};

const SOURCE_RANK: Record<LootProviderId, number> = {
  everloot: 4,
  everlookdb_players: 3,
  user_observation: 2,
  classic_db: 1,
};

function compareCandidates(
  a: NormalizedDropObservation,
  b: NormalizedDropObservation
): number {
  const tierDiff = CONFIDENCE_RANK[b.confidenceTier] - CONFIDENCE_RANK[a.confidenceTier];
  if (tierDiff !== 0) return tierDiff;

  const sampleDiff = (b.killsObserved ?? -1) - (a.killsObserved ?? -1);
  if (sampleDiff !== 0) return sampleDiff;

  const reporterDiff = (b.reporterCount ?? -1) - (a.reporterCount ?? -1);
  if (reporterDiff !== 0) return reporterDiff;

  const sourceDiff = SOURCE_RANK[b.source] - SOURCE_RANK[a.source];
  if (sourceDiff !== 0) return sourceDiff;

  return b.observedAt.getTime() - a.observedAt.getTime();
}

/**
 * Resolves multi-source drop observations into a single active loot entry per
 * (creatureId, itemId, lootMethod), strictly prioritizing WoW Forever observed
 * evidence over Classic 1.12 estimates and preventing double-counting.
 */
export function resolveCreatureLoot(
  observations: NormalizedDropObservation[],
  now: Date = new Date()
): ResolvedLootEntry[] {
  const grouped = new Map<string, NormalizedDropObservation[]>();

  for (const obs of observations) {
    if (!Number.isFinite(obs.dropRate) || obs.dropRate < 0 || obs.dropRate > 1) {
      continue;
    }
    const key = `${obs.creatureId}:${obs.itemId}:${obs.lootMethod}`;
    const bucket = grouped.get(key);
    if (bucket) {
      bucket.push(obs);
    } else {
      grouped.set(key, [obs]);
    }
  }

  const resolved: ResolvedLootEntry[] = [];

  for (const candidates of grouped.values()) {
    candidates.sort(compareCandidates);
    const winner = candidates[0];
    if (!winner) continue;

    // If winner has observed dropRate without stack quantity, see if another Forever observed
    // source has real avgQty; never silently copy Classic qty onto Forever verified drops unless absent.
    let avgQty = winner.avgQty;
    let avgQtyIsAssumed = false;
    if (avgQty === null || !Number.isFinite(avgQty) || avgQty <= 0) {
      const siblingWithQty = candidates.find(
        (c) =>
          c.source !== "classic_db" &&
          c.avgQty !== null &&
          Number.isFinite(c.avgQty) &&
          c.avgQty > 0
      );
      if (siblingWithQty && siblingWithQty.avgQty !== null) {
        avgQty = siblingWithQty.avgQty;
      } else {
        avgQty = 1;
        avgQtyIsAssumed = true;
      }
    }

    const minQty = winner.minQty !== null && winner.minQty > 0 ? winner.minQty : 1;
    const maxQty =
      winner.maxQty !== null && winner.maxQty >= minQty
        ? winner.maxQty
        : Math.max(minQty, Math.ceil(avgQty));

    resolved.push({
      creatureId: winner.creatureId,
      itemId: winner.itemId,
      lootMethod: winner.lootMethod,
      dropRate: winner.dropRate,
      minQty,
      maxQty,
      avgQty,
      avgQtyIsAssumed,
      sampleSize: winner.killsObserved,
      reporterCount: winner.reporterCount,
      ciLow: winner.ciLow,
      ciHigh: winner.ciHigh,
      confidenceTier: winner.confidenceTier,
      source: winner.source,
      isQuestOnly: winner.isQuestOnly,
      resolvedAt: now,
    });
  }

  return resolved.sort((a, b) =>
    a.creatureId !== b.creatureId
      ? a.creatureId - b.creatureId
      : a.itemId - b.itemId
  );
}
