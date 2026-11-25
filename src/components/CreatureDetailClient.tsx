"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ArrowUpDown,
  Coins,
  Dice5,
  ExternalLink,
  MapPin,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import { PriceHistoryChart } from "@/components/PriceHistoryChart";
import {
  defaultDirectionForLootColumn,
  sortCreatureLoot,
  type LootSortColumn,
  type SortDirection,
} from "@/domain/profitability/loot-sort";
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

interface CreatureDetailResponse {
  creature: {
    id: number;
    name: string;
    minLevel: number | null;
    maxLevel: number | null;
    creatureType: string | null;
    classification: string;
    healthMin: number | null;
    healthMax: number | null;
    primaryZoneName: string | null;
    rawCoinMinCopper: number | null;
    rawCoinMaxCopper: number | null;
    rawCoinSource: string | null;
  };
  market: {
    id: string;
    region: string;
    faction: MarketFaction;
    displayName: string;
    defaultCommissionRate: string;
    lastSnapshotAt: string | null;
  } | null;
  spawns: Array<{
    id: number;
    zoneName: string | null;
    x: string;
    y: string;
    confidenceTier: ConfidenceTier;
    source: string;
  }>;
  profitability: {
    egphLiquidityAdjustedCopper: number;
    egphGrossEvCopper: number;
    egpkLiquidityAdjustedCopper: number;
    egpkGrossEvCopper: number;
    rawCoinPerKillCopper: number;
    vendorValuePerKillCopper: number;
    ahGrossValuePerKillCopper: number;
    ahLiquidityAdjustedValuePerKillCopper: number;
    unknownLiquiditySharePct: number;
    overallConfidence: ConfidenceTier;
    includesEstimatedData: boolean;
    weightedLiquidityScore: number | null;
    items: Array<{
      itemId: number;
      variantId?: string | null;
      suffixId?: number | null;
      suffixName?: string | null;
      variantCountForBase?: number | null;
      variantPriceNote?: string | null;
      itemName: string;
      quality: number;
      lootMethod: string;
      liquidationChannel: string;
      dropRate: number;
      avgQty: number;
      avgQtyIsAssumed: boolean;
      unitGrossCopper: number;
      effectiveCommissionRate: number;
      expectedGrossEvPerKillCopper: number;
      expectedLiquidityAdjustedPerKillCopper: number;
      confidenceTier: ConfidenceTier;
      sampleSize: number | null;
      source: string;
      priceStatus?: string;
      liquidity: {
        score: number | null;
        sellingProbability: number | null;
        status: "ESTIMATED" | "UNKNOWN";
      };
      dropMetrics: {
        expectedKillsPerDrop: number | null;
        killsFor50Pct: number | null;
        killsFor90Pct: number | null;
      };
    }>;
  };
  verdict: {
    bestFactionMarket: {
      faction: MarketFaction;
      marketId: string;
      displayName: string;
      egphLiquidityAdjustedCopper: number;
      egphGrossEvCopper: number;
      commissionRate: number;
    } | null;
    factionComparisons: Array<{
      faction: MarketFaction;
      marketId: string;
      displayName: string;
      egphLiquidityAdjustedCopper: number;
      egphGrossEvCopper: number;
      commissionRate: number;
    }>;
    bestItem: {
      itemId: number;
      variantId?: string | null;
      suffixId?: number | null;
      itemName: string;
      quality: number;
      dropRate: number;
      unitGrossCopper: number;
    } | null;
    k50BestDrop: number | null;
    k90BestDrop: number | null;
  };
  topDropHistory: Array<{
    bucketTs: string;
    medianCopper: number | null;
    minCopper: number | null;
    availableQty: number;
    estimatedCreatureEgphCopper: number;
  }>;
}

export function CreatureDetailClient({
  creatureId,
  initialMarketId,
  initialKph,
}: {
  creatureId: number;
  initialMarketId: string;
  initialKph: number;
}) {
  const [marketId, setMarketId] = useState(initialMarketId);
  const [killsPerHour, setKillsPerHour] = useState(initialKph);
  const [expensesGold, setExpensesGold] = useState(0);
  const [data, setData] = useState<CreatureDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lootFilter, setLootFilter] = useState("");
  const [variantsOnly, setVariantsOnly] = useState(false);
  const [sortCol, setSortCol] = useState<LootSortColumn>("evPerKill");
  const [sortDir, setSortDir] = useState<SortDirection>("desc");

  const handleSort = (column: LootSortColumn) => {
    if (sortCol === column) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(column);
      setSortDir(defaultDirectionForLootColumn(column));
    }
  };

  // User-submitted WoW Forever drop observation state
  const [showObsForm, setShowObsForm] = useState(false);
  const [obsItemQuery, setObsItemQuery] = useState("");
  const [obsSearchHits, setObsSearchHits] = useState<
    Array<{ id: number; name: string; quality: number }>
  >([]);
  const [obsItemId, setObsItemId] = useState<number | null>(null);
  const [obsKills, setObsKills] = useState<number>(100);
  const [obsDrops, setObsDrops] = useState<number>(1);
  const [obsSubmitting, setObsSubmitting] = useState(false);
  const [obsFeedback, setObsFeedback] = useState<string | null>(null);

  useEffect(() => {
    const q = obsItemQuery.trim();
    if (q.length < 2) {
      setObsSearchHits([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/v1/search?q=${encodeURIComponent(q)}`);
        if (res.ok) {
          const json = await res.json();
          setObsSearchHits((json.items ?? []).slice(0, 6));
        }
      } catch {
        // ignore
      }
    }, 200);
    return () => clearTimeout(t);
  }, [obsItemQuery]);

  const submitObservation = async () => {
    if (!obsItemId) return;
    setObsSubmitting(true);
    setObsFeedback(null);
    try {
      const res = await fetch("/api/v1/observations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          creatureId,
          itemId: obsItemId,
          killsObserved: obsKills,
          dropsObserved: obsDrops,
          marketId,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to save observation");
      setObsFeedback(
        `Saved as OBSERVED (${obsDrops}/${obsKills} = ${(json.dropRate * 100).toFixed(2)}%). Recalculating EGPH...`
      );
      setObsItemId(null);
      setObsItemQuery("");
      setObsSearchHits([]);
      await load();
    } catch (err) {
      setObsFeedback(
        err instanceof Error ? err.message : "Failed to save observation"
      );
    } finally {
      setObsSubmitting(false);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        marketId,
        killsPerHour: String(Math.max(1, killsPerHour)),
        hourlyExpensesCopper: String(Math.round(Math.max(0, expensesGold) * 10_000)),
      });
      const res = await fetch(`/api/v1/creatures/${creatureId}?${qs.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load creature");
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error loading creature");
    } finally {
      setLoading(false);
    }
  }, [creatureId, marketId, killsPerHour, expensesGold]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading && !data) {
    return (
      <div className="py-16 text-center text-sm text-zinc-400">
        Loading creature loot table and market profitability...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-lg border border-red-500/40 bg-red-950/30 p-6 text-sm text-red-200">
        {error ?? "Creature not found."}
      </div>
    );
  }

  const { creature, market, spawns, profitability, verdict, topDropHistory } = data;
  const conf = CONFIDENCE_BADGE[profitability.overallConfidence];
  const levelStr =
    creature.minLevel && creature.maxLevel && creature.minLevel !== creature.maxLevel
      ? `${creature.minLevel}–${creature.maxLevel}`
      : creature.minLevel
        ? String(creature.minLevel)
        : "Unknown";

  const bestItemRarity = verdict.bestItem
    ? getRarityMeta(verdict.bestItem.quality)
    : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-amber-300"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Farm Rankings
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-bold text-amber-100">
              {creature.name}
            </h1>
            <span className="rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 font-mono text-xs text-zinc-400">
              NPC #{creature.id}
            </span>
            <span
              className={`rounded border px-2 py-0.5 text-xs font-semibold ${conf.className}`}
            >
              {conf.label}
            </span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-zinc-400">
            <span>Level {levelStr}</span>
            <span>·</span>
            <span>{creature.creatureType ?? "Unknown Type"}</span>
            {creature.classification !== "normal" && (
              <>
                <span>·</span>
                <span className="uppercase text-amber-300">
                  {creature.classification}
                </span>
              </>
            )}
            <span>·</span>
            <a
              href={`https://everlookdb.com/npc/${creature.id}`}
              target="_blank"
              rel="noopener noreferrer"
              title={`View exact spawn map for ${creature.name} on EverlookDB (WoW Forever)`}
              className="inline-flex items-center gap-1 rounded border border-amber-500/35 bg-amber-500/10 px-2 py-0.5 font-medium text-amber-200 transition-colors hover:border-amber-400/70 hover:bg-amber-500/20 hover:text-amber-100"
            >
              <MapPin className="h-3.5 w-3.5 text-amber-400" />
              <span>{creature.primaryZoneName ?? "View Spawn Map"}</span>
              <ExternalLink className="h-3 w-3 text-amber-400/80" />
            </a>
            {creature.healthMin && (
              <>
                <span>·</span>
                <span>
                  HP:{" "}
                  {creature.healthMax && creature.healthMax !== creature.healthMin
                    ? `${creature.healthMin.toLocaleString()}–${creature.healthMax.toLocaleString()}`
                    : creature.healthMin.toLocaleString()}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-zinc-800 bg-[#12161f] p-3 text-xs">
          <div>
            <label className="mb-1 block text-[10px] uppercase text-zinc-500">
              Kills / Hr
            </label>
            <input
              type="number"
              min={1}
              max={5000}
              value={killsPerHour}
              onChange={(e) =>
                setKillsPerHour(Math.max(1, Number(e.target.value) || 1))
              }
              className="w-20 rounded border border-zinc-700 bg-[#0d1016] px-2 py-1 text-xs text-zinc-100"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] uppercase text-zinc-500">
              Expenses (g/hr)
            </label>
            <input
              type="number"
              min={0}
              step={0.5}
              value={expensesGold}
              onChange={(e) =>
                setExpensesGold(Math.max(0, Number(e.target.value) || 0))
              }
              className="w-24 rounded border border-zinc-700 bg-[#0d1016] px-2 py-1 text-xs text-zinc-100"
            />
          </div>
          <Link
            href={`/simulator?creatureId=${creature.id}&marketId=${encodeURIComponent(marketId)}&kph=${killsPerHour}`}
            className="inline-flex items-center gap-1.5 rounded border border-amber-500/40 bg-amber-500/15 px-3 py-1.5 font-medium text-amber-200 hover:bg-amber-500/25"
          >
            <Dice5 className="h-3.5 w-3.5" />
            Simulate Farm
          </Link>
        </div>
      </div>

      {/* Dedicated Verdict Section */}
      <section className="rounded-xl border border-amber-500/30 bg-gradient-to-br from-[#161923] via-[#12161f] to-[#1a1612] p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-500/20 pb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-amber-400" />
            <h2 className="text-sm font-bold uppercase tracking-wider text-amber-200">
              IS THIS CREATURE WORTH FARMING RIGHT NOW?
            </h2>
          </div>
          {market && (
            <span className="text-xs text-zinc-400">
              {market.displayName} · Snapshot{" "}
              {formatRelativeAge(market.lastSnapshotAt)}
            </span>
          )}
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <div className="rounded-lg border border-zinc-800 bg-[#0d1016]/80 p-3.5">
            <div className="text-[11px] uppercase text-zinc-400">
              Adjusted Gold / Hour
            </div>
            <div className="mt-1 font-mono text-xl font-bold text-amber-300">
              {formatCopperFull(profitability.egphLiquidityAdjustedCopper)}
            </div>
            <div className="mt-1 text-[11px] text-zinc-500">
              Gross EV: {formatCopperFull(profitability.egphGrossEvCopper)}
            </div>
          </div>

          <div className="rounded-lg border border-zinc-800 bg-[#0d1016]/80 p-3.5">
            <div className="text-[11px] uppercase text-zinc-400">
              Expected Gold / Kill
            </div>
            <div className="mt-1 font-mono text-lg font-semibold text-zinc-100">
              {formatCopperFull(profitability.egpkLiquidityAdjustedCopper)}
            </div>
            <div className="mt-1 text-[11px] text-zinc-500">
              Raw coin: {formatCopperShort(profitability.rawCoinPerKillCopper)} ·
              Vendor: {formatCopperShort(profitability.vendorValuePerKillCopper)}
            </div>
          </div>

          <div className="rounded-lg border border-zinc-800 bg-[#0d1016]/80 p-3.5">
            <div className="text-[11px] uppercase text-zinc-400">
              Best Item to Obtain
            </div>
            {verdict.bestItem ? (
              <>
                <Link
                  href={
                    verdict.bestItem.suffixId
                      ? `/items/${verdict.bestItem.itemId}/${verdict.bestItem.suffixId}?marketId=${encodeURIComponent(marketId)}`
                      : `/items/${verdict.bestItem.itemId}?marketId=${encodeURIComponent(marketId)}`
                  }
                  className={`mt-1 block truncate text-sm font-semibold hover:underline ${bestItemRarity?.textClass ?? "text-zinc-100"}`}
                >
                  {verdict.bestItem.itemName}
                </Link>
                <div className="mt-1 text-[11px] text-zinc-400">
                  {formatPercent(verdict.bestItem.dropRate)} ·{" "}
                  {formatCopperShort(verdict.bestItem.unitGrossCopper)}
                </div>
              </>
            ) : (
              <div className="mt-1 text-sm text-zinc-500">No valued drops</div>
            )}
          </div>

          <div className="rounded-lg border border-zinc-800 bg-[#0d1016]/80 p-3.5">
            <div className="text-[11px] uppercase text-zinc-400">
              Best Faction Market
            </div>
            {verdict.bestFactionMarket ? (
              <>
                <button
                  type="button"
                  onClick={() => setMarketId(verdict.bestFactionMarket!.marketId)}
                  className={`mt-1 inline-block rounded border px-2 py-0.5 text-xs font-semibold capitalize ${factionBadgeClass(verdict.bestFactionMarket.faction)}`}
                >
                  {verdict.bestFactionMarket.faction} (
                  {(verdict.bestFactionMarket.commissionRate * 100).toFixed(0)}%
                  cut)
                </button>
                <div className="mt-1 font-mono text-xs text-amber-200">
                  {formatCopperFull(
                    verdict.bestFactionMarket.egphLiquidityAdjustedCopper
                  )}
                  /hr
                </div>
              </>
            ) : (
              <div className="mt-1 text-xs text-zinc-500">Unavailable</div>
            )}
          </div>

          <div className="rounded-lg border border-zinc-800 bg-[#0d1016]/80 p-3.5">
            <div className="text-[11px] uppercase text-zinc-400">
              Kills for Best Drop
            </div>
            <div className="mt-1 flex items-baseline gap-3 font-mono text-sm text-zinc-100">
              <span>
                50%:{" "}
                <strong className="text-amber-300">
                  {verdict.k50BestDrop !== null
                    ? Math.ceil(verdict.k50BestDrop)
                    : "—"}
                </strong>
              </span>
              <span>
                90%:{" "}
                <strong className="text-amber-300">
                  {verdict.k90BestDrop !== null
                    ? Math.ceil(verdict.k90BestDrop)
                    : "—"}
                </strong>
              </span>
            </div>
            <div className="mt-1 text-[11px] text-zinc-500">
              K50 = ln(0.5)/ln(1-p), K90 = ln(0.1)/ln(1-p)
            </div>
          </div>
        </div>

        {/* Cross-Faction Quick Comparison */}
        {verdict.factionComparisons.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-zinc-400">Compare Faction Markets:</span>
            {verdict.factionComparisons.map((fc) => (
              <button
                key={fc.marketId}
                type="button"
                onClick={() => setMarketId(fc.marketId)}
                className={`rounded-md border px-2.5 py-1 transition-colors ${
                  fc.marketId === marketId
                    ? "border-amber-400 bg-amber-500/20 text-amber-100"
                    : "border-zinc-700 bg-[#0d1016] text-zinc-300 hover:border-zinc-500"
                }`}
              >
                <span className="capitalize font-medium">{fc.faction}</span>:{" "}
                <span className="font-mono text-amber-300">
                  {formatCopperShort(fc.egphLiquidityAdjustedCopper)}/hr
                </span>
              </button>
            ))}
          </div>
        )}

        {profitability.includesEstimatedData && (
          <div className="mt-3 flex items-center gap-2 rounded border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
            <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
            <span>
              Includes Classic 1.12 estimated drop probabilities where WoW
              Forever observations are not yet available. Check each drop row&apos;s
              provenance badge below.
            </span>
          </div>
        )}
      </section>

      {/* Historical Profitability Chart + Spawn Coords */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <PriceHistoryChart
            mode="profitability"
            title="Historical Creature Profitability Trend (Driven by Top Drop Market History)"
            dailyPoints={topDropHistory.map((h) => ({
              ts: h.bucketTs,
              minCopper: h.minCopper,
              medianCopper: h.medianCopper,
              availableQty: h.availableQty,
              estimatedCreatureEgphCopper: h.estimatedCreatureEgphCopper,
            }))}
          />
        </div>

        <div className="rounded-lg border border-zinc-800 bg-[#12161f] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-amber-100">
              <MapPin className="h-4 w-4 text-amber-400" />
              Spawn Locations ({spawns.length})
            </h3>
            <a
              href={`https://everlookdb.com/npc/${creature.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-200 hover:bg-amber-500/20"
            >
              <span>EverlookDB Map</span>
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
          {spawns.length === 0 ? (
            <p className="mt-2 text-xs text-zinc-500">
              No spawn coordinates synced for this creature yet. Zone:{" "}
              {creature.primaryZoneName ?? "Unknown"}.
            </p>
          ) : (
            <div className="mt-3 max-h-60 space-y-1.5 overflow-y-auto text-xs">
              {spawns.slice(0, 20).map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between rounded border border-zinc-800/80 bg-[#0d1016] px-2.5 py-1.5"
                >
                  <span className="text-zinc-300">
                    {s.zoneName ?? creature.primaryZoneName ?? "Zone"}
                  </span>
                  <span className="font-mono text-amber-300">
                    ({s.x}, {s.y})
                  </span>
                </div>
              ))}
              <p className="pt-1 text-[10px] text-zinc-500">
                Source: {spawns[0]?.source} ({spawns[0]?.confidenceTier})
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Complete Loot Table */}
      <section className="overflow-hidden rounded-xl border border-zinc-800 bg-[#12161f]">
        {(() => {
          const variantRowCount = profitability.items.filter(
            (i) => i.suffixId !== null && i.suffixId !== undefined
          ).length;
          const qLower = lootFilter.trim().toLowerCase();
          const filteredItems = profitability.items.filter((i) => {
            if (variantsOnly && !i.suffixId) return false;
            if (!qLower) return true;
            return (
              i.itemName.toLowerCase().includes(qLower) ||
              (i.suffixName ?? "").toLowerCase().includes(qLower) ||
              String(i.itemId) === qLower
            );
          });
          const sortedItems = sortCreatureLoot(filteredItems, sortCol, sortDir);

          const renderSortHeader = (
            col: LootSortColumn,
            label: string,
            align: "left" | "right" = "left"
          ) => {
            const active = sortCol === col;
            const ariaSort: "ascending" | "descending" | "none" = active
              ? sortDir === "asc"
                ? "ascending"
                : "descending"
              : "none";
            return (
              <th
                aria-sort={ariaSort}
                className={`px-3 py-2.5 ${align === "right" ? "text-right" : "text-left"}`}
              >
                <button
                  type="button"
                  onClick={() => handleSort(col)}
                  className={`inline-flex items-center gap-1 rounded px-1 py-0.5 uppercase tracking-wider transition-colors hover:bg-zinc-800/80 hover:text-amber-200 ${
                    align === "right" ? "ml-auto flex-row-reverse" : ""
                  } ${active ? "font-bold text-amber-300" : "text-zinc-400"}`}
                >
                  <span>{label}</span>
                  {active ? (
                    sortDir === "asc" ? (
                      <ArrowUp className="h-3 w-3 shrink-0 text-amber-300" />
                    ) : (
                      <ArrowDown className="h-3 w-3 shrink-0 text-amber-300" />
                    )
                  ) : (
                    <ArrowUpDown className="h-3 w-3 shrink-0 text-zinc-600" />
                  )}
                </button>
              </th>
            );
          };

          return (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 px-4 py-3">
                <div>
                  <h2 className="flex items-center gap-2 text-sm font-semibold text-amber-100">
                    <Coins className="h-4 w-4 text-amber-400" />
                    Complete Loot Table ({filteredItems.length} of{" "}
                    {profitability.items.length} entries
                    {variantRowCount > 0
                      ? ` · ${variantRowCount} enchanted variants`
                      : ""}
                    )
                  </h2>
                  <span className="text-[11px] text-zinc-500">
                    All drops &amp; random-enchant variants contribute to EGPH
                    (1/N split prevents EV inflation) · BoP/Gray routed to Vendor
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={lootFilter}
                    onChange={(e) => setLootFilter(e.target.value)}
                    placeholder='Filter item or suffix (e.g. "of the Monkey")...'
                    className="w-56 rounded border border-zinc-700 bg-[#0d1016] px-2.5 py-1 text-xs text-zinc-100 placeholder:text-zinc-500"
                  />
                  {variantRowCount > 0 && (
                    <label className="flex cursor-pointer items-center gap-1.5 rounded border border-fuchsia-500/35 bg-fuchsia-500/10 px-2 py-1 text-[11px] text-fuchsia-200">
                      <input
                        type="checkbox"
                        checked={variantsOnly}
                        onChange={(e) => setVariantsOnly(e.target.checked)}
                        className="accent-fuchsia-400"
                      />
                      <span>Variants Only</span>
                    </label>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowObsForm((v) => !v)}
                    className="rounded border border-sky-500/40 bg-sky-500/15 px-3 py-1.5 text-xs font-medium text-sky-200 hover:bg-sky-500/25"
                  >
                    {showObsForm ? "Close" : "+ Record Observed Forever Drop"}
                  </button>
                </div>
              </div>

              {showObsForm && (
                <div className="border-b border-zinc-800 bg-[#0d1017] p-4 text-xs space-y-3">
                  <p className="text-zinc-400">
                    Looted a brand-new WoW Forever item not yet in
                    Everloot/EverlookDB? Record your observed sample size below.
                    Saved transparently as{" "}
                    <strong className="text-sky-300">
                      OBSERVED (user_observation)
                    </strong>{" "}
                    — never presented as Verified or Classic data.
                  </p>
                  <div className="grid gap-3 sm:grid-cols-4">
                    <div className="sm:col-span-2 relative">
                      <label className="mb-1 block text-[11px] text-zinc-400">
                        Search Item Name or ID
                      </label>
                      <input
                        type="text"
                        value={obsItemQuery}
                        onChange={(e) => {
                          setObsItemQuery(e.target.value);
                          setObsItemId(null);
                        }}
                        placeholder="e.g. Recipe: Elixir of Strength or 250385"
                        className="w-full rounded border border-zinc-700 bg-[#12161f] px-2.5 py-1.5 text-zinc-100"
                      />
                      {obsSearchHits.length > 0 && !obsItemId && (
                        <div className="absolute z-20 mt-1 w-full rounded border border-zinc-700 bg-[#12161f] p-1 shadow-xl">
                          {obsSearchHits.map((it) => {
                            const r = getRarityMeta(it.quality);
                            return (
                              <button
                                key={it.id}
                                type="button"
                                onClick={() => {
                                  setObsItemId(it.id);
                                  setObsItemQuery(`${it.name} (#${it.id})`);
                                  setObsSearchHits([]);
                                }}
                                className="flex w-full justify-between rounded px-2 py-1 text-left hover:bg-zinc-800"
                              >
                                <span className={r.textClass}>{it.name}</span>
                                <span className="font-mono text-[10px] text-zinc-500">
                                  #{it.id}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] text-zinc-400">
                        Drops Observed
                      </label>
                      <input
                        type="number"
                        min={1}
                        value={obsDrops}
                        onChange={(e) =>
                          setObsDrops(Math.max(1, Number(e.target.value) || 1))
                        }
                        className="w-full rounded border border-zinc-700 bg-[#12161f] px-2.5 py-1.5 text-zinc-100"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] text-zinc-400">
                        Total Kills Sampled
                      </label>
                      <input
                        type="number"
                        min={1}
                        value={obsKills}
                        onChange={(e) =>
                          setObsKills(
                            Math.max(obsDrops, Number(e.target.value) || 1)
                          )
                        }
                        className="w-full rounded border border-zinc-700 bg-[#12161f] px-2.5 py-1.5 text-zinc-100"
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[11px] text-zinc-400">
                      Sample rate:{" "}
                      <strong className="font-mono text-amber-300">
                        {((obsDrops / Math.max(1, obsKills)) * 100).toFixed(2)}%
                      </strong>{" "}
                      ({obsDrops}/{obsKills})
                    </span>
                    <button
                      type="button"
                      disabled={!obsItemId || obsSubmitting}
                      onClick={submitObservation}
                      className="rounded border border-amber-500/50 bg-amber-500/20 px-3 py-1.5 font-semibold text-amber-100 hover:bg-amber-500/30 disabled:opacity-40"
                    >
                      {obsSubmitting ? "Saving..." : "Save Observed Drop"}
                    </button>
                  </div>
                  {obsFeedback && (
                    <p className="text-xs text-emerald-300">{obsFeedback}</p>
                  )}
                </div>
              )}

              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-zinc-800 bg-[#0d1017] text-[11px]">
                      {renderSortHeader("item", "Item", "left")}
                      {renderSortHeader("dropRate", "Drop Rate", "right")}
                      {renderSortHeader("avgQty", "Avg Qty", "right")}
                      {renderSortHeader("channel", "Channel", "left")}
                      {renderSortHeader("unitPrice", "Unit Price", "right")}
                      {renderSortHeader("liquidity", "Liquidity / Si", "right")}
                      {renderSortHeader("k50", "K50 / K90", "right")}
                      {renderSortHeader("evPerKill", "EV / Kill (Adj)", "right")}
                      {renderSortHeader("provenance", "Provenance & Sample", "left")}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/70">
                    {sortedItems.map((item) => {
                      const rarity = getRarityMeta(item.quality);
                      const itemConf = CONFIDENCE_BADGE[item.confidenceTier];
                      const itemHref = item.suffixId
                        ? `/items/${item.itemId}/${item.suffixId}?marketId=${encodeURIComponent(marketId)}`
                        : `/items/${item.itemId}?marketId=${encodeURIComponent(marketId)}`;
                      return (
                        <tr
                          key={`${item.variantId ?? item.itemId}-${item.lootMethod}`}
                          className="hover:bg-amber-500/[0.03]"
                        >
                          <td className="px-3 py-2.5">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <Link
                                href={itemHref}
                                className={`font-medium hover:underline ${rarity.textClass}`}
                              >
                                {item.itemName}
                              </Link>
                              {item.suffixId && (
                                <span className="rounded border border-fuchsia-500/40 bg-fuchsia-500/15 px-1 py-0.2 text-[9px] font-bold uppercase text-fuchsia-300">
                                  VARIANT
                                </span>
                              )}
                              <span className="font-mono text-[10px] text-zinc-600">
                                #{item.variantId ?? item.itemId}
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-zinc-200">
                            {formatPercent(
                              item.dropRate,
                              item.suffixId ? 3 : 2
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-zinc-400">
                            {item.avgQty.toFixed(2)}
                            {item.avgQtyIsAssumed && (
                              <span
                                title="Defaulted to 1.0 (source rollup counts loot windows, not stack size)"
                                className="ml-0.5 text-zinc-600"
                              >
                                *
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2.5">
                            <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] uppercase text-zinc-300">
                              {item.liquidationChannel === "auction_house"
                                ? `AH (${(item.effectiveCommissionRate * 100).toFixed(0)}%)`
                                : item.liquidationChannel}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-zinc-200">
                            <div>{formatCopperShort(item.unitGrossCopper)}</div>
                            {item.variantPriceNote && (
                              <div className="text-[9px] text-zinc-500">
                                {item.variantPriceNote}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono">
                            {item.liquidationChannel === "vendor" ? (
                              <span className="text-emerald-400">
                                100% (Vendor)
                              </span>
                            ) : item.liquidity.status === "ESTIMATED" ? (
                              <span className="text-zinc-300">
                                {item.liquidity.score?.toFixed(0)}/100 ·{" "}
                                {formatPercent(
                                  item.liquidity.sellingProbability,
                                  0
                                )}
                              </span>
                            ) : (
                              <span className="text-zinc-500">Unknown</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-zinc-400">
                            {item.dropMetrics.killsFor50Pct !== null
                              ? `${Math.ceil(item.dropMetrics.killsFor50Pct).toLocaleString()} / ${Math.ceil(item.dropMetrics.killsFor90Pct ?? 0).toLocaleString()}`
                              : "—"}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono font-semibold text-amber-300">
                            {formatCopperShort(
                              item.expectedLiquidityAdjustedPerKillCopper
                            )}
                          </td>
                          <td className="px-3 py-2.5">
                            <span
                              className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${itemConf.className}`}
                            >
                              {itemConf.short}
                            </span>
                            <span className="ml-1.5 text-[10px] text-zinc-500">
                              {item.source}
                              {item.sampleSize ? ` (n=${item.sampleSize})` : ""}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          );
        })()}
      </section>
    </div>
  );
}
