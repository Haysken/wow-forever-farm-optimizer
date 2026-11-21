# WoW Forever — Farm Profit Optimizer

A data-driven economic analysis web application for **World of Warcraft: Forever** that cross-references creature loot databases with live Auction House market data (Alliance, Horde, and Neutral Blackwater) to answer:

> **"Which creature should I farm right now to maximize my gold per hour?"**

---

## Key Capabilities (Planned)

- **Multi-Source Creature & Loot Database:** Combines WoW Forever client data (`1.60.1.x`), player-observed drop rates with sample sizes & 95% confidence intervals (Everloot / EverlookDB), and clearly badged Classic 1.12 fallbacks (`ESTIMATED`).
- **Independent Faction Auction House Markets:** Tracks Alliance, Horde, and Neutral (Blackwater) Auction Houses across US/EU rulesets with configurable AH commissions (default 5% faction, 15% neutral).
- **Expected Gold per Hour (EGPH) Engine:** Evaluates *all* relevant creature drops (AH-sellable items, vendor floor / BoP liquidation, raw coin drops), market liquidity, selling probability, farming speed, and hourly expenses — separating statistical expected value from simulated runs.
- **Interactive Economic Tools:** Farm Ranking Dashboard, Creature Detail Verdict Pages, Item Source Comparison Pages, 24h/7d/30d Price & Profitability Charts, Farming Simulator, Watchlist, and Opportunity Alerts.
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
- [x] **Phase 2:** Data foundation (PostgreSQL/Drizzle schema + migrations, provider adapters, loot resolver, ingestion workers, unit & live smoke tests) *(ready for live DB migration once `DATABASE_URL` is configured in `.env.local`)*
- [ ] **Phase 3:** Core profitability engine & mathematical test suite
- [ ] **Phase 4:** Web application (Dashboard, Creature/Item pages, Charts, Simulator, Watchlist)
- [ ] **Phase 5:** Optimization, scheduled sync, monitoring & production hardening

---

## Local Setup & Data Sync Commands

```bash
# 1. Install dependencies
npm install

# 2. Configure local environment (never commit .env.local)
cp .env.example .env.local
# Edit .env.local and set DATABASE_URL (e.g., Neon/Supabase PostgreSQL)
# Optional: set EVERLOOKDB_API_KEY, BLIZZARD_CLIENT_ID, BLIZZARD_CLIENT_SECRET

# 3. Apply PostgreSQL migrations
npm run db:migrate

# 4. Ingest live WoW Forever data
npm run sync:catalog   # Zones, items (22.8k), creatures (9.9k) from EverlookDB
npm run sync:loot      # Observed WoW Forever drops from Everloot (+ optional EverlookDB NPCs)
npm run sync:markets   # Alliance, Horde, and Blackwater AH snapshots from Forever AH

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
