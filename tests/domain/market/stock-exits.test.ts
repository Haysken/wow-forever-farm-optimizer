import { describe, expect, it } from "vitest";
import { analyzeHourlyStockExits } from "@/domain/market/stock-exits";

describe("analyzeHourlyStockExits", () => {
  it("detects consecutive hourly stock drops, tags cheapest-cleared signals, and ignores increases", () => {
    const analysis = analyzeHourlyStockExits([
      // Intentionally unsorted to verify chronological sorting
      {
        ts: "2026-11-22T12:00:00Z",
        minCopper: 55_000,
        medianCopper: 70_000,
        availableQty: 18,
        listingCount: 18,
      },
      {
        ts: "2026-11-22T09:00:00Z",
        minCopper: 30_000,
        medianCopper: 60_000,
        availableQty: 22,
        listingCount: 22,
      },
      {
        ts: "2026-11-22T10:00:00Z",
        minCopper: 45_000,
        medianCopper: 65_000,
        availableQty: 20,
        listingCount: 20,
      },
      {
        ts: "2026-11-22T11:00:00Z",
        minCopper: 45_000,
        medianCopper: 65_000,
        availableQty: 23, // stock rose -> not an exit event
        listingCount: 23,
      },
    ]);

    expect(analysis.eventsAsc).toHaveLength(2);
    expect(analysis.summary).toMatchObject({
      totalEvents: 2,
      cheapestClearedEvents: 2,
      totalUnitsExited: 7, // (22->20 = 2) + (23->18 = 5)
      totalEstimatedVolumeCopper: 2 * 30_000 + 5 * 45_000,
      weightedAvgUnitCopper: Math.round((2 * 30_000 + 5 * 45_000) / 7),
      analyzedSnapshots: 4,
      analyzedSpanHours: 3,
      dataStatus: "ESTIMATED",
    });

    // Desc order puts newest event first
    expect(analysis.eventsDesc[0]).toMatchObject({
      ts: "2026-11-22T12:00:00Z",
      prevTs: "2026-11-22T11:00:00Z",
      unitsExited: 5,
      listingsExited: 5,
      prevMinCopper: 45_000,
      currMinCopper: 55_000,
      estimatedUnitCopper: 45_000,
      estimatedGrossCopper: 225_000,
      cheapestCleared: true,
      dataStatus: "ESTIMATED",
    });

    expect(analysis.eventsDesc[1]).toMatchObject({
      ts: "2026-11-22T10:00:00Z",
      unitsExited: 2,
      prevMinCopper: 30_000,
      currMinCopper: 45_000,
      cheapestCleared: true,
    });
  });

  it("marks stock drops where lowest price did not increase as non-cheapest-cleared and skips multi-day gaps", () => {
    const analysis = analyzeHourlyStockExits([
      {
        ts: "2026-11-20T09:00:00Z",
        minCopper: 50_000,
        medianCopper: 60_000,
        availableQty: 15,
      },
      {
        ts: "2026-11-20T10:00:00Z",
        minCopper: 50_000,
        medianCopper: 60_000,
        availableQty: 12,
      },
      // 12-hour gap -> should not produce a bogus hourly exit event
      {
        ts: "2026-11-20T22:00:00Z",
        minCopper: 70_000,
        medianCopper: 80_000,
        availableQty: 2,
      },
    ]);

    expect(analysis.eventsAsc).toHaveLength(1);
    expect(analysis.eventsAsc[0]).toMatchObject({
      unitsExited: 3,
      cheapestCleared: false,
      estimatedUnitCopper: 50_000,
    });
    expect(analysis.summary.cheapestClearedEvents).toBe(0);
  });

  it("returns empty analysis cleanly when given fewer than 2 snapshots", () => {
    const analysis = analyzeHourlyStockExits([
      {
        ts: "2026-11-22T09:00:00Z",
        minCopper: 10_000,
        medianCopper: 12_000,
        availableQty: 5,
      },
    ]);

    expect(analysis.eventsDesc).toEqual([]);
    expect(analysis.summary.totalEvents).toBe(0);
    expect(analysis.summary.weightedAvgUnitCopper).toBeNull();
  });
});
