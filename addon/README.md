# WoW Forever Farm Optimizer — In-Game Companion Addon

Lightweight, 100% read-only Lua addon for **World of Warcraft: Forever** (`1.60.1.x`).

## What It Collects (Passively While You Play)
- **Real WoW Forever creature drops** (including brand-new Classic+ `250xxx` items like *Recipe: Elixir of Strength* not found in Classic 1.12 databases).
- **Exact drop quantities (`Qi`)** and **raw copper drops**.
- **Empty corpse tracking** (prevents upward drop-rate bias).
- **Real farming speed (`K` kills/hour)** measured from active farming intervals.
- **Map spawn coordinates `(x, y)`** per creature.
- **Zero automation / zero memory reading / zero AH botting.**

## Installation (3 Steps)
1. Copy the folder `addon/WoWForeverFarmOptimizer` into your WoW Forever AddOns directory:
   ```text
   <WoW Folder>/_forever_/Interface/AddOns/WoWForeverFarmOptimizer/
   ```
2. Play normally. Type `/wffo` in chat anytime to check recorded kills/drops, `/wffo start` and `/wffo stop` for timed sessions, and `/reload` (or log out) to flush data to disk.
3. Upload your saved file on the website at **`/import`**:
   ```text
   <WoW Folder>/_forever_/WTF/Account/<ACCOUNT_NAME>/SavedVariables/WoWForeverFarmOptimizer.lua
   ```
   *(Or run `npm run watch:addon` locally with `WOW_SAVEDVARS_PATH` set in `.env.local` for automatic sync.)*
