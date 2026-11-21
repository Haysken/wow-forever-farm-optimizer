"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Bookmark, BookmarkCheck, Swords } from "lucide-react";
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

const WATCHLIST_KEY = "wow_forever_watchlist_v1";

interface ItemDetailResponse {
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
  region: string;
  selectedMarket: {
    id: string;
    displayName: string;
    faction: MarketFaction;
  } | null;
  markets: Array<{
    marketId: string;
    houseId: number;
    faction: MarketFaction;
    displayName: string;
    defaultCommissionRate: number;
    lowestBuyoutCopper: number | null;
    p10Copper: number | null;
    medianCopper: number | null;
    clearingPriceCopper: number | null;
    availableQty: number;
    listingCount: number;
    change24hPct: number | null;
    trend7dPct: number | null;
    trend30dPct: number | null;
    estimatedSoldPerDay: number | null;
    salesDataStatus: string;
    priceStatus: string;
    snapshotAt: string | null;
    liquidity: {
      score: number | null;
      sellingProbability: number | null;
      status: "ESTIMATED" | "UNKNOWN";
    };
  }>;
  historyHourly: Array<{
    ts: string;
    minCopper: number | null;
    p10Copper: number | null;
    medianCopper: number | null;
    availableQty: number;
  }>;
  historyDaily: Array<{
    ts: string;
    minCopper: number | null;
    p10Copper: number | null;
    medianCopper: number | null;
    availableQty: number;
  }>;
  creatureSources: Array<{
    creatureId: number;
    creatureName: string;
    minLevel: number | null;
    maxLevel: number | null;
    zoneName: string | null;
    lootMethod: string;
    dropRate: number;
    avgQty: number;
    confidenceTier: ConfidenceTier;
    sampleSize: number | null;
    source: string;
    itemEvPerKillCopper: number;
    totalEgpkCopper: number;
    totalEgphCopper: number;
    totalEgphGrossCopper: number;
  }>;
}

export function ItemDetailClient({
  itemId,
  initialMarketId,
}: {
  itemId: number;
  initialMarketId: string;
}) {
  const [marketId, setMarketId] = useState(initialMarketId);
  const [region, setRegion] = useState(initialMarketId.split(":")[0] || "us");
  const [killsPerHour, setKillsPerHour] = useState(60);
  const [data, setData] = useState<ItemDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [watched, setWatched] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(WATCHLIST_KEY);
      if (raw) {
        const list = JSON.parse(raw) as Array<{ itemId: number }>;
        setWatched(list.some((x) => x.itemId === itemId));
      }
    } catch {
      // ignore storage errors
    }
  }, [itemId]);

  const toggleWatchlist = () => {
    if (!data) return;
    try {
      const raw = localStorage.getItem(WATCHLIST_KEY);
      const list: Array<{ itemId: number; name: string; quality: number }> = raw
        ? JSON.parse(raw)
        : [];
      const exists = list.some((x) => x.itemId === itemId);
      const updated = exists
        ? list.filter((x) => x.itemId !== itemId)
        : [
            ...list,
            {
              itemId: data.item.id,
              name: data.item.name,
              quality: data.item.quality,
            },
          ];
      localStorage.setItem(WATCHLIST_KEY, JSON.stringify(updated));
      setWatched(!exists);
    } catch {
      // ignore storage errors
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        marketId,
        region,
        killsPerHour: String(Math.max(1, killsPerHour)),
      });
      const res = await fetch(`/api/v1/items/${itemId}?${qs.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load item");
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error loading item");
    } finally {
      setLoading(false);
    }
  }, [itemId, marketId, region, killsPerHour]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading && !data) {
    return (
      <div className="py-16 text-center text-sm text-zinc-400">
        Loading item prices across Alliance, Horde &amp; Blackwater markets...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-lg border border-red-500/40 bg-red-950/30 p-6 text-sm text-red-200">
        {error ?? "Item not found."}
      </div>
    );
  }

  const { item, markets, historyHourly, historyDaily, creatureSources } = data;
  const rarity = getRarityMeta(item.quality);

  // Representative Alliance, Horde, and Neutral summary cards (prefer houses with active listings)
  const pickFactionMarket = (fac: "alliance" | "horde" | "neutral") =>
    markets.find((m) => m.faction === fac && m.priceStatus === "ACTUAL") ??
    markets.find((m) => m.faction === fac);

  const byFaction: Record<"alliance" | "horde" | "neutral", (typeof markets)[number] | undefined> = {
    alliance: pickFactionMarket("alliance"),
    horde: pickFactionMarket("horde"),
    neutral: pickFactionMarket("neutral"),
  };

  const activeRegionHouses = markets.filter(
    (m) => m.priceStatus === "ACTUAL" && m.faction !== "unified"
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
              alt={item.name}
              className={`h-12 w-12 rounded-md border-2 bg-zinc-900 object-cover ${rarity.borderClass}`}
            />
          )}
          <div>
            <div className="flex items-center gap-3 text-xs text-zinc-400">
              <Link
                href="/market"
                className="inline-flex items-center gap-1 hover:text-amber-300"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Auction House
              </Link>
              <span className="text-zinc-700">·</span>
              <Link href="/" className="hover:text-amber-300">
                Farm Rankings
              </Link>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h1 className={`text-2xl font-bold ${rarity.textClass}`}>
                {item.name}
              </h1>
              <span className="rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 font-mono text-xs text-zinc-400">
                Item #{item.id}
              </span>
              {item.id >= 200_000 && (
                <span className="rounded border border-violet-500/40 bg-violet-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-300">
                  WoW Forever New
                </span>
              )}
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
              <span>Bind: {item.bindType.toUpperCase()}</span>
              <span>·</span>
              <span>
                Vendor sell:{" "}
                <strong className="font-mono text-zinc-200">
                  {formatCopperFull(item.vendorSellCopper)}
                </strong>
              </span>
            </div>
            {item.description && (
              <p className="mt-1.5 max-w-2xl text-xs italic text-amber-200/80">
                &ldquo;{item.description}&rdquo;
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <select
            value={region}
            onChange={(e) => {
              const nextRegion = e.target.value;
              setRegion(nextRegion);
              setMarketId(`${nextRegion}:0`);
            }}
            className="rounded border border-zinc-700 bg-[#12161f] px-2.5 py-1.5 text-zinc-100"
          >
            <option value="us">Region: US</option>
            <option value="eu">Region: EU</option>
          </select>

          <button
            type="button"
            onClick={toggleWatchlist}
            className={`inline-flex items-center gap-1.5 rounded border px-3 py-1.5 font-medium transition-colors ${
              watched
                ? "border-amber-500/50 bg-amber-500/20 text-amber-200"
                : "border-zinc-700 bg-[#12161f] text-zinc-300 hover:border-amber-500/40"
            }`}
          >
            {watched ? (
              <BookmarkCheck className="h-3.5 w-3.5" />
            ) : (
              <Bookmark className="h-3.5 w-3.5" />
            )}
            {watched ? "In Watchlist" : "Add to Watchlist"}
          </button>
        </div>
      </div>

      {/* Cross-Faction Price Comparison Cards */}
      <section className="grid gap-4 md:grid-cols-3">
        {(["alliance", "horde", "neutral"] as const).map((fac) => {
          const m = byFaction[fac];
          const selected = m?.marketId === marketId;
          return (
            <div
              key={fac}
              onClick={() => m && setMarketId(m.marketId)}
              className={`cursor-pointer rounded-xl border p-4 transition-colors ${
                selected
                  ? "border-amber-500/50 bg-[#161a24]"
                  : "border-zinc-800 bg-[#12161f] hover:border-zinc-700"
              }`}
            >
              <div className="flex items-center justify-between">
                <span
                  className={`rounded border px-2 py-0.5 text-xs font-semibold capitalize ${factionBadgeClass(fac)}`}
                >
                  {fac === "neutral" ? "Blackwater Neutral" : `${fac} AH`}
                </span>
                <span className="text-[11px] text-zinc-500">
                  {m ? formatRelativeAge(m.snapshotAt) : "Not synced"}
                </span>
              </div>

              {m && m.priceStatus === "ACTUAL" ? (
                <div className="mt-3 space-y-2 text-xs">
                  <div className="flex items-baseline justify-between">
                    <span className="text-zinc-400">Clearing Price</span>
                    <span className="font-mono text-lg font-bold text-amber-300">
                      {formatCopperFull(m.clearingPriceCopper)}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 border-t border-zinc-800/80 pt-2 text-[11px]">
                    <div className="flex justify-between">
                      <span className="text-zinc-500">Lowest:</span>
                      <span className="font-mono text-zinc-200">
                        {formatCopperShort(m.lowestBuyoutCopper)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-500">Median:</span>
                      <span className="font-mono text-zinc-200">
                        {formatCopperShort(m.medianCopper)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-500">Supply:</span>
                      <span className="font-mono text-zinc-200">
                        {m.availableQty.toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-500">Est. Sold/Day:</span>
                      <span className="font-mono text-zinc-200">
                        {m.estimatedSoldPerDay !== null
                          ? m.estimatedSoldPerDay.toFixed(1)
                          : "Unknown"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-500">Liquidity:</span>
                      <span className="font-mono text-emerald-300">
                        {m.liquidity.score !== null
                          ? `${m.liquidity.score.toFixed(0)}/100`
                          : "Unknown"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-500">24h Delta:</span>
                      <span
                        className={`font-mono ${
                          (m.change24hPct ?? 0) >= 0
                            ? "text-emerald-400"
                            : "text-red-400"
                        }`}
                      >
                        {m.change24hPct !== null
                          ? `${m.change24hPct >= 0 ? "+" : ""}${m.change24hPct.toFixed(1)}%`
                          : "—"}
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="mt-4 text-xs text-zinc-500">
                  No active listings in this faction Auction House snapshot.
                </p>
              )}
            </div>
          );
        })}
      </section>

      {/* All Active Houses Breakdown in Region */}
      {activeRegionHouses.length > 0 && (
        <section className="overflow-hidden rounded-xl border border-zinc-800 bg-[#12161f]">
          <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2.5">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-amber-200">
              All Active {region.toUpperCase()} Auction Houses ({activeRegionHouses.length})
            </h2>
            <span className="text-[11px] text-zinc-500">
              Click any house to switch chart &amp; creature profitability
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#0d1017] text-[10px] uppercase text-zinc-400">
                <tr>
                  <th className="px-3 py-2">House</th>
                  <th className="px-3 py-2">Faction</th>
                  <th className="px-3 py-2 text-right">Lowest</th>
                  <th className="px-3 py-2 text-right">Median</th>
                  <th className="px-3 py-2 text-right">Clearing</th>
                  <th className="px-3 py-2 text-right">Supply</th>
                  <th className="px-3 py-2 text-right">Snapshot</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/70">
                {activeRegionHouses.map((h) => (
                  <tr
                    key={h.marketId}
                    onClick={() => setMarketId(h.marketId)}
                    className={`cursor-pointer transition-colors hover:bg-amber-500/[0.06] ${
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
                    <td className="px-3 py-2 text-right font-mono text-zinc-200">
                      {formatCopperFull(h.lowestBuyoutCopper)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-zinc-200">
                      {formatCopperFull(h.medianCopper)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-semibold text-amber-300">
                      {formatCopperFull(h.clearingPriceCopper)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-zinc-300">
                      {h.availableQty.toLocaleString()}
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

      {/* Price & Supply History Chart */}
      <PriceHistoryChart
        mode="item"
        title={`Historical Price & Supply (${data.selectedMarket?.displayName ?? marketId})`}
        hourlyPoints={historyHourly}
        dailyPoints={historyDaily}
      />

      {/* Creature Source Comparison Table */}
      <section className="overflow-hidden rounded-xl border border-zinc-800 bg-[#12161f]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 px-4 py-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-amber-100">
              <Swords className="h-4 w-4 text-amber-400" />
              Which creature is the most efficient source of {item.name}?
            </h2>
            <p className="text-[11px] text-zinc-500">
              Comparing {creatureSources.length} known dropping creatures at{" "}
              {killsPerHour} kills/hr (total creature EGPH includes all drops)
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
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-zinc-800 bg-[#0d1017] text-[11px] uppercase tracking-wider text-zinc-400">
                <th className="px-3 py-2.5">Creature</th>
                <th className="px-3 py-2.5">Level</th>
                <th className="px-3 py-2.5">Zone</th>
                <th className="px-3 py-2.5 text-right">Drop Rate</th>
                <th className="px-3 py-2.5 text-right">Gold / Kill (Total)</th>
                <th className="px-3 py-2.5 text-right">Gold / Hour (Total)</th>
                <th className="px-3 py-2.5">Confidence</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/70">
              {creatureSources.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-8 text-center text-zinc-500"
                  >
                    No synced creature loot tables drop this item yet.
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
                      <td className="px-3 py-2.5 text-right font-mono font-semibold text-zinc-100">
                        {formatPercent(src.dropRate)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-zinc-300">
                        {formatCopperShort(src.totalEgpkCopper)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono font-bold text-amber-300">
                        {formatCopperFull(src.totalEgphCopper)}
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${conf.className}`}
                        >
                          {conf.short}
                        </span>
                        <span className="ml-1.5 text-[10px] text-zinc-500">
                          {src.source}
                          {src.sampleSize ? ` (n=${src.sampleSize})` : ""}
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
