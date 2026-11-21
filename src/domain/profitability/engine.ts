import type { ConfidenceTier } from "@/providers/types";
import { evaluateMarketLiquidity } from "./liquidity";
import { computeDropProbabilityMetrics } from "./probabilities";
import {
  DEFAULT_MARKET_COMMISSIONS,
  type CreatureProfitabilityResult,
  type CreatureProfitInput,
  type ItemContribution,
  type LiquidationChannel,
  type LootDropInput,
  type PriceBasis,
  type ProfitabilityParams,
} from "./types";

const CONFIDENCE_PRIORITY: Record<ConfidenceTier, number> = {
  VERIFIED: 4,
  OBSERVED: 3,
  ESTIMATED: 2,
  UNKNOWN: 1,
};

function selectAuctionUnitPriceCopper(
  item: LootDropInput,
  basis: PriceBasis
): number | null {
  const ordered: Array<number | null> =
    basis === "lowest"
      ? [item.lowestBuyoutCopper, item.clearingPriceCopper, item.medianCopper]
      : basis === "p10"
        ? [item.p10Copper, item.clearingPriceCopper, item.lowestBuyoutCopper]
        : basis === "median"
          ? [item.medianCopper, item.clearingPriceCopper, item.lowestBuyoutCopper]
          : basis === "market_value"
            ? [item.marketValueCopper, item.clearingPriceCopper, item.medianCopper]
            : [
                item.clearingPriceCopper,
                item.p10Copper,
                item.medianCopper,
                item.marketValueCopper,
                item.lowestBuyoutCopper,
              ];

  for (const candidate of ordered) {
    if (candidate !== null && Number.isFinite(candidate) && candidate > 0) {
      return candidate;
    }
  }
  return null;
}

/**
 * Core Expected Gold per Hour (EGPH) profitability engine.
 *
 * Implements:
 *   EGPH = K * SUM(Pi * Qi * Vi * (1 - Ci) * Si) + K * avgRawCoin - E
 *
 * Key economic guarantees:
 * - Evaluates ALL relevant loot drops from the creature (never single-item shortcuts).
 * - Routes BoP, Poor (gray), unlisted, and below-vendor items to NPC vendor (C = 0, S = 1.0).
 * - Excludes Quest items from gold valuation (V = 0).
 * - Applies configurable AH commission C per market type (5% faction, 15% neutral default).
 * - Never invents selling probability Si when sales velocity is missing; transparently splits
 *   Liquidity-Adjusted EGPH vs Gross EV EGPH and reports unknownLiquiditySharePct.
 */
export function calculateCreatureProfitability(
  input: CreatureProfitInput,
  params: ProfitabilityParams
): CreatureProfitabilityResult {
  if (!Number.isFinite(params.killsPerHour) || params.killsPerHour <= 0) {
    throw new Error(`killsPerHour (K) must be a positive finite number, received ${params.killsPerHour}`);
  }

  const marketFaction = params.marketFaction ?? "alliance";
  const commissionRate =
    params.commissionRate ?? DEFAULT_MARKET_COMMISSIONS[marketFaction];
  if (!Number.isFinite(commissionRate) || commissionRate < 0 || commissionRate >= 1) {
    throw new Error(
      `commissionRate (C) must be in [0, 1), received ${commissionRate}`
    );
  }

  const hourlyExpensesCopper = Math.max(0, params.hourlyExpensesCopper ?? 0);
  const timeHorizonDays = Math.max(0.01, params.timeHorizonDays ?? 1);
  const priceBasis: PriceBasis = params.priceBasis ?? "clearing";
  const includeDepositPenalty = params.includeDepositPenalty ?? false;
  const depositRateOfVendor =
    params.depositRateOfVendor ?? (marketFaction === "neutral" ? 0.75 : 0.15);
  const unknownLiquidityPolicy =
    params.unknownLiquidityPolicy ?? "exclude_from_adjusted";
  const unknownLiquidityDiscount = Math.min(
    1,
    Math.max(0, params.unknownLiquidityDiscount ?? 0.25)
  );

  // Raw coin drop (C = 0, S = 1.0)
  const rawCoinPerKillCopper =
    input.rawCoinMinCopper !== null && input.rawCoinMaxCopper !== null
      ? (Math.max(0, input.rawCoinMinCopper) + Math.max(0, input.rawCoinMaxCopper)) / 2
      : input.rawCoinMinCopper !== null
        ? Math.max(0, input.rawCoinMinCopper)
        : 0;

  let vendorValuePerKillCopper = 0;
  let ahGrossValuePerKillCopper = 0;
  let ahLiquidityAdjustedValuePerKillCopper = 0;
  let unknownLiquidityEvPerKillCopper = 0;

  let liquidityWeightSum = 0;
  let liquidityScoreWeightedSum = 0;

  const contributions: ItemContribution[] = [];

  for (const item of input.loot) {
    if (
      params.allowedConfidenceTiers &&
      !params.allowedConfidenceTiers.has(item.confidenceTier)
    ) {
      continue;
    }

    const dropRate = Number.isFinite(item.dropRate)
      ? Math.min(1, Math.max(0, item.dropRate))
      : 0;
    const avgQty =
      Number.isFinite(item.avgQty) && item.avgQty > 0 ? item.avgQty : 1;
    const dropMetrics = computeDropProbabilityMetrics(dropRate);
    const vendorSell = Math.max(0, item.vendorSellCopper);

    const liquidity = evaluateMarketLiquidity({
      estimatedSoldPerDay: item.estimatedSoldPerDay,
      availableQty: item.availableQty,
      trend7dPct: item.trend7dPct,
      trend30dPct: item.trend30dPct,
      daysSeen: item.daysSeen,
      salesDataStatus: item.salesDataStatus,
      timeHorizonDays,
    });

    const isUnsellable = item.isQuestOnly || item.bindType === "quest";
    const isVendorOnly = item.bindType === "bop" || item.quality === 0;
    const ahUnitPrice =
      !isUnsellable && !isVendorOnly
        ? selectAuctionUnitPriceCopper(item, priceBasis)
        : null;

    let channel: LiquidationChannel = "none";
    let unitGrossCopper = 0;
    let effectiveCommissionRate = 0;
    let depositPenaltyPerUnitCopper = 0;
    let expectedGrossEvPerKillCopper = 0;
    let expectedLiquidityAdjustedPerKillCopper = 0;
    let itemUnknownLiqEvPerKillCopper = 0;

    if (isUnsellable || dropRate === 0) {
      channel = "none";
    } else {
      const ahGrossUnitNet =
        ahUnitPrice !== null ? ahUnitPrice * (1 - commissionRate) : 0;

      if (isVendorOnly || ahUnitPrice === null || ahGrossUnitNet <= vendorSell) {
        if (vendorSell > 0) {
          channel = "vendor";
          unitGrossCopper = vendorSell;
          effectiveCommissionRate = 0;
          const ev = dropRate * avgQty * vendorSell;
          expectedGrossEvPerKillCopper = ev;
          expectedLiquidityAdjustedPerKillCopper = ev;
          vendorValuePerKillCopper += ev;
        }
      } else {
        // Auction House beats vendor on gross net value
        const depositPerListing = includeDepositPenalty
          ? Math.max(1, Math.round(vendorSell * depositRateOfVendor))
          : 0;

        if (liquidity.sellingProbability !== null) {
          const s = liquidity.sellingProbability;
          depositPenaltyPerUnitCopper = depositPerListing * (1 - s);
          const ahAdjUnitNet = ahGrossUnitNet * s - depositPenaltyPerUnitCopper;

          if (ahAdjUnitNet <= vendorSell && vendorSell > 0) {
            // Even though AH sticker price is higher, poor liquidity makes vendoring superior
            channel = "vendor";
            unitGrossCopper = vendorSell;
            effectiveCommissionRate = 0;
            depositPenaltyPerUnitCopper = 0;
            const ev = dropRate * avgQty * vendorSell;
            expectedGrossEvPerKillCopper = ev;
            expectedLiquidityAdjustedPerKillCopper = ev;
            vendorValuePerKillCopper += ev;
          } else {
            channel = "auction_house";
            unitGrossCopper = ahUnitPrice;
            effectiveCommissionRate = commissionRate;
            expectedGrossEvPerKillCopper = dropRate * avgQty * ahGrossUnitNet;
            expectedLiquidityAdjustedPerKillCopper =
              dropRate * avgQty * Math.max(0, ahAdjUnitNet);
            ahGrossValuePerKillCopper += expectedGrossEvPerKillCopper;
            ahLiquidityAdjustedValuePerKillCopper +=
              expectedLiquidityAdjustedPerKillCopper;

            if (liquidity.score !== null) {
              liquidityWeightSum += expectedGrossEvPerKillCopper;
              liquidityScoreWeightedSum +=
                liquidity.score * expectedGrossEvPerKillCopper;
            }
          }
        } else {
          // Selling probability is UNKNOWN — never fabricate Si
          channel = "auction_house";
          unitGrossCopper = ahUnitPrice;
          effectiveCommissionRate = commissionRate;
          expectedGrossEvPerKillCopper = dropRate * avgQty * ahGrossUnitNet;
          itemUnknownLiqEvPerKillCopper = expectedGrossEvPerKillCopper;
          ahGrossValuePerKillCopper += expectedGrossEvPerKillCopper;
          unknownLiquidityEvPerKillCopper += itemUnknownLiqEvPerKillCopper;

          if (unknownLiquidityPolicy === "assume_full") {
            expectedLiquidityAdjustedPerKillCopper = expectedGrossEvPerKillCopper;
            ahLiquidityAdjustedValuePerKillCopper +=
              expectedLiquidityAdjustedPerKillCopper;
          } else if (unknownLiquidityPolicy === "conservative_discount") {
            const discounted = Math.max(
              vendorSell,
              ahGrossUnitNet * unknownLiquidityDiscount
            );
            expectedLiquidityAdjustedPerKillCopper =
              dropRate * avgQty * discounted;
            ahLiquidityAdjustedValuePerKillCopper +=
              expectedLiquidityAdjustedPerKillCopper;
          } else {
            // "exclude_from_adjusted": count only guaranteed vendor floor in adjusted EGPH
            const vendorFloorEv = dropRate * avgQty * vendorSell;
            expectedLiquidityAdjustedPerKillCopper = vendorFloorEv;
            if (vendorFloorEv > 0) {
              vendorValuePerKillCopper += vendorFloorEv;
            }
          }
        }
      }
    }

    contributions.push({
      itemId: item.itemId,
      itemName: item.itemName,
      quality: item.quality,
      lootMethod: item.lootMethod,
      liquidationChannel: channel,
      dropRate,
      avgQty,
      avgQtyIsAssumed: item.avgQtyIsAssumed,
      unitGrossCopper,
      effectiveCommissionRate,
      depositPenaltyPerUnitCopper,
      expectedGrossEvPerKillCopper,
      expectedLiquidityAdjustedPerKillCopper,
      unknownLiquidityEvPerKillCopper: itemUnknownLiqEvPerKillCopper,
      liquidity,
      dropMetrics,
      confidenceTier: item.confidenceTier,
      sampleSize: item.sampleSize,
      source: item.source,
      priceStatus: item.priceStatus,
      salesDataStatus: item.salesDataStatus,
    });
  }

  contributions.sort(
    (a, b) =>
      b.expectedLiquidityAdjustedPerKillCopper -
        a.expectedLiquidityAdjustedPerKillCopper ||
      b.expectedGrossEvPerKillCopper - a.expectedGrossEvPerKillCopper
  );

  const totalGrossPerKillBeforeExpenses =
    rawCoinPerKillCopper +
    contributions.reduce((acc, c) => acc + c.expectedGrossEvPerKillCopper, 0);

  const totalAdjustedPerKillBeforeExpenses =
    rawCoinPerKillCopper +
    contributions.reduce(
      (acc, c) => acc + c.expectedLiquidityAdjustedPerKillCopper,
      0
    );

  const K = params.killsPerHour;
  const egphGrossEvCopper =
    K * totalGrossPerKillBeforeExpenses - hourlyExpensesCopper;
  const egphLiquidityAdjustedCopper =
    K * totalAdjustedPerKillBeforeExpenses - hourlyExpensesCopper;
  const egpkGrossEvCopper = egphGrossEvCopper / K;
  const egpkLiquidityAdjustedCopper = egphLiquidityAdjustedCopper / K;

  const unknownLiquidityEvPerHourCopper = K * unknownLiquidityEvPerKillCopper;
  const grossLootPerHour = K * totalGrossPerKillBeforeExpenses;
  const unknownLiquiditySharePct =
    grossLootPerHour > 0
      ? Number(((unknownLiquidityEvPerHourCopper / grossLootPerHour) * 100).toFixed(2))
      : 0;

  const contributingItems = contributions.filter(
    (c) => c.expectedGrossEvPerKillCopper > 0
  );

  let overallConfidence: ConfidenceTier = "UNKNOWN";
  if (contributingItems.length > 0) {
    // Report the lowest confidence tier among items contributing >= 10% of gross loot EV,
    // or best available if all are small — prevents hiding an ESTIMATED big-ticket drop behind VERIFIED trash.
    const materialItems = contributingItems.filter(
      (c) =>
        totalGrossPerKillBeforeExpenses > 0 &&
        c.expectedGrossEvPerKillCopper / totalGrossPerKillBeforeExpenses >= 0.1
    );
    const pool = materialItems.length > 0 ? materialItems : contributingItems;
    overallConfidence = pool.reduce<ConfidenceTier>((lowest, item) => {
      return CONFIDENCE_PRIORITY[item.confidenceTier] <
        CONFIDENCE_PRIORITY[lowest]
        ? item.confidenceTier
        : lowest;
    }, pool[0]!.confidenceTier);
  }

  const includesEstimatedData = contributingItems.some(
    (c) => c.confidenceTier === "ESTIMATED" || c.confidenceTier === "UNKNOWN"
  );

  const bestDrop =
    contributions.find((c) => c.expectedGrossEvPerKillCopper > 0) ?? null;

  const weightedLiquidityScore =
    liquidityWeightSum > 0
      ? Number((liquidityScoreWeightedSum / liquidityWeightSum).toFixed(2))
      : null;

  return {
    creatureId: input.creatureId,
    creatureName: input.creatureName,
    egphLiquidityAdjustedCopper: Math.round(egphLiquidityAdjustedCopper),
    egphGrossEvCopper: Math.round(egphGrossEvCopper),
    egpkLiquidityAdjustedCopper: Math.round(egpkLiquidityAdjustedCopper),
    egpkGrossEvCopper: Math.round(egpkGrossEvCopper),
    rawCoinPerKillCopper: Math.round(rawCoinPerKillCopper),
    vendorValuePerKillCopper: Math.round(vendorValuePerKillCopper),
    ahGrossValuePerKillCopper: Math.round(ahGrossValuePerKillCopper),
    ahLiquidityAdjustedValuePerKillCopper: Math.round(
      ahLiquidityAdjustedValuePerKillCopper
    ),
    unknownLiquidityEvPerHourCopper: Math.round(unknownLiquidityEvPerHourCopper),
    unknownLiquiditySharePct,
    bestDrop,
    overallConfidence,
    includesEstimatedData,
    weightedLiquidityScore,
    items: contributions,
    appliedParams: {
      killsPerHour: K,
      hourlyExpensesCopper,
      commissionRate,
      timeHorizonDays,
      priceBasis,
      unknownLiquidityPolicy,
    },
  };
}
