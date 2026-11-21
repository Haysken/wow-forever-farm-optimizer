import { loadLocalEnv } from "@/lib/env";
import { closeDb } from "@/db";
import { runCatalogSync } from "@/workers/sync-catalog";
import { runLootSync } from "@/workers/sync-loot";
import { runMarketSync } from "@/workers/sync-markets";

loadLocalEnv();

async function runAll() {
  const includeCatalog = process.env.SYNC_INCLUDE_CATALOG === "1";
  const includeLoot = process.env.SYNC_INCLUDE_LOOT === "1";

  const summary: Record<string, unknown> = {
    startedAt: new Date().toISOString(),
  };

  if (includeCatalog) {
    summary.catalog = await runCatalogSync();
  }
  if (includeLoot) {
    const npcIds = process.env.SYNC_EVERLOOK_NPC_IDS
      ? process.env.SYNC_EVERLOOK_NPC_IDS.split(",")
          .map((s) => Number(s.trim()))
          .filter((n) => Number.isInteger(n) && n > 0)
      : [];
    summary.loot = await runLootSync({ everlookNpcIds: npcIds });
  }

  summary.markets = await runMarketSync();
  summary.finishedAt = new Date().toISOString();
  return summary;
}

runAll()
  .then((res) => {
    console.log("[sync:all] completed:", JSON.stringify(res, null, 2));
  })
  .catch((err) => {
    console.error("[sync:all] failed:", err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
