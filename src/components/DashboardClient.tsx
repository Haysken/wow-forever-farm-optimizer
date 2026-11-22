"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowUpDown,
  Filter,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import { FARMING_SPEED_PRESETS } from "@/domain/profitability/types";
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

interface MarketOption {
  id: string;
  region: string;
  houseId: number;
  faction: MarketFaction;
  displayName: string;
  defaultCommissionRate: string;
  lastSnapshotAt: string | null;
}

interface RankingRow {
  rank: number;
  creatureId: number;
  creatureName: string;
  minLevel: number | null;
  maxLevel: number | null;
  creatureType: string | null;
  classification: string;
  zoneName: string | null;
  bestDropTrend7dPct: number | null;
  profitability: {
    egphLiquidityAdjustedCopper: number;
    egphGrossEvCopper: number;
    egpkLiquidityAdjustedCopper: number;
    egpkGrossEvCopper: number;
    unknownLiquiditySharePct: number;
    overallConfidence: ConfidenceTier;
    includesEstimatedData: boolean;
    weightedLiquidityScore: number | null;
    bestDrop: {
      itemId: number;
      variantId?: string | null;
      suffixId?: number | null;
      suffixName?: string | null;
      variantPriceNote?: string | null;
      itemName: string;
      quality: number;
      dropRate: number;
      unitGrossCopper: number;
      liquidationChannel: string;
      confidenceTier: ConfidenceTier;
      sampleSize: number | null;
    } | null;
  };
}

interface DbCounts {
  zones: number;
  items: number;
  creatures: number;
  resolvedLoot: number;
  markets: number;
  marketSnapshots: number;
}

export function DashboardClient() {
  const [markets, setMarkets] = useState<MarketOption[]>([]);
  const [counts, setCounts] = useState<DbCounts | null>(null);
  const [region, setRegion] = useState<string>("us");
  const [faction, setFaction] = useState<MarketFaction>("unified");
  const [marketId, setMarketId] = useState<string>("us:0");

  // Farming speed & economic controls
  const [speedPreset, setSpeedPreset] = useState<string>("average");
  const [killsPerHour, setKillsPerHour] = useState<number>(60);
  const [expensesGold, setExpensesGold] = useState<number>(0);
  const [commissionOverridePct, setCommissionOverridePct] = useState<string>("");

  // Filters
  const [search, setSearch] = useState("");
  const [zone, setZone] = useState("");
  const [minLevel, setMinLevel] = useState("");
  const [maxLevel, setMaxLevel] = useState("");
  const [minQuality, setMinQuality] = useState("");
  const [itemCategory, setItemCategory] = useState("");
  const [minDropRatePct, setMinDropRatePct] = useState("");
  const [minPriceGold, setMinPriceGold] = useState("");
  const [minEgphGold, setMinEgphGold] = useState("");
  const [foreverObservedOnly, setForeverObservedOnly] = useState(false);
  const [sortBy, setSortBy] = useState<string>("egph_adjusted");

  // Data state
  const [rows, setRows] = useState<RankingRow[]>([]);
  const [total, setTotal] = useState(0);
  const [activeMarket, setActiveMarket] = useState<MarketOption | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/v1/markets")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.markets) && data.markets.length > 0) {
          setMarkets(data.markets);
          setCounts(data.counts ?? null);
          const first =
            data.markets.find(
              (m: MarketOption) => m.region === "us" && m.faction === "unified"
            ) ??
            data.markets.find(
              (m: MarketOption) => m.region === "us" && m.faction === "alliance"
            ) ??
            data.markets[0];
          if (first) {
            setRegion(first.region);
            setFaction(first.faction);
            setMarketId(first.id);
          }
        }
      })
      .catch(() => {
        // handled by ranking fetch error state
      });
  }, []);

  const filteredMarkets = useMemo(() => {
    return markets.filter(
      (m) => m.region === region && m.faction === faction
    );
  }, [markets, region, faction]);

  useEffect(() => {
    if (
      filteredMarkets.length > 0 &&
      !filteredMarkets.some((m) => m.id === marketId)
    ) {
      setMarketId(filteredMarkets[0]!.id);
    }
  }, [filteredMarkets, marketId]);

  const fetchRankings = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    params.set("marketId", marketId);
    params.set("killsPerHour", String(Math.max(1, killsPerHour)));
    params.set(
      "hourlyExpensesCopper",
      String(Math.round(Math.max(0, expensesGold) * 10_000))
    );
    if (commissionOverridePct.trim() !== "") {
      const parsed = Number(commissionOverridePct) / 100;
      if (Number.isFinite(parsed) && parsed >= 0 && parsed < 1) {
        params.set("commissionOverride", String(parsed));
      }
    }
    if (search.trim()) params.set("search", search.trim());
    if (zone.trim()) params.set("zone", zone.trim());
    if (minLevel) params.set("minLevel", minLevel);
    if (maxLevel) params.set("maxLevel", maxLevel);
    if (minQuality) params.set("minQuality", minQuality);
    if (itemCategory) params.set("itemCategory", itemCategory);
    if (minDropRatePct) {
      params.set("minDropRate", String(Number(minDropRatePct) / 100));
    }
    if (minPriceGold) {
      params.set(
        "minItemPriceCopper",
        String(Math.round(Number(minPriceGold) * 10_000))
      );
    }
    if (minEgphGold) {
      params.set(
        "minEgphCopper",
        String(Math.round(Number(minEgphGold) * 10_000))
      );
    }
    params.set(
      "confidence",
      foreverObservedOnly
        ? "VERIFIED,OBSERVED"
        : "VERIFIED,OBSERVED,ESTIMATED"
    );
    params.set("sortBy", sortBy);
    params.set("limit", "100");

    try {
      const res = await fetch(`/api/v1/rankings?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Failed to load farm rankings");
      }
      setRows(data.rows ?? []);
      setTotal(data.total ?? 0);
      setActiveMarket(data.market ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load rankings");
    } finally {
      setLoading(false);
    }
  }, [
    marketId,
    killsPerHour,
    expensesGold,
    commissionOverridePct,
    search,
    zone,
    minLevel,
    maxLevel,
    minQuality,
    itemCategory,
    minDropRatePct,
    minPriceGold,
    minEgphGold,
    foreverObservedOnly,
    sortBy,
  ]);

  useEffect(() => {
    const t = setTimeout(() => {
      fetchRankings();
    }, 150);
    return () => clearTimeout(t);
  }, [fetchRankings]);

  const availableRegions = useMemo(() => {
    const set = new Set(markets.map((m) => m.region));
    return set.size > 0 ? Array.from(set) : ["us", "eu"];
  }, [markets]);

  const currentCommissionDisplay = activeMarket
    ? `${(Number(activeMarket.defaultCommissionRate) * 100).toFixed(0)}%`
    : faction === "neutral"
      ? "15%"
      : "5%";

  return (
    <div className="space-y-5">
      {/* Top Hero / KPI Strip */}
      <section className="rounded-xl border border-amber-500/20 bg-gradient-to-r from-[#131722] via-[#12161f] to-[#17151c] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-amber-100 sm:text-2xl">
              Which Creature Should You Farm Right Now?
            </h1>
            <p className="mt-1 max-w-2xl text-xs text-zinc-400 sm:text-sm">
              Expected Gold per Hour (EGPH) across every drop on a creature&apos;s
              loot table, combining live WoW Forever Auction House prices,
              faction cuts, vendor floors, and market liquidity.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            {activeMarket && (
              <span
                className={`rounded-full border px-2.5 py-1 font-medium ${factionBadgeClass(activeMarket.faction)}`}
              >
                {activeMarket.displayName} · Snapshot{" "}
                {formatRelativeAge(activeMarket.lastSnapshotAt)}
              </span>
            )}
            {counts && (
              <span className="rounded-full border border-zinc-700 bg-zinc-900/80 px-2.5 py-1 text-zinc-300">
                {counts.items.toLocaleString()} items ·{" "}
                {counts.creatures.toLocaleString()} NPCs ·{" "}
                {counts.resolvedLoot.toLocaleString()} loot rows ·{" "}
                {counts.marketSnapshots.toLocaleString()} live prices
              </span>
            )}
          </div>
        </div>
      </section>

      {/* Market & Farming Speed Controls */}
      <section className="grid gap-4 rounded-xl border border-zinc-800 bg-[#12161f] p-4 lg:grid-cols-12">
        {/* Market Selection */}
        <div className="space-y-2 lg:col-span-5">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-amber-400">
            <SlidersHorizontal className="h-3.5 w-3.5" />
            <span>Auction House Market</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="mb-1 block text-[11px] text-zinc-400">
                Region
              </label>
              <select
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                className="w-full rounded border border-zinc-700 bg-[#0d1016] px-2 py-1.5 text-xs text-zinc-100"
              >
                {availableRegions.map((r) => (
                  <option key={r} value={r}>
                    {r.toUpperCase()}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] text-zinc-400">
                Faction AH
              </label>
              <select
                value={faction}
                onChange={(e) => setFaction(e.target.value as MarketFaction)}
                className="w-full rounded border border-zinc-700 bg-[#0d1016] px-2 py-1.5 text-xs text-zinc-100"
              >
                <option value="unified">All Regional Houses (5%)</option>
                <option value="alliance">Alliance (5%)</option>
                <option value="horde">Horde (5%)</option>
                <option value="neutral">Blackwater Neutral (15%)</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] text-zinc-400">
                House / Ruleset
              </label>
              <select
                value={marketId}
                onChange={(e) => setMarketId(e.target.value)}
                className="w-full rounded border border-zinc-700 bg-[#0d1016] px-2 py-1.5 text-xs text-zinc-100"
              >
                {filteredMarkets.length === 0 ? (
                  <option value={marketId}>{marketId}</option>
                ) : (
                  filteredMarkets.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.houseId === 0 ? "All Houses (Unified)" : `House #${m.houseId}`}
                    </option>
                  ))
                )}
              </select>
            </div>
          </div>
        </div>

        {/* Farming Parameters */}
        <div className="space-y-2 lg:col-span-7">
          <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-amber-400">
            <span>Farming Speed (K) &amp; Economic Parameters</span>
            <span className="text-[11px] font-normal normal-case text-zinc-500">
              Default AH cut: {currentCommissionDisplay}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div>
              <label className="mb-1 block text-[11px] text-zinc-400">
                Speed Preset
              </label>
              <select
                value={speedPreset}
                onChange={(e) => {
                  const val = e.target.value;
                  setSpeedPreset(val);
                  const preset = FARMING_SPEED_PRESETS.find((p) => p.id === val);
                  if (preset) setKillsPerHour(preset.killsPerHour);
                }}
                className="w-full rounded border border-zinc-700 bg-[#0d1016] px-2 py-1.5 text-xs text-zinc-100"
              >
                {FARMING_SPEED_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label} ({p.killsPerHour}/hr)
                  </option>
                ))}
                <option value="custom">Custom KPH</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] text-zinc-400">
                Kills / Hour (K)
              </label>
              <input
                type="number"
                min={1}
                max={5000}
                value={killsPerHour}
                onChange={(e) => {
                  setSpeedPreset("custom");
                  setKillsPerHour(Math.max(1, Number(e.target.value) || 1));
                }}
                className="w-full rounded border border-zinc-700 bg-[#0d1016] px-2 py-1.5 text-xs text-zinc-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] text-zinc-400">
                Expenses / Hr (Gold)
              </label>
              <input
                type="number"
                min={0}
                step={0.5}
                value={expensesGold}
                onChange={(e) =>
                  setExpensesGold(Math.max(0, Number(e.target.value) || 0))
                }
                className="w-full rounded border border-zinc-700 bg-[#0d1016] px-2 py-1.5 text-xs text-zinc-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] text-zinc-400">
                AH Cut Override (%)
              </label>
              <input
                type="number"
                min={0}
                max={95}
                placeholder={currentCommissionDisplay}
                value={commissionOverridePct}
                onChange={(e) => setCommissionOverridePct(e.target.value)}
                className="w-full rounded border border-zinc-700 bg-[#0d1016] px-2 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Filter & Sort Bar */}
      <section className="rounded-xl border border-zinc-800 bg-[#12161f] p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-400">
            <Filter className="h-3.5 w-3.5 text-amber-400" />
            <span>Filters &amp; Provenance</span>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="flex cursor-pointer items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-200">
              <input
                type="checkbox"
                checked={foreverObservedOnly}
                onChange={(e) => setForeverObservedOnly(e.target.checked)}
                className="accent-emerald-400"
              />
              <ShieldCheck className="h-3.5 w-3.5" />
              <span>Forever Verified / Observed Only</span>
            </label>

            <div className="flex items-center gap-1.5 text-xs">
              <ArrowUpDown className="h-3.5 w-3.5 text-zinc-500" />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="rounded border border-zinc-700 bg-[#0d1016] px-2.5 py-1 text-xs text-zinc-100"
              >
                <option value="egph_adjusted">
                  Sort: Liquidity-Adjusted Gold/Hr
                </option>
                <option value="egph_gross">Sort: Gross EV Gold/Hr</option>
                <option value="egpk">Sort: Expected Gold/Kill</option>
                <option value="best_item_value">Sort: Highest Item Value</option>
                <option value="drop_rate">Sort: Highest Drop Rate</option>
                <option value="liquidity">Sort: Best Liquidity</option>
                <option value="price_trend">Sort: Best 7d Appreciation</option>
              </select>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
          <input
            type="text"
            placeholder="Creature / Item / ID"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="col-span-2 rounded border border-zinc-800 bg-[#0d1016] px-2.5 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-500"
          />
          <input
            type="text"
            placeholder="Zone (exact)"
            value={zone}
            onChange={(e) => setZone(e.target.value)}
            className="rounded border border-zinc-800 bg-[#0d1016] px-2 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-500"
          />
          <div className="flex gap-1">
            <input
              type="number"
              placeholder="Min Lv"
              value={minLevel}
              onChange={(e) => setMinLevel(e.target.value)}
              className="w-1/2 rounded border border-zinc-800 bg-[#0d1016] px-2 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-500"
            />
            <input
              type="number"
              placeholder="Max Lv"
              value={maxLevel}
              onChange={(e) => setMaxLevel(e.target.value)}
              className="w-1/2 rounded border border-zinc-800 bg-[#0d1016] px-2 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-500"
            />
          </div>
          <select
            value={minQuality}
            onChange={(e) => setMinQuality(e.target.value)}
            className="rounded border border-zinc-800 bg-[#0d1016] px-2 py-1.5 text-xs text-zinc-100"
          >
            <option value="">Any Rarity</option>
            <option value="1">Common+</option>
            <option value="2">Uncommon+</option>
            <option value="3">Rare+</option>
            <option value="4">Epic+</option>
          </select>
          <select
            value={itemCategory}
            onChange={(e) => setItemCategory(e.target.value)}
            className="rounded border border-zinc-800 bg-[#0d1016] px-2 py-1.5 text-xs text-zinc-100"
          >
            <option value="">Any Category</option>
            <option value="Trade Goods">Trade Goods</option>
            <option value="Consumable">Consumable</option>
            <option value="Weapon">Weapon</option>
            <option value="Armor">Armor</option>
            <option value="Recipe">Recipe</option>
          </select>
          <input
            type="number"
            placeholder="Min Drop %"
            value={minDropRatePct}
            onChange={(e) => setMinDropRatePct(e.target.value)}
            className="rounded border border-zinc-800 bg-[#0d1016] px-2 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-500"
          />
          <input
            type="number"
            placeholder="Min Gold/Hr"
            value={minEgphGold}
            onChange={(e) => setMinEgphGold(e.target.value)}
            className="rounded border border-zinc-800 bg-[#0d1016] px-2 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-500"
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-500">
          <span>
            Showing <strong className="text-zinc-200">{rows.length}</strong> of{" "}
            <strong className="text-zinc-200">{total}</strong> ranked creatures
            at {killsPerHour} kills/hr
          </span>
          <div className="flex items-center gap-3">
            <input
              type="number"
              placeholder="Min Item Price (g)"
              value={minPriceGold}
              onChange={(e) => setMinPriceGold(e.target.value)}
              className="w-32 rounded border border-zinc-800 bg-[#0d1016] px-2 py-1 text-xs text-zinc-100 placeholder:text-zinc-500"
            />
            <button
              type="button"
              onClick={fetchRankings}
              className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-300 hover:border-amber-500/40 hover:text-amber-200"
            >
              <RefreshCw
                className={`h-3 w-3 ${loading ? "animate-spin" : ""}`}
              />
              Refresh
            </button>
          </div>
        </div>
      </section>

      {/* Error State */}
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-500/40 bg-red-950/30 p-4 text-xs text-red-200">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Main Ranked Table */}
      <section className="overflow-hidden rounded-xl border border-zinc-800 bg-[#12161f]">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-zinc-800 bg-[#0d1017] text-[11px] uppercase tracking-wider text-zinc-400">
                <th className="px-3 py-2.5">Rank</th>
                <th className="px-3 py-2.5">Creature</th>
                <th className="px-3 py-2.5">Level</th>
                <th className="px-3 py-2.5">Zone</th>
                <th className="px-3 py-2.5">Best Drop</th>
                <th className="px-3 py-2.5 text-right">Drop Rate</th>
                <th className="px-3 py-2.5 text-right">Market Price</th>
                <th className="px-3 py-2.5 text-right">Liquidity</th>
                <th className="px-3 py-2.5 text-right">Gold / Kill</th>
                <th className="px-3 py-2.5 text-right">Gold / Hour (Adj)</th>
                <th className="px-3 py-2.5 text-right">Gross EV / Hr</th>
                <th className="px-3 py-2.5">Confidence</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/70">
              {loading && rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={12}
                    className="px-4 py-12 text-center text-zinc-500"
                  >
                    Calculating live farm profitability across creature loot
                    tables...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={12}
                    className="px-4 py-12 text-center text-zinc-500"
                  >
                    No creatures match the selected filters. Try disabling
                    &quot;Forever Verified / Observed Only&quot; or widening
                    level/price filters.
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const best = row.profitability.bestDrop;
                  const rarity = best ? getRarityMeta(best.quality) : null;
                  const conf =
                    CONFIDENCE_BADGE[row.profitability.overallConfidence];
                  const levelStr =
                    row.minLevel && row.maxLevel && row.minLevel !== row.maxLevel
                      ? `${row.minLevel}–${row.maxLevel}`
                      : row.minLevel
                        ? String(row.minLevel)
                        : "—";

                  return (
                    <tr
                      key={row.creatureId}
                      className="transition-colors hover:bg-amber-500/[0.04]"
                    >
                      <td className="px-3 py-2.5 font-mono text-zinc-500">
                        #{row.rank}
                      </td>
                      <td className="px-3 py-2.5">
                        <Link
                          href={`/creatures/${row.creatureId}?marketId=${encodeURIComponent(marketId)}&kph=${killsPerHour}`}
                          className="font-semibold text-zinc-100 hover:text-amber-300"
                        >
                          {row.creatureName}
                        </Link>
                        {row.classification !== "normal" && (
                          <span className="ml-1.5 rounded bg-amber-500/15 px-1 py-0.5 text-[10px] uppercase text-amber-300">
                            {row.classification}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-zinc-400">
                        {levelStr}
                      </td>
                      <td className="px-3 py-2.5 text-zinc-300">
                        {row.zoneName ?? "—"}
                      </td>
                      <td className="px-3 py-2.5">
                        {best ? (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Link
                              href={
                                best.suffixId
                                  ? `/items/${best.itemId}/${best.suffixId}?marketId=${encodeURIComponent(marketId)}`
                                  : `/items/${best.itemId}?marketId=${encodeURIComponent(marketId)}`
                              }
                              className={`font-medium hover:underline ${rarity?.textClass ?? "text-zinc-200"}`}
                            >
                              {best.itemName}
                            </Link>
                            {best.suffixId && (
                              <span
                                title={best.variantPriceNote ?? "Random enchant variant"}
                                className="rounded border border-fuchsia-500/40 bg-fuchsia-500/15 px-1 py-0.2 text-[9px] font-bold uppercase text-fuchsia-300"
                              >
                                VARIANT
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-zinc-600">Coin / None</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-zinc-300">
                        {best ? formatPercent(best.dropRate) : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-zinc-200">
                        {best ? formatCopperShort(best.unitGrossCopper) : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono">
                        {row.profitability.weightedLiquidityScore !== null ? (
                          <span
                            className={
                              row.profitability.weightedLiquidityScore >= 70
                                ? "text-emerald-400"
                                : row.profitability.weightedLiquidityScore >= 40
                                  ? "text-amber-300"
                                  : "text-red-400"
                            }
                          >
                            {row.profitability.weightedLiquidityScore.toFixed(0)}
                            /100
                          </span>
                        ) : (
                          <span className="text-zinc-500">Unknown</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-zinc-300">
                        {formatCopperShort(
                          row.profitability.egpkLiquidityAdjustedCopper
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono font-bold text-amber-300">
                        {formatCopperFull(
                          row.profitability.egphLiquidityAdjustedCopper
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-zinc-400">
                        {formatCopperShort(row.profitability.egphGrossEvCopper)}
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          title={conf.tooltip}
                          className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-semibold ${conf.className}`}
                        >
                          {conf.short}
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
