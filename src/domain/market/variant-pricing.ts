import type { DataStatus, MarketFaction } from "@/providers/types";
import type { LootDropInput } from "@/domain/profitability/types";

export const MIN_SUFFIX_MULTIPLIER = 0.25;
export const MAX_SUFFIX_MULTIPLIER = 25.0;

export interface VariantSnapshotRecord {
  variantId: string;
  itemId: number;
  suffixId: number;
  fullName: string;
  suffixName: string;
  houseKey: string;
  region: string;
  faction: MarketFaction;
  realmLabel: string | null;
  lowestBuyoutCopper: number | null;
  p10Copper: number | null;
  medianCopper: number | null;
  clearingPriceCopper: number | null;
  baseReferenceCopper: number | null;
  availableQty: number;
  listingCount: number;
  timeLeftShort: number;
  timeLeftMedium: number;
  timeLeftLong: number;
  timeLeftVeryLong: number;
  snapshotAt: Date;
}

export interface AggregatedVariantCandidate {
  variantId: string;
  itemId: number;
  suffixId: number;
  fullName: string;
  suffixName: string;
  /** Direct snapshots in the requested region (if any) */
  directSnapshots: VariantSnapshotRecord[];
  /** Reference snapshots from any scanned region (currently EU EverlookDB) */
  referenceSnapshots: VariantSnapshotRecord[];
}

export interface ResolvedVariantPrice {
  clearingPriceCopper: number | null;
  lowestBuyoutCopper: number | null;
  p10Copper: number | null;
  medianCopper: number | null;
  availableQty: number;
  listingCount: number;
  priceStatus: DataStatus;
  calibrationMethod: "direct_scan" | "region_base_scaled" | "cross_region_fallback" | "missing";
  /** Empirical suffix premium ratio (variant / base) observed in direct scan */
  suffixMultiplier: number | null;
  /** Target market base price used when calibrating cross-region */
  basePriceUsedCopper: number | null;
  /** Reference EU scanned clearing price */
  referenceClearingCopper: number | null;
  /** Human-readable provenance note for UI display */
  note: string;
  snapshotAt: Date | null;
}

/**
 * Computes the empirical suffix premium multiplier from real scanned variant vs base prices,
 * clamped to [0.25, 25.0] so single-listing outlier prices cannot distort calibrated estimates.
 */
export function computeSuffixMultiplier(
  variantCopper: number | null,
  baseReferenceCopper: number | null,
  vendorSellCopper: number
): number {
  if (variantCopper === null || !Number.isFinite(variantCopper) || variantCopper <= 0) {
    return 1.0;
  }
  const denom = Math.max(
    baseReferenceCopper !== null && Number.isFinite(baseReferenceCopper) && baseReferenceCopper > 0
      ? baseReferenceCopper
      : 0,
    Math.max(0, vendorSellCopper),
    1
  );
  const raw = variantCopper / denom;
  return Number(
    Math.min(MAX_SUFFIX_MULTIPLIER, Math.max(MIN_SUFFIX_MULTIPLIER, raw)).toFixed(4)
  );
}

function pickRepresentativeSnapshot(
  snapshots: readonly VariantSnapshotRecord[],
  preferredFaction?: MarketFaction
): VariantSnapshotRecord | null {
  const priced = snapshots.filter(
    (s) => s.clearingPriceCopper !== null && s.clearingPriceCopper > 0
  );
  if (priced.length === 0) return null;

  // Prefer matching faction if available, otherwise pick the house with most supply / lowest conservative price
  const factionMatch =
    preferredFaction && preferredFaction !== "unified"
      ? priced.filter((s) => s.faction === preferredFaction)
      : [];
  const pool = factionMatch.length > 0 ? factionMatch : priced;

  const sorted = [...pool].sort(
    (a, b) =>
      (a.clearingPriceCopper ?? Infinity) - (b.clearingPriceCopper ?? Infinity) ||
      b.availableQty - a.availableQty
  );
  return sorted[Math.floor(sorted.length / 2)] ?? sorted[0] ?? null;
}

/**
 * Resolves a random-enchant variant's market price for BOTH US and EU markets:
 * - Tier 1 (ACTUAL): Direct scanned snapshot in the target region (and matching faction when non-unified,
 *   or any house in that region for unified pools).
 * - Tier 2 (ESTIMATED · Region Base Scaled): Target market's REAL live base item price from Forever AH
 *   multiplied by the empirical suffix premium ratio (M = variant_ref / base_ref) observed in EverlookDB,
 *   floored at vendorSellCopper.
 * - Tier 3 (ESTIMATED · Cross-Region Fallback): If the target market has 0 active base listings,
 *   falls back transparently to the reference scanned variant price.
 */
export function resolveVariantMarketPrice(params: {
  targetRegion: string;
  targetFaction: MarketFaction;
  vendorSellCopper: number;
  /** Target market's real live base-item clearing price (e.g., us:110 or us:0) */
  targetMarketBaseCopper: number | null;
  /** Target region's unified base-item clearing price fallback (e.g., us:0) */
  targetRegionUnifiedBaseCopper: number | null;
  candidate: AggregatedVariantCandidate;
}): ResolvedVariantPrice {
  const {
    targetRegion,
    targetFaction,
    vendorSellCopper,
    targetMarketBaseCopper,
    targetRegionUnifiedBaseCopper,
    candidate,
  } = params;

  const regLower = targetRegion.toLowerCase();
  const refSnap = pickRepresentativeSnapshot(candidate.referenceSnapshots);
  const directMatchPool = candidate.directSnapshots.filter(
    (s) => s.region.toLowerCase() === regLower
  );

  // Use direct scan when we have a scan in this region AND either unified or matching faction
  const directFactionPool =
    targetFaction === "unified"
      ? directMatchPool
      : directMatchPool.filter((s) => s.faction === targetFaction);

  const directSnap = pickRepresentativeSnapshot(directFactionPool, targetFaction);

  const multiplierSource = directSnap ?? refSnap;
  const suffixMultiplier = multiplierSource
    ? computeSuffixMultiplier(
        multiplierSource.clearingPriceCopper,
        multiplierSource.baseReferenceCopper,
        vendorSellCopper
      )
    : null;

  if (directSnap && directSnap.clearingPriceCopper !== null) {
    const totalQty = directFactionPool.reduce((acc, s) => acc + s.availableQty, 0);
    const totalListings = directFactionPool.reduce((acc, s) => acc + s.listingCount, 0);
    return {
      clearingPriceCopper: directSnap.clearingPriceCopper,
      lowestBuyoutCopper: directSnap.lowestBuyoutCopper,
      p10Copper: directSnap.p10Copper,
      medianCopper: directSnap.medianCopper,
      availableQty: totalQty,
      listingCount: totalListings,
      priceStatus: "ACTUAL",
      calibrationMethod: "direct_scan",
      suffixMultiplier,
      basePriceUsedCopper: directSnap.baseReferenceCopper,
      referenceClearingCopper: refSnap?.clearingPriceCopper ?? directSnap.clearingPriceCopper,
      note: `ACTUAL (${directSnap.houseKey})`,
      snapshotAt: directSnap.snapshotAt,
    };
  }

  // No direct scan for this region/faction (e.g. US markets or EU Horde):
  // Calibrate using target market's REAL live base price * empirical suffix premium multiplier
  const baseForCalibration =
    targetMarketBaseCopper !== null && targetMarketBaseCopper > 0
      ? targetMarketBaseCopper
      : targetRegionUnifiedBaseCopper !== null && targetRegionUnifiedBaseCopper > 0
        ? targetRegionUnifiedBaseCopper
        : null;

  if (refSnap && refSnap.clearingPriceCopper !== null && suffixMultiplier !== null) {
    if (baseForCalibration !== null) {
      const scaledClearing = Math.max(
        vendorSellCopper,
        Math.round(baseForCalibration * suffixMultiplier)
      );
      const lowRatio =
        refSnap.lowestBuyoutCopper && refSnap.clearingPriceCopper > 0
          ? refSnap.lowestBuyoutCopper / refSnap.clearingPriceCopper
          : 1;
      const medRatio =
        refSnap.medianCopper && refSnap.clearingPriceCopper > 0
          ? refSnap.medianCopper / refSnap.clearingPriceCopper
          : 1;

      return {
        clearingPriceCopper: scaledClearing,
        lowestBuyoutCopper: Math.max(vendorSellCopper, Math.round(scaledClearing * lowRatio)),
        p10Copper: scaledClearing,
        medianCopper: Math.max(vendorSellCopper, Math.round(scaledClearing * medRatio)),
        availableQty: refSnap.availableQty,
        listingCount: refSnap.listingCount,
        priceStatus: "ESTIMATED",
        calibrationMethod: "region_base_scaled",
        suffixMultiplier,
        basePriceUsedCopper: baseForCalibration,
        referenceClearingCopper: refSnap.clearingPriceCopper,
        note: `${regLower.toUpperCase()} Calibrated (${suffixMultiplier.toFixed(2)}× base)`,
        snapshotAt: refSnap.snapshotAt,
      };
    }

    // Fallback: item has no active base listing in target region -> transparent EU scan reference
    return {
      clearingPriceCopper: refSnap.clearingPriceCopper,
      lowestBuyoutCopper: refSnap.lowestBuyoutCopper,
      p10Copper: refSnap.p10Copper,
      medianCopper: refSnap.medianCopper,
      availableQty: refSnap.availableQty,
      listingCount: refSnap.listingCount,
      priceStatus: "ESTIMATED",
      calibrationMethod: "cross_region_fallback",
      suffixMultiplier,
      basePriceUsedCopper: null,
      referenceClearingCopper: refSnap.clearingPriceCopper,
      note: `ESTIMATED (${refSnap.region.toUpperCase()} Ref)`,
      snapshotAt: refSnap.snapshotAt,
    };
  }

  return {
    clearingPriceCopper: null,
    lowestBuyoutCopper: null,
    p10Copper: null,
    medianCopper: null,
    availableQty: 0,
    listingCount: 0,
    priceStatus: "MISSING",
    calibrationMethod: "missing",
    suffixMultiplier: null,
    basePriceUsedCopper: baseForCalibration,
    referenceClearingCopper: null,
    note: "MISSING",
    snapshotAt: null,
  };
}

/**
 * Expands creature loot drops that have known random-enchantment variants into
 * individual variant LootDropInput entries.
 *
 * CRITICAL ECONOMIC GUARANTEE:
 * Each variant receives an estimated effective drop rate of `baseDropRate / N`
 * (uniform partition across the N known variants) so SUM(variant dropRates) === baseDropRate.
 * This prevents EV inflation while allowing high-value suffixes (e.g. "of the Monkey")
 * to route to the Auction House and low-value suffixes to route independently to Vendor.
 */
export function expandLootDropsWithVariants(
  loot: readonly LootDropInput[],
  variantsByItemId: ReadonlyMap<number, readonly AggregatedVariantCandidate[]>,
  options: {
    targetRegion: string;
    targetFaction: MarketFaction;
    regionUnifiedBaseByItem?: ReadonlyMap<number, number>;
  }
): LootDropInput[] {
  const expanded: LootDropInput[] = [];

  for (const drop of loot) {
    const candidates = variantsByItemId.get(drop.itemId);
    if (!candidates || candidates.length === 0) {
      expanded.push(drop);
      continue;
    }

    const n = candidates.length;
    const perVariantDropRate = drop.dropRate / n;
    const targetMarketBaseCopper =
      drop.clearingPriceCopper ??
      drop.p10Copper ??
      drop.medianCopper ??
      drop.lowestBuyoutCopper ??
      null;
    const targetRegionUnifiedBaseCopper =
      options.regionUnifiedBaseByItem?.get(drop.itemId) ?? null;

    for (const candidate of candidates) {
      const resolved = resolveVariantMarketPrice({
        targetRegion: options.targetRegion,
        targetFaction: options.targetFaction,
        vendorSellCopper: drop.vendorSellCopper,
        targetMarketBaseCopper,
        targetRegionUnifiedBaseCopper,
        candidate,
      });

      const scaledSoldPerDay =
        drop.estimatedSoldPerDay !== null && drop.estimatedSoldPerDay > 0
          ? drop.estimatedSoldPerDay / n
          : null;

      expanded.push({
        ...drop,
        variantId: candidate.variantId,
        suffixId: candidate.suffixId,
        suffixName: candidate.suffixName,
        variantCountForBase: n,
        variantPriceNote: resolved.note,
        itemName: candidate.fullName,
        dropRate: perVariantDropRate,
        confidenceTier: "ESTIMATED",
        source: `${drop.source} · 1/${n} suffix`,
        lowestBuyoutCopper: resolved.lowestBuyoutCopper,
        p10Copper: resolved.p10Copper,
        medianCopper: resolved.medianCopper,
        marketValueCopper: resolved.clearingPriceCopper,
        clearingPriceCopper: resolved.clearingPriceCopper,
        availableQty: resolved.availableQty,
        listingCount: resolved.listingCount,
        priceStatus: resolved.priceStatus,
        snapshotAt: resolved.snapshotAt ?? drop.snapshotAt,
        estimatedSoldPerDay: scaledSoldPerDay,
        salesDataStatus:
          scaledSoldPerDay !== null ? "ESTIMATED" : drop.salesDataStatus,
      });
    }
  }

  return expanded;
}
