import { truncateError } from "@/lib/cache";
import { loadLocalEnv } from "@/lib/env";
import { eq, sql } from "drizzle-orm";

loadLocalEnv();
import { closeDb, getDb, schema } from "@/db";
import { EverlookDBVariantAdapter } from "@/providers/everlookdb-variants";

export async function runVariantSync(): Promise<{
  housesSynced: number;
  variantsUpserted: number;
  snapshotsUpserted: number;
  skippedUnknownItems: number;
}> {
  const db = getDb();
  const adapter = new EverlookDBVariantAdapter({ maxRps: 2 });

  const [run] = await db
    .insert(schema.syncRuns)
    .values({
      provider: adapter.sourceId,
      jobType: "variant_snapshot",
      status: "running",
    })
    .returning();

  const runId = run?.id;

  try {
    const itemRows = await db
      .select({ id: schema.items.id, name: schema.items.name })
      .from(schema.items);
    const baseNameById = new Map<number, string>(
      itemRows.map((r) => [r.id, r.name])
    );

    const houses = await adapter.fetchHouses();
    let totalVariantsUpserted = 0;
    let totalSnapshotsUpserted = 0;
    let skippedUnknownItems = 0;

    const seenVariants = new Set<string>();

    for (const house of houses) {
      const rows = await adapter.fetchHouseVariants(house, baseNameById);
      const validRows = rows.filter((r) => {
        if (!baseNameById.has(r.itemId)) {
          skippedUnknownItems += 1;
          return false;
        }
        return true;
      });

      // Deduplicate by variantId within a house snapshot
      const deduped = Array.from(
        new Map(validRows.map((r) => [r.variantId, r])).values()
      );

      const newVariants = deduped.filter((r) => !seenVariants.has(r.variantId));
      for (let i = 0; i < newVariants.length; i += 300) {
        const chunk = newVariants.slice(i, i + 300);
        await db
          .insert(schema.itemVariants)
          .values(
            chunk.map((r) => ({
              id: r.variantId,
              itemId: r.itemId,
              suffixId: r.suffixId,
              fullName: r.fullName,
              suffixName: r.suffixName,
              source: adapter.sourceId,
              updatedAt: new Date(),
            }))
          )
          .onConflictDoUpdate({
            target: schema.itemVariants.id,
            set: {
              fullName: sql`excluded.full_name`,
              suffixName: sql`excluded.suffix_name`,
              updatedAt: new Date(),
            },
          });

        for (const r of chunk) {
          seenVariants.add(r.variantId);
        }
        totalVariantsUpserted += chunk.length;
      }

      for (let i = 0; i < deduped.length; i += 300) {
        const chunk = deduped.slice(i, i + 300);
        await db
          .insert(schema.itemVariantSnapshots)
          .values(
            chunk.map((r) => ({
              variantId: r.variantId,
              houseKey: r.houseKey,
              region: r.region,
              faction: r.faction,
              realmLabel: r.realmLabel,
              lowestBuyoutCopper: r.lowestBuyoutCopper,
              p10Copper: r.p10Copper,
              medianCopper: r.medianCopper,
              clearingPriceCopper: r.clearingPriceCopper,
              baseReferenceCopper: r.baseReferenceCopper,
              availableQty: r.availableQty,
              listingCount: r.listingCount,
              timeLeftShort: r.timeLeftShort,
              timeLeftMedium: r.timeLeftMedium,
              timeLeftLong: r.timeLeftLong,
              timeLeftVeryLong: r.timeLeftVeryLong,
              priceStatus: "ACTUAL" as const,
              source: adapter.sourceId,
              snapshotAt: r.snapshotAt,
            }))
          )
          .onConflictDoUpdate({
            target: [
              schema.itemVariantSnapshots.variantId,
              schema.itemVariantSnapshots.houseKey,
            ],
            set: {
              realmLabel: sql`excluded.realm_label`,
              lowestBuyoutCopper: sql`excluded.lowest_buyout_copper`,
              p10Copper: sql`excluded.p10_copper`,
              medianCopper: sql`excluded.median_copper`,
              clearingPriceCopper: sql`excluded.clearing_price_copper`,
              baseReferenceCopper: sql`excluded.base_reference_copper`,
              availableQty: sql`excluded.available_qty`,
              listingCount: sql`excluded.listing_count`,
              timeLeftShort: sql`excluded.time_left_short`,
              timeLeftMedium: sql`excluded.time_left_medium`,
              timeLeftLong: sql`excluded.time_left_long`,
              timeLeftVeryLong: sql`excluded.time_left_very_long`,
              priceStatus: sql`excluded.price_status`,
              snapshotAt: sql`excluded.snapshot_at`,
            },
          });

        totalSnapshotsUpserted += chunk.length;
      }
    }

    if (runId) {
      await db
        .update(schema.syncRuns)
        .set({
          status: "succeeded",
          recordsProcessed: totalSnapshotsUpserted,
          recordsFailed: skippedUnknownItems,
          finishedAt: new Date(),
        })
        .where(eq(schema.syncRuns.id, runId));
    }

    return {
      housesSynced: houses.length,
      variantsUpserted: totalVariantsUpserted,
      snapshotsUpserted: totalSnapshotsUpserted,
      skippedUnknownItems,
    };
  } catch (error) {
    if (runId) {
      await db
        .update(schema.syncRuns)
        .set({
          status: "failed",
          errorSummary: truncateError(error, 500),
          finishedAt: new Date(),
        })
        .where(eq(schema.syncRuns.id, runId));
    }
    throw error;
  }
}

const isMain = process.argv[1]?.endsWith("sync-variants.ts");
if (isMain) {
  runVariantSync()
    .then((res) => {
      console.log("[sync:variants] completed:", res);
    })
    .catch((err) => {
      console.error("[sync:variants] failed:", err);
      process.exitCode = 1;
    })
    .finally(() => closeDb());
}
