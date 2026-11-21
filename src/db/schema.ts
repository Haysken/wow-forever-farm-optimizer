import {
  bigint,
  boolean,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const confidenceTierEnum = pgEnum("confidence_tier", [
  "VERIFIED",
  "OBSERVED",
  "ESTIMATED",
  "UNKNOWN",
]);

export const dataStatusEnum = pgEnum("data_status", [
  "ACTUAL",
  "CALCULATED",
  "ESTIMATED",
  "MISSING",
]);

export const factionEnum = pgEnum("faction", [
  "alliance",
  "horde",
  "neutral",
  "unified",
]);

export const lootMethodEnum = pgEnum("loot_method", [
  "kill",
  "skinning",
  "pickpocket",
]);

export const bindTypeEnum = pgEnum("bind_type", [
  "none",
  "boe",
  "bop",
  "bou",
  "quest",
]);

export const historyResolutionEnum = pgEnum("history_resolution", [
  "hour",
  "day",
]);

export const syncStatusEnum = pgEnum("sync_status", [
  "running",
  "succeeded",
  "failed",
  "partial",
]);

export const zones = pgTable(
  "zones",
  {
    id: integer("id").primaryKey(),
    name: text("name").notNull(),
    continent: text("continent"),
    faction: text("faction"),
    kind: text("kind").notNull().default("zone"),
    minLevel: integer("min_level"),
    maxLevel: integer("max_level"),
    isInstance: boolean("is_instance").notNull().default(false),
    source: text("source").notNull(),
    clientBuild: text("client_build"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("zones_name_idx").on(table.name)]
);

export const items = pgTable(
  "items",
  {
    id: integer("id").primaryKey(),
    name: text("name").notNull(),
    quality: integer("quality").notNull(), // 0=Poor..5=Legendary..7=Heirloom
    qualityName: text("quality_name").notNull(),
    itemClass: text("item_class"),
    itemSubclass: text("item_subclass"),
    itemLevel: integer("item_level"),
    requiredLevel: integer("required_level"),
    bindType: bindTypeEnum("bind_type").notNull().default("none"),
    vendorSellCopper: bigint("vendor_sell_copper", { mode: "number" })
      .notNull()
      .default(0),
    vendorBuyCopper: bigint("vendor_buy_copper", { mode: "number" })
      .notNull()
      .default(0),
    maxStack: integer("max_stack").notNull().default(1),
    isCommodity: boolean("is_commodity").notNull().default(false),
    iconId: integer("icon_id"),
    iconUrl: text("icon_url"),
    description: text("description"),
    foreverStatus: text("forever_status"), // same | changed | new | rebuilt | unknown
    source: text("source").notNull(),
    clientBuild: text("client_build"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("items_name_idx").on(table.name),
    index("items_quality_idx").on(table.quality),
    index("items_class_idx").on(table.itemClass),
  ]
);

export const creatures = pgTable(
  "creatures",
  {
    id: integer("id").primaryKey(),
    name: text("name").notNull(),
    minLevel: integer("min_level"),
    maxLevel: integer("max_level"),
    creatureType: text("creature_type"),
    creatureFamily: text("creature_family"),
    classification: text("classification").notNull().default("normal"),
    factionRestriction: text("faction_restriction"),
    healthMin: integer("health_min"),
    healthMax: integer("health_max"),
    primaryZoneId: integer("primary_zone_id").references(() => zones.id, {
      onDelete: "set null",
    }),
    primaryZoneName: text("primary_zone_name"),
    rawCoinMinCopper: bigint("raw_coin_min_copper", { mode: "number" }),
    rawCoinMaxCopper: bigint("raw_coin_max_copper", { mode: "number" }),
    rawCoinSource: text("raw_coin_source"),
    source: text("source").notNull(),
    clientBuild: text("client_build"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("creatures_name_idx").on(table.name),
    index("creatures_zone_idx").on(table.primaryZoneId),
    index("creatures_level_idx").on(table.minLevel, table.maxLevel),
  ]
);

export const creatureSpawns = pgTable(
  "creature_spawns",
  {
    id: serial("id").primaryKey(),
    creatureId: integer("creature_id")
      .notNull()
      .references(() => creatures.id, { onDelete: "cascade" }),
    zoneId: integer("zone_id").references(() => zones.id, {
      onDelete: "set null",
    }),
    zoneName: text("zone_name"),
    subzone: text("subzone"),
    x: numeric("x", { precision: 6, scale: 2 }).notNull(),
    y: numeric("y", { precision: 6, scale: 2 }).notNull(),
    source: text("source").notNull(),
    confidenceTier: confidenceTierEnum("confidence_tier").notNull(),
    sampleSize: integer("sample_size"),
    observedAt: timestamp("observed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("creature_spawns_creature_idx").on(table.creatureId),
    index("creature_spawns_zone_idx").on(table.zoneId),
  ]
);

export const dropObservations = pgTable(
  "drop_observations",
  {
    id: serial("id").primaryKey(),
    creatureId: integer("creature_id")
      .notNull()
      .references(() => creatures.id, { onDelete: "cascade" }),
    itemId: integer("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    lootMethod: lootMethodEnum("loot_method").notNull().default("kill"),
    source: text("source").notNull(), // everloot | everlookdb_players | classic_db
    killsObserved: integer("kills_observed"),
    dropsObserved: integer("drops_observed"),
    totalQtyObserved: integer("total_qty_observed"),
    minQty: integer("min_qty"),
    maxQty: integer("max_qty"),
    avgQty: numeric("avg_qty", { precision: 8, scale: 4 }),
    dropRate: numeric("drop_rate", { precision: 10, scale: 8 }).notNull(),
    ciLow: numeric("ci_low", { precision: 10, scale: 8 }),
    ciHigh: numeric("ci_high", { precision: 10, scale: 8 }),
    reporterCount: integer("reporter_count"),
    confidenceTier: confidenceTierEnum("confidence_tier").notNull(),
    isQuestOnly: boolean("is_quest_only").notNull().default(false),
    clientBuild: text("client_build"),
    observedAt: timestamp("observed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("drop_obs_unique_idx").on(
      table.creatureId,
      table.itemId,
      table.lootMethod,
      table.source
    ),
    index("drop_obs_creature_idx").on(table.creatureId),
    index("drop_obs_item_idx").on(table.itemId),
    index("drop_obs_confidence_idx").on(table.confidenceTier),
  ]
);

export const creatureLootResolved = pgTable(
  "creature_loot_resolved",
  {
    creatureId: integer("creature_id")
      .notNull()
      .references(() => creatures.id, { onDelete: "cascade" }),
    itemId: integer("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    lootMethod: lootMethodEnum("loot_method").notNull().default("kill"),
    winningObservationId: integer("winning_observation_id").references(
      () => dropObservations.id,
      { onDelete: "set null" }
    ),
    dropRate: numeric("drop_rate", { precision: 10, scale: 8 }).notNull(),
    minQty: integer("min_qty").notNull().default(1),
    maxQty: integer("max_qty").notNull().default(1),
    avgQty: numeric("avg_qty", { precision: 8, scale: 4 })
      .notNull()
      .default("1.0000"),
    avgQtyIsAssumed: boolean("avg_qty_is_assumed").notNull().default(false),
    sampleSize: integer("sample_size"),
    reporterCount: integer("reporter_count"),
    ciLow: numeric("ci_low", { precision: 10, scale: 8 }),
    ciHigh: numeric("ci_high", { precision: 10, scale: 8 }),
    confidenceTier: confidenceTierEnum("confidence_tier").notNull(),
    source: text("source").notNull(),
    isQuestOnly: boolean("is_quest_only").notNull().default(false),
    resolvedAt: timestamp("resolved_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.creatureId, table.itemId, table.lootMethod],
    }),
    index("resolved_loot_item_idx").on(table.itemId),
    index("resolved_loot_confidence_idx").on(table.confidenceTier),
  ]
);

export const ahMarkets = pgTable(
  "ah_markets",
  {
    id: text("id").primaryKey(), // e.g. "us:110" or "eu:113"
    region: text("region").notNull(), // us | eu | kr | tw
    rulesetId: integer("ruleset_id").notNull(),
    rulesetLabel: text("ruleset_label"), // null until verified via Blizzard API
    houseId: integer("house_id").notNull(),
    faction: factionEnum("faction").notNull(),
    displayName: text("display_name").notNull(),
    defaultCommissionRate: numeric("default_commission_rate", {
      precision: 5,
      scale: 4,
    }).notNull(),
    providerSource: text("provider_source").notNull(),
    providerKey: text("provider_key").notNull(),
    lastSnapshotAt: timestamp("last_snapshot_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("ah_markets_region_faction_idx").on(table.region, table.faction),
  ]
);

export const itemMarketSnapshots = pgTable(
  "item_market_snapshots",
  {
    marketId: text("market_id")
      .notNull()
      .references(() => ahMarkets.id, { onDelete: "cascade" }),
    itemId: integer("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    lowestBuyoutCopper: bigint("lowest_buyout_copper", { mode: "number" }),
    p10Copper: bigint("p10_copper", { mode: "number" }),
    medianCopper: bigint("median_copper", { mode: "number" }),
    meanCopper: bigint("mean_copper", { mode: "number" }),
    marketValueCopper: bigint("market_value_copper", { mode: "number" }),
    historicalValueCopper: bigint("historical_value_copper", {
      mode: "number",
    }),
    clearingPriceCopper: bigint("clearing_price_copper", { mode: "number" }),
    availableQty: integer("available_qty").notNull().default(0),
    listingCount: integer("listing_count").notNull().default(0),
    change24hPct: numeric("change_24h_pct", { precision: 8, scale: 3 }),
    trend7dPct: numeric("trend_7d_pct", { precision: 8, scale: 3 }),
    trend30dPct: numeric("trend_30d_pct", { precision: 8, scale: 3 }),
    priceStatus: dataStatusEnum("price_status").notNull().default("ACTUAL"),
    source: text("source").notNull(),
    snapshotAt: timestamp("snapshot_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.marketId, table.itemId] }),
    index("item_snapshots_item_idx").on(table.itemId),
    index("item_snapshots_time_idx").on(table.snapshotAt),
  ]
);

export const itemPriceHistory = pgTable(
  "item_price_history",
  {
    marketId: text("market_id")
      .notNull()
      .references(() => ahMarkets.id, { onDelete: "cascade" }),
    itemId: integer("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    resolution: historyResolutionEnum("resolution").notNull(),
    bucketTs: timestamp("bucket_ts", { withTimezone: true }).notNull(),
    minCopper: bigint("min_copper", { mode: "number" }),
    p10Copper: bigint("p10_copper", { mode: "number" }),
    medianCopper: bigint("median_copper", { mode: "number" }),
    meanCopper: bigint("mean_copper", { mode: "number" }),
    availableQty: integer("available_qty").notNull().default(0),
    listingCount: integer("listing_count").notNull().default(0),
    source: text("source").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.marketId, table.itemId, table.resolution, table.bucketTs],
    }),
    index("price_history_item_market_ts_idx").on(
      table.itemId,
      table.marketId,
      table.bucketTs
    ),
  ]
);

export const itemSalesEstimates = pgTable(
  "item_sales_estimates",
  {
    marketId: text("market_id")
      .notNull()
      .references(() => ahMarkets.id, { onDelete: "cascade" }),
    itemId: integer("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    estimatedSoldPerDay: numeric("estimated_sold_per_day", {
      precision: 14,
      scale: 4,
    }),
    daysSeen: integer("days_seen"),
    liquidityScore: numeric("liquidity_score", { precision: 5, scale: 2 }),
    sellingProb24h: numeric("selling_prob_24h", { precision: 6, scale: 4 }),
    sellingProb7d: numeric("selling_prob_7d", { precision: 6, scale: 4 }),
    dataStatus: dataStatusEnum("data_status").notNull().default("MISSING"),
    source: text("source").notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.marketId, table.itemId] }),
    index("sales_estimates_item_idx").on(table.itemId),
  ]
);

export const userWatchlists = pgTable(
  "user_watchlists",
  {
    id: serial("id").primaryKey(),
    ownerKey: text("owner_key").notNull(), // session token or future user ID
    itemId: integer("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    marketId: text("market_id")
      .notNull()
      .references(() => ahMarkets.id, { onDelete: "cascade" }),
    alertPriceAboveCopper: bigint("alert_price_above_copper", {
      mode: "number",
    }),
    alertPriceBelowCopper: bigint("alert_price_below_copper", {
      mode: "number",
    }),
    alertSupplyBelowQty: integer("alert_supply_below_qty"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("watchlist_owner_item_market_idx").on(
      table.ownerKey,
      table.itemId,
      table.marketId
    ),
  ]
);

export const farmingPresets = pgTable(
  "farming_presets",
  {
    id: serial("id").primaryKey(),
    ownerKey: text("owner_key").notNull(),
    name: text("name").notNull(),
    killsPerHour: integer("kills_per_hour").notNull(),
    hourlyExpensesCopper: bigint("hourly_expenses_copper", { mode: "number" })
      .notNull()
      .default(0),
    preferredMarketId: text("preferred_market_id").references(
      () => ahMarkets.id,
      { onDelete: "set null" }
    ),
    commissionOverride: numeric("commission_override", {
      precision: 5,
      scale: 4,
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("farming_presets_owner_idx").on(table.ownerKey)]
);

export const syncRuns = pgTable(
  "sync_runs",
  {
    id: serial("id").primaryKey(),
    provider: text("provider").notNull(),
    jobType: text("job_type").notNull(), // catalog | loot | market_snapshot | history
    status: syncStatusEnum("status").notNull(),
    recordsProcessed: integer("records_processed").notNull().default(0),
    recordsFailed: integer("records_failed").notNull().default(0),
    clientBuild: text("client_build"),
    errorSummary: text("error_summary"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    index("sync_runs_provider_job_idx").on(
      table.provider,
      table.jobType,
      table.startedAt
    ),
  ]
);
