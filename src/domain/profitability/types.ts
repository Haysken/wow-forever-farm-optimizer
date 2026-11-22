import type {
  BindType,
  ConfidenceTier,
  DataStatus,
  LootMethod,
  MarketFaction,
} from "@/providers/types";

export type PriceBasis =
  | "clearing"
  | "lowest"
  | "p10"
  | "median"
  | "market_value";

export type UnknownLiquidityPolicy =
  | "exclude_from_adjusted"
  | "conservative_discount"
  | "assume_full";

export type FarmingSpeedPresetId = "slow" | "average" | "fast" | "custom";

export interface FarmingSpeedPreset {
  id: Exclude<FarmingSpeedPresetId, "custom">;
  label: string;
  killsPerHour: number;
  description: string;
}

export const FARMING_SPEED_PRESETS: readonly FarmingSpeedPreset[] = [
  {
    id: "slow",
    label: "Slow farming",
    killsPerHour: 30,
    description: "Elites, high-HP targets, or contested spawns (30 kills/hr)",
  },
  {
    id: "average",
    label: "Average farming",
    killsPerHour: 60,
    description: "Standard solo single-target grinding (60 kills/hr)",
  },
  {
    id: "fast",
    label: "Fast farming",
    killsPerHour: 120,
    description: "Geared AoE or low-level rapid clears (120 kills/hr)",
  },
] as const;

export const DEFAULT_MARKET_COMMISSIONS: Record<MarketFaction, number> = {
  alliance: 0.05,
  horde: 0.05,
  neutral: 0.15,
  unified: 0.05,
};

export interface LootDropInput {
  itemId: number;
  variantId?: string | null;
  suffixId?: number | null;
  suffixName?: string | null;
  variantCountForBase?: number | null;
  variantPriceNote?: string | null;
  itemName: string;
  quality: number;
  bindType: BindType;
  vendorSellCopper: number;
  isQuestOnly: boolean;
  isCommodity: boolean;
  lootMethod: LootMethod;
  dropRate: number; // [0, 1]
  minQty: number;
  maxQty: number;
  avgQty: number;
  avgQtyIsAssumed: boolean;
  confidenceTier: ConfidenceTier;
  sampleSize: number | null;
  reporterCount: number | null;
  ciLow: number | null;
  ciHigh: number | null;
  source: string;
  // Market snapshot fields (nullable when item has no active listings)
  lowestBuyoutCopper: number | null;
  p10Copper: number | null;
  medianCopper: number | null;
  marketValueCopper: number | null;
  clearingPriceCopper: number | null;
  availableQty: number;
  listingCount: number;
  trend7dPct: number | null;
  trend30dPct: number | null;
  priceStatus: DataStatus;
  snapshotAt: Date | null;
  // Sales / demand estimates
  estimatedSoldPerDay: number | null;
  daysSeen: number | null;
  salesDataStatus: DataStatus;
}

export interface CreatureProfitInput {
  creatureId: number;
  creatureName: string;
  rawCoinMinCopper: number | null;
  rawCoinMaxCopper: number | null;
  rawCoinSource: string | null;
  loot: LootDropInput[];
}

export interface ProfitabilityParams {
  /** K: Average creatures killed per hour (must be > 0). */
  killsPerHour: number;
  /** E: Farming expenses per hour in copper (consumables, repairs, ammo). */
  hourlyExpensesCopper?: number;
  /** Market type used to derive default commission if commissionRate is omitted. */
  marketFaction?: MarketFaction;
  /** C: Explicit Auction House commission override in [0, 1). */
  commissionRate?: number;
  /** Selected selling time horizon in days (e.g., 1 day or 7 days). */
  timeHorizonDays?: number;
  /** Price basis for AH valuation. Default: conservative "clearing". */
  priceBasis?: PriceBasis;
  /** Include non-refundable listing deposit penalty weighted by (1 - Si). */
  includeDepositPenalty?: boolean;
  /** Deposit cost as fraction of vendorSellCopper (default 0.15 for 12h faction, 0.75 neutral). */
  depositRateOfVendor?: number;
  /** How to treat AH items whose selling probability Si is UNKNOWN. */
  unknownLiquidityPolicy?: UnknownLiquidityPolicy;
  /** Discount applied when unknownLiquidityPolicy === "conservative_discount" (default 0.25). */
  unknownLiquidityDiscount?: number;
  /** Optional filter restricting which confidence tiers enter the calculation. */
  allowedConfidenceTiers?: ReadonlySet<ConfidenceTier>;
}

export interface DropProbabilityMetrics {
  dropRate: number;
  expectedKillsPerDrop: number | null;
  killsFor50Pct: number | null;
  killsFor90Pct: number | null;
}

export interface LiquidityAssessment {
  score: number | null; // 0..100 or null when UNKNOWN
  sellingProbability: number | null; // [0, 1] or null when UNKNOWN
  daysOfSupply: number | null;
  status: "ESTIMATED" | "UNKNOWN";
  factors: {
    demandScore: number | null;
    supplyCompetitionScore: number | null;
    stabilityScore: number | null;
    observationScore: number | null;
  };
}

export type LiquidationChannel = "none" | "vendor" | "auction_house";

export interface ItemContribution {
  itemId: number;
  variantId: string | null;
  suffixId: number | null;
  suffixName: string | null;
  variantCountForBase: number | null;
  variantPriceNote: string | null;
  itemName: string;
  quality: number;
  lootMethod: LootMethod;
  liquidationChannel: LiquidationChannel;
  dropRate: number;
  avgQty: number;
  avgQtyIsAssumed: boolean;
  unitGrossCopper: number;
  effectiveCommissionRate: number;
  depositPenaltyPerUnitCopper: number;
  expectedGrossEvPerKillCopper: number;
  expectedLiquidityAdjustedPerKillCopper: number;
  unknownLiquidityEvPerKillCopper: number;
  liquidity: LiquidityAssessment;
  dropMetrics: DropProbabilityMetrics;
  confidenceTier: ConfidenceTier;
  sampleSize: number | null;
  source: string;
  priceStatus: DataStatus;
  salesDataStatus: DataStatus;
}

export interface CreatureProfitabilityResult {
  creatureId: number;
  creatureName: string;
  /** EGPH using liquidity-adjusted realization (conservative, never invents unknown Si). */
  egphLiquidityAdjustedCopper: number;
  /** Theoretical EGPH assuming Si = 1.0 for all AH-sellable drops. */
  egphGrossEvCopper: number;
  /** EGPK = EGPH / K (liquidity-adjusted, net of hourly expenses). */
  egpkLiquidityAdjustedCopper: number;
  /** Gross EV per kill (net of hourly expenses / K). */
  egpkGrossEvCopper: number;
  /** Pre-expense breakdown per kill. */
  rawCoinPerKillCopper: number;
  vendorValuePerKillCopper: number;
  ahGrossValuePerKillCopper: number;
  ahLiquidityAdjustedValuePerKillCopper: number;
  /** Portion of hourly gross EV attributable to items with UNKNOWN selling probability. */
  unknownLiquidityEvPerHourCopper: number;
  unknownLiquiditySharePct: number;
  bestDrop: ItemContribution | null;
  /** Highest-priority confidence tier present among contributing drops. */
  overallConfidence: ConfidenceTier;
  /** True if any contributing drop comes from ESTIMATED (Classic 1.12) or low-confidence data. */
  includesEstimatedData: boolean;
  /** EV-weighted liquidity score (0..100), or null if no AH drops have known liquidity. */
  weightedLiquidityScore: number | null;
  items: ItemContribution[];
  appliedParams: {
    killsPerHour: number;
    hourlyExpensesCopper: number;
    commissionRate: number;
    timeHorizonDays: number;
    priceBasis: PriceBasis;
    unknownLiquidityPolicy: UnknownLiquidityPolicy;
  };
}
