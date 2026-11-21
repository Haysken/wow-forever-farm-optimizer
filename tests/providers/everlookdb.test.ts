import { describe, expect, it } from "vitest";
import { EverlookDBCatalogAdapter } from "@/providers/everlookdb-catalog";
import { EverlookDBLootAdapter } from "@/providers/everlookdb-loot";

describe("EverlookDB Adapters", () => {
  it("normalizes zones, items (including numeric or string binds), and creatures while filtering internal entries", async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/downloads/zones.json")) {
        return new Response(
          JSON.stringify({
            build: "1.60.1.70959",
            data: [
              {
                id: 1411,
                name: "Durotar",
                continent: "Kalimdor",
                faction: "horde",
                kind: "zone",
                min_level: 1,
                max_level: 14,
              },
            ],
          }),
          { status: 200 }
        );
      }
      if (url.endsWith("/downloads/items.json")) {
        return new Response(
          JSON.stringify({
            build: "1.60.1.70959",
            data: [
              {
                id: 2589,
                name: "Linen Cloth",
                quality: "common",
                category: "Trade Goods",
                type: "Cloth",
                ilvl: 5,
                reqlevel: 0,
                binds: "none",
                sell: 13,
                buy: 55,
                stack: 20,
                icon: 132889,
                internal: 0,
              },
              {
                id: 19019,
                name: "Thunderfury",
                quality: "legendary",
                category: "Weapon",
                type: "One-Handed Swords",
                ilvl: 80,
                reqlevel: 60,
                binds: 1, // numeric BoP
                sell: 245000,
                buy: 0,
                stack: 1,
                internal: 0,
              },
              {
                id: 999999,
                name: "Internal Test Item",
                quality: "poor",
                internal: 1,
              },
            ],
          }),
          { status: 200 }
        );
      }
      if (url.endsWith("/downloads/npcs.json")) {
        return new Response(
          JSON.stringify({
            build: "1.60.1.70959",
            data: [
              {
                id: 95,
                name: "Defias Smuggler",
                level: 11,
                maxlevel: 12,
                type: "Humanoid",
                family: "",
                classification: "normal",
                zone: "Westfall",
                internal: 0,
              },
            ],
          }),
          { status: 200 }
        );
      }
      return new Response("{}", { status: 404 });
    }) as typeof fetch;

    const adapter = new EverlookDBCatalogAdapter({ maxRps: 100, fetchImpl });
    const [z, i, c] = await Promise.all([
      adapter.fetchZones(),
      adapter.fetchItems(),
      adapter.fetchCreatures(),
    ]);

    expect(z.build).toBe("1.60.1.70959");
    expect(z.zones[0]).toMatchObject({ id: 1411, name: "Durotar", isInstance: false });

    expect(i.items).toHaveLength(2); // internal item filtered out
    expect(i.items[0]).toMatchObject({
      id: 2589,
      quality: 1,
      bindType: "none",
      isCommodity: true,
      vendorSellCopper: 13,
    });
    expect(i.items[1]).toMatchObject({
      id: 19019,
      quality: 5,
      bindType: "bop",
      isCommodity: false,
    });

    expect(c.creatures[0]).toMatchObject({
      id: 95,
      name: "Defias Smuggler",
      minLevel: 11,
      maxLevel: 12,
      primaryZoneName: "Westfall",
    });
  });

  it("strictly separates players (OBSERVED) from classic_db (ESTIMATED) drops and parses quest flags", async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          id: 38,
          build: "1.60.1.70959",
          players: {
            loot: {
              corpse: {
                n: 54,
                items: [{ id: 2589, drops: 11, qty: 22, rate: 0.2037 }],
              },
            },
          },
          classic_db: {
            at: [[1429, 25.0, 92.9]],
            at_zones: ["Elwynn Forest"],
            drops: [
              [1931, 1.0, 1], // quest item
              [2589, 0.25],
            ],
            gold: [24, 64],
            hp: [100, 120],
          },
        }),
        { status: 200 }
      )) as typeof fetch;

    const adapter = new EverlookDBLootAdapter({ maxRps: 100, fetchImpl });
    const bundle = await adapter.fetchNpcLoot(38);

    expect(bundle.healthMin).toBe(100);
    expect(bundle.rawCoinMinCopper).toBe(24);
    expect(bundle.rawCoinMaxCopper).toBe(64);
    expect(bundle.spawns).toHaveLength(1);
    expect(bundle.spawns[0]).toMatchObject({
      zoneId: 1429,
      zoneName: "Elwynn Forest",
      confidenceTier: "ESTIMATED",
    });

    const playerObs = bundle.observations.filter((o) => o.source === "everlookdb_players");
    const classicObs = bundle.observations.filter((o) => o.source === "classic_db");

    expect(playerObs).toHaveLength(1);
    expect(playerObs[0]).toMatchObject({
      itemId: 2589,
      confidenceTier: "OBSERVED",
      avgQty: 2, // 22 / 11
      killsObserved: 54,
    });

    expect(classicObs).toHaveLength(2);
    expect(classicObs[0]).toMatchObject({
      itemId: 1931,
      confidenceTier: "ESTIMATED",
      isQuestOnly: true,
    });
    expect(classicObs[1]).toMatchObject({
      itemId: 2589,
      confidenceTier: "ESTIMATED",
      isQuestOnly: false,
    });
  });
});
