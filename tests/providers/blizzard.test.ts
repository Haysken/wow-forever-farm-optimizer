import { describe, expect, it } from "vitest";
import {
  aggregateBlizzardListings,
  BlizzardMarketAdapter,
} from "@/providers/blizzard-market";

describe("BlizzardMarketAdapter", () => {
  it("fails explicitly when OAuth credentials are missing (never fabricates data)", async () => {
    const adapter = new BlizzardMarketAdapter({ clientId: "", clientSecret: "" });
    expect(adapter.isConfigured()).toBe(false);
    await expect(adapter.fetchMarkets(["us"])).rejects.toThrow(
      /Blizzard API credentials are not configured/i
    );
  });

  it("aggregates raw Blizzard listings into quantity-weighted min, p10, median, and mean copper prices", () => {
    const now = new Date("2026-11-21T12:00:00Z");
    const rows = aggregateBlizzardListings(
      "us:110",
      [
        { itemId: 2589, unitPriceCopper: 20, quantity: 10 },
        { itemId: 2589, unitPriceCopper: 30, quantity: 80 },
        { itemId: 2589, unitPriceCopper: 100, quantity: 10 },
      ],
      now
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      marketId: "us:110",
      itemId: 2589,
      lowestBuyoutCopper: 20,
      p10Copper: 20, // 10th unit out of 100 is at 20c
      medianCopper: 30, // 50th unit is at 30c
      meanCopper: 36, // (200 + 2400 + 1000) / 100 = 36
      clearingPriceCopper: 20, // min(p10=20, median=30)
      availableQty: 100,
      listingCount: 3,
      estimatedSoldPerDay: null,
      salesDataStatus: "MISSING",
      priceStatus: "ACTUAL",
      source: "blizzard_api",
    });
  });

  it("authenticates via OAuth2 client_credentials and queries trailing-slash ruleset auction endpoints", async () => {
    const calledUrls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      calledUrls.push(url);
      if (url.includes("oauth.battle.net/token")) {
        return new Response(
          JSON.stringify({
            access_token: "test-token",
            token_type: "bearer",
            expires_in: 86399,
          }),
          { status: 200 }
        );
      }
      if (url.includes("/data/wow/ruleset/index")) {
        return new Response(
          JSON.stringify({ rulesets: [{ id: 2, name: "Forever PvP" }] }),
          { status: 200 }
        );
      }
      if (url.includes("/data/wow/ruleset/2/auctions/?")) {
        return new Response(
          JSON.stringify({
            auctions: [
              { id: 110, name: "Alliance Auction House" },
              { id: 116, name: "Blackwater Auction House" },
            ],
          }),
          { status: 200 }
        );
      }
      return new Response("{}", { status: 404 });
    }) as typeof fetch;

    const adapter = new BlizzardMarketAdapter({
      clientId: "cid",
      clientSecret: "csec",
      fetchImpl,
    });
    const markets = await adapter.fetchMarkets(["us"]);

    expect(markets).toHaveLength(2);
    expect(markets[0]).toMatchObject({
      id: "us:110",
      rulesetLabel: "Forever PvP",
      faction: "alliance",
      defaultCommissionRate: 0.05,
    });
    expect(markets[1]).toMatchObject({
      id: "us:116",
      faction: "neutral",
      defaultCommissionRate: 0.15,
    });
    expect(calledUrls.some((u) => u.includes("/ruleset/2/auctions/?"))).toBe(true);
  });
});
