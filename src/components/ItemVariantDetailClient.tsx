"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  Info,
  Layers,
  Sparkles,
  Swords,
} from "lucide-react";
import { EstimatedSalesSection } from "@/components/EstimatedSalesSection";
import { PriceHistoryChart } from "@/components/PriceHistoryChart";
import {
  CONFIDENCE_BADGE,
  factionBadgeClass,
  formatCopperFull,
  formatCopperShort,
  formatPercent,
  formatRelativeAge,
  getRarityMeta,
} from "@/lib/wow-ui";
import type { ConfidenceTier, MarketFaction } from "@/providers/types";

interface ResolvedSummary {
  clearingPriceCopper: number | null;
  lowestBuyoutCopper: number | null;
  p10Copper: number | null;
  medianCopper: number | null;
  availableQty: number;
  listingCount: number;
  priceStatus: string;
  calibrationMethod: string;
  suffixMultiplier: number | null;
  basePriceUsedCopper: number | null;
  referenceClearingCopper: number | null;
  note: string;
  snapshotAt: string | null;
}

interface VariantDetailResponse {
  item: {
    id: number;
    name: string;
    quality: number;
    qualityName: string;
    itemClass: string | null;
    itemSubclass: string | null;
    itemLevel: number | null;
    requiredLevel: number | null;
    bindType: string;
    vendorSellCopper: number;
    iconUrl: string | null;
    description: string | null;
  };
  variant: {
    id: string;
    itemId: number;
    suffixId: number;
    fullName: string;
    suffixName: string;
    totalVariantsCount: number;
    source: string;
  };
  region: string;
  selectedMarketId: string;
  usSummary: ResolvedSummary;
  euSummary: ResolvedSummary;
  directScannedHouses: Array<{
    houseKey: string;
    region: string;
    faction: MarketFaction;
    realmLabel: string | null;
    lowestBuyoutCopper: number | null;
    p10Copper: number | null;
    medianCopper: number | null;
    clearingPriceCopper: number | null;
    baseReferenceCopper: number | null;
    suffixMultiplier: number;
    availableQty: number;
    listingCount: number;
    timeLeft: {
      short: number;
      medium: number;
      long: number;
      veryLong: number;
    };
    snapshotAt: string;
  }>;
  regionalHouses: Array<{
    marketId: string;
    houseId: number;
    region: string;
    faction: MarketFaction;
    displayName: string;
    defaultCommissionRate: number;
    baseItemClearingCopper: number | null;
    variantClearingCopper: number | null;
    variantLowestCopper: number | null;
    variantMedianCopper: number | null;
    priceStatus: string;
    calibrationMethod: string;
    calibrationNote: string;
    suffixMultiplier: number | null;
    baseAvailableQty: number;
    snapshotAt: string | null;
  }>;
  historyHouseKey: string | null;
  historyDaily: Array<{
    ts: string;
    minCopper: number | null;
    p10Copper: number | null;
    medianCopper: number | null;
    availableQty: number;
    listingCount: number;
  }>;
  historyHourly: Array<{
    ts: string;
    minCopper: number | null;
    p10Copper: number | null;
    medianCopper: number | null;
    availableQty: number;
    listingCount: number;
  }>;
  siblingVariants: Array<{
    variantId: string;
    itemId: number;
    suffixId: number;
    fullName: string;
    suffixName: string;
    suffixMultiplier: number | null;
    euClearingCopper: number | null;
    euPriceStatus: string;
    euSupplyQty: number;
    usClearingCopper: number | null;
    usPriceStatus: string;
    usCalibrationNote: string;
  }>;
  creatureSources: Array<{
    creatureId: number;
    creatureName: string;
    minLevel: number | null;
    maxLevel: number | null;
    zoneName: string | null;
    lootMethod: string;
    baseDropRate: number;
    effectiveDropRate: number;
    avgQty: number;
    k50: number | null;
    k90: number | null;
    confidenceTier: ConfidenceTier;
    baseConfidenceTier: ConfidenceTier;
    sampleSize: number | null;
    source: string;
    variantEvPerKillCopper: number;
    variantEvPerHourCopper: number;
  }>;
}

export function ItemVariantDetailClient({
  itemId,
  suffixId,
  initialMarketId,
}: {
  itemId: number;
  suffixId: number;
  initialMarketId: string;
}) {
  const [region, setRegion] = useState(
    (initialMarketId.split(":")[0] || "us").toLowerCase()
  );
  const [marketId, setMarketId] = useState(initialMarketId);
  const [killsPerHour, setKillsPerHour] = useState(60);
  const [data, setData] = useState<VariantDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        marketId,
        region,
        killsPerHour: String(Math.max(1, killsPerHour)),
      });
      const res = await fetch(
        `/api/v1/items/${itemId}/variants/${suffixId}?${qs.toString()}`
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load variant");
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error loading variant");
    } finally {
      setLoading(false);
    }
  }, [itemId, suffixId, marketId, region, killsPerHour]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading && !data) {
    return (
      <div className="py-16 text-center text-sm text-zinc-400">
        Loading US &amp; EU enchantment variant pricing and history...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-lg border border-red-500/40 bg-red-950/30 p-6 text-sm text-red-200">
        {error ?? "Item enchantment variant not found."}
      </div>
    );
  }

  const {
    item,
    variant,
    usSummary,
    euSummary,
    directScannedHouses,
    regionalHouses,
    historyHouseKey,
    historyDaily,
    historyHourly,
    siblingVariants,
    creatureSources,
  } = data;

  const rarity = getRarityMeta(item.quality);
  const activeRegionalHouses = regionalHouses.filter(
    (h) => h.variantClearingCopper !== null && h.faction !== "unified"
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3.5">
          {item.iconUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.iconUrl}
              alt={variant.fullName}
              className={`h-12 w-12 rounded-md border-2 bg-zinc-900 object-cover ${rarity.borderClass}`}
            />
          )}
          <div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-400">
              <Link
                href={`/items/${item.id}?marketId=${encodeURIComponent(marketId)}`}
                className="inline-flex items-center gap-1 hover:text-amber-300"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Base Item: {item.name}
              </Link>
              <span className="text-zinc-700">·</span>
              <Link href="/market" className="hover:text-amber-300">
                Auction House
              </Link>
              <span className="text-zinc-700">·</span>
              <Link href="/" className="hover:text-amber-300">
                Farm Rankings
              </Link>
            </div>

            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h1 className={`text-2xl font-bold ${rarity.textClass}`}>
                {variant.fullName}
              </h1>
              <span className="rounded border border-fuchsia-500/40 bg-fuchsia-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-fuchsia-300">
                <Sparkles className="mr-1 inline h-3 w-3" />
                Random Enchant Variant
              </span>
              <span className="rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 font-mono text-xs text-zinc-400">
                #{item.id}:{variant.suffixId}
              </span>
            </div>

            <div className="mt-1 flex flex-wrap items-center gap-2.5 text-xs text-zinc-400">
              <span>{rarity.name}</span>
              {item.itemClass && (
                <>
                  <span>·</span>
                  <span>
                    {item.itemClass}
                    {item.itemSubclass ? ` / ${item.itemSubclass}` : ""}
                  </span>
                </>
              )}
              <span>·</span>
              <span>
                Suffix:{" "}
                <strong className="text-fuchsia-200">{variant.suffixName}</strong>{" "}
                (1 of {variant.totalVariantsCount} observed variants)
              </span>
              <span>·</span>
              <span>
                Vendor sell:{" "}
                <strong className="font-mono text-zinc-200">
                  {formatCopperFull(item.vendorSellCopper)}
                </strong>
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <div className="flex items-center gap-1 rounded-md border border-zinc-700 bg-[#12161f] p-0.5">
            {(["us", "eu"] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => {
                  setRegion(r);
                  setMarketId(`${r}:0`);
                }}
                className={`rounded px-3 py-1 font-semibold uppercase transition-colors ${
                  region === r
                    ? "bg-amber-500/20 text-amber-200"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* US & EU Side-by-Side Valuation Cards */}
      <section className="grid gap-4 md:grid-cols-2">
        {/* US Card */}
        <div
          onClick={() => {
            setRegion("us");
            setMarketId("us:0");
          }}
          className={`cursor-pointer rounded-xl border p-4 transition-colors ${
            region === "us"
              ? "border-amber-500/50 bg-[#161a24]"
              : "border-zinc-800 bg-[#12161f] hover:border-zinc-700"
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="rounded border border-sky-500/40 bg-sky-500/15 px-2 py-0.5 text-xs font-bold text-sky-200">
                US Region
              </span>
              <span
                className={`rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                  usSummary.priceStatus === "ACTUAL"
                    ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                    : "border-amber-500/40 bg-amber-500/15 text-amber-300"
                }`}
              >
                {usSummary.priceStatus}
              </span>
            </div>
            <span className="text-[11px] text-zinc-500">
              {usSummary.note}
            </span>
          </div>

          <div className="mt-3 flex items-baseline justify-between">
            <span className="text-xs text-zinc-400">
              {usSummary.priceStatus === "ACTUAL"
                ? "US Clearing Price (Direct Scan)"
                : "US Calibrated Clearing Price"}
            </span>
            <span className="font-mono text-2xl font-bold text-amber-300">
              {formatCopperFull(usSummary.clearingPriceCopper)}
            </span>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-zinc-800/80 pt-2.5 text-[11px]">
            <div className="flex justify-between">
              <span className="text-zinc-500">Live US Base (us:0):</span>
              <span className="font-mono text-zinc-200">
                {usSummary.basePriceUsedCopper !== null
                  ? formatCopperFull(usSummary.basePriceUsedCopper)
                  : "Unlisted"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Suffix Multiplier:</span>
              <span className="font-mono font-semibold text-fuchsia-300">
                {usSummary.suffixMultiplier !== null
                  ? `${usSummary.suffixMultiplier.toFixed(2)}× base`
                  : "—"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Est. Lowest:</span>
              <span className="font-mono text-zinc-300">
                {formatCopperShort(usSummary.lowestBuyoutCopper)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Est. Median:</span>
              <span className="font-mono text-zinc-300">
                {formatCopperShort(usSummary.medianCopper)}
              </span>
            </div>
          </div>

          {usSummary.priceStatus !== "ACTUAL" && (
            <p className="mt-2.5 flex items-start gap-1.5 text-[10px] text-zinc-500">
              <Info className="mt-0.5 h-3 w-3 shrink-0 text-amber-400/70" />
              <span>
                Blizzard&apos;s US Web API strips random suffixes. US price is
                calibrated from the live Forever AH US base price × empirical
                suffix premium observed on EU addon scans (auto-upgrades to
                ACTUAL once US scans are imported).
              </span>
            </p>
          )}
        </div>

        {/* EU Card */}
        <div
          onClick={() => {
            setRegion("eu");
            setMarketId("eu:0");
          }}
          className={`cursor-pointer rounded-xl border p-4 transition-colors ${
            region === "eu"
              ? "border-amber-500/50 bg-[#161a24]"
              : "border-zinc-800 bg-[#12161f] hover:border-zinc-700"
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="rounded border border-indigo-500/40 bg-indigo-500/15 px-2 py-0.5 text-xs font-bold text-indigo-200">
                EU Region
              </span>
              <span
                className={`rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                  euSummary.priceStatus === "ACTUAL"
                    ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                    : "border-amber-500/40 bg-amber-500/15 text-amber-300"
                }`}
              >
                {euSummary.priceStatus}
              </span>
            </div>
            <span className="text-[11px] text-zinc-500">
              {euSummary.note}
            </span>
          </div>

          <div className="mt-3 flex items-baseline justify-between">
            <span className="text-xs text-zinc-400">
              EU Clearing Price (In-Game Addon Scan)
            </span>
            <span className="font-mono text-2xl font-bold text-emerald-300">
              {formatCopperFull(euSummary.clearingPriceCopper)}
            </span>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-zinc-800/80 pt-2.5 text-[11px]">
            <div className="flex justify-between">
              <span className="text-zinc-500">Lowest Buyout:</span>
              <span className="font-mono text-zinc-200">
                {formatCopperShort(euSummary.lowestBuyoutCopper)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Median:</span>
              <span className="font-mono text-zinc-200">
                {formatCopperShort(euSummary.medianCopper)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Scanned Supply:</span>
              <span className="font-mono text-zinc-200">
                {euSummary.availableQty.toLocaleString()} ({euSummary.listingCount}{" "}
                listings)
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Last Scan:</span>
              <span className="font-mono text-zinc-400">
                {formatRelativeAge(euSummary.snapshotAt)}
              </span>
            </div>
          </div>

          <p className="mt-2.5 flex items-start gap-1.5 text-[10px] text-zinc-500">
            <Info className="mt-0.5 h-3 w-3 shrink-0 text-emerald-400/70" />
            <span>
              Direct in-game AH suffix prices sourced from EverlookDB addon
              scans ({directScannedHouses.length} scanned houses).
            </span>
          </p>
        </div>
      </section>

      {/* Direct Addon-Scanned Houses Breakdown (with time_left) */}
      {directScannedHouses.length > 0 && (
        <section className="overflow-hidden rounded-xl border border-zinc-800 bg-[#12161f]">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 px-4 py-2.5">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-emerald-300">
              Direct Suffix-Scanned Auction Houses ({directScannedHouses.length}) — ACTUAL
            </h2>
            <span className="text-[11px] text-zinc-500">
              Time Left buckets: Short (&lt;30m) / Med (30m–2h) / Long (2–12h) / Very Long (&gt;12h)
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#0d1017] text-[10px] uppercase text-zinc-400">
                <tr>
                  <th className="px-3 py-2">House / Realm</th>
                  <th className="px-3 py-2">Faction</th>
                  <th className="px-3 py-2 text-right">Lowest</th>
                  <th className="px-3 py-2 text-right">P10</th>
                  <th className="px-3 py-2 text-right">Median</th>
                  <th className="px-3 py-2 text-right">vs Base</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-3 py-2 text-right">Time Left (S/M/L/VL)</th>
                  <th className="px-3 py-2 text-right">Scanned</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/70">
                {directScannedHouses.map((h) => (
                  <tr key={h.houseKey} className="hover:bg-amber-500/[0.03]">
                    <td className="px-3 py-2">
                      <div className="font-mono text-zinc-200">{h.houseKey}</div>
                      {h.realmLabel && (
                        <div className="text-[10px] text-zinc-500">
                          {h.realmLabel}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold capitalize ${factionBadgeClass(h.faction)}`}
                      >
                        {h.faction}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-zinc-200">
                      {formatCopperFull(h.lowestBuyoutCopper)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-amber-300 font-semibold">
                      {formatCopperFull(h.p10Copper)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-zinc-300">
                      {formatCopperFull(h.medianCopper)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-fuchsia-300">
                      {h.suffixMultiplier.toFixed(2)}×
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-zinc-200">
                      {h.availableQty.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-[11px] text-zinc-400">
                      {h.timeLeft.short}/{h.timeLeft.medium}/{h.timeLeft.long}/
                      {h.timeLeft.veryLong}
                    </td>
                    <td className="px-3 py-2 text-right text-[11px] text-zinc-500">
                      {formatRelativeAge(h.snapshotAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Selected Region Forever AH Houses (US or EU Calibrated Breakdown) */}
      {activeRegionalHouses.length > 0 && (
        <section className="overflow-hidden rounded-xl border border-zinc-800 bg-[#12161f]">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 px-4 py-2.5">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-amber-200">
              {region.toUpperCase()} Regional Houses Breakdown ({activeRegionalHouses.length})
            </h2>
            <span className="text-[11px] text-zinc-500">
              Live {region.toUpperCase()} base prices from Forever AH calibrated with suffix premium
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#0d1017] text-[10px] uppercase text-zinc-400">
                <tr>
                  <th className="px-3 py-2">House</th>
                  <th className="px-3 py-2">Faction</th>
                  <th className="px-3 py-2 text-right">Live Base Item Price</th>
                  <th className="px-3 py-2 text-right">Variant Price</th>
                  <th className="px-3 py-2">Provenance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/70">
                {activeRegionalHouses.map((h) => (
                  <tr
                    key={h.marketId}
                    onClick={() => setMarketId(h.marketId)}
                    className={`cursor-pointer hover:bg-amber-500/[0.04] ${
                      h.marketId === marketId ? "bg-amber-500/10" : ""
                    }`}
                  >
                    <td className="px-3 py-2 font-mono text-zinc-200">
                      House #{h.houseId}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold capitalize ${factionBadgeClass(h.faction)}`}
                      >
                        {h.faction}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-zinc-300">
                      {h.baseItemClearingCopper !== null
                        ? formatCopperFull(h.baseItemClearingCopper)
                        : "Unlisted (uses unified)"}
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-bold text-amber-300">
                      {formatCopperFull(h.variantClearingCopper)}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-zinc-400">
                      <span
                        className={`mr-1.5 rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                          h.priceStatus === "ACTUAL"
                            ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                            : "border-amber-500/40 bg-amber-500/15 text-amber-300"
                        }`}
                      >
                        {h.priceStatus}
                      </span>
                      {h.calibrationNote}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Per-Variant Price History & Estimated Stock Exits */}
      <PriceHistoryChart
        mode="item"
        title={`Variant Price & Supply History (${historyHouseKey ?? "EverlookDB"})`}
        hourlyPoints={historyHourly}
        dailyPoints={historyDaily}
      />

      <EstimatedSalesSection
        hourlyPoints={historyHourly}
        marketLabel={historyHouseKey ?? `${variant.fullName} (EverlookDB)`}
      />

      {/* Sibling Enchantment Versions Comparison */}
      <section className="overflow-hidden rounded-xl border border-zinc-800 bg-[#12161f]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-amber-100">
            <Layers className="h-4 w-4 text-fuchsia-400" />
            All Enchantment Versions of {item.name} ({siblingVariants.length})
          </h2>
          <span className="text-[11px] text-zinc-500">
            Click any suffix to open its dedicated page &amp; price history
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#0d1017] text-[10px] uppercase text-zinc-400">
              <tr>
                <th className="px-3 py-2">Variant Name</th>
                <th className="px-3 py-2">Suffix</th>
                <th className="px-3 py-2 text-right">vs Base</th>
                <th className="px-3 py-2 text-right">US Price (Calibrated)</th>
                <th className="px-3 py-2 text-right">EU Price (Scanned)</th>
                <th className="px-3 py-2 text-right">EU Supply</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/70">
              {siblingVariants.map((sv) => {
                const isCurrent = sv.suffixId === variant.suffixId;
                return (
                  <tr
                    key={sv.variantId}
                    className={
                      isCurrent
                        ? "bg-fuchsia-500/10"
                        : "hover:bg-amber-500/[0.03]"
                    }
                  >
                    <td className="px-3 py-2">
                      <Link
                        href={`/items/${sv.itemId}/${sv.suffixId}?marketId=${encodeURIComponent(marketId)}`}
                        className={`font-semibold hover:underline ${rarity.textClass}`}
                      >
                        {sv.fullName}
                      </Link>
                      {isCurrent && (
                        <span className="ml-2 rounded bg-fuchsia-500/20 px-1.5 py-0.5 text-[9px] font-bold uppercase text-fuchsia-300">
                          Viewing
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-zinc-400">{sv.suffixName}</td>
                    <td className="px-3 py-2 text-right font-mono text-fuchsia-300">
                      {sv.suffixMultiplier !== null
                        ? `${sv.suffixMultiplier.toFixed(2)}×`
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-semibold text-amber-300">
                      {formatCopperFull(sv.usClearingCopper)}
                      <span className="ml-1 text-[9px] text-zinc-500">
                        ({sv.usPriceStatus === "ACTUAL" ? "ACT" : "EST"})
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-emerald-300">
                      {formatCopperFull(sv.euClearingCopper)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-zinc-400">
                      {sv.euSupplyQty.toLocaleString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Dropping Creatures */}
      <section className="overflow-hidden rounded-xl border border-zinc-800 bg-[#12161f]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 px-4 py-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-amber-100">
              <Swords className="h-4 w-4 text-amber-400" />
              Creatures Dropping {variant.fullName} ({creatureSources.length})
            </h2>
            <p className="text-[11px] text-zinc-500">
              Effective drop rate = Base drop rate ÷ {variant.totalVariantsCount}{" "}
              known suffixes (uniform 1/N split — ESTIMATED)
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-zinc-400">Kills/hr:</span>
            <input
              type="number"
              min={1}
              max={5000}
              value={killsPerHour}
              onChange={(e) =>
                setKillsPerHour(Math.max(1, Number(e.target.value) || 1))
              }
              className="w-20 rounded border border-zinc-700 bg-[#0d1016] px-2 py-1 text-zinc-100"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-zinc-800 bg-[#0d1017] text-[11px] uppercase tracking-wider text-zinc-400">
                <th className="px-3 py-2.5">Creature</th>
                <th className="px-3 py-2.5">Level</th>
                <th className="px-3 py-2.5">Zone</th>
                <th className="px-3 py-2.5 text-right">Base Drop</th>
                <th className="px-3 py-2.5 text-right">
                  Est. Variant Drop (1/{variant.totalVariantsCount})
                </th>
                <th className="px-3 py-2.5 text-right">K50 / K90</th>
                <th className="px-3 py-2.5 text-right">Variant EV/Hr</th>
                <th className="px-3 py-2.5">Confidence</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/70">
              {creatureSources.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-8 text-center text-zinc-500"
                  >
                    No synced creature loot tables drop {item.name} yet.
                  </td>
                </tr>
              ) : (
                creatureSources.map((src) => {
                  const conf = CONFIDENCE_BADGE[src.confidenceTier];
                  return (
                    <tr
                      key={`${src.creatureId}-${src.lootMethod}`}
                      className="hover:bg-amber-500/[0.03]"
                    >
                      <td className="px-3 py-2.5">
                        <Link
                          href={`/creatures/${src.creatureId}?marketId=${encodeURIComponent(marketId)}&kph=${killsPerHour}`}
                          className="font-semibold text-zinc-100 hover:text-amber-300"
                        >
                          {src.creatureName}
                        </Link>
                      </td>
                      <td className="px-3 py-2.5 font-mono text-zinc-400">
                        {src.minLevel ?? "—"}
                        {src.maxLevel && src.maxLevel !== src.minLevel
                          ? `–${src.maxLevel}`
                          : ""}
                      </td>
                      <td className="px-3 py-2.5 text-zinc-300">
                        {src.zoneName ?? "—"}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-zinc-400">
                        {formatPercent(src.baseDropRate)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono font-semibold text-fuchsia-300">
                        {formatPercent(src.effectiveDropRate, 3)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-zinc-400">
                        {src.k50 !== null
                          ? `${Math.ceil(src.k50).toLocaleString()} / ${Math.ceil(src.k90 ?? 0).toLocaleString()}`
                          : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono font-bold text-amber-300">
                        {formatCopperFull(src.variantEvPerHourCopper)}
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${conf.className}`}
                        >
                          {conf.short}
                        </span>
                        <span className="ml-1.5 text-[10px] text-zinc-500">
                          {src.source}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
