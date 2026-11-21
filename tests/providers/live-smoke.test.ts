import { describe, expect, it } from "vitest";
import { EverlookDBCatalogAdapter } from "@/providers/everlookdb-catalog";
import { EverlookDBLootAdapter } from "@/providers/everlookdb-loot";
import { EverlootLootAdapter } from "@/providers/everloot-loot";
import { ForeverAHMarketAdapter } from "@/providers/forever-ah-market";

const RUN_LIVE = process.env.LIVE_API_TESTS === "1";

describe.skipIf(!RUN_LIVE)("Live External API Smoke Tests", () => {
  it("fetches live Alliance, Horde, and Neutral houses + market rows from Forever AH", async () => {
    const adapter = new ForeverAHMarketAdapter({ maxRps: 1 });
    const markets = await adapter.fetchMarkets(["us", "eu"]);

    expect(markets.length).toBeGreaterThanOrEqual(30);
    expect(markets.some((m) => m.region === "us" && m.faction === "alliance")).toBe(true);
    expect(markets.some((m) => m.region === "us" && m.faction === "horde")).toBe(true);
    expect(markets.some((m) => m.region === "us" && m.faction === "neutral")).toBe(true);

    const sampleHouse = markets.find((m) => m.region === "eu" && m.faction === "alliance")!;
    const rows = await adapter.fetchMarketSnapshot(sampleHouse, { maxPages: 1, pageSize: 5 });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]?.source).toBe("forever_ah");
  }, 30_000);

  it("fetches live observed creature drops from Everloot (CC BY-SA 4.0)", async () => {
    const adapter = new EverlootLootAdapter();
    const res = await adapter.fetchDrops();

    expect(res.observations.length).toBeGreaterThan(0);
    expect(res.observations.every((o) => o.source === "everloot")).toBe(true);
    expect(
      res.observations.every(
        (o) => o.confidenceTier === "VERIFIED" || o.confidenceTier === "OBSERVED"
      )
    ).toBe(true);
  }, 30_000);

  it("fetches live WoW Forever zones and NPC loot layers from EverlookDB", async () => {
    const catalog = new EverlookDBCatalogAdapter();
    const { build, zones } = await catalog.fetchZones();
    expect(build).toBeTruthy();
    expect(zones.length).toBeGreaterThan(50);

    const loot = new EverlookDBLootAdapter();
    const npc38 = await loot.fetchNpcLoot(38);
    expect(npc38.observations.some((o) => o.source === "everlookdb_players")).toBe(true);
    expect(npc38.observations.some((o) => o.source === "classic_db")).toBe(true);
  }, 30_000);
});
