"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Bookmark, Trash2 } from "lucide-react";
import { formatCopperFull, formatCopperShort, getRarityMeta } from "@/lib/wow-ui";

const WATCHLIST_KEY = "wow_forever_watchlist_v1";

interface SavedWatchItem {
  itemId: number;
  name: string;
  quality: number;
}

interface HydratedWatchItem extends SavedWatchItem {
  clearingPriceCopper: number | null;
  change24hPct: number | null;
  availableQty: number;
  estimatedSoldPerDay: number | null;
  bestCreatureName: string | null;
  bestCreatureId: number | null;
  bestCreatureEgphCopper: number | null;
}

export function WatchlistClient() {
  const [marketId, setMarketId] = useState("us:110");
  const [items, setItems] = useState<HydratedWatchItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let saved: SavedWatchItem[] = [];
    try {
      const raw = localStorage.getItem(WATCHLIST_KEY);
      if (raw) saved = JSON.parse(raw);
    } catch {
      saved = [];
    }

    if (saved.length === 0) {
      setItems([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    Promise.all(
      saved.map(async (s): Promise<HydratedWatchItem> => {
        try {
          const res = await fetch(
            `/api/v1/items/${s.itemId}?marketId=${encodeURIComponent(marketId)}`
          );
          if (!res.ok) throw new Error("not ok");
          const data = await res.json();
          const m =
            data.markets?.find(
              (x: { marketId: string }) => x.marketId === marketId
            ) ?? data.markets?.[0];
          const best = data.creatureSources?.[0];
          return {
            ...s,
            clearingPriceCopper: m?.clearingPriceCopper ?? null,
            change24hPct: m?.change24hPct ?? null,
            availableQty: m?.availableQty ?? 0,
            estimatedSoldPerDay: m?.estimatedSoldPerDay ?? null,
            bestCreatureName: best?.creatureName ?? null,
            bestCreatureId: best?.creatureId ?? null,
            bestCreatureEgphCopper: best?.totalEgphCopper ?? null,
          };
        } catch {
          return {
            ...s,
            clearingPriceCopper: null,
            change24hPct: null,
            availableQty: 0,
            estimatedSoldPerDay: null,
            bestCreatureName: null,
            bestCreatureId: null,
            bestCreatureEgphCopper: null,
          };
        }
      })
    )
      .then(setItems)
      .finally(() => setLoading(false));
  }, [marketId]);

  const removeItem = (itemId: number) => {
    const next = items.filter((i) => i.itemId !== itemId);
    setItems(next);
    try {
      localStorage.setItem(
        WATCHLIST_KEY,
        JSON.stringify(
          next.map(({ itemId: id, name, quality }) => ({ itemId: id, name, quality }))
        )
      );
    } catch {
      // ignore
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-amber-500/20 bg-[#12161f] p-5">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-amber-100">
            <Bookmark className="h-5 w-5 text-amber-400" />
            Item Watchlist
          </h1>
          <p className="mt-1 text-xs text-zinc-400">
            Saved locally in your browser. Monitor live price changes, supply,
            estimated daily demand, and the current most profitable creature to
            farm.
          </p>
        </div>

        <select
          value={marketId}
          onChange={(e) => setMarketId(e.target.value)}
          className="rounded border border-zinc-700 bg-[#0d1016] px-3 py-1.5 text-xs text-zinc-100"
        >
          <option value="us:110">US House #110 (Alliance)</option>
          <option value="us:113">US House #113 (Horde)</option>
          <option value="us:116">US House #116 (Blackwater)</option>
          <option value="eu:110">EU House #110 (Alliance)</option>
          <option value="eu:113">EU House #113 (Horde)</option>
          <option value="eu:116">EU House #116 (Blackwater)</option>
        </select>
      </header>

      <section className="overflow-hidden rounded-xl border border-zinc-800 bg-[#12161f]">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-zinc-800 bg-[#0d1017] text-[11px] uppercase tracking-wider text-zinc-400">
                <th className="px-3 py-2.5">Item</th>
                <th className="px-3 py-2.5 text-right">Clearing Price</th>
                <th className="px-3 py-2.5 text-right">24h Change</th>
                <th className="px-3 py-2.5 text-right">Supply</th>
                <th className="px-3 py-2.5 text-right">Est. Sold / Day</th>
                <th className="px-3 py-2.5">Best Creature to Farm</th>
                <th className="px-3 py-2.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/70">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-zinc-500">
                    Loading live watchlist metrics...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-zinc-500">
                    Your watchlist is empty. Open any item page and click{" "}
                    <strong className="text-amber-200">Add to Watchlist</strong>.
                  </td>
                </tr>
              ) : (
                items.map((item) => {
                  const r = getRarityMeta(item.quality);
                  return (
                    <tr key={item.itemId} className="hover:bg-amber-500/[0.03]">
                      <td className="px-3 py-2.5">
                        <Link
                          href={`/items/${item.itemId}?marketId=${encodeURIComponent(marketId)}`}
                          className={`font-semibold hover:underline ${r.textClass}`}
                        >
                          {item.name}
                        </Link>
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-amber-300">
                        {formatCopperFull(item.clearingPriceCopper)}
                      </td>
                      <td
                        className={`px-3 py-2.5 text-right font-mono ${
                          (item.change24hPct ?? 0) >= 0
                            ? "text-emerald-400"
                            : "text-red-400"
                        }`}
                      >
                        {item.change24hPct !== null
                          ? `${item.change24hPct >= 0 ? "+" : ""}${item.change24hPct.toFixed(1)}%`
                          : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-zinc-300">
                        {item.availableQty.toLocaleString()}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-zinc-300">
                        {item.estimatedSoldPerDay !== null
                          ? item.estimatedSoldPerDay.toFixed(1)
                          : "Unknown"}
                      </td>
                      <td className="px-3 py-2.5">
                        {item.bestCreatureId && item.bestCreatureName ? (
                          <Link
                            href={`/creatures/${item.bestCreatureId}?marketId=${encodeURIComponent(marketId)}`}
                            className="text-zinc-200 hover:text-amber-300"
                          >
                            {item.bestCreatureName}{" "}
                            <span className="font-mono text-amber-300">
                              ({formatCopperShort(item.bestCreatureEgphCopper)}/hr)
                            </span>
                          </Link>
                        ) : (
                          <span className="text-zinc-500">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => removeItem(item.itemId)}
                          className="rounded p-1 text-zinc-500 hover:bg-red-950/50 hover:text-red-300"
                          title="Remove from watchlist"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
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
