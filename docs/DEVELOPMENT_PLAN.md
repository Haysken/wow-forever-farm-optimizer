# DEVELOPMENT PLAN — WOW FOREVER FARM OPTIMIZER

- **Status:** Phases 1–5 Completed & Verified Live (PostgreSQL 17 + Next.js Production Build)
- **Date:** 2026-11-21
- **Workflow Rules:** Follows `PROJECT_SPEC.md` Section 12, `AGENTS.md`, and `GIT_WORKFLOW.md` (Conventional Commits, `main` + `feature/*` branches, mandatory commit & push after every validated task).

---

## Phase 0 — Prerequisites & Repository Bootstrap (Blocked on User Action)

### What Will Be Done
1. User installs GitHub CLI (`gh`) and authenticates (`gh auth login`).
2. User approves the Feasibility Assessment and open decisions in `docs/ARCHITECTURE.md` Section 8.
3. Agent executes initial GitHub bootstrap:
   - Create GitHub repository `wow-forever-farm-optimizer`.
   - Initialize local Git on `main` (`git init -b main`) and configure `origin`.
   - Create `.gitignore` (Node/Next.js, `.env*`, Drizzle artifacts, logs, OS/editor files) and comprehensive `README.md`.
   - Commit specifications (`PROJECT_SPEC.md`, `AGENTS.md`, `GIT_WORKFLOW.md`) and Phase 1 docs (`docs/DATA_SOURCES.md`, `docs/ARCHITECTURE.md`, `docs/DEVELOPMENT_PLAN.md`) as initial commit (`chore: initialize repository and phase 1 feasibility docs`).
   - Push `main` to GitHub.

### Dependencies & Potential Problems
- **Verified Blocker:** `gh` CLI is not installed on this workstation; `~/.ssh` does not exist.
- **Verified Local Gaps:** Neither PostgreSQL (`psql`) nor Docker is installed; PowerShell blocks `npm.ps1` (`npm.cmd` required or `Set-ExecutionPolicy RemoteSigned -Scope CurrentUser`).

### Validation Criteria
- `gh auth status` succeeds; `git remote -v` points to GitHub `wow-forever-farm-optimizer`.
- `git status` clean on `main`; initial commit visible on GitHub; zero secrets committed.

---

## Phase 1 — Technical Feasibility Assessment *(Completed — Pending Approval)*

### Deliverables Completed
- Empirical HTTP verification of all proposed APIs (`api.ahledger.com`, `azerite.exchange`, `api.thewowdb.com`, `azerdex.com`, `everloot.app` / `github.com/Everloot/everloot`) and discovered alternatives (`forever-ah.com`, `everlookdb.com`, `wowforever.wclbox.com`, `cmangos/classic-db`, Blizzard Battle.net API).
- Authored [DATA_SOURCES.md](DATA_SOURCES.md), [ARCHITECTURE.md](ARCHITECTURE.md), and [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md).

### Open Verification Item Carried Into Phase 2
- Resolve exact `house_id` (`110–125`) → WoW Forever ruleset/server-group name mapping (Normal, PvP, RP, RP-PvP, etc.) using Blizzard API `/data/wow/ruleset/index` or verified community mapping.

---

## Phase 2 — Data Foundation & Ingestion Pipeline

**Branch:** `feature/data-foundation` → merge to `main` after validation.

### What Will Be Implemented
1. **Application Scaffold:** Next.js (App Router) + TypeScript (`strict: true`) + Tailwind CSS + shadcn/ui + Drizzle ORM + Vitest + Zod + ESLint.
2. **PostgreSQL Schema & Migrations:** All tables defined in `docs/ARCHITECTURE.md` Section 5 (`zones`, `items`, `creatures`, `creature_spawns`, `drop_observations`, `creature_loot_resolved`, `ah_markets`, `item_market_snapshots`, `item_price_history`, `item_sales_estimates`, `user_watchlists`, `farming_presets`, `sync_runs`).
3. **Catalog Adapter & Worker (`everlookdb`):** Ingest `items.json` (22,806 items), `npcs.json` (8,736 NPCs), `zones.json` for build `1.60.1.x` with Zod validation.
4. **Loot Observation Adapters & Resolver:**
   - Primary Forever Observed adapter: `everloot.app/api/rollups/drops` (`VERIFIED` / `OBSERVED` tiers with sample size, reporters, 95% CI).
   - Secondary Forever Observed + Classic Fallback adapter: `everlookdb.com` (`players` layer as `OBSERVED`, `classic_db` layer strictly tagged `ESTIMATED`).
   - Deterministic loot resolver populating `creature_loot_resolved` without double-counting.
5. **Market Data Adapter & Hourly Snapshot Worker:**
   - Primary MVP adapter: `forever-ah.com/v1` (all US/EU Alliance, Horde, and Blackwater houses; rate-limited `<= 1 req/s`; supports current snapshots, stats, and 24h/7d/30d history).
   - Canonical adapter interface + Blizzard Battle.net API adapter (implemented if user supplies credentials, otherwise stubbed cleanly with documented env config).
6. **ID Cross-Validation & Integration Tests:** Automated tests verifying item/creature foreign-key integrity, provenance tagging, rate-limiter compliance, and mock + live-smoke ingestion.

### Dependencies & Potential Problems
- Requires PostgreSQL connection URL (local or Neon/Supabase).
- Fetching per-NPC `/npc/{id}.json` for all 8,736 NPCs from EverlookDB at 5 req/s would take ~30 minutes; prioritize obtaining a free EverlookDB API key (50 req/s → ~3 min) and/or ingesting `classic_db` bulk + on-demand/incremental sync of observed NPCs first.
- `house_id` → ruleset label mapping must be verified so UI market selector displays accurate ruleset names (never invented labels).

### Validation Criteria
- `drizzle-kit migrate` runs cleanly on fresh PostgreSQL DB.
- Real items, creatures, zones, Forever observed drops, Classic estimated fallbacks, and live US/EU Alliance + Horde + Neutral AH prices are populated in PostgreSQL with timestamps and provenance tags.
- `vitest` integration suite, `tsc --noEmit`, and `eslint` pass with zero errors.
- Committed and pushed to GitHub.

---

## Phase 3 — Core Profitability Engine

**Branch:** `feature/profitability-engine` → merge to `main` after validation.

### What Will Be Implemented
1. **Pure Domain Module (`src/domain/profitability/`):**
   - Full EGPH calculation across **all** relevant creature drops (never single-item shortcuts).
   - Liquidation channel routing: Quest/unsellable (`0`), BoP/Poor/below-vendor (`vendorSell`, `C=0`, `S=1`), Auctionable (`clearingPrice`, configurable `C` by market type, `S_i`, optional deposit cost), plus raw coin drops.
   - Secondary metrics: `EGPK`, `Kills = 1/P`, `P(>=1 in k kills)`, `K50`, `K90` with complete edge-case handling (`p=0`, `p=1`, `K=0`, `null` prices).
   - Liquidity Score (0–100) and selling probability `S_i` calculator — strictly separated from drop rate `P_i`; returns explicit `UNKNOWN` when `sold_per_day` is missing; outputs both `egph_liquidity_adjusted` and `egph_gross_ev`.
   - Farming speed preset definitions (`Slow`, `Average`, `Fast`, `Custom KPH`) — never silently invented; always displays active `K`.
   - Farming Simulator engine (analytical EV + reproducible Monte Carlo trials with percentiles).
2. **Precomputed Market-Creature Rollup Service:** Computes indexed per-market EV rollups in PostgreSQL after each market sync for sub-100ms dashboard queries.
3. **Comprehensive Mathematical Unit Test Suite:** Known hand-verified economic scenarios, Alliance vs Horde vs Blackwater (5% vs 15% cut) comparisons, vendor floor overrides, missing-liquidity degradation, `p=0`/`p=1` edge cases, and Monte Carlo convergence tests.

### Dependencies & Potential Problems
- Everloot `/api/rollups/drops` omits average stack quantity (`Qi`); document and handle `avg_qty = 1` fallback with explicit caveat unless EverlookDB `players` (`qty/drops`) or corpus events supply `Qi`.
- Prevent rare/unreliable `0.01%` world-drop outliers with low sample size from dominating rankings via confidence filters and optional outlier dampening toggle.

### Validation Criteria
- 100% pass rate on all mathematical unit tests and edge-case property tests (`vitest`).
- Deterministic golden-fixture outputs verified by hand.
- `tsc --noEmit` & lint pass; committed and pushed to GitHub.

---

## Phase 4 — Web Application & Interactive Economic Tools

**Branch:** `feature/web-application` (or sub-branches per page group) → merge to `main`.

### What Will Be Implemented
1. **Design System & Layout:** Dark charcoal background, gold/bronze accents, WoW item rarity colors (`Poor` → `Legendary`), high-density readable tables, provenance & confidence badges (`VERIFIED`, `OBSERVED`, `ESTIMATED`, `UNKNOWN`), global market/region/faction/ruleset selector with data freshness indicator.
2. **Backend REST API (`src/app/api/v1/*`):**
   - `GET /api/v1/rankings` (sortable, multi-filtered creature EGPH rankings with dynamic `K`, `E`, `C`, confidence params)
   - `GET /api/v1/creatures/[id]` (creature details, spawns, complete loot table, faction market comparison, historical profitability)
   - `GET /api/v1/items/[id]` (item details, cross-faction/cross-house prices, 24h/7d/30d history, all dropping creatures ranked by efficiency)
   - `GET /api/v1/search` (unified search by creature name, item name, item ID, zone)
   - `POST /api/v1/simulate` (farming session EV + Monte Carlo simulation)
   - `GET /api/v1/alerts` & `GET /api/v1/health`
3. **Pages:**
   - **Farm Ranking Dashboard (`/`):** Ranked table, all spec filters (Alliance/Horde/Neutral, US/EU, server group, level, zone, rarity, category, min drop rate, min price, min EGPH, data confidence), dynamic recalculation, farming speed & expense controls.
   - **Creature Detail Page (`/creatures/[id]`):** Complete loot table with drop provenance & sample sizes, *"IS THIS CREATURE WORTH FARMING RIGHT NOW?"* verdict card (current EGPH, best item, best faction market, `K50`/`K90`, profitability trend), spawn coordinates, historical profitability chart.
   - **Item Detail Page (`/items/[id]`):** Cross-faction price comparison (Alliance vs Horde vs Neutral), 24h/7d/30d price + supply + sales charts (Recharts), liquidity breakdown, ranked creature comparison table (*"Which creature is the most efficient source of this item?"*).
   - **Farming Simulator (`/simulator`):** Interactive session duration / KPH / faction / market simulator clearly contrasting Statistical EV vs Simulated Outcomes.
   - **Watchlist & Opportunity Alerts (`/watchlist`, `/opportunities`):** Track saved items (price deltas, supply scarcity, best-creature shifts) and surface market-driven farming opportunities.

### Dependencies & Potential Problems
- Recharts historical profitability chart only renders periods where real stored price history exists (never backfilled/fabricated).
- Creature models/renders are not universally available via public APIs; render clean creature-type emblems when no verified image exists.

### Validation Criteria
- End-to-end verification of all 10 Final Acceptance Criteria (`PROJECT_SPEC.md` Section 13) against **real ingested WoW Forever data**.
- Responsive desktop & mobile checks; zero console errors; API validation & component tests pass.
- Committed and pushed to GitHub.

---

## Phase 5 — Optimization, Scheduled Sync & Production Hardening

**Branch:** `feature/optimization-hardening` → merge to `main`.

### What Will Be Implemented
1. **Scheduled Synchronization:** Automated hourly market ingestion + daily loot/catalog refresh (GitHub Actions cron or dedicated worker process) with retry/backoff and stale-data alerts.
2. **Database & Query Tuning:** Composite indexes, `pg_trgm` trigram search indexes, materialized rollup refresh timing, `EXPLAIN ANALYZE` verification.
3. **Caching & Rate-Limit Protection:** Next.js route/data caching aligned with hourly snapshot cadence; evaluate Redis only if benchmarked load justifies it.
4. **Canonical Blizzard API Activation (if credentials configured):** Dual-source failover between Forever AH and direct Blizzard API.
5. **Monitoring & Final Documentation Sync:** Update `README.md`, `docs/ARCHITECTURE.md`, and `docs/DATA_SOURCES.md` to reflect final production state.

### Validation Criteria
- Dashboard ranking p95 latency `< 200ms` under realistic filter combinations.
- Verified graceful fallback when upstream market API is simulated offline (displays last known prices + exact age banner).
- Full test suite, production build (`next build`), and live-data acceptance audit pass; final state pushed to `main`.
