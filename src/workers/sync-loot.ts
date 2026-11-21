import "dotenv/config";
import { eq, sql } from "drizzle-orm";
import { closeDb, getDb, schema } from "@/db";
import { resolveCreatureLoot } from "@/ingestion/loot-resolver";
import { validateDropObservations } from "@/ingestion/validators";
import { EverlookDBLootAdapter } from "@/providers/everlookdb-loot";
import { EverlootLootAdapter } from "@/providers/everloot-loot";
import type { NormalizedDropObservation } from "@/providers/types";

export interface SyncLootOptions {
  /** Optional list of NPC IDs to also enrich via EverlookDB (players + classic_db fallback). */
  everlookNpcIds?: number[];
}

export async function runLootSync(options: SyncLootOptions = {}): Promise<{
  observationsUpserted: number;
  observationsRejected: number;
  resolvedLootCount: number;
}> {
  const db = getDb();
  const everloot = new EverlootLootAdapter();
  const everlookLoot = new EverlookDBLootAdapter();

  const [run] = await db
    .insert(schema.syncRuns)
    .values({
      provider: "everloot+everlookdb",
      jobType: "loot",
      status: "running",
    })
    .returning();

  const runId = run?.id;

  try {
    const [itemRows, creatureRows] = await Promise.all([
      db.select({ id: schema.items.id }).from(schema.items),
      db.select({ id: schema.creatures.id }).from(schema.creatures),
    ]);

    const knownItemIds = new Set(itemRows.map((r) => r.id));
    const knownCreatureIds = new Set(creatureRows.map((r) => r.id));

    const allObservations: NormalizedDropObservation[] = [];

    // 1. Primary WoW Forever observed drops from Everloot (CC BY-SA 4.0)
    const everlootRes = await everloot.fetchDrops();
    allObservations.push(...everlootRes.observations);

    // 2. Optional EverlookDB per-NPC enrichment (players OBSERVED + classic_db ESTIMATED)
    const targetNpcIds = options.everlookNpcIds ?? [];
    for (const npcId of targetNpcIds) {
      if (!knownCreatureIds.has(npcId)) continue;
      const bundle = await everlookLoot.fetchNpcLoot(npcId);
      allObservations.push(...bundle.observations);

      if (bundle.healthMin !== null || bundle.rawCoinMinCopper !== null) {
        await db
          .update(schema.creatures)
          .set({
            healthMin: bundle.healthMin,
            healthMax: bundle.healthMax,
            rawCoinMinCopper: bundle.rawCoinMinCopper,
            rawCoinMaxCopper: bundle.rawCoinMaxCopper,
            rawCoinSource: bundle.rawCoinSource,
            updatedAt: new Date(),
          })
          .where(eq(schema.creatures.id, npcId));
      }
    }

    const { valid, rejected } = validateDropObservations(
      allObservations,
      knownCreatureIds,
      knownItemIds
    );

    for (let i = 0; i < valid.length; i += 250) {
      const chunk = valid.slice(i, i + 250);
      await db
        .insert(schema.dropObservations)
        .values(
          chunk.map((o) => ({
            creatureId: o.creatureId,
            itemId: o.itemId,
            lootMethod: o.lootMethod,
            source: o.source,
            killsObserved: o.killsObserved,
            dropsObserved: o.dropsObserved,
            totalQtyObserved: o.totalQtyObserved,
            minQty: o.minQty,
            maxQty: o.maxQty,
            avgQty: o.avgQty !== null ? o.avgQty.toFixed(4) : null,
            dropRate: o.dropRate.toFixed(8),
            ciLow: o.ciLow !== null ? o.ciLow.toFixed(8) : null,
            ciHigh: o.ciHigh !== null ? o.ciHigh.toFixed(8) : null,
            reporterCount: o.reporterCount,
            confidenceTier: o.confidenceTier,
            isQuestOnly: o.isQuestOnly,
            clientBuild: o.clientBuild,
            observedAt: o.observedAt,
          }))
        )
        .onConflictDoUpdate({
          target: [
            schema.dropObservations.creatureId,
            schema.dropObservations.itemId,
            schema.dropObservations.lootMethod,
            schema.dropObservations.source,
          ],
          set: {
            killsObserved: sql`excluded.kills_observed`,
            dropsObserved: sql`excluded.drops_observed`,
            totalQtyObserved: sql`excluded.total_qty_observed`,
            avgQty: sql`excluded.avg_qty`,
            dropRate: sql`excluded.drop_rate`,
            ciLow: sql`excluded.ci_low`,
            ciHigh: sql`excluded.ci_high`,
            reporterCount: sql`excluded.reporter_count`,
            confidenceTier: sql`excluded.confidence_tier`,
            isQuestOnly: sql`excluded.is_quest_only`,
            observedAt: sql`excluded.observed_at`,
          },
        });
    }

    // Re-resolve active loot entries deterministically across all stored observations
    const resolved = resolveCreatureLoot(valid);
    for (let i = 0; i < resolved.length; i += 250) {
      const chunk = resolved.slice(i, i + 250);
      await db
        .insert(schema.creatureLootResolved)
        .values(
          chunk.map((r) => ({
            creatureId: r.creatureId,
            itemId: r.itemId,
            lootMethod: r.lootMethod,
            dropRate: r.dropRate.toFixed(8),
            minQty: r.minQty,
            maxQty: r.maxQty,
            avgQty: r.avgQty.toFixed(4),
            avgQtyIsAssumed: r.avgQtyIsAssumed,
            sampleSize: r.sampleSize,
            reporterCount: r.reporterCount,
            ciLow: r.ciLow !== null ? r.ciLow.toFixed(8) : null,
            ciHigh: r.ciHigh !== null ? r.ciHigh.toFixed(8) : null,
            confidenceTier: r.confidenceTier,
            source: r.source,
            isQuestOnly: r.isQuestOnly,
            resolvedAt: r.resolvedAt,
          }))
        )
        .onConflictDoUpdate({
          target: [
            schema.creatureLootResolved.creatureId,
            schema.creatureLootResolved.itemId,
            schema.creatureLootResolved.lootMethod,
          ],
          set: {
            dropRate: sql`excluded.drop_rate`,
            minQty: sql`excluded.min_qty`,
            maxQty: sql`excluded.max_qty`,
            avgQty: sql`excluded.avg_qty`,
            avgQtyIsAssumed: sql`excluded.avg_qty_is_assumed`,
            sampleSize: sql`excluded.sample_size`,
            reporterCount: sql`excluded.reporter_count`,
            ciLow: sql`excluded.ci_low`,
            ciHigh: sql`excluded.ci_high`,
            confidenceTier: sql`excluded.confidence_tier`,
            source: sql`excluded.source`,
            isQuestOnly: sql`excluded.is_quest_only`,
            resolvedAt: sql`excluded.resolved_at`,
          },
        });
    }

    if (runId) {
      await db
        .update(schema.syncRuns)
        .set({
          status: rejected.length > 0 ? "partial" : "succeeded",
          recordsProcessed: valid.length,
          recordsFailed: rejected.length,
          finishedAt: new Date(),
        })
        .where(eq(schema.syncRuns.id, runId));
    }

    return {
      observationsUpserted: valid.length,
      observationsRejected: rejected.length,
      resolvedLootCount: resolved.length,
    };
  } catch (error) {
    if (runId) {
      await db
        .update(schema.syncRuns)
        .set({
          status: "failed",
          errorSummary: error instanceof Error ? error.message : String(error),
          finishedAt: new Date(),
        })
        .where(eq(schema.syncRuns.id, runId));
    }
    throw error;
  }
}

const isMain = process.argv[1]?.endsWith("sync-loot.ts");
if (isMain) {
  const npcIdsArg = process.env.SYNC_EVERLOOK_NPC_IDS
    ? process.env.SYNC_EVERLOOK_NPC_IDS.split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n) && n > 0)
    : [];

  runLootSync({ everlookNpcIds: npcIdsArg })
    .then((res) => {
      console.log("[sync:loot] completed:", res);
    })
    .catch((err) => {
      console.error("[sync:loot] failed:", err);
      process.exitCode = 1;
    })
    .finally(() => closeDb());
}
