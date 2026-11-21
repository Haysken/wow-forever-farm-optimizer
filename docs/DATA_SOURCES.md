# DATA SOURCES & TECHNICAL FEASIBILITY — WOW FOREVER FARM OPTIMIZER

- **Assessment Date:** 2026-11-21 (17 days post-launch of *World of Warcraft: Forever* on 2026-11-04)
- **Observed Client Builds:** `1.60.1.70959` (EverlookDB / Everloot), `1.60.1.71037` (WCLBox)
- **Verification Method:** Direct HTTP/JSON-RPC probes from local environment (no anti-bot bypass, no fabricated responses) + official/community documentation review.

> Every claim below distinguishes **Verifiable Evidence** (tested live HTTP responses or published repo/docs) from **Architectural Reasoning** (engineering conclusions drawn from that evidence).

---

## 1. Executive Feasibility Matrix

| Source | Type | Proposed in Spec? | Live HTTP Verification (2026-11-21) | Auth | Rate Limit | Faction AH Split | Forever Loot Coverage | License / Terms | Integration Verdict |
|---|---|---|---|---|---|---|---|---|---|
| **AHledger** (`api.ahledger.com`) | Market AH | Yes | `GET /v1/markets` (`200`), `GET /v1/items/2589` (`200`); guessed price paths (`404`); `ahledger.com` (`429` Vercel checkpoint) | Unknown for price endpoints | `300` (`x-ratelimit-limit`) | Alliance & Horde (US/EU/CN/KR); **no Neutral** | None | Addon: All Rights Reserved; API terms behind checkpoint | **Deferred / Secondary** — price endpoints & commercial terms unverified |
| **Azerite Exchange** (`azerite.exchange/forever`) | Market AH | Yes | Web UI `200`; `/api` `404`; `/api/health` `503` (redis failed) | Account + Patreon tiers (120 credits/day free) | Credit-gated | Alliance/Horde/Neutral in UI only | None | ToS forbids limit workarounds; `Content-Signal` robots | **Rejected** — no public API, credit/Patreon paywall |
| **TheWoWDB** (`api.thewowdb.com` / `thewowdb.com`) | Market AH & DB | Yes | `api.thewowdb.com/` serves HTML site; `/v1/*` `404`; `robots.txt` has `Disallow: /api/` | Closed desktop sync | Undocumented | Addon-scanned (closed) | Closed web pages only | Proprietary site; `/api/` disallowed | **Rejected** — `api.thewowdb.com` is not a public REST API |
| **Forever AH** (`forever-ah.com`) | Market AH | Discovered alternative | `GET /v1/houses`, `/v1/houses/{k}/market`, `/stats`, `/history`, `/items/{id}/houses` all **`200 OK` JSON** | None (free read-only) | ~1 req/s recommended (`429` + `Retry-After`) | **Yes: Alliance, Horde & Blackwater (Neutral)** across US/EU/KR/TW | None | Free read-only; open CORS; credit Forever AH + Blizzard API (no commercial SLA) | **Recommended Primary (MVP)** |
| **Blizzard Battle.net Game Data API** | Market AH & Static Data | Discovered alternative | Documented official WoW Forever ruleset endpoints; **not live-tested yet** (no OAuth client creds) | OAuth2 `client_credentials` (free dev app) | 36,000/hr, 100/s (heavy endpoints weighted) | **Yes: per `ruleset/{id}/auctions/{houseId}` + `/commodities`** | None (Blizzard API has no creature loot tables) | Blizzard Developer API ToS (free personal/non-commercial; commercial restricted) | **Recommended Canonical / Fallback** (once user supplies credentials) |
| **AzerDex** (`azerdex.com`) | Observed Loot | Yes | Web UI `200`; `/api` `404`; `robots.txt` has `Disallow: /api/` | Private backend API | N/A (not public) | None | **150 items, 139 sources, 5 zones** (stale since 2026-11-09) | Closed backend; public pages read-only | **Rejected** — no public API, tiny/stale coverage |
| **Everloot** (`github.com/Everloot/everloot`, `everloot.app`) | Observed Loot & Facts | Yes | `GET /api/rollups/drops` (`200`), `GET /api/corpus/public` (`200`), `POST /mcp/public` (`200`); `/database/download` (`403` Cloudflare) | None for public read; free key lifts corpus limit | Public rate limit (free key available) | Partial (not primary) | **Real Forever observed:** 18,088 loot windows, **60 unique NPCs**, 288 items (as of 2026-11-21 12:30Z) | Code: **AGPL-3.0**; Observed Data: **CC BY-SA 4.0** | **Recommended Primary for `VERIFIED` / `OBSERVED` Drops** |
| **EverlookDB** (`everlookdb.com`) | Client Catalog + Dual Loot | Discovered alternative | `/downloads/{items,npcs,zones}.json` (`200`), `/openapi.json` (`200`), `/npc/{id}.json` (`200`), `/item/{id}.json` (`200`) | None (5–10 req/s); free instant key (50 req/s) | `x-ratelimit-limit: 30` burst / 5–10 req/s | **Insufficient** (only 2 EU Alliance addon houses; 0 US, 0 Horde) | **22,806 items, 8,736 NPCs** (client) + `players` Forever drops + `classic_db` fallback | Client data: Blizzard IP; `classic_db` layer: **GPL-3.0** (CMaNGOS) | **Recommended Primary Catalog + `OBSERVED`/`ESTIMATED` Loot Layer** |
| **CMaNGOS `classic-db`** (`github.com/cmangos/classic-db`) | Classic 1.12 Fallback Loot | Spec fallback class | GitHub API `200`, actively maintained (`pushed_at: 2026-11-21`) | None (public Git) | GitHub standard | None | Complete Classic 1.12 NPC loot tables & min/max quantities | **GPL-3.0** | **Recommended Fallback (`ESTIMATED` only)** (via EverlookDB or isolated GPL pipeline) |
| **WCLBox Open API** (`wowforever.wclbox.com`) | Item Catalog | Discovered alternative | `/api/open/v1/openapi.json` (`200`) | None (read-only) | 10 req/s per IP (`429` + `Retry-After`) | None | 21,874 items (`new`/`rebuilt`/`changed`/`same`/`missing`), no mob loot | Attribution required; Blizzard IP | **Optional Secondary** (item diff validation only) |

---

## 2. Detailed Empirical Verification by Source

### 2.1 Market Data Sources

#### A. AHledger (`https://api.ahledger.com`) — *Proposed in Spec*
- **Verifiable Evidence:**
  - `GET https://api.ahledger.com/v1/markets` → `200 OK`, `Content-Type: application/json; charset=utf-8`, `access-control-allow-origin: *`, `x-ratelimit-limit: 300`, `Cache-Control: public, max-age=300`, `last-modified: Sat, 21 Nov 2026 12:41:15 GMT`.
  - Returns 34 markets total, including 32 WoW Forever markets structured as `forever.{normal|pvp|rp|rppvp}.{alliance|horde}.{us|eu|cn|kr}`. **No Neutral/Blackwater houses are listed.**
  - `GET https://api.ahledger.com/v1/items/2589` → `200 OK` JSON containing `id`, `name`, `quality`, `itemClass`, `itemSubclass`, `level`, `requiredLevel`, `vendorSell`, `icon` (Blizzard CDN URL), `url`, `chartUrl`, and `attribution` (`"Prices from AHledger"`).
  - `GET https://api.ahledger.com/robots.txt` → `User-agent: * / Disallow: /`.
  - `GET https://ahledger.com` → `429 Too Many Requests` (`Vercel Security Checkpoint`). Not bypassed.
  - All probed price paths (`/v1/markets/{id}`, `/v1/markets/{id}/prices`, `/v1/items/2589/prices`, `/v1/items/2589/history`, `/v1/prices`, `/v1/quotes`, `/v1/snapshot/{id}`) returned `404 {"error":"not found"}`.
- **Architectural Reasoning:** AHledger clearly runs a real JSON API for Forever Alliance/Horde markets, but its price-query routes, auth requirements, and commercial license terms are behind the web checkpoint at `ahledger.com/developers` and cannot be verified programmatically. Do not block MVP on it; if the user later checks `ahledger.com/developers` in a browser and approves its terms, it can be added as an adapter.

#### B. Azerite Exchange (`https://azerite.exchange/forever`) — *Proposed in Spec*
- **Verifiable Evidence:**
  - `GET https://azerite.exchange/forever` → `200 OK` HTML (Next.js app). UI text states: *"Browsing as Scout — A free account reads live prices - 120 live-data credits a day"* and references Patreon-gated *Goblin tier* features (Cross-realm, Alerts).
  - `GET https://azerite.exchange/api` → `404`; `GET https://azerite.exchange/docs` → `404`; `GET https://azerite.exchange/api/health` → `503` (`{"ok":false,"failed":["redis"],...}`).
  - `GET https://azerite.exchange/terms` explicitly restricts account sharing and limit circumvention; `robots.txt` includes `Content-Signal` clauses.
- **Architectural Reasoning:** Unsuitable for programmatic integration. No public API exists, data access is credit- and Patreon-gated, and scraping would violate ToS.

#### C. TheWoWDB (`https://api.thewowdb.com/` / `https://thewowdb.com/`) — *Proposed in Spec*
- **Verifiable Evidence:**
  - `GET https://api.thewowdb.com/` → `200 OK` HTML identical to `https://thewowdb.com/` (`<title>TheWoWDB | WoW Forever Auction House Prices and Database</title>`).
  - `GET https://api.thewowdb.com/v1/houses`, `/v1/items/search?q=linen`, `/api/v1/houses`, `/docs` → all `404`.
  - Both `thewowdb.com/robots.txt` and `api.thewowdb.com/robots.txt` contain `Disallow: /api/`.
  - `https://thewowdb.com/llms.txt` confirms WoW Forever AH prices are scanned in-game via its own addon and does not document any public REST API.
- **Architectural Reasoning:** `api.thewowdb.com` is not an accessible public REST API. Do not integrate.

#### D. Forever AH (`https://forever-ah.com`) — *Discovered Alternative (Recommended Primary for MVP)*
- **Verifiable Evidence:**
  - `GET https://forever-ah.com/robots.txt` → `200 OK`: *"The data API (/v1/) must stay crawlable"*.
  - `GET https://forever-ah.com/api/` → `200 OK` public API documentation: free, read-only, no API key, open CORS, ~1 req/s recommended, `429` with `Retry-After`, attribution to *"Forever AH and Blizzard's Battle.net API"*, all prices in copper per unit, refreshed ~hourly from Blizzard's official Battle.net API.
  - `GET https://forever-ah.com/v1/houses` → `200 OK` JSON returning **64 houses** across `us`, `eu`, `kr`, `tw`:
    - Per region: **15 real auction houses** (`house_id`s `110–121`, `123–125`) — 5 Alliance, 5 Horde, 5 Blackwater (Neutral) — plus 1 `unified` ("All Auction Houses", `house_id: 0`).
    - Verified freshness: `last_snapshot` timestamps were `2026-11-21T12:22:42Z` to `12:26:53Z` (~15 minutes prior to probe at `12:42Z`).
  - `GET https://forever-ah.com/v1/houses/18/market?limit=2` → `200 OK`, `Cache-Control: public, max-age=60`, `total: 7021` active items on EU house 18, returning `item` metadata (`sell_price`, `quality`, `item_class`, `item_subclass`, `item_level`, `required_level`, `has_icon`), `current` (`ts`, `min_unit`, `p10_unit`, `median_unit`, `mean_unit`, `quantity`, `listings`), 24h change (`prev_median_unit`, `median_change_pct`), and `stats` (`market_value`, `historical_value`, `trend_pct`, `days_seen`, `sold_per_day`).
  - `GET https://forever-ah.com/v1/houses/18/items/2589/stats` → `200 OK`: `{"market_value":29,"historical_value":29,"trend_pct":null,"days_seen":8,"sold_per_day":58081.28946005474}`.
  - `GET https://forever-ah.com/v1/houses/18/items/2589/history?resolution=day` → `200 OK` daily/hourly series (hourly retained up to 62 days, daily beyond).
  - `GET https://forever-ah.com/v1/items/2589/houses?region=us` → `200 OK` showing **distinct live prices per house/faction**:
    - House `114` (Horde): min `20c`, median `28c`, qty `22,814`
    - House `110` (Alliance): min `25c`, median `30c`, qty `20,251`
    - House `117` (Blackwater/Neutral): min `25c`, median `27c`, qty `1,258`
    - House `124` (Horde): min `60c`, median `66c`, qty `8,552`
    - Note: `point` is `null` when an item has zero listings in a house (verified empirically).
- **Limitations & Uncertainties:**
  1. **Unlabeled `house_id`s (`110–125`):** `/v1/houses` reports all 5 Alliance houses simply as `"Alliance Auction House"` with `ruleset_id: 2`, without naming which server group/ruleset (Normal, PvP, RP, RP-PvP, etc.) each `house_id` maps to. This mapping must be confirmed via Blizzard API or verified community metadata.
  2. **`sold_per_day` is estimated:** Derived statistically from hourly snapshot differences, not official Blizzard transaction logs. Must be displayed as `ESTIMATED`.
  3. **Operational risk:** Independent community site with no commercial SLA. Must be abstracted behind a `MarketDataProvider` interface and backed by local PostgreSQL snapshots.

#### E. Official Blizzard Battle.net Game Data API — *Discovered Alternative (Canonical / Fallback)*
- **Verifiable Evidence (Documentation / Ecosystem Reports — NOT live-tested without credentials):**
  - Auth: OAuth 2.0 `client_credentials` at `https://oauth.battle.net/token` (~24h bearer token).
  - WoW Forever realmless ruleset endpoints (`namespace=dynamic-forever-{region}`):
    - `GET /data/wow/ruleset/index`
    - `GET /data/wow/ruleset/{rulesetId}/auctions/` (trailing slash required)
    - `GET /data/wow/ruleset/{rulesetId}/auctions/{houseId}` (non-commodities / equipment)
    - `GET /data/wow/ruleset/{rulesetId}/auctions/{houseId}/commodities` (stackable commodities)
  - Rate limits: 36,000 calls/hour, 100 req/sec (heavy commodity/auction endpoints may carry higher quota weight).
  - Terms: Free for personal/non-commercial community tools; Blizzard reserves fee rights and restricts commercial monetization without separate agreement.
- **Architectural Reasoning:** First-party canonical source (~hourly refresh) that eliminates third-party dependency risk. However, Blizzard does **not** return historical prices or `sold_per_day`, so our own hourly snapshot worker + aggregation tables in PostgreSQL are required to compute history and demand proxies. Recommended as Phase 2/5 canonical adapter once the user provides Blizzard Developer API credentials.

---

### 2.2 Creature, Item, and Loot Drop Sources

#### A. AzerDex (`https://azerdex.com/`) — *Proposed in Spec*
- **Verifiable Evidence:**
  - `GET https://azerdex.com/robots.txt` → `Disallow: /api/`.
  - `GET https://azerdex.com/` → `200 OK` HTML showing live catalog totals: **Items: 150 | Sources: 139 (creatures, nodes, pools) | Zones: 5 | Last publish: 9 Nov 2026** (publication #15, 12 days stale at assessment date).
  - `GET https://azerdex.com/about/data` documents its observation methodology (hides samples `<10`, rounds `<30`, Wilson 95% CI `≥30`, "high" `≥100`; warns empty corpses may inflate observed drop rates) and confirms its backend API is private.
- **Architectural Reasoning:** Not viable for integration due to disallowed/private API, stale publishing, and <2% coverage.

#### B. Everloot (`https://github.com/Everloot/everloot` & `https://everloot.app`) — *Proposed in Spec (Primary Forever Observed Loot)*
- **Verifiable Evidence:**
  - Public GitHub repo (`pushed_at: 2026-11-21T07:25:40Z`). Dual license: **Code = AGPL-3.0**, **Observed Data = CC BY-SA 4.0** (game-file layer under Blizzard terms).
  - `GET https://everloot.app/api/rollups/drops` → `200 OK` JSON (`dataAsOf: 2026-11-21T12:30:16.412Z`):
    - Corpus totals: `1,121` uploads, `18,088` loot windows, `108,297` records, `38` distinct folded installs.
    - Rate rows returned: **500 rows** (`469` NPC rows, `31` object rows) covering **60 unique NPCs**, `7` objects, and `288` items (`233` confirmed, `119` verified, `148` reported).
    - Exact schema per row: `sourceNpcId` / `sourceObjectId`, `sourceName`, `sourceNameTier`, `itemId`, `kills` (sample size), `drops`, `rate`, `rateLow`, `rateHigh` (95% Wilson CI), `reporters` (distinct installs), `tier` (`reported` | `verified` | `confirmed`), `public`, `settled`.
  - `GET https://everloot.app/api/corpus/public` → `200 OK` JSON anonymous event stream (includes `npc_sighting` with `mapId`, `x`, `y`, `level`, `creatureType`, `rank` and loot windows).
  - `POST https://everloot.app/mcp/public` → `200 OK` Streamable HTTP MCP server (`everloot-knowledge` v0.10.0, 32 tools).
  - `GET https://everloot.app/database/download` → `403` Cloudflare block to automated HTTP client (not bypassed).
  - **Coverage caveat verified:** `npc_page(448)` (Hogger) returned *"No agreed name yet"* and zero pins/drops; `/api/rollups/drops` does not include `minQty`/`maxQty` per drop (counts windows containing the item, not stack quantities — raw quantity requires parsing corpus events or defaulting `Qi = 1` with explicit caveat).
- **Architectural Reasoning:** Highest-integrity source for **real WoW Forever observed drops** (`VERIFIED` and `OBSERVED` tiers) because every figure carries sample size (`kills`), distinct reporter count, and 95% CI. However, with only **60 unique NPCs** currently covered, Everloot alone cannot power a game-wide farm ranking dashboard on Day 1.

#### C. EverlookDB (`https://everlookdb.com`) — *Discovered Alternative (Primary Catalog + Dual Loot Layer)*
- **Verifiable Evidence:**
  - `GET https://everlookdb.com/llms.txt` (`200`), `GET https://everlookdb.com/openapi.json` (`200`, OpenAPI 3.1), `GET https://everlookdb.com/data.html` (`200`).
  - Explicitly welcomes automated tools; no API key required for 5–10 req/s (`x-ratelimit-limit: 30` burst); free instant key raises limit to 50 req/s.
  - Bulk JSON/CSV game-client tables (`build 1.60.1.70959`) accessible directly (`HEAD /downloads/npcs.json` → `200`):
    - **22,806 items** (`/downloads/items.json`)
    - **8,736 NPCs** (`/downloads/npcs.json`)
    - Plus `zones.json`, `quests.json`, `spells.json`, `enchants.json`.
  - Per-entity merged JSON (`/npc/{id}.json`, `/item/{id}.json`) cleanly separates provenance into three distinct keys:
    - `game_client`: Official WoW Forever `1.60.1.70959` client tables.
    - `players`: Real WoW Forever player-observed drops (verified on `/item/2589.json`: e.g., Defias Thug `id: 38`, `n: 54`, `drops: 11`, `qty: 11`, `rate: 0.2037`; sparse — `/npc/448.json` has `players: null`). Notice `players` includes total `qty` so `avgQty = qty / drops` can be computed!
    - `classic_db`: Full CMaNGOS Classic 1.12 baseline (`drops`, `at` spawn coords, `at_zones`, `hp`, `lvl`, `gold`, `respawn`, `type`, `rank`).
  - Auction endpoint (`GET /api/v1/auctions` → `200`) currently covers only **2 EU Alliance** addon-scanned houses (`EU-6946-Alliance`, `EU-6842-Alliance`) — zero US, zero Horde — so **do NOT use EverlookDB for market pricing**.
  - `GET https://everlookdb.com/credits` confirms `classic_db` layer is licensed under **GNU GPL v3.0** (`cmangos/classic-db`).
- **Architectural Reasoning:** Solves two major gaps simultaneously: (1) supplies the canonical WoW Forever `1.60.1` item/NPC/zone catalog (22,806 items, 8,736 NPCs) via single bulk JSON downloads, and (2) provides both an additional Forever `players` observation layer (with `qty`!) and structured Classic 1.12 fallback data explicitly segregated from player observations.

#### D. CMaNGOS `classic-db` (`https://github.com/cmangos/classic-db`) — *Fallback Reference*
- **Verifiable Evidence:** Public GitHub repo (`200 OK`), **GPL-3.0**, actively maintained (`pushed_at: 2026-11-21`). Contains normalized Vanilla 1.12 SQL tables (`creature_loot_template`, `reference_loot_template`, `creature_template`, spawns) including `mincountOrRef` / `maxcount` drop quantities and loot groups (`groupid`).
- **Architectural Reasoning:** Useful only as a strictly tagged `ESTIMATED` fallback baseline for Vanilla-origin creatures lacking WoW Forever observations. Because `classic-db` is GPL-3.0, bundling it directly into a closed/proprietary codebase would trigger GPL-3.0 obligations; consuming via an isolated GPL-licensed ETL script or via EverlookDB's API avoids contaminating proprietary application code (see Section 5).

#### E. WCLBox Open API (`https://wowforever.wclbox.com/api/open/v1/openapi.json`) — *Optional Cross-Check*
- **Verifiable Evidence:** `200 OK` OpenAPI 3.1 read-only item catalog (21,874 items, build `1.60.1.71037`, 10 req/s/IP) with Forever diff status (`new`, `rebuilt`, `changed`, `same`, `missing`). No creature loot tables or AH prices.
- **Architectural Reasoning:** Helpful secondary check to flag items that are `new` or `rebuilt` in WoW Forever (where Classic 1.12 loot estimates are especially unreliable).

---

## 3. WoW Forever Auction House Mechanics (Verified)

1. **Realmless Ruleset Architecture:** WoW Forever replaces per-realm AHs with regional ruleset/server-group markets (`US`, `EU`, `KR`, `TW`, `CN`).
2. **Independent Faction Markets (Verified Live):**
   - **Alliance AH** and **Horde AH** are strictly segregated pools (capital cities within each faction share one pool).
   - **Blackwater AH (Neutral)** (Gadgetzan, Booty Bay, Everlook) is a separate third market allowing cross-faction trading.
   - `forever-ah.com/v1/houses` verifies **15 independent real `house_id`s per region** (`110–121`, `123–125` = 5 server-groups/rulesets × 3 factions).
3. **Commission Rates (`C`):**
   - Faction AH (Alliance / Horde): **5%** (`C = 0.05`).
   - Neutral Blackwater AH: **15%** (`C = 0.15`).
   - Per `PROJECT_SPEC.md`, these must be **configurable defaults per market type**, never hardcoded constants.
4. **Commodities & Deposit Mechanics:**
   - Stackable trade goods/consumables operate as Retail-style **Commodities** (FIFO at same unit price; 1c undercutting unnecessary).
   - Non-stackable gear/random-suffix items remain individual listings.
   - Listing deposits are paid upfront and forfeited on expiration (Blizzard reduced minimum deposits toward a 1c floor for low-value items).

---

## 4. Data Provenance, Confidence & Anti-Contamination Policy

To satisfy `PROJECT_SPEC.md` Sections 2C & 11 (never silently presenting Classic estimates as Forever facts), every drop entry in PostgreSQL must store `(source, confidence_tier, sample_size, reporter_count, ci_low, ci_high, client_build, observed_at)`:

| Confidence Tier | Qualification Criteria | Source Priority | Ranking Behavior |
|---|---|---|---|
| **`VERIFIED`** | WoW Forever observed data with `reporters >= 3` AND `kills >= 30` (Everloot `confirmed`/`settled`, or corroborated Everloot + EverlookDB `players`) | 1 (Highest) | Included in default rankings with green badge & sample size |
| **`OBSERVED`** | WoW Forever observed data below verified threshold (`reporters < 3` or `10 <= kills < 30`, or EverlookDB `players` without distinct install count) | 2 | Included with amber "Low Sample / Observed" badge + 95% Wilson CI |
| **`ESTIMATED`** | Classic 1.12 baseline (`classic_db` via EverlookDB or CMaNGOS) where zero WoW Forever observations exist | 3 (Fallback only) | Clearly labeled `"Classic 1.12 Estimate (≈)"`; user filter toggle (can restrict dashboard to Forever-only `VERIFIED`/`OBSERVED` vs including `ESTIMATED`) |
| **`UNKNOWN`** | New WoW Forever creature/item with zero observations and no Classic 1.12 match, or `< 10` observed kills with no baseline | 4 | Excluded from numeric gold/hour top rankings; shown as `"Insufficient Data"` |

**Strict Precedence Rule:** Whenever a `(creature_id, item_id)` pair has `VERIFIED` Forever observations, `ESTIMATED` Classic 1.12 probabilities are **suppressed from calculation** (preserved only as historical reference metadata) and never summed with Forever rows (preventing double-counting).

---

## 5. Licensing & Legal Risk Summary

| Dependency / Source | License / Terms | Key Obligations & Risk |
|---|---|---|
| **Everloot observed data** | **CC BY-SA 4.0** | Must credit Everloot + link license. If we publish/redistribute a derived open dataset containing Everloot drops, that derived dataset must also be CC BY-SA 4.0. |
| **Everloot source code** | **AGPL-3.0** | **Do NOT copy or link Everloot code** into our repository unless our entire app is licensed AGPL-3.0. Consuming Everloot's public HTTP API does not trigger AGPL-3.0 copyleft on our app. |
| **CMaNGOS `classic-db`** | **GPL-3.0** | Do NOT embed GPL-3.0 SQL dumps directly into a non-GPL application bundle. Querying EverlookDB's API or running an isolated GPL-licensed data ETL job keeps license boundaries clean; credit CMaNGOS + GPL-3.0. |
| **Blizzard Game Data API & Client Assets** | **Blizzard Developer API ToS / Blizzard IP** | Non-commercial/personal fan tools are permitted free; commercial monetization requires Blizzard approval. Must display Blizzard trademark disclaimer and avoid third-party proxy circumvention. |
| **Forever AH / EverlookDB** | Free community APIs (attribution required) | Respect rate limits (~1 req/s Forever AH; 5–10 req/s unauth or 50 req/s with free key on EverlookDB), cache responses server-side, attribute sources visibly in UI. |
