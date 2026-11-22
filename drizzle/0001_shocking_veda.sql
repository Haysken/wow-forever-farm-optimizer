CREATE TABLE "item_variant_snapshots" (
	"variant_id" text NOT NULL,
	"house_key" text NOT NULL,
	"region" text NOT NULL,
	"faction" "faction" NOT NULL,
	"realm_label" text,
	"lowest_buyout_copper" bigint,
	"p10_copper" bigint,
	"median_copper" bigint,
	"clearing_price_copper" bigint,
	"base_reference_copper" bigint,
	"available_qty" integer DEFAULT 0 NOT NULL,
	"listing_count" integer DEFAULT 0 NOT NULL,
	"time_left_short" integer DEFAULT 0 NOT NULL,
	"time_left_medium" integer DEFAULT 0 NOT NULL,
	"time_left_long" integer DEFAULT 0 NOT NULL,
	"time_left_very_long" integer DEFAULT 0 NOT NULL,
	"price_status" "data_status" DEFAULT 'ACTUAL' NOT NULL,
	"source" text NOT NULL,
	"snapshot_at" timestamp with time zone NOT NULL,
	CONSTRAINT "item_variant_snapshots_variant_id_house_key_pk" PRIMARY KEY("variant_id","house_key")
);
--> statement-breakpoint
CREATE TABLE "item_variants" (
	"id" text PRIMARY KEY NOT NULL,
	"item_id" integer NOT NULL,
	"suffix_id" integer NOT NULL,
	"full_name" text NOT NULL,
	"suffix_name" text NOT NULL,
	"source" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "item_variant_snapshots" ADD CONSTRAINT "item_variant_snapshots_variant_id_item_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."item_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_variants" ADD CONSTRAINT "item_variants_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "item_variant_snapshots_region_idx" ON "item_variant_snapshots" USING btree ("region","variant_id");--> statement-breakpoint
CREATE INDEX "item_variant_snapshots_variant_idx" ON "item_variant_snapshots" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "item_variants_item_idx" ON "item_variants" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "item_variants_full_name_idx" ON "item_variants" USING btree ("full_name");--> statement-breakpoint
CREATE UNIQUE INDEX "item_variants_item_suffix_idx" ON "item_variants" USING btree ("item_id","suffix_id");