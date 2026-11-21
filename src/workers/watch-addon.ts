import fs from "node:fs";
import path from "node:path";
import { loadLocalEnv } from "@/lib/env";
import { closeDb } from "@/db";
import { importSavedVariablesToDb } from "@/ingestion/on-demand-hydrator";

loadLocalEnv();

/**
 * Optional local companion watcher for the WoW Forever Farm Optimizer Lua addon.
 * Set WOW_SAVEDVARS_PATH in .env.local pointing to:
 *   <WoW>/_forever_/WTF/Account/<ACCOUNT>/SavedVariables/WoWForeverFarmOptimizer.lua
 *
 * Whenever the player executes /reload or logs out, this script detects the file
 * update and imports real observed drops & kills/hr into PostgreSQL automatically.
 */
async function startWatcher() {
  const targetPath = process.env.WOW_SAVEDVARS_PATH?.trim();
  if (!targetPath) {
    console.error(
      "[watch:addon] WOW_SAVEDVARS_PATH is not set in .env.local.\n" +
        "Set it to your SavedVariables/WoWForeverFarmOptimizer.lua file, or upload manually at /import."
    );
    process.exit(1);
  }

  const resolved = path.resolve(targetPath);
  if (!fs.existsSync(resolved)) {
    console.error(`[watch:addon] File not found: ${resolved}`);
    process.exit(1);
  }

  const marketId = process.env.WATCH_ADDON_MARKET_ID?.trim() || "us:0";
  let lastMtimeMs = 0;

  const syncOnce = async () => {
    try {
      const stat = fs.statSync(resolved);
      if (stat.mtimeMs === lastMtimeMs) return;
      lastMtimeMs = stat.mtimeMs;

      const content = fs.readFileSync(resolved, "utf-8");
      const summary = await importSavedVariablesToDb(content, marketId);
      console.log(
        `[watch:addon] Imported ${summary.creaturesParsed} creatures, ${summary.observationsSaved} loot rows, ${summary.itemsHydrated} items hydrated.`
      );
    } catch (err) {
      console.error(
        "[watch:addon] Sync error:",
        err instanceof Error ? err.message : err
      );
    }
  };

  console.log(`[watch:addon] Watching ${resolved} (press Ctrl+C to stop)...`);
  await syncOnce();

  const watcher = fs.watch(resolved, () => {
    setTimeout(() => {
      void syncOnce();
    }, 500);
  });

  process.on("SIGINT", async () => {
    watcher.close();
    await closeDb();
    process.exit(0);
  });
}

void startWatcher();
