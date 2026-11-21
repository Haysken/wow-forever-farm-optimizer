import { describe, expect, it } from "vitest";
import { evaluateMarketLiquidity } from "@/domain/profitability";

describe("Market liquidity & selling probability (Si)", () => {
  it("returns explicit UNKNOWN with null score and null Si when sales data is missing", () => {
    const res = evaluateMarketLiquidity({
      estimatedSoldPerDay: null,
      availableQty: 250,
      trend7dPct: 4.5,
      trend30dPct: null,
      daysSeen: 10,
      salesDataStatus: "MISSING",
      timeHorizonDays: 1,
    });

    expect(res.status).toBe("UNKNOWN");
    expect(res.score).toBeNull();
    expect(res.sellingProbability).toBeNull();
    expect(res.daysOfSupply).toBeNull();
  });

  it("ranks fast-moving low-overhang commodities dramatically higher than slow oversupplied items", () => {
    const highDemand = evaluateMarketLiquidity({
      estimatedSoldPerDay: 500,
      availableQty: 200, // 0.4 days of supply
      trend7dPct: 2.0,
      trend30dPct: 4.0,
      daysSeen: 14,
      salesDataStatus: "ESTIMATED",
      timeHorizonDays: 1,
    });

    const slowOverhang = evaluateMarketLiquidity({
      estimatedSoldPerDay: 0.2,
      availableQty: 40, // 200 days of supply
      trend7dPct: 35.0,
      trend30dPct: 50.0,
      daysSeen: 3,
      salesDataStatus: "ESTIMATED",
      timeHorizonDays: 1,
    });

    expect(highDemand.status).toBe("ESTIMATED");
    expect(slowOverhang.status).toBe("ESTIMATED");
    expect(highDemand.score!).toBeGreaterThan(85);
    expect(highDemand.sellingProbability!).toBeGreaterThan(0.95);
    expect(slowOverhang.score!).toBeLessThan(25);
    expect(slowOverhang.sellingProbability!).toBeLessThan(0.05);
  });

  it("increases selling probability monotonically with a longer time horizon", () => {
    const oneDay = evaluateMarketLiquidity({
      estimatedSoldPerDay: 2,
      availableQty: 12,
      trend7dPct: 5,
      trend30dPct: 8,
      daysSeen: 10,
      salesDataStatus: "ESTIMATED",
      timeHorizonDays: 1,
    });

    const sevenDays = evaluateMarketLiquidity({
      estimatedSoldPerDay: 2,
      availableQty: 12,
      trend7dPct: 5,
      trend30dPct: 8,
      daysSeen: 10,
      salesDataStatus: "ESTIMATED",
      timeHorizonDays: 7,
    });

    expect(sevenDays.sellingProbability!).toBeGreaterThan(
      oneDay.sellingProbability!
    );
  });

  it("returns 0 selling probability when estimatedSoldPerDay is exactly 0", () => {
    const zeroSales = evaluateMarketLiquidity({
      estimatedSoldPerDay: 0,
      availableQty: 15,
      trend7dPct: 0,
      trend30dPct: 0,
      daysSeen: 14,
      salesDataStatus: "ESTIMATED",
      timeHorizonDays: 7,
    });

    expect(zeroSales.score).toBe(0);
    expect(zeroSales.sellingProbability).toBe(0);
  });
});
