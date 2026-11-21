import { describe, expect, it } from "vitest";
import {
  computeClearingPriceCopper,
  defaultCommissionForFaction,
  FACTION_AH_COMMISSION,
  ForeverAHMarketAdapter,
  inferFactionFromHouse,
  NEUTRAL_AH_COMMISSION,
} from "@/providers/forever-ah-market";

function mockJsonFetch(routes: Record<string, unknown>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    for (const [pattern, payload] of Object.entries(routes)) {
      if (url.includes(pattern)) {
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
    }
    return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
  }) as typeof fetch;
}

describe("ForeverAHMarketAdapter", () => {
  it("maps Alliance, Horde, Neutral (Blackwater), and Unified houses with configurable default commissions", async () => {
    const fetchImpl = mockJsonFetch({
      "/v1/houses": [
        {
          house_key: 2,
          region: "us",
          ruleset_id: 2,
          house_id: 110,
          name: "Alliance Auction House",
          last_snapshot: "2026-11-21T12:25:01Z",
          house_type: "real",
        },
        {
          house_key: 5,
          region: "us",
          ruleset_id: 2,
          house_id: 113,
          name: "Horde Auction House",
          last_snapshot: "2026-11-21T12:25:02Z",
          house_type: "real",
        },
        {
          house_key: 8,
          region: "us",
          ruleset_id: 2,
          house_id: 116,
          name: "Blackwater Auction House",
          last_snapshot: "2026-11-21T12:24:55Z",
          house_type: "real",
        },
        {
          house_key: 17,
          region: "us",
          ruleset_id: 2,
          house_id: 0,
          name: "All Auction Houses",
          last_snapshot: "2026-11-21T12:25:02Z",
          house_type: "unified",
        },
        {
          house_key: 34,
          region: "kr",
          ruleset_id: 2,
          house_id: 110,
          name: "얼라이언스 경매장",
          last_snapshot: "2026-11-21T12:26:53Z",
          house_type: "real",
        },
      ],
    });

    const adapter = new ForeverAHMarketAdapter({ maxRps: 100, fetchImpl });
    const usMarkets = await adapter.fetchMarkets(["us"]);

    expect(usMarkets).toHaveLength(4);
    expect(usMarkets[0]).toMatchObject({
      id: "us:110",
      faction: "alliance",
      defaultCommissionRate: FACTION_AH_COMMISSION,
      rulesetLabel: null,
    });
    expect(usMarkets[1]).toMatchObject({
      id: "us:113",
      faction: "horde",
      defaultCommissionRate: FACTION_AH_COMMISSION,
    });
    expect(usMarkets[2]).toMatchObject({
      id: "us:116",
      faction: "neutral",
      defaultCommissionRate: NEUTRAL_AH_COMMISSION,
    });
    expect(usMarkets[3]).toMatchObject({
      id: "us:0",
      faction: "unified",
    });

    // Korean localized house names still resolve faction via verified house_id
    expect(
      inferFactionFromHouse({ house_id: 110, house_type: "real", name: "얼라이언스 경매장" })
    ).toBe("alliance");
    expect(defaultCommissionForFaction("neutral")).toBe(0.15);
    expect(defaultCommissionForFaction("alliance")).toBe(0.05);
  });

  it("normalizes market rows, distinguishes ESTIMATED vs MISSING sales velocity, and computes conservative clearing price", async () => {
    const fetchImpl = mockJsonFetch({
      "/v1/houses/18/market": {
        house: {
          house_key: 18,
          region: "eu",
          ruleset_id: 2,
          house_id: 110,
          name: "Alliance Auction House",
          last_snapshot: "2026-11-21T12:23:03Z",
          house_type: "real",
        },
        as_of: "2026-11-21T12:23:03Z",
        total: 2,
        rows: [
          {
            item: { item_id: 2589, name: "Linen Cloth", sell_price: 13 },
            current: {
              ts: "2026-11-21T12:23:03Z",
              min_unit: 20,
              p10_unit: 27,
              median_unit: 30,
              mean_unit: 765,
              quantity: 20251,
              listings: 500,
            },
            median_change_pct: -1.5,
            stats: {
              market_value: 29,
              historical_value: 29,
              trend_pct: 2.1,
              days_seen: 8,
              sold_per_day: 58081.28,
            },
          },
          {
            item: { item_id: 9999, name: "Rare Unlisted", sell_price: 500 },
            current: null,
            median_change_pct: null,
            stats: null,
          },
        ],
      },
    });

    const adapter = new ForeverAHMarketAdapter({ maxRps: 100, fetchImpl });
    const rows = await adapter.fetchMarketSnapshot({
      id: "eu:110",
      region: "eu",
      rulesetId: 2,
      rulesetLabel: null,
      houseId: 110,
      faction: "alliance",
      displayName: "EU House #110 — Alliance",
      defaultCommissionRate: 0.05,
      providerSource: "forever_ah",
      providerKey: "18",
      lastSnapshotAt: null,
    });

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      itemId: 2589,
      lowestBuyoutCopper: 20,
      p10Copper: 27,
      medianCopper: 30,
      clearingPriceCopper: 27, // min(p10=27, median=30, market_value=29)
      salesDataStatus: "ESTIMATED",
      priceStatus: "ACTUAL",
    });
    expect(rows[1]).toMatchObject({
      itemId: 9999,
      clearingPriceCopper: null,
      estimatedSoldPerDay: null,
      salesDataStatus: "MISSING",
      priceStatus: "MISSING",
    });
  });

  it("computes clearing price with fallback to lowest buyout when robust stats are absent", () => {
    expect(
      computeClearingPriceCopper({
        minUnit: 450,
        p10Unit: null,
        medianUnit: null,
        marketValue: null,
      })
    ).toBe(450);
    expect(
      computeClearingPriceCopper({
        minUnit: null,
        p10Unit: null,
        medianUnit: null,
        marketValue: null,
      })
    ).toBeNull();
  });
});
