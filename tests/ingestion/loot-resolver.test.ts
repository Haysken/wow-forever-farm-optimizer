import { describe, expect, it } from "vitest";
import { resolveCreatureLoot } from "@/ingestion/loot-resolver";
import { validateDropObservations } from "@/ingestion/validators";
import type { NormalizedDropObservation } from "@/providers/types";

function makeObs(
  overrides: Partial<NormalizedDropObservation>
): NormalizedDropObservation {
  return {
    creatureId: 95,
    itemId: 2589,
    lootMethod: "kill",
    source: "classic_db",
    killsObserved: null,
    dropsObserved: null,
    totalQtyObserved: null,
    minQty: null,
    maxQty: null,
    avgQty: null,
    dropRate: 0.3,
    ciLow: null,
    ciHigh: null,
    reporterCount: null,
    confidenceTier: "ESTIMATED",
    isQuestOnly: false,
    clientBuild: "1.60.1.70959",
    observedAt: new Date("2026-11-21T12:00:00Z"),
    ...overrides,
  };
}

describe("resolveCreatureLoot & validators", () => {
  it("prioritizes WoW Forever VERIFIED over OBSERVED and ESTIMATED without double-counting", () => {
    const observations: NormalizedDropObservation[] = [
      makeObs({
        source: "classic_db",
        confidenceTier: "ESTIMATED",
        dropRate: 0.38,
        avgQty: 1.5,
      }),
      makeObs({
        source: "everlookdb_players",
        confidenceTier: "OBSERVED",
        dropRate: 0.2,
        killsObserved: 54,
        dropsObserved: 11,
        totalQtyObserved: 22,
        avgQty: 2,
      }),
      makeObs({
        source: "everloot",
        confidenceTier: "VERIFIED",
        dropRate: 0.18,
        killsObserved: 120,
        dropsObserved: 22,
        reporterCount: 5,
        ciLow: 0.12,
        ciHigh: 0.26,
        avgQty: null, // Everloot rollup omits stack qty
      }),
    ];

    const resolved = resolveCreatureLoot(observations);
    expect(resolved).toHaveLength(1); // Zero double-counting!
    expect(resolved[0]).toMatchObject({
      creatureId: 95,
      itemId: 2589,
      confidenceTier: "VERIFIED",
      source: "everloot",
      dropRate: 0.18,
      sampleSize: 120,
      reporterCount: 5,
      // Enriched avgQty from sibling Forever OBSERVED source (not Classic 1.12!)
      avgQty: 2,
      avgQtyIsAssumed: false,
    });
  });

  it("flags avgQtyIsAssumed=true when no Forever observed source carries quantity", () => {
    const resolved = resolveCreatureLoot([
      makeObs({
        source: "everloot",
        confidenceTier: "VERIFIED",
        dropRate: 0.25,
        killsObserved: 80,
        dropsObserved: 20,
        reporterCount: 4,
        avgQty: null,
      }),
      makeObs({
        source: "classic_db",
        confidenceTier: "ESTIMATED",
        dropRate: 0.4,
        avgQty: 3, // must NOT leak onto Forever VERIFIED row
      }),
    ]);

    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.avgQty).toBe(1);
    expect(resolved[0]?.avgQtyIsAssumed).toBe(true);
  });

  it("keeps distinct loot methods (kill vs skinning) separate", () => {
    const resolved = resolveCreatureLoot([
      makeObs({ lootMethod: "kill", itemId: 2589, dropRate: 0.2 }),
      makeObs({ lootMethod: "skinning", itemId: 2934, dropRate: 0.8 }),
    ]);

    expect(resolved).toHaveLength(2);
    expect(resolved.map((r) => r.lootMethod).sort()).toEqual(["kill", "skinning"]);
  });

  it("rejects out-of-bounds drop rates, invalid IDs, and unknown catalog references", () => {
    const knownCreatures = new Set([95]);
    const knownItems = new Set([2589]);

    const res = validateDropObservations(
      [
        makeObs({ creatureId: 95, itemId: 2589, dropRate: 0.25 }),
        makeObs({ creatureId: 95, itemId: 2589, dropRate: 1.5 }), // invalid rate
        makeObs({ creatureId: 99999, itemId: 2589, dropRate: 0.25 }), // unknown creature
        makeObs({ creatureId: 95, itemId: 88888, dropRate: 0.25 }), // unknown item
        makeObs({
          creatureId: 95,
          itemId: 2589,
          dropRate: 0.5,
          killsObserved: 10,
          dropsObserved: 15, // drops > kills
        }),
      ],
      knownCreatures,
      knownItems
    );

    expect(res.valid).toHaveLength(1);
    expect(res.rejected).toHaveLength(4);
  });
});
