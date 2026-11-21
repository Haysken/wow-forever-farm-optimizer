export type ConfidenceTier = "VERIFIED" | "OBSERVED" | "ESTIMATED" | "UNKNOWN";

export type DataStatus = "ACTUAL" | "CALCULATED" | "ESTIMATED" | "MISSING";

export type MarketFaction = "alliance" | "horde" | "neutral" | "unified";

export type LootMethod = "kill" | "skinning" | "pickpocket";

export type BindType = "none" | "boe" | "bop" | "bou" | "quest";

export type MarketProviderId = "forever_ah" | "blizzard_api" | "ahledger";

export type CatalogProviderId = "everlookdb" | "wclbox";

export type LootProviderId = "everloot" | "everlookdb_players" | "classic_db";

export interface NormalizedZone {
  id: number;
  name: string;
  continent: string | null;
  faction: string | null;
  kind: string;
  minLevel: number | null;
  maxLevel: number | null;
  isInstance: boolean;
  source: CatalogProviderId;
  clientBuild: string | null;
}

export interface NormalizedItem {
  id: number;
  name: string;
  quality: number;
  qualityName: string;
  itemClass: string | null;
  itemSubclass: string | null;
  itemLevel: number | null;
  requiredLevel: number | null;
  bindType: BindType;
  vendorSellCopper: number;
  vendorBuyCopper: number;
  maxStack: number;
  isCommodity: boolean;
  iconId: number | null;
  iconUrl: string | null;
  description: string | null;
  foreverStatus: string | null;
  source: CatalogProviderId;
  clientBuild: string | null;
}

export interface NormalizedCreature {
  id: number;
  name: string;
  minLevel: number | null;
  maxLevel: number | null;
  creatureType: string | null;
  creatureFamily: string | null;
  classification: string;
  factionRestriction: string | null;
  healthMin: number | null;
  healthMax: number | null;
  primaryZoneName: string | null;
  rawCoinMinCopper: number | null;
  rawCoinMaxCopper: number | null;
  rawCoinSource: string | null;
  source: CatalogProviderId;
  clientBuild: string | null;
}

export interface NormalizedSpawn {
  creatureId: number;
  zoneId: number | null;
  zoneName: string | null;
  subzone: string | null;
  x: number;
  y: number;
  source: string;
  confidenceTier: ConfidenceTier;
  sampleSize: number | null;
}

export interface NormalizedDropObservation {
  creatureId: number;
  itemId: number;
  lootMethod: LootMethod;
  source: LootProviderId;
  killsObserved: number | null;
  dropsObserved: number | null;
  totalQtyObserved: number | null;
  minQty: number | null;
  maxQty: number | null;
  avgQty: number | null;
  dropRate: number;
  ciLow: number | null;
  ciHigh: number | null;
  reporterCount: number | null;
  confidenceTier: ConfidenceTier;
  isQuestOnly: boolean;
  clientBuild: string | null;
  observedAt: Date;
}

export interface NormalizedMarket {
  id: string; // e.g. "us:110"
  region: string;
  rulesetId: number;
  rulesetLabel: string | null;
  houseId: number;
  faction: MarketFaction;
  displayName: string;
  defaultCommissionRate: number; // 0.05 faction, 0.15 neutral
  providerSource: MarketProviderId;
  providerKey: string;
  lastSnapshotAt: Date | null;
}

export interface NormalizedItemMarketRow {
  marketId: string;
  itemId: number;
  lowestBuyoutCopper: number | null;
  p10Copper: number | null;
  medianCopper: number | null;
  meanCopper: number | null;
  marketValueCopper: number | null;
  historicalValueCopper: number | null;
  clearingPriceCopper: number | null;
  availableQty: number;
  listingCount: number;
  change24hPct: number | null;
  trend7dPct: number | null;
  trend30dPct: number | null;
  estimatedSoldPerDay: number | null;
  daysSeen: number | null;
  salesDataStatus: DataStatus;
  priceStatus: DataStatus;
  source: MarketProviderId;
  snapshotAt: Date;
}

export interface NormalizedPricePoint {
  marketId: string;
  itemId: number;
  resolution: "hour" | "day";
  bucketTs: Date;
  minCopper: number | null;
  p10Copper: number | null;
  medianCopper: number | null;
  meanCopper: number | null;
  availableQty: number;
  listingCount: number;
  source: MarketProviderId;
}

export interface CatalogProvider {
  readonly sourceId: CatalogProviderId;
  fetchZones(): Promise<{ build: string | null; zones: NormalizedZone[] }>;
  fetchItems(): Promise<{ build: string | null; items: NormalizedItem[] }>;
  fetchCreatures(): Promise<{ build: string | null; creatures: NormalizedCreature[] }>;
}

export interface LootObservationProvider {
  readonly sourceId: LootProviderId;
  fetchDrops(): Promise<{
    dataAsOf: Date;
    observations: NormalizedDropObservation[];
    skippedNonCreatureRows: number;
  }>;
}

export interface MarketDataProvider {
  readonly sourceId: MarketProviderId;
  fetchMarkets(regions?: string[]): Promise<NormalizedMarket[]>;
  fetchMarketSnapshot(
    market: NormalizedMarket,
    options?: { maxPages?: number; pageSize?: number; itemIds?: number[] }
  ): Promise<NormalizedItemMarketRow[]>;
  fetchItemHistory?(
    market: NormalizedMarket,
    itemId: number,
    resolution: "hour" | "day"
  ): Promise<NormalizedPricePoint[]>;
}
