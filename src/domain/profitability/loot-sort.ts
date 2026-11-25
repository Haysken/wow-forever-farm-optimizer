import type { ConfidenceTier } from "@/providers/types";

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
  itemName: string;
  dropRate: number;
  avgQty: number;
  liquidationChannel: string;
  unitGrossCopper: number;
  expectedGrossEvPerKillCopper: number;
  expectedLiquidityAdjustedPerKillCopper: number;
  confidenceTier: ConfidenceTier;
  sampleSize: number | null;
  liquidity: {
    score: number | null;
    sellingProbability: number | null;
    status: "ESTIMATED" | "UNKNOWN";
  };
  dropMetrics: {
    killsFor50Pct: number | null;
    killsFor90Pct: number | null;
  };
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
