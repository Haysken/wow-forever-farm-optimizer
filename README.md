# WoW Forever — Farm Profit Optimizer

A data-driven economic analysis web application for **World of Warcraft: Forever** that cross-references creature loot databases with live Auction House market data (Alliance, Horde, and Neutral Blackwater) to answer:

> **"Which creature should I farm right now to maximize my gold per hour?"**

---

## Key Capabilities

- **Multi-Source Creature & Loot Database:** Combines WoW Forever client data (`1.60.1.x`), player-observed drop rates with sample sizes & 95% confidence intervals (Everloot / EverlookDB), and clearly badged Classic 1.12 fallbacks (`ESTIMATED`).
- **Full WoW Forever Auction House & New Items Explorer (`/market`):** Syncs every active item across US/EU Unified pools (`us:0`, `eu:0`) and individual Alliance, Horde, and Neutral (Blackwater) houses — including 1,200+ brand-new WoW Forever items (`ID >= 200,000`) with live prices, 24h deltas, supply, and estimated daily sales.
- **Expected Gold per Hour (EGPH) Engine:** Evaluates *all* relevant creature drops (AH-sellable items, vendor floor / BoP liquidation, raw coin drops), market liquidity, selling probability, farming speed, and hourly expenses — separating statistical expected value from simulated runs.
- **Interactive Economic Tools:** Farm Ranking Dashboard, Auction House & New Items Explorer (`/market`), Creature Detail Verdict Pages, Item Source Comparison Pages, 24h/7d/30d Price & Profitability Charts, Farming Simulator, Watchlist, and Opportunity Alerts.
- **Strict Data Provenance:** Every number is explicitly tagged (`VERIFIED`, `OBSERVED`, `ESTIMATED`, or `UNKNOWN`) with source attribution and freshness timestamps. Never fabricates prices, history, or drop rates.

---

## Project Documentation

| Document | Description |
|---|---|
| [PROJECT_SPEC.md](PROJECT_SPEC.MD) | Primary product specification and acceptance criteria |
| [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md) | Empirical verification of external APIs, coverage, rate limits, and licenses |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System architecture, stack evaluation, PostgreSQL/Drizzle schema, and profitability engine spec |
| [docs/DEVELOPMENT_PLAN.md](docs/DEVELOPMENT_PLAN.md) | Phased incremental roadmap and validation criteria |
| [GIT_WORKFLOW.md](GIT_WORKFLOW.md) | Repository, branching, Conventional Commits, and synchronization workflow |
| [AGENTS.md](AGENTS.MD) | Engineering rules and data-reliability guardrails |

---

## Architecture Overview

- **Frontend / Full-Stack:** Next.js (App Router), React, TypeScript (`strict`), Tailwind CSS, shadcn/ui, Recharts
- **Database & ORM:** PostgreSQL + Drizzle ORM
- **Validation & Testing:** Zod + Vitest
- **Data Providers (Decoupled Adapters):**
  - **Market Data:** Forever AH (`forever-ah.com/v1`) + Blizzard Battle.net Game Data API (canonical / failover)
  - **Catalog & Fallback Loot:** EverlookDB (`everlookdb.com`, build `1.60.1.x`)
  - **Observed WoW Forever Loot:** Everloot (`everloot.app`, CC BY-SA 4.0)

---

## Development Status

- [x] **Phase 1:** Technical feasibility assessment & architecture documentation
- [x] **Phase 2:** Data foundation (PostgreSQL/Drizzle schema + migrations, provider adapters, loot resolver, ingestion workers, unit & live smoke tests)
- [x] **Phase 3:** Core profitability engine (EGPH, EGPK, K50/K90, liquidity & `Si` model, vendor/BoP/coin routing, Monte Carlo farming simulator, PostgreSQL ranking service, full mathematical test suite)
- [x] **Phase 4:** Web application (Farm Ranking Dashboard, Creature Detail Verdict pages, Item Detail Cross-Faction pages, Recharts 24h/7d/30d history, Farming Simulator, Watchlist, Market Opportunities)
- [x] **Phase 5:** Optimization, scheduled sync, PostgreSQL `pg_trgm` indexing, TTL caching, staleness monitoring & end-to-end live verification

---

## Local Setup & Data Sync Commands

```bash
# 1. Install dependencies
npm install

# 2. Configure local environment (never commit .env.local)
cp .env.example .env.local
# Edit .env.local and set DATABASE_URL (e.g., local portable PG17 or Neon/Supabase)
# If using local portable PostgreSQL 17:
#   .\scripts\start-pg.ps1   (start local server on 127.0.0.1:5432)
#   .\scripts\stop-pg.ps1    (stop local server)
# Optional: set EVERLOOKDB_API_KEY, BLIZZARD_CLIENT_ID, BLIZZARD_CLIENT_SECRET

# 3. Apply PostgreSQL migrations
npm run db:migrate

# 4. Ingest live WoW Forever data & optimize search indexes
npm run sync:catalog          # Zones, items (22.8k), creatures (9.9k) from EverlookDB
npm run sync:loot             # Observed WoW Forever drops from Everloot (+ optional EverlookDB NPCs)
npm run sync:markets          # Alliance, Horde, Blackwater, and Unified AH snapshots from Forever AH
npm run sync:markets:unified  # Full regional snapshot (all active items including new 250xxx items in US/EU)
npm run sync:variants         # Random-enchant item variants (itemId:suffixId) from EverlookDB addon scans
npm run db:optimize           # Applies pg_trgm GIN indexes + composite snapshot indexes + ANALYZE
npm run sync:all              # Combined scheduled sync orchestrator (see scripts/github-actions-scheduled-sync.yml)
npm run watch:addon           # Optional: auto-import SavedVariables/WoWForeverFarmOptimizer.lua on /reload

# 5. Run checks & development server
npm run typecheck
npm run lint
npm test
npm run dev
```

---

## Attribution & Legal Notice

- *World of Warcraft* and *Blizzard Entertainment* are trademarks or registered trademarks of Blizzard Entertainment, Inc. This is an independent, non-commercial community tool and is not affiliated with or endorsed by Blizzard Entertainment.
- Observed loot data from **Everloot** is licensed under **CC BY-SA 4.0**.
- Classic 1.12 fallback references originate from **CMaNGOS `classic-db`** (GPL-3.0) via **EverlookDB**.
- Auction House market data is sourced from **Forever AH** and the **Blizzard Battle.net Game Data API**.
