import "dotenv/config";
import { eq, sql } from "drizzle-orm";
import { closeDb, getDb, schema } from "@/db";
import { deduplicateById } from "@/ingestion/validators";
import { EverlookDBCatalogAdapter } from "@/providers/everlookdb-catalog";

const BATCH_SIZE = 500;

async function chunked<T>(rows: T[], fn: (chunk: T[]) => Promise<void>): Promise<void> {
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    await fn(rows.slice(i, i + BATCH_SIZE));
  }
}

export async function runCatalogSync(): Promise<{
  zonesUpserted: number;
  itemsUpserted: number;
  creaturesUpserted: number;
  clientBuild: string | null;
}> {
  const db = getDb();
  const adapter = new EverlookDBCatalogAdapter();

  const [run] = await db
    .insert(schema.syncRuns)
    .values({
      provider: adapter.sourceId,
      jobType: "catalog",
      status: "running",
    })
    .returning();

  const runId = run?.id;

  try {
    const [zonePayload, itemPayload, creaturePayload] = await Promise.all([
      adapter.fetchZones(),
      adapter.fetchItems(),
      adapter.fetchCreatures(),
    ]);

    const clientBuild =
      itemPayload.build ?? creaturePayload.build ?? zonePayload.build;

    const { unique: uniqueZones } = deduplicateById(zonePayload.zones);
    const { unique: uniqueItems } = deduplicateById(itemPayload.items);
    const { unique: uniqueCreatures } = deduplicateById(creaturePayload.creatures);

    const zoneNameToId = new Map<string, number>();
    for (const z of uniqueZones) {
      zoneNameToId.set(z.name.toLowerCase(), z.id);
    }

    await chunked(uniqueZones, async (chunk) => {
      await db
        .insert(schema.zones)
        .values(
          chunk.map((z) => ({
            id: z.id,
            name: z.name,
            continent: z.continent,
            faction: z.faction,
            kind: z.kind,
            minLevel: z.minLevel,
            maxLevel: z.maxLevel,
            isInstance: z.isInstance,
            source: z.source,
            clientBuild: z.clientBuild,
            updatedAt: new Date(),
          }))
        )
        .onConflictDoUpdate({
          target: schema.zones.id,
          set: {
            name: sql`excluded.name`,
            continent: sql`excluded.continent`,
            faction: sql`excluded.faction`,
            kind: sql`excluded.kind`,
            minLevel: sql`excluded.min_level`,
            maxLevel: sql`excluded.max_level`,
            isInstance: sql`excluded.is_instance`,
            clientBuild: sql`excluded.client_build`,
            updatedAt: new Date(),
          },
        });
    });

    await chunked(uniqueItems, async (chunk) => {
      await db
        .insert(schema.items)
        .values(
          chunk.map((item) => ({
            id: item.id,
            name: item.name,
            quality: item.quality,
            qualityName: item.qualityName,
            itemClass: item.itemClass,
            itemSubclass: item.itemSubclass,
            itemLevel: item.itemLevel,
            requiredLevel: item.requiredLevel,
            bindType: item.bindType,
            vendorSellCopper: item.vendorSellCopper,
            vendorBuyCopper: item.vendorBuyCopper,
            maxStack: item.maxStack,
            isCommodity: item.isCommodity,
            iconId: item.iconId,
            iconUrl: item.iconUrl,
            description: item.description,
            foreverStatus: item.foreverStatus,
            source: item.source,
            clientBuild: item.clientBuild,
            updatedAt: new Date(),
          }))
        )
        .onConflictDoUpdate({
          target: schema.items.id,
          set: {
            name: sql`excluded.name`,
            quality: sql`excluded.quality`,
            qualityName: sql`excluded.quality_name`,
            itemClass: sql`excluded.item_class`,
            itemSubclass: sql`excluded.item_subclass`,
            itemLevel: sql`excluded.item_level`,
            requiredLevel: sql`excluded.required_level`,
            bindType: sql`excluded.bind_type`,
            vendorSellCopper: sql`excluded.vendor_sell_copper`,
            vendorBuyCopper: sql`excluded.vendor_buy_copper`,
            maxStack: sql`excluded.max_stack`,
            isCommodity: sql`excluded.is_commodity`,
            iconId: sql`excluded.icon_id`,
            iconUrl: sql`excluded.icon_url`,
            description: sql`excluded.description`,
            clientBuild: sql`excluded.client_build`,
            updatedAt: new Date(),
          },
        });
    });

    await chunked(uniqueCreatures, async (chunk) => {
      await db
        .insert(schema.creatures)
        .values(
          chunk.map((c) => ({
            id: c.id,
            name: c.name,
            minLevel: c.minLevel,
            maxLevel: c.maxLevel,
            creatureType: c.creatureType,
            creatureFamily: c.creatureFamily,
            classification: c.classification,
            factionRestriction: c.factionRestriction,
            healthMin: c.healthMin,
            healthMax: c.healthMax,
            primaryZoneId: c.primaryZoneName
              ? (zoneNameToId.get(c.primaryZoneName.toLowerCase()) ?? null)
              : null,
            primaryZoneName: c.primaryZoneName,
            rawCoinMinCopper: c.rawCoinMinCopper,
            rawCoinMaxCopper: c.rawCoinMaxCopper,
            rawCoinSource: c.rawCoinSource,
            source: c.source,
            clientBuild: c.clientBuild,
            updatedAt: new Date(),
          }))
        )
        .onConflictDoUpdate({
          target: schema.creatures.id,
          set: {
            name: sql`excluded.name`,
            minLevel: sql`excluded.min_level`,
            maxLevel: sql`excluded.max_level`,
            creatureType: sql`excluded.creature_type`,
            creatureFamily: sql`excluded.creature_family`,
            classification: sql`excluded.classification`,
            primaryZoneId: sql`excluded.primary_zone_id`,
            primaryZoneName: sql`excluded.primary_zone_name`,
            clientBuild: sql`excluded.client_build`,
            updatedAt: new Date(),
          },
        });
    });

    const total = uniqueZones.length + uniqueItems.length + uniqueCreatures.length;
    if (runId) {
      await db
        .update(schema.syncRuns)
        .set({
          status: "succeeded",
          recordsProcessed: total,
          clientBuild,
          finishedAt: new Date(),
        })
        .where(eq(schema.syncRuns.id, runId));
    }

    return {
      zonesUpserted: uniqueZones.length,
      itemsUpserted: uniqueItems.length,
      creaturesUpserted: uniqueCreatures.length,
      clientBuild,
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

const isMain = process.argv[1]?.endsWith("sync-catalog.ts");
if (isMain) {
  runCatalogSync()
    .then((res) => {
      console.log("[sync:catalog] completed:", res);
    })
    .catch((err) => {
      console.error("[sync:catalog] failed:", err);
      process.exitCode = 1;
    })
    .finally(() => closeDb());
}
