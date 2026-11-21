# PROJECT: WoW FOREVER — FARM PROFIT OPTIMIZER

## 1. ROLE AND OBJECTIVE

Act as a senior full-stack developer, software architect, data engineer, and World of Warcraft Classic economy analyst.

Build a complete web application dedicated to **World of Warcraft: Forever**, focused on identifying the most profitable creatures to farm based on their loot tables, drop probabilities, and current Auction House prices.

The main purpose is to answer one question:

**"Which creature should I farm right now to maximize my gold per hour?"**

The application must cross-reference creature loot databases with live Auction House market data, calculating the expected economic return of farming each creature.

This must be a functional, data-driven application, not a static mockup.

## 2. CORE FUNCTIONALITY

### A. Creature and loot database

Create a searchable database of creatures with the following information:

- Creature name.
- Creature ID.
- Creature level.
- Creature type.
- Zone and subzone.
- Coordinates, when available.
- Faction restrictions, if applicable.
- Creature health, if available.
- Loot table.
- Item names and IDs.
- Individual drop probabilities.
- Minimum and maximum quantity per drop.
- Source and reliability of the drop data.

Allow users to search by:
- Creature name.
- Item name.
- Item ID.
- Zone.
- Creature level.
- Item rarity.
- Item category.

### B. Item database and Auction House integration

For every item dropped by a creature, retrieve current Auction House information.

The application must distinguish between:

- Alliance Auction House.
- Horde Auction House.
- Neutral / cross-faction Auction House, when applicable.
- US and EU regions.
- Server groups and rulesets, where applicable.

Display the following information:

| Field | Description |
|---|---|
| Item | Item name and icon |
| Drop rate | Percentage chance |
| Alliance price | Current market price |
| Horde price | Current market price |
| Neutral price | Current market price, if available |
| Lowest buyout | Cheapest active listing |
| Median price | Median market price |
| Clearing price | Estimated realistic selling price |
| Available quantity | Units currently listed |
| Estimated sales/day | Estimated daily demand |
| 7-day trend | Price variation |
| 30-day trend | Price variation |
| Last update | Data freshness |

Use market-specific APIs whenever available.

Primary research candidates:
- AHledger API: https://api.ahledger.com
- Azerite Exchange: https://azerite.exchange/forever
- TheWoWDB: https://api.thewowdb.com/
- Other documented WoW Forever market data sources.

Do not assume that all these sources have identical coverage or commercial licensing. Verify their documentation, access restrictions, data freshness, and licensing before implementation.

### C. Drop rate database integration

Research and integrate available creature loot databases:

- AzerDex: https://azerdex.com/
- Everloot: https://github.com/Everloot/everloot
- Other compatible community databases.
- Classic-compatible loot databases, only as fallback sources.

IMPORTANT:

WoW Forever-specific loot data must take priority over Vanilla Classic estimates.

Never silently present estimated Classic drop rates as verified WoW Forever data.

Every drop rate must have a source and a confidence classification:

1. VERIFIED: Directly supported by reliable WoW Forever observations.
2. OBSERVED: Calculated from community-collected samples.
3. ESTIMATED: Derived from Classic databases or indirect evidence.
4. UNKNOWN: No reliable data available.

Whenever possible, display the sample size used to calculate observed drop rates.

## 3. MAIN FEATURE: FARM PROFIT CALCULATOR

This is the most important feature of the application.

Develop a mathematical ranking engine that identifies the creatures with the highest expected gold generation.

### Primary formula: Expected Gold per Hour (EGPH)

Use:

EGPH = K × Σ(Pi × Qi × Vi × (1 - C) × Si) - E

Where:

- K = Average number of creatures killed per hour.
- Pi = Probability of obtaining item i.
- Qi = Average quantity of item i per successful drop.
- Vi = Realistic selling price per unit.
- C = Auction House commission.
- Si = Estimated probability of successfully selling the item within the selected time horizon.
- E = Farming expenses per hour.

The Auction House commission must be configurable by market type. Do not hardcode an assumed commission.

The calculation must consider all relevant loot drops from a creature, not just its most valuable item.

### Secondary metrics

Calculate and display:

**1. Expected Gold per Kill**

EGPK = EGPH / K

**2. Expected Kills per Drop**

Kills = 1 / P

**3. Probability of obtaining at least one drop**

P(at least one drop) = 1 - (1 - p)^k

Where:
- p = Individual drop probability.
- k = Number of kills.

**4. Kills required for 50% probability**

K50 = ln(0.5) / ln(1 - p)

**5. Kills required for 90% probability**

K90 = ln(0.1) / ln(1 - p)

Handle edge cases such as 0% and 100% drop rates.

### Farming speed

The number of kills per hour must not be invented.

Allow users to configure their estimated farming speed.

Provide configurable presets:
- Slow farming.
- Average farming.
- Fast farming.
- Custom kills per hour.

Eventually, allow community-submitted farming speed estimates for individual creatures and locations.

### Market liquidity

An expensive item is not necessarily a profitable farming target.

Create a liquidity score considering:

- Estimated units sold per day.
- Current available quantity.
- Historical sales volume.
- Price stability.
- Price variation over 7 and 30 days.

If sales information is unavailable, explicitly indicate that the selling probability is unknown rather than inventing it.

Keep market liquidity and drop probability as separate metrics.

## 4. FARM RANKING DASHBOARD

Create a central dashboard showing the best farming opportunities at the current market conditions.

Display a ranked table:

| Rank | Creature | Level | Zone | Best Drop | Drop Rate | Market Price | Gold/Hour |
|---|---|---|---|---|---|---|---|

Allow sorting by:

- Highest expected gold per hour.
- Highest expected gold per kill.
- Highest item value.
- Highest drop rate.
- Best liquidity.
- Best price appreciation.
- Lowest competition.

Provide filters for:

- Alliance / Horde.
- US / EU.
- Server group.
- Creature level.
- Zone.
- Item rarity.
- Item category.
- Minimum drop rate.
- Minimum item price.
- Minimum estimated gold per hour.
- Data confidence.

The ranking must recalculate when the user changes the market, faction, or farming parameters.

## 5. CREATURE DETAIL PAGE

Each creature must have its own detailed page.

Display:

- Creature image or model, when available.
- Name and level.
- Zone and spawn locations.
- Complete loot table.
- Drop probabilities.
- Individual item prices.
- Historical item prices.
- Expected gold per kill.
- Expected gold per hour.
- Farming difficulty.
- Estimated farming speed.
- Drop data confidence.

Include a dedicated section:

"IS THIS CREATURE WORTH FARMING RIGHT NOW?"

Show:
- Current expected profitability.
- Best item to obtain.
- Best faction market to sell into.
- Estimated kills for a 50% chance.
- Estimated kills for a 90% chance.
- Historical profitability trend.

## 6. ITEM DETAIL PAGE

Each item must have:

- Item icon.
- Name and item ID.
- Quality and rarity.
- Item description.
- Current prices across factions.
- Historical price chart.
- Market liquidity.
- Estimated daily sales.
- Current supply.
- All known creatures that drop the item.
- Drop rate for each creature.
- Zone and creature level.
- Ranking of the best creatures to farm for this item.

Include a comparison table:

| Creature | Drop Rate | Gold per Kill | Gold per Hour | Zone |
|---|---|---|---|---|

This page should answer:

"Which creature is the most efficient source of this item?"

## 7. PRICE AND PROFIT HISTORY

Implement charts showing:

- Item price over the last 24 hours.
- 7-day price history.
- 30-day price history.
- Historical supply.
- Estimated sales volume.
- Expected farming profitability over time.

Where historical drop data is available, show how changes in market prices affect farming profitability.

Do not fabricate historical data.

## 8. ADVANCED FEATURES

Implement the following features:

### A. Farming simulator

Allow the player to simulate a farming session:

- Select a creature.
- Enter farming duration.
- Enter kills per hour.
- Select faction and market.
- Calculate expected loot.
- Calculate expected gold.
- Simulate random loot outcomes.

Clearly distinguish statistical expected value from simulated outcomes.

### B. Item watchlist

Allow users to save items they are interested in.

Monitor:
- Price increases.
- Price decreases.
- Changes in available supply.
- Changes in estimated daily sales.
- Changes in the best creature to farm.

### C. Opportunity alerts

Identify opportunities when:
- An item becomes significantly more valuable.
- A creature's expected gold per hour increases.
- An item becomes scarce.
- A previously unprofitable creature becomes profitable.

### D. Farming route optimization

As a future feature, combine creature spawn locations and estimated kill efficiency to suggest efficient farming routes.

Do not prioritize this over the core profitability engine.

## 9. USER INTERFACE AND DESIGN

Create a polished, professional gaming-oriented interface.

Visual direction:

- Dark fantasy / World of Warcraft-inspired aesthetic.
- Dark charcoal backgrounds.
- Gold and bronze accents.
- Subtle borders and restrained visual effects.
- High-quality item icons.
- Clear typography.
- Dense but readable data tables.
- Responsive desktop and mobile layouts.

Avoid an excessively decorative MMORPG interface. This is primarily an economic analysis tool.

Prioritize:
1. Readability.
2. Fast searches.
3. Clear profitability comparisons.
4. Easy access to item and creature information.

Use familiar WoW rarity colors:
- Poor: Gray.
- Common: White.
- Uncommon: Green.
- Rare: Blue.
- Epic: Purple.
- Legendary: Orange.

## 10. TECHNICAL ARCHITECTURE

Choose a modern and maintainable architecture.

Preferred technologies:

- Frontend: Next.js + React + TypeScript.
- Styling: Tailwind CSS.
- UI components: shadcn/ui.
- Backend: Next.js API routes or a dedicated backend.
- Database: PostgreSQL.
- ORM: Prisma or Drizzle.
- Charts: Recharts.
- Caching: Redis, if justified by API volume.
- Scheduled jobs: Background workers or cron jobs.

Requirements:

- Separate external data providers from business logic.
- Create independent adapters for each data source.
- Cache market data intelligently.
- Respect API rate limits and cache headers.
- Handle missing data gracefully.
- Store historical market snapshots.
- Implement logging and error handling.
- Make the application scalable.
- Never expose private API keys in frontend code.

Create a normalized database structure for:

- Items.
- Creatures.
- Creature loot tables.
- Drop observations.
- Zones.
- Auction House markets.
- Item prices.
- Price history.
- Sales estimates.
- User watchlists.
- Farming configurations.

## 11. DATA VALIDATION AND RELIABILITY

This is critical.

Never invent:
- Drop probabilities.
- Item prices.
- Historical prices.
- Creature locations.
- Market demand.
- Farming speed.

Every metric must indicate whether it is:
- Actual data.
- Calculated data.
- Estimated data.
- Missing data.

Include timestamps and data source attribution.

If a market API is unavailable, show the last known value and its age.

If a creature has no reliable drop data, do not assign it a misleading profitability ranking.

Support confidence indicators and minimum observation thresholds.

The application should also avoid double-counting loot entries or mixing different item variants.

## 12. DEVELOPMENT WORKFLOW

Do not attempt to build the entire application blindly.

Follow these stages:

PHASE 1 — RESEARCH
- Inspect all available APIs and databases.
- Verify their endpoints and data structures.
- Verify licensing and usage restrictions.
- Determine the actual availability of faction-specific market data.
- Identify gaps in creature loot coverage.
- Document technical limitations.

PHASE 2 — DATA FOUNDATION
- Build the database schema.
- Implement market data adapters.
- Implement loot database adapters.
- Validate item IDs and creature IDs.
- Create sample integration tests.

PHASE 3 — PROFITABILITY ENGINE
- Implement the EGPH formula.
- Implement probability calculations.
- Implement liquidity and selling estimates.
- Build automated tests using known mathematical examples.
- Verify that the engine handles missing or uncertain data correctly.

PHASE 4 — APPLICATION
- Build the dashboard.
- Build creature pages.
- Build item pages.
- Implement search and filtering.
- Implement market comparisons.
- Implement charts.

PHASE 5 — OPTIMIZATION
- Improve caching.
- Optimize database queries.
- Implement scheduled synchronization.
- Add monitoring and error handling.
- Test the application with real market data.

## 13. FINAL ACCEPTANCE CRITERIA

The project is not complete until a user can:

1. Open the website.
2. Search for an item.
3. See all known creatures that drop it.
4. Compare their drop probabilities.
5. See the current Auction House prices for Alliance and Horde.
6. Compare market prices.
7. Calculate expected gold per kill.
8. Calculate expected gold per hour.
9. Identify the most profitable creature to farm.
10. Understand the reliability and freshness of every relevant data point.

The main dashboard must work with real data.

Do not substitute static JSON examples for actual integrations and call the project complete.

If some data source does not provide the necessary information, document the limitation and implement an appropriate fallback.

**Final objective: Build the most useful WoW Forever farming profitability database possible, allowing players to make economically informed farming decisions based on current market conditions and reliable loot data.**

Before coding, present the proposed architecture, API availability, data coverage, and known limitations. Then proceed with implementation in incremental, testable stages.