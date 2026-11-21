"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Search,
  Sparkles,
  Store,
} from "lucide-react";
import {
  factionBadgeClass,
  formatCopperFull,
  formatCopperShort,
  formatRelativeAge,
  getRarityMeta,
} from "@/lib/wow-ui";
import type { MarketFaction } from "@/providers/types";

interface MarketOption {
  id: string;
  region: string;
  houseId: number;
  faction: MarketFaction;
  displayName: string;
  defaultCommissionRate: string;
  lastSnapshotAt: string | null;
}

interface MarketItemRow {
  itemId: number;
  name: string;
  quality: number;
  itemClass: string | null;
  itemSubclass: string | null;
  iconUrl: string | null;
  isNewForever: boolean;
  vendorSellCopper: number;
  lowestBuyoutCopper: number | null;
  medianCopper: number | null;
  clearingPriceCopper: number | null;
  availableQty: number;
  listingCount: number;
  change24hPct: number | null;
  estimatedSoldPerDay: number | null;
  snapshotAt: string;
}

interface MarketItemsResponse {
  total: number;
  totalActiveInMarket: number;
  newForeverCountInMarket: number;
  rows: MarketItemRow[];
}

const PAGE_SIZE = 50;

export function MarketExplorerClient() {
  const [markets, setMarkets] = useState<MarketOption[]>([]);
  const [marketId, setMarketId] = useState("us:0");
  const [search, setSearch] = useState("");
  const [newForeverOnly, setNewForeverOnly] = useState(false);
  const [itemClass, setItemClass] = useState("");
  const [minQuality, setMinQuality] = useState("");
  const [sortBy, setSortBy] = useState("price_desc");
  const [page, setPage] = useState(0);

  const [data, setData] = useState<MarketItemsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/v1/markets")
      .then((r) => r.json())
      .then((json) => {
        if (Array.isArray(json.markets)) {
          setMarkets(json.markets);
        }
      })
      .catch(() => {
        // fallback options still work
      });
  }, []);

  const selectedMarket = useMemo(
    () => markets.find((m) => m.id === marketId) ?? null,
    [markets, marketId]
  );

  const fetchItems = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    params.set("marketId", marketId);
    params.set("sortBy", sortBy);
    params.set("limit", String(PAGE_SIZE));
    params.set("offset", String(page * PAGE_SIZE));
    if (newForeverOnly) params.set("newForeverOnly", "true");
    if (search.trim()) params.set("search", search.trim());
    if (itemClass) params.set("itemClass", itemClass);
    if (minQuality) params.set("minQuality", minQuality);

    try {
      const res = await fetch(`/api/v1/market-items?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error ?? "Failed to load Auction House items");
      }
      setData(json);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load market items"
      );
    } finally {
      setLoading(false);
    }
  }, [marketId, search, newForeverOnly, itemClass, minQuality, sortBy, page]);

  useEffect(() => {
    const t = setTimeout(() => {
      fetchItems();
    }, 150);
    return () => clearTimeout(t);
  }, [fetchItems]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  const groupedMarkets = useMemo(() => {
    const unified = markets.filter((m) => m.faction === "unified");
    const us = markets.filter(
      (m) => m.region === "us" && m.faction !== "unified"
    );
    const eu = markets.filter(
      (m) => m.region === "eu" && m.faction !== "unified"
    );
    return { unified, us, eu };
  }, [markets]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <section className="rounded-xl border border-amber-500/20 bg-gradient-to-r from-[#131722] via-[#12161f] to-[#17151c] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-amber-100 sm:text-2xl">
              <Store className="h-5 w-5 text-amber-400" />
              WoW Forever Auction House &amp; New Items
            </h1>
            <p className="mt-1 max-w-2xl text-xs text-zinc-400 sm:text-sm">
              Browse every live item listed on the WoW Forever Auction House —
              including all brand-new Forever recipes, consumables, gear, and
              trade goods (<code className="text-amber-300">ID 200,000+</code>).
              Click any item to inspect prices across all Alliance, Horde, and
              Blackwater houses plus price history.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            {selectedMarket && (
              <span
                className={`rounded-full border px-2.5 py-1 font-medium ${factionBadgeClass(selectedMarket.faction)}`}
              >
                {selectedMarket.displayName} ·{" "}
                {formatRelativeAge(selectedMarket.lastSnapshotAt)}
              </span>
            )}
            {data && (
              <span className="rounded-full border border-zinc-700 bg-zinc-900/80 px-2.5 py-1 text-zinc-300">
                <strong className="text-zinc-100">
                  {data.totalActiveInMarket.toLocaleString()}
                </strong>{" "}
                live items ·{" "}
                <strong className="text-violet-300">
                  {data.newForeverCountInMarket.toLocaleString()}
                </strong>{" "}
                New Forever items
              </span>
            )}
          </div>
        </div>
      </section>

      {/* Filters */}
      <section className="space-y-3 rounded-xl border border-zinc-800 bg-[#12161f] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={marketId}
              onChange={(e) => {
                setMarketId(e.target.value);
                setPage(0);
              }}
              className="rounded border border-zinc-700 bg-[#0d1016] px-2.5 py-1.5 text-xs text-zinc-100"
            >
              {markets.length === 0 ? (
                <>
                  <option value="us:0">US — All Auction Houses (Unified)</option>
                  <option value="eu:0">EU — All Auction Houses (Unified)</option>
                </>
              ) : (
                <>
                  {groupedMarkets.unified.length > 0 && (
                    <optgroup label="Regional Unified Pools (All Items)">
                      {groupedMarkets.unified.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.displayName}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {groupedMarkets.us.length > 0 && (
                    <optgroup label="US Individual Houses">
                      {groupedMarkets.us.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.displayName}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {groupedMarkets.eu.length > 0 && (
                    <optgroup label="EU Individual Houses">
                      {groupedMarkets.eu.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.displayName}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </>
              )}
            </select>

            <label
              className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                newForeverOnly
                  ? "border-violet-400/60 bg-violet-500/20 text-violet-200"
                  : "border-zinc-700 bg-[#0d1016] text-zinc-300 hover:border-violet-500/40"
              }`}
            >
              <input
                type="checkbox"
                checked={newForeverOnly}
                onChange={(e) => {
                  setNewForeverOnly(e.target.checked);
                  setPage(0);
                }}
                className="accent-violet-400"
              />
              <Sparkles className="h-3.5 w-3.5 text-violet-300" />
              <span>New WoW Forever Items Only (200k+)</span>
            </label>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <ArrowUpDown className="h-3.5 w-3.5 text-zinc-500" />
            <select
              value={sortBy}
              onChange={(e) => {
                setSortBy(e.target.value);
                setPage(0);
              }}
              className="rounded border border-zinc-700 bg-[#0d1016] px-2.5 py-1.5 text-xs text-zinc-100"
            >
              <option value="price_desc">Sort: Highest Price</option>
              <option value="price_asc">Sort: Lowest Price</option>
              <option value="change_24h">Sort: Biggest 24h Gain</option>
              <option value="sold_per_day">Sort: Highest Est. Sold/Day</option>
              <option value="supply">Sort: Highest Supply</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-12">
          <div className="relative sm:col-span-6">
            <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-zinc-500" />
            <input
              type="text"
              placeholder="Search item name or exact item ID (e.g. Elixir of Strength or 250385)..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
              className="w-full rounded border border-zinc-800 bg-[#0d1016] py-1.5 pl-8 pr-3 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500/50 focus:outline-none"
            />
          </div>

          <select
            value={itemClass}
            onChange={(e) => {
              setItemClass(e.target.value);
              setPage(0);
            }}
            className="rounded border border-zinc-800 bg-[#0d1016] px-2.5 py-1.5 text-xs text-zinc-100 sm:col-span-3"
          >
            <option value="">All Categories</option>
            <option value="Recipe">Recipe</option>
            <option value="Consumable">Consumable</option>
            <option value="Trade Goods">Trade Goods</option>
            <option value="Weapon">Weapon</option>
            <option value="Armor">Armor</option>
            <option value="Container">Container</option>
            <option value="Projectile">Projectile</option>
            <option value="Miscellaneous">Miscellaneous</option>
          </select>

          <select
            value={minQuality}
            onChange={(e) => {
              setMinQuality(e.target.value);
              setPage(0);
            }}
            className="rounded border border-zinc-800 bg-[#0d1016] px-2.5 py-1.5 text-xs text-zinc-100 sm:col-span-2"
          >
            <option value="">Any Rarity</option>
            <option value="1">Common+</option>
            <option value="2">Uncommon+</option>
            <option value="3">Rare+</option>
            <option value="4">Epic+</option>
          </select>

          <button
            type="button"
            onClick={fetchItems}
            className="inline-flex items-center justify-center gap-1 rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-300 hover:border-amber-500/40 hover:text-amber-200 sm:col-span-1"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
            <span>Sync</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-500">
          <span>
            Showing{" "}
            <strong className="text-zinc-200">
              {data ? data.rows.length : 0}
            </strong>{" "}
            of{" "}
            <strong className="text-zinc-200">
              {data ? data.total.toLocaleString() : 0}
            </strong>{" "}
            matching live AH listings · Prices: <span className="text-emerald-400">ACTUAL</span>{" "}
            (Forever AH) · Sold/Day: <span className="text-amber-300">ESTIMATED</span>
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 0 || loading}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="inline-flex items-center gap-1 rounded border border-zinc-800 bg-[#0d1016] px-2 py-1 text-zinc-300 disabled:opacity-40 hover:border-amber-500/40"
            >
              <ChevronLeft className="h-3 w-3" />
              Prev
            </button>
            <span className="font-mono text-zinc-400">
              Page {page + 1} / {totalPages}
            </span>
            <button
              type="button"
              disabled={page + 1 >= totalPages || loading}
              onClick={() => setPage((p) => p + 1)}
              className="inline-flex items-center gap-1 rounded border border-zinc-800 bg-[#0d1016] px-2 py-1 text-zinc-300 disabled:opacity-40 hover:border-amber-500/40"
            >
              Next
              <ChevronRight className="h-3 w-3" />
            </button>
          </div>
        </div>
      </section>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-500/40 bg-red-950/30 p-4 text-xs text-red-200">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Results Table */}
      <section className="overflow-hidden rounded-xl border border-zinc-800 bg-[#12161f]">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-zinc-800 bg-[#0d1017] text-[11px] uppercase tracking-wider text-zinc-400">
                <th className="px-3 py-2.5">Item</th>
                <th className="px-3 py-2.5">Category</th>
                <th className="px-3 py-2.5 text-right">Lowest</th>
                <th className="px-3 py-2.5 text-right">Median</th>
                <th className="px-3 py-2.5 text-right">Clearing Price</th>
                <th className="px-3 py-2.5 text-right">24h Delta</th>
                <th className="px-3 py-2.5 text-right">Supply</th>
                <th className="px-3 py-2.5 text-right">Est. Sold/Day</th>
                <th className="px-3 py-2.5 text-right">Snapshot</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/70">
              {loading && (!data || data.rows.length === 0) ? (
                <tr>
                  <td
                    colSpan={9}
                    className="px-4 py-12 text-center text-zinc-500"
                  >
                    Loading live WoW Forever Auction House listings...
                  </td>
                </tr>
              ) : !data || data.rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={9}
                    className="px-4 py-12 text-center text-zinc-500"
                  >
                    No live listings found in this house for the selected
                    filters. Try switching to{" "}
                    <strong className="text-amber-300">
                      US / EU — All Auction Houses (Unified)
                    </strong>{" "}
                    or clearing filters.
                  </td>
                </tr>
              ) : (
                data.rows.map((row) => {
                  const rarity = getRarityMeta(row.quality);
                  return (
                    <tr
                      key={row.itemId}
                      className="transition-colors hover:bg-amber-500/[0.04]"
                    >
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2.5">
                          {row.iconUrl && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={row.iconUrl}
                              alt=""
                              loading="lazy"
                              className={`h-7 w-7 shrink-0 rounded border bg-zinc-900 object-cover ${rarity.borderClass}`}
                            />
                          )}
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <Link
                                href={`/items/${row.itemId}?marketId=${encodeURIComponent(marketId)}`}
                                className={`font-semibold hover:underline ${rarity.textClass}`}
                              >
                                {row.name}
                              </Link>
                              {row.isNewForever && (
                                <span className="rounded border border-violet-500/40 bg-violet-500/15 px-1.5 py-0.2 text-[9px] font-bold uppercase tracking-wide text-violet-300">
                                  Forever New
                                </span>
                              )}
                            </div>
                            <div className="font-mono text-[10px] text-zinc-500">
                              #{row.itemId}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-zinc-400">
                        {row.itemClass ?? "—"}
                        {row.itemSubclass ? (
                          <span className="text-zinc-600">
                            {" "}
                            / {row.itemSubclass}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-zinc-300">
                        {formatCopperShort(row.lowestBuyoutCopper)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-zinc-300">
                        {formatCopperShort(row.medianCopper)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono font-bold text-amber-300">
                        {formatCopperFull(row.clearingPriceCopper)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono">
                        {row.change24hPct !== null ? (
                          <span
                            className={
                              row.change24hPct >= 0
                                ? "text-emerald-400"
                                : "text-red-400"
                            }
                          >
                            {row.change24hPct >= 0 ? "+" : ""}
                            {row.change24hPct.toFixed(1)}%
                          </span>
                        ) : (
                          <span className="text-zinc-600">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-zinc-200">
                        {row.availableQty.toLocaleString()}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-zinc-300">
                        {row.estimatedSoldPerDay !== null
                          ? row.estimatedSoldPerDay.toFixed(1)
                          : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-right text-[11px] text-zinc-500">
                        {formatRelativeAge(row.snapshotAt)}
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
