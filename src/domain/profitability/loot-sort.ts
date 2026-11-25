import type { ConfidenceTier } from "@/providers/types";
import { computeDropProbabilityMetrics } from "./probabilities";

export type LootSortColumn =
  | "item"
  | "dropRate"
  | "avgQty"
  | "channel"
  | "unitPrice"
  | "liquidity"
  | "k50"
  | "evPerKill"
  | "provenance";

export type SortDirection = "asc" | "desc";

export interface SortableLootItem {
  itemId: number;
  variantId?: string | null;
  suffixId?: number | null;
  suffixName?: string | null;
  variantCountForBase?: number | null;
  variantPriceNote?: string | null;
  itemName: string;
  quality: number;
  lootMethod: string;
  dropRate: number;
  avgQty: number;
  avgQtyIsAssumed: boolean;
  liquidationChannel: string;
  unitGrossCopper: number;
  effectiveCommissionRate: number;
  expectedGrossEvPerKillCopper: number;
  expectedLiquidityAdjustedPerKillCopper: number;
  confidenceTier: ConfidenceTier;
  sampleSize: number | null;
  source: string;
  liquidity: {
    score: number | null;
    sellingProbability: number | null;
    status: "ESTIMATED" | "UNKNOWN";
  };
  dropMetrics: {
    expectedKillsPerDrop: number | null;
    killsFor50Pct: number | null;
    killsFor90Pct: number | null;
  };
  /** Populated when multiple random-enchant variants are collapsed into 1 base item row */
  collapsedVariantCount?: number;
  collapsedMaxUnitCopper?: number;
}

const CHANNEL_RANK: Record<string, number> = {
  auction_house: 3,
  vendor: 2,
  none: 1,
};

const CONFIDENCE_RANK: Record<ConfidenceTier, number> = {
  VERIFIED: 4,
  OBSERVED: 3,
  ESTIMATED: 2,
  UNKNOWN: 1,
};

export function defaultDirectionForLootColumn(
  column: LootSortColumn
): SortDirection {
  return column === "item" || column === "k50" ? "asc" : "desc";
}

function liquidityRank(item: SortableLootItem): number | null {
  if (item.liquidationChannel === "vendor") return 1.0;
  if (
    item.liquidity.status === "ESTIMATED" &&
    item.liquidity.sellingProbability !== null
  ) {
    return item.liquidity.sellingProbability;
  }
  return null;
}

function compareNullableNumber(
  a: number | null,
  b: number | null,
  direction: SortDirection
): number {
  if (a === null && b === null) return 0;
  // Always push missing/null metrics to the bottom for usability
  if (a === null) return 1;
  if (b === null) return -1;
  return direction === "asc" ? a - b : b - a;
}

export function sortCreatureLoot<T extends SortableLootItem>(
  items: readonly T[],
  column: LootSortColumn,
  direction: SortDirection
): T[] {
  const dir = direction === "asc" ? 1 : -1;

  return [...items].sort((a, b) => {
    let diff = 0;

    switch (column) {
      case "item":
        diff = a.itemName.localeCompare(b.itemName, undefined, {
          sensitivity: "base",
        }) * dir;
        break;
      case "dropRate":
        diff = (a.dropRate - b.dropRate) * dir;
        break;
      case "avgQty":
        diff = (a.avgQty - b.avgQty) * dir;
        break;
      case "channel":
        diff =
          ((CHANNEL_RANK[a.liquidationChannel] ?? 0) -
            (CHANNEL_RANK[b.liquidationChannel] ?? 0)) *
          dir;
        break;
      case "unitPrice":
        diff = (a.unitGrossCopper - b.unitGrossCopper) * dir;
        break;
      case "liquidity": {
        diff = compareNullableNumber(
          liquidityRank(a),
          liquidityRank(b),
          direction
        );
        if (diff === 0) {
          diff = compareNullableNumber(
            a.liquidity.score,
            b.liquidity.score,
            direction
          );
        }
        break;
      }
      case "k50":
        diff = compareNullableNumber(
          a.dropMetrics.killsFor50Pct,
          b.dropMetrics.killsFor50Pct,
          direction
        );
        break;
      case "provenance":
        diff =
          ((CONFIDENCE_RANK[a.confidenceTier] ?? 0) -
            (CONFIDENCE_RANK[b.confidenceTier] ?? 0)) *
          dir;
        if (diff === 0) {
          diff = ((a.sampleSize ?? -1) - (b.sampleSize ?? -1)) * dir;
        }
        break;
      case "evPerKill":
      default:
        diff =
          (a.expectedLiquidityAdjustedPerKillCopper -
            b.expectedLiquidityAdjustedPerKillCopper) *
          dir;
        if (diff === 0) {
          diff =
            (a.expectedGrossEvPerKillCopper - b.expectedGrossEvPerKillCopper) *
            dir;
        }
        break;
    }

    if (diff !== 0) return diff;
    // Deterministic secondary tie-breaker: higher EV/kill then itemName
    return (
      b.expectedLiquidityAdjustedPerKillCopper -
        a.expectedLiquidityAdjustedPerKillCopper ||
      a.itemName.localeCompare(b.itemName)
    );
  });
}

function stripSuffixFromName(
  fullName: string,
  suffixName?: string | null
): string {
  const trimmed = fullName.trim();
  if (suffixName) {
    const suf = suffixName.trim();
    if (
      suf.length > 0 &&
      trimmed.length > suf.length + 1 &&
      trimmed.toLowerCase().endsWith(suf.toLowerCase())
    ) {
      return trimmed.slice(0, trimmed.length - suf.length).trim();
    }
  }
  const idx = trimmed.lastIndexOf(" of ");
  if (idx > 0) return trimmed.slice(0, idx).trim();
  return trimmed;
}

/**
 * Collapses expanded random-enchant variant rows (`suffixId != null`) back into
 * one summary row per `(itemId, lootMethod)` while preserving exact total dropRate
 * and exact total EV/kill so collapsed view matches the creature's true EGPH.
 */
export function collapseVariantLootRows<T extends SortableLootItem>(
  items: readonly T[]
): T[] {
  const plain: T[] = [];
  const groups = new Map<string, T[]>();

  for (const item of items) {
    if (!item.suffixId) {
      plain.push(item);
      continue;
    }
    const key = `${item.itemId}:${item.lootMethod}`;
    let list = groups.get(key);
    if (!list) {
      list = [];
      groups.set(key, list);
    }
    list.push(item);
  }

  const collapsed: T[] = [...plain];

  for (const group of groups.values()) {
    const rep = group[0]!;
    const totalDropRate = Math.min(
      1,
      group.reduce((acc, g) => acc + g.dropRate, 0)
    );
    const totalGrossEv = group.reduce(
      (acc, g) => acc + g.expectedGrossEvPerKillCopper,
      0
    );
    const totalAdjEv = group.reduce(
      (acc, g) => acc + g.expectedLiquidityAdjustedPerKillCopper,
      0
    );
    const avgUnit = Math.round(
      group.reduce((acc, g) => acc + g.unitGrossCopper, 0) / group.length
    );
    const maxUnit = Math.max(...group.map((g) => g.unitGrossCopper));
    const hasAh = group.some((g) => g.liquidationChannel === "auction_house");
    const ahItem = group.find((g) => g.liquidationChannel === "auction_house");
    const baseName = stripSuffixFromName(rep.itemName, rep.suffixName);
    const baseSource = rep.source.replace(/\s*·\s*1\/\d+\s*suffix$/i, "");

    collapsed.push({
      ...rep,
      variantId: null,
      suffixId: null,
      suffixName: null,
      variantPriceNote: null,
      itemName: baseName,
      dropRate: totalDropRate,
      liquidationChannel: hasAh ? "auction_house" : rep.liquidationChannel,
      effectiveCommissionRate: hasAh
        ? (ahItem?.effectiveCommissionRate ?? rep.effectiveCommissionRate)
        : rep.effectiveCommissionRate,
      unitGrossCopper: avgUnit,
      expectedGrossEvPerKillCopper: totalGrossEv,
      expectedLiquidityAdjustedPerKillCopper: totalAdjEv,
      dropMetrics: computeDropProbabilityMetrics(totalDropRate),
      source: baseSource,
      collapsedVariantCount: group.length,
      collapsedMaxUnitCopper: maxUnit,
    });
  }

  return collapsed;
}
