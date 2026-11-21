import { describe, expect, it } from "vitest";
import {
  classifyEverlootConfidence,
  EverlootLootAdapter,
} from "@/providers/everloot-loot";

describe("EverlootLootAdapter", () => {
  it("classifies VERIFIED only when confirmed/settled with >=3 reporters and >=30 kills", () => {
    expect(
      classifyEverlootConfidence({
        tier: "confirmed",
        reporters: 3,
        kills: 53,
        settled: false,
      })
    ).toBe("VERIFIED");

    expect(
      classifyEverlootConfidence({
        tier: "confirmed",
        reporters: 3,
        kills: 20,
        settled: false,
      })
    ).toBe("OBSERVED");

    expect(
      classifyEverlootConfidence({
        tier: "verified",
        reporters: 2,
        kills: 80,
      })
    ).toBe("OBSERVED");

    expect(
      classifyEverlootConfidence({
        tier: "reported",
        reporters: 1,
        kills: 55,
      })
    ).toBe("OBSERVED");
  });

  it("filters out non-creature object rows and preserves sample size and Wilson CI bounds", async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          generatedAt: "2026-11-21T12:44:20.640Z",
          dataAsOf: "2026-11-21T12:30:16.412Z",
          stats: { uploads: 1121, lootWindows: 18088, records: 108297 },
          rates: [
            {
              sourceObjectId: 35591,
              itemId: 6303,
              kills: 279,
              drops: 102,
              rate: 0.3655,
              rateLow: 0.3112,
              rateHigh: 0.4235,
              reporters: 6,
              tier: "confirmed",
              settled: true,
            },
            {
              sourceNpcId: 2266,
              itemId: 2589,
              kills: 53,
              drops: 2,
              rate: 0.0377,
              rateLow: 0.0104,
              rateHigh: 0.1275,
              reporters: 3,
              tier: "confirmed",
              settled: false,
            },
            {
              sourceNpcId: 428,
              itemId: 6889,
              kills: 55,
              drops: 37,
              rate: 0.6727,
              rateLow: 0.541,
              rateHigh: 0.7818,
              reporters: 1,
              tier: "reported",
              settled: false,
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )) as typeof fetch;

    const adapter = new EverlootLootAdapter({ fetchImpl });
    const result = await adapter.fetchDrops();

    expect(result.skippedNonCreatureRows).toBe(1);
    expect(result.observations).toHaveLength(2);
    expect(result.observations[0]).toMatchObject({
      creatureId: 2266,
      itemId: 2589,
      killsObserved: 53,
      dropsObserved: 2,
      reporterCount: 3,
      confidenceTier: "VERIFIED",
      avgQty: null,
      source: "everloot",
    });
    expect(result.observations[1]).toMatchObject({
      creatureId: 428,
      itemId: 6889,
      confidenceTier: "OBSERVED",
    });
  });
});
