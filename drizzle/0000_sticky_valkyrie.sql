CREATE TYPE "public"."bind_type" AS ENUM('none', 'boe', 'bop', 'bou', 'quest');--> statement-breakpoint
CREATE TYPE "public"."confidence_tier" AS ENUM('VERIFIED', 'OBSERVED', 'ESTIMATED', 'UNKNOWN');--> statement-breakpoint
CREATE TYPE "public"."data_status" AS ENUM('ACTUAL', 'CALCULATED', 'ESTIMATED', 'MISSING');--> statement-breakpoint
CREATE TYPE "public"."faction" AS ENUM('alliance', 'horde', 'neutral', 'unified');--> statement-breakpoint
CREATE TYPE "public"."history_resolution" AS ENUM('hour', 'day');--> statement-breakpoint
CREATE TYPE "public"."loot_method" AS ENUM('kill', 'skinning', 'pickpocket');--> statement-breakpoint
CREATE TYPE "public"."sync_status" AS ENUM('running', 'succeeded', 'failed', 'partial');--> statement-breakpoint
CREATE TABLE "ah_markets" (
	"id" text PRIMARY KEY NOT NULL,
	"region" text NOT NULL,
	"ruleset_id" integer NOT NULL,
	"ruleset_label" text,
	"house_id" integer NOT NULL,
	"faction" "faction" NOT NULL,
	"display_name" text NOT NULL,
	"default_commission_rate" numeric(5, 4) NOT NULL,
	"provider_source" text NOT NULL,
	"provider_key" text NOT NULL,
	"last_snapshot_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "creature_loot_resolved" (
	"creature_id" integer NOT NULL,
	"item_id" integer NOT NULL,
	"loot_method" "loot_method" DEFAULT 'kill' NOT NULL,
	"winning_observation_id" integer,
	"drop_rate" numeric(10, 8) NOT NULL,
	"min_qty" integer DEFAULT 1 NOT NULL,
	"max_qty" integer DEFAULT 1 NOT NULL,
	"avg_qty" numeric(8, 4) DEFAULT '1.0000' NOT NULL,
	"avg_qty_is_assumed" boolean DEFAULT false NOT NULL,
	"sample_size" integer,
	"reporter_count" integer,
	"ci_low" numeric(10, 8),
	"ci_high" numeric(10, 8),
	"confidence_tier" "confidence_tier" NOT NULL,
	"source" text NOT NULL,
	"is_quest_only" boolean DEFAULT false NOT NULL,
	"resolved_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creature_loot_resolved_creature_id_item_id_loot_method_pk" PRIMARY KEY("creature_id","item_id","loot_method")
);
--> statement-breakpoint
CREATE TABLE "creature_spawns" (
	"id" serial PRIMARY KEY NOT NULL,
	"creature_id" integer NOT NULL,
	"zone_id" integer,
	"zone_name" text,
	"subzone" text,
	"x" numeric(6, 2) NOT NULL,
	"y" numeric(6, 2) NOT NULL,
	"source" text NOT NULL,
	"confidence_tier" "confidence_tier" NOT NULL,
	"sample_size" integer,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "creatures" (
	"id" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"min_level" integer,
	"max_level" integer,
	"creature_type" text,
	"creature_family" text,
	"classification" text DEFAULT 'normal' NOT NULL,
	"faction_restriction" text,
	"health_min" integer,
	"health_max" integer,
	"primary_zone_id" integer,
	"primary_zone_name" text,
	"raw_coin_min_copper" bigint,
	"raw_coin_max_copper" bigint,
	"raw_coin_source" text,
	"source" text NOT NULL,
	"client_build" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drop_observations" (
	"id" serial PRIMARY KEY NOT NULL,
	"creature_id" integer NOT NULL,
	"item_id" integer NOT NULL,
	"loot_method" "loot_method" DEFAULT 'kill' NOT NULL,
	"source" text NOT NULL,
	"kills_observed" integer,
	"drops_observed" integer,
	"total_qty_observed" integer,
	"min_qty" integer,
	"max_qty" integer,
	"avg_qty" numeric(8, 4),
	"drop_rate" numeric(10, 8) NOT NULL,
	"ci_low" numeric(10, 8),
	"ci_high" numeric(10, 8),
	"reporter_count" integer,
	"confidence_tier" "confidence_tier" NOT NULL,
	"is_quest_only" boolean DEFAULT false NOT NULL,
	"client_build" text,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "farming_presets" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_key" text NOT NULL,
	"name" text NOT NULL,
	"kills_per_hour" integer NOT NULL,
	"hourly_expenses_copper" bigint DEFAULT 0 NOT NULL,
	"preferred_market_id" text,
	"commission_override" numeric(5, 4),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_market_snapshots" (
	"market_id" text NOT NULL,
	"item_id" integer NOT NULL,
	"lowest_buyout_copper" bigint,
	"p10_copper" bigint,
	"median_copper" bigint,
	"mean_copper" bigint,
	"market_value_copper" bigint,
	"historical_value_copper" bigint,
	"clearing_price_copper" bigint,
	"available_qty" integer DEFAULT 0 NOT NULL,
	"listing_count" integer DEFAULT 0 NOT NULL,
	"change_24h_pct" numeric(8, 3),
	"trend_7d_pct" numeric(8, 3),
	"trend_30d_pct" numeric(8, 3),
	"price_status" "data_status" DEFAULT 'ACTUAL' NOT NULL,
	"source" text NOT NULL,
	"snapshot_at" timestamp with time zone NOT NULL,
	CONSTRAINT "item_market_snapshots_market_id_item_id_pk" PRIMARY KEY("market_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "item_price_history" (
	"market_id" text NOT NULL,
	"item_id" integer NOT NULL,
	"resolution" "history_resolution" NOT NULL,
	"bucket_ts" timestamp with time zone NOT NULL,
	"min_copper" bigint,
	"p10_copper" bigint,
	"median_copper" bigint,
	"mean_copper" bigint,
	"available_qty" integer DEFAULT 0 NOT NULL,
	"listing_count" integer DEFAULT 0 NOT NULL,
	"source" text NOT NULL,
	CONSTRAINT "item_price_history_market_id_item_id_resolution_bucket_ts_pk" PRIMARY KEY("market_id","item_id","resolution","bucket_ts")
);
--> statement-breakpoint
CREATE TABLE "item_sales_estimates" (
	"market_id" text NOT NULL,
	"item_id" integer NOT NULL,
	"estimated_sold_per_day" numeric(14, 4),
	"days_seen" integer,
	"liquidity_score" numeric(5, 2),
	"selling_prob_24h" numeric(6, 4),
	"selling_prob_7d" numeric(6, 4),
	"data_status" "data_status" DEFAULT 'MISSING' NOT NULL,
	"source" text NOT NULL,
	"computed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "item_sales_estimates_market_id_item_id_pk" PRIMARY KEY("market_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"quality" integer NOT NULL,
	"quality_name" text NOT NULL,
	"item_class" text,
	"item_subclass" text,
	"item_level" integer,
	"required_level" integer,
	"bind_type" "bind_type" DEFAULT 'none' NOT NULL,
	"vendor_sell_copper" bigint DEFAULT 0 NOT NULL,
	"vendor_buy_copper" bigint DEFAULT 0 NOT NULL,
	"max_stack" integer DEFAULT 1 NOT NULL,
	"is_commodity" boolean DEFAULT false NOT NULL,
	"icon_id" integer,
	"icon_url" text,
	"description" text,
	"forever_status" text,
	"source" text NOT NULL,
	"client_build" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"job_type" text NOT NULL,
	"status" "sync_status" NOT NULL,
	"records_processed" integer DEFAULT 0 NOT NULL,
	"records_failed" integer DEFAULT 0 NOT NULL,
	"client_build" text,
	"error_summary" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user_watchlists" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_key" text NOT NULL,
	"item_id" integer NOT NULL,
	"market_id" text NOT NULL,
	"alert_price_above_copper" bigint,
	"alert_price_below_copper" bigint,
	"alert_supply_below_qty" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "zones" (
	"id" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"continent" text,
	"faction" text,
	"kind" text DEFAULT 'zone' NOT NULL,
	"min_level" integer,
	"max_level" integer,
	"is_instance" boolean DEFAULT false NOT NULL,
	"source" text NOT NULL,
	"client_build" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "creature_loot_resolved" ADD CONSTRAINT "creature_loot_resolved_creature_id_creatures_id_fk" FOREIGN KEY ("creature_id") REFERENCES "public"."creatures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creature_loot_resolved" ADD CONSTRAINT "creature_loot_resolved_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creature_loot_resolved" ADD CONSTRAINT "creature_loot_resolved_winning_observation_id_drop_observations_id_fk" FOREIGN KEY ("winning_observation_id") REFERENCES "public"."drop_observations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creature_spawns" ADD CONSTRAINT "creature_spawns_creature_id_creatures_id_fk" FOREIGN KEY ("creature_id") REFERENCES "public"."creatures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creature_spawns" ADD CONSTRAINT "creature_spawns_zone_id_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."zones"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creatures" ADD CONSTRAINT "creatures_primary_zone_id_zones_id_fk" FOREIGN KEY ("primary_zone_id") REFERENCES "public"."zones"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drop_observations" ADD CONSTRAINT "drop_observations_creature_id_creatures_id_fk" FOREIGN KEY ("creature_id") REFERENCES "public"."creatures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drop_observations" ADD CONSTRAINT "drop_observations_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "farming_presets" ADD CONSTRAINT "farming_presets_preferred_market_id_ah_markets_id_fk" FOREIGN KEY ("preferred_market_id") REFERENCES "public"."ah_markets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_market_snapshots" ADD CONSTRAINT "item_market_snapshots_market_id_ah_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."ah_markets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_market_snapshots" ADD CONSTRAINT "item_market_snapshots_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_price_history" ADD CONSTRAINT "item_price_history_market_id_ah_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."ah_markets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_price_history" ADD CONSTRAINT "item_price_history_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_sales_estimates" ADD CONSTRAINT "item_sales_estimates_market_id_ah_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."ah_markets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_sales_estimates" ADD CONSTRAINT "item_sales_estimates_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_watchlists" ADD CONSTRAINT "user_watchlists_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_watchlists" ADD CONSTRAINT "user_watchlists_market_id_ah_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."ah_markets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ah_markets_region_faction_idx" ON "ah_markets" USING btree ("region","faction");--> statement-breakpoint
CREATE INDEX "resolved_loot_item_idx" ON "creature_loot_resolved" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "resolved_loot_confidence_idx" ON "creature_loot_resolved" USING btree ("confidence_tier");--> statement-breakpoint
CREATE INDEX "creature_spawns_creature_idx" ON "creature_spawns" USING btree ("creature_id");--> statement-breakpoint
CREATE INDEX "creature_spawns_zone_idx" ON "creature_spawns" USING btree ("zone_id");--> statement-breakpoint
CREATE INDEX "creatures_name_idx" ON "creatures" USING btree ("name");--> statement-breakpoint
CREATE INDEX "creatures_zone_idx" ON "creatures" USING btree ("primary_zone_id");--> statement-breakpoint
CREATE INDEX "creatures_level_idx" ON "creatures" USING btree ("min_level","max_level");--> statement-breakpoint
CREATE UNIQUE INDEX "drop_obs_unique_idx" ON "drop_observations" USING btree ("creature_id","item_id","loot_method","source");--> statement-breakpoint
CREATE INDEX "drop_obs_creature_idx" ON "drop_observations" USING btree ("creature_id");--> statement-breakpoint
CREATE INDEX "drop_obs_item_idx" ON "drop_observations" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "drop_obs_confidence_idx" ON "drop_observations" USING btree ("confidence_tier");--> statement-breakpoint
CREATE INDEX "farming_presets_owner_idx" ON "farming_presets" USING btree ("owner_key");--> statement-breakpoint
CREATE INDEX "item_snapshots_item_idx" ON "item_market_snapshots" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "item_snapshots_time_idx" ON "item_market_snapshots" USING btree ("snapshot_at");--> statement-breakpoint
CREATE INDEX "price_history_item_market_ts_idx" ON "item_price_history" USING btree ("item_id","market_id","bucket_ts");--> statement-breakpoint
CREATE INDEX "sales_estimates_item_idx" ON "item_sales_estimates" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "items_name_idx" ON "items" USING btree ("name");--> statement-breakpoint
CREATE INDEX "items_quality_idx" ON "items" USING btree ("quality");--> statement-breakpoint
CREATE INDEX "items_class_idx" ON "items" USING btree ("item_class");--> statement-breakpoint
CREATE INDEX "sync_runs_provider_job_idx" ON "sync_runs" USING btree ("provider","job_type","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "watchlist_owner_item_market_idx" ON "user_watchlists" USING btree ("owner_key","item_id","market_id");--> statement-breakpoint
CREATE INDEX "zones_name_idx" ON "zones" USING btree ("name");