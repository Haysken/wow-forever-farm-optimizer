import { describe, expect, it } from "vitest";
import {
  EverlookDBVariantAdapter,
  extractSuffixLabel,
} from "@/providers/everlookdb-variants";

function mockFetch(routes: Record<string, unknown>): typeof fetch {
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

describe("EverlookDBVariantAdapter", () => {
  it("extracts suffix labels accurately from full item names", () => {
    expect(extractSuffixLabel("Notched Shortsword of the Monkey", "Notched Shortsword")).toBe(
      "of the Monkey"
    );
    expect(extractSuffixLabel("Green Lens of Shadow Wrath", "Green Lens")).toBe(
      "of Shadow Wrath"
    );
    expect(extractSuffixLabel("Overlord's Chestplate of Healing")).toBe("of Healing");
  });

  it("parses columnar EverlookDB house snapshots and attaches suffix=0 base reference prices", async () => {
    const fetchImpl = mockFetch({
      "/api/v1/auctions/house/EU-6946-Alliance": {
        columns: [
          "id",
          "suffix",
          "name",
          "quality",
          "icon",
          "low",
          "p10",
          "median",
          "qty",
          "auctions",
          "bid_only",
          "with_bids",
          "time_left",
          "min_bid",
          "vendor_sell",
        ],
        meta: {
          key: "EU-6946-Alliance",
          region: "EU",
          side: "Alliance",
          realm: "CAMWOW EU5 Realm 4 PvP",
          at: 1795352633,
        },
        rows: [
          [727, 0, "Notched Shortsword", 2, 135274, 1000, 1000, 1200, 10, 10, 0, 0, [0, 1, 2, 7], null, 244],
          [727, 12721, "Notched Shortsword of the Monkey", 2, 135274, 12950, 12950, 13500, 2, 2, 0, 0, [0, 0, 1, 1], null, 244],
          [727, 12718, "Notched Shortsword of the Eagle", 2, 135274, 297, 297, 500, 5, 5, 0, 0, [0, 0, 0, 5], 499, 244],
        ],
      },
    });

    const adapter = new EverlookDBVariantAdapter({ maxRps: 100, fetchImpl });
    const rows = await adapter.fetchHouseVariants(
      {
        houseKey: "EU-6946-Alliance",
        region: "eu",
        faction: "alliance",
        realmLabel: "CAMWOW EU5 Realm 4 PvP",
        snapshotAt: new Date("2026-11-22T12:00:00Z"),
      },
      new Map([[727, "Notched Shortsword"]])
    );

    // Only suffixed variants (suffix > 0) are returned, with suffix=0 attached as baseReferenceCopper
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      variantId: "727:12721",
      itemId: 727,
      suffixId: 12721,
      fullName: "Notched Shortsword of the Monkey",
      suffixName: "of the Monkey",
      clearingPriceCopper: 12950,
      baseReferenceCopper: 1000,
      timeLeftLong: 1,
      timeLeftVeryLong: 1,
    });
  });
});
