export interface HourlySnapshotInput {
  ts: string;
  minCopper: number | null;
  p10Copper?: number | null;
  medianCopper: number | null;
  availableQty: number;
  listingCount?: number;
}

export interface EstimatedStockExitEvent {
  /** Timestamp of the earlier snapshot (before stock decreased) */
  prevTs: string;
  /** Timestamp of the later snapshot (when lower stock was observed) */
  ts: string;
  /** Hours elapsed between prevTs and ts */
  windowHours: number;
  /** Net units removed from the AH between consecutive snapshots (> 0) */
  unitsExited: number;
  /** Net listings removed (can be 0 if partial stack bought or new listing added) */
  listingsExited: number;
  /** Supply immediately before and after the exit window */
  prevQty: number;
  currQty: number;
  /** Lowest buyout right before exit (best proxy for clearing buyout price) */
  prevMinCopper: number | null;
  /** Lowest buyout right after exit */
  currMinCopper: number | null;
  /** Median price right before exit */
  prevMedianCopper: number | null;
  /** Conservative unit price proxy (prevMin -> prevP10 -> prevMedian) */
  estimatedUnitCopper: number | null;
  /** estimatedUnitCopper * unitsExited */
  estimatedGrossCopper: number | null;
  /**
   * True when the lowest buyout rose after stock decreased (or supply hit 0),
   * which is a stronger signal that the cheapest listing(s) were bought out
   * rather than a random high-priced listing expiring. Still ESTIMATED.
   */
  cheapestCleared: boolean;
  /** Always ESTIMATED because Blizzard's API does not expose trade logs */
  dataStatus: "ESTIMATED";
}

export interface StockExitSummary {
  totalEvents: number;
  cheapestClearedEvents: number;
  totalUnitsExited: number;
  totalEstimatedVolumeCopper: number;
  weightedAvgUnitCopper: number | null;
  analyzedSnapshots: number;
  analyzedSpanHours: number;
  dataStatus: "ESTIMATED";
}

export interface StockExitAnalysis {
  /** Events sorted newest-first for tabular display */
  eventsDesc: EstimatedStockExitEvent[];
  /** Events sorted oldest-first for chronological charting */
  eventsAsc: EstimatedStockExitEvent[];
  summary: StockExitSummary;
}

const DEFAULT_MAX_GAP_HOURS = 3;

/**
 * Derives estimated Auction House stock-exit events from consecutive real hourly
 * snapshots. Because Blizzard's Battle.net API only exposes active hourly listings
 * and never completed purchase logs, every derived exit is strictly tagged
 * `ESTIMATED` (may include purchases, seller cancellations, or expirations).
 */
export function analyzeHourlyStockExits(
  points: readonly HourlySnapshotInput[],
  options: { maxGapHours?: number } = {}
): StockExitAnalysis {
  const maxGapHours = options.maxGapHours ?? DEFAULT_MAX_GAP_HOURS;

  const valid = points
    .map((pt) => ({ pt, timeMs: Date.parse(pt.ts) }))
    .filter((entry) => Number.isFinite(entry.timeMs))
    .sort((a, b) => a.timeMs - b.timeMs);

  // Deduplicate identical timestamps (keep last occurrence)
  const deduped: Array<{ pt: HourlySnapshotInput; timeMs: number }> = [];
  for (const entry of valid) {
    const last = deduped[deduped.length - 1];
    if (last && last.timeMs === entry.timeMs) {
      deduped[deduped.length - 1] = entry;
    } else {
      deduped.push(entry);
    }
  }

  const eventsAsc: EstimatedStockExitEvent[] = [];
  let totalUnitsExited = 0;
  let totalEstimatedVolumeCopper = 0;
  let weightedPriceNumerator = 0;
  let weightedPriceUnits = 0;
  let cheapestClearedEvents = 0;

  for (let i = 1; i < deduped.length; i++) {
    const prev = deduped[i - 1]!;
    const curr = deduped[i]!;
    const gapHours = (curr.timeMs - prev.timeMs) / 3_600_000;

    if (gapHours <= 0 || gapHours > maxGapHours) {
      continue;
    }

    const unitsExited = prev.pt.availableQty - curr.pt.availableQty;
    if (unitsExited <= 0) {
      continue;
    }

    const prevListings = prev.pt.listingCount ?? 0;
    const currListings = curr.pt.listingCount ?? 0;
    const listingsExited = Math.max(0, prevListings - currListings);

    const prevMinCopper = prev.pt.minCopper ?? null;
    const currMinCopper = curr.pt.minCopper ?? null;
    const prevMedianCopper = prev.pt.medianCopper ?? null;
    const estimatedUnitCopper =
      prevMinCopper ?? prev.pt.p10Copper ?? prevMedianCopper ?? null;
    const estimatedGrossCopper =
      estimatedUnitCopper !== null
        ? Math.round(estimatedUnitCopper * unitsExited)
        : null;

    const cheapestCleared =
      curr.pt.availableQty === 0 ||
      (prevMinCopper !== null &&
        currMinCopper !== null &&
        currMinCopper > prevMinCopper);

    if (cheapestCleared) {
      cheapestClearedEvents += 1;
    }
    totalUnitsExited += unitsExited;
    if (estimatedGrossCopper !== null) {
      totalEstimatedVolumeCopper += estimatedGrossCopper;
    }
    if (estimatedUnitCopper !== null) {
      weightedPriceNumerator += estimatedUnitCopper * unitsExited;
      weightedPriceUnits += unitsExited;
    }

    eventsAsc.push({
      prevTs: prev.pt.ts,
      ts: curr.pt.ts,
      windowHours: Math.round(gapHours * 10) / 10,
      unitsExited,
      listingsExited,
      prevQty: prev.pt.availableQty,
      currQty: curr.pt.availableQty,
      prevMinCopper,
      currMinCopper,
      prevMedianCopper,
      estimatedUnitCopper,
      estimatedGrossCopper,
      cheapestCleared,
      dataStatus: "ESTIMATED",
    });
  }

  const analyzedSpanHours =
    deduped.length >= 2
      ? Math.round(
          ((deduped[deduped.length - 1]!.timeMs - deduped[0]!.timeMs) /
            3_600_000) *
            10
        ) / 10
      : 0;

  return {
    eventsAsc,
    eventsDesc: [...eventsAsc].reverse(),
    summary: {
      totalEvents: eventsAsc.length,
      cheapestClearedEvents,
      totalUnitsExited,
      totalEstimatedVolumeCopper,
      weightedAvgUnitCopper:
        weightedPriceUnits > 0
          ? Math.round(weightedPriceNumerator / weightedPriceUnits)
          : null,
      analyzedSnapshots: deduped.length,
      analyzedSpanHours,
      dataStatus: "ESTIMATED",
    },
  };
}
