"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Flame, PackageOpen, TrendingUp } from "lucide-react";
import { formatCopperFull, getRarityMeta } from "@/lib/wow-ui";

interface OpportunityPayload {
  marketId: string;
  risingItems: Array<{
    itemId: number;
    name: string;
    quality: number;
    clearingPriceCopper: number | null;
    change24hPct: number;
    availableQty: number;
    estimatedSoldPerDay: number | null;
  }>;
  scarceItems: Array<{
    itemId: number;
    name: string;
    quality: number;
    clearingPriceCopper: number | null;
    availableQty: number;
    estimatedSoldPerDay: number;
    daysOfSupply: number;
  }>;
}

export default function OpportunitiesPage() {
  const [marketId, setMarketId] = useState("us:0");
  const [markets, setMarkets] = useState<Array<{ id: string; displayName: string }>>([]);
  const [data, setData] = useState<OpportunityPayload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/v1/markets")
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.markets) && d.markets.length > 0) {
          setMarkets(d.markets);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/v1/opportunities?marketId=${encodeURIComponent(marketId)}`)
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, [marketId]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-amber-500/20 bg-[#12161f] p-5">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-amber-100">
            <TrendingUp className="h-5 w-5 text-amber-400" />
            Market Opportunity Alerts
          </h1>
          <p className="mt-1 text-xs text-zinc-400">
            Live signals derived strictly from real AH snapshots across farmable
            creature drops: sharp 24h price surges and low days-of-supply
            scarcity.
          </p>
        </div>

        <select
          value={marketId}
          onChange={(e) => setMarketId(e.target.value)}
          className="rounded border border-zinc-700 bg-[#0d1016] px-3 py-1.5 text-xs text-zinc-100"
        >
          {markets.length === 0 ? (
            <option value={marketId}>{marketId}</option>
          ) : (
            markets.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName}
              </option>
            ))
          )}
        </select>
      </header>

      {loading ? (
        <div className="py-16 text-center text-sm text-zinc-500">
          Scanning market snapshots for price surges and scarcity...
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="overflow-hidden rounded-xl border border-zinc-800 bg-[#12161f]">
            <div className="border-b border-zinc-800 px-4 py-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-emerald-200">
                <Flame className="h-4 w-4 text-emerald-400" />
                Price Surges (+10%+ in 24h)
              </h2>
            </div>
            <table className="w-full text-left text-xs">
              <thead className="bg-[#0d1017] text-[10px] uppercase text-zinc-400">
                <tr>
                  <th className="px-3 py-2">Item</th>
                  <th className="px-3 py-2 text-right">Price</th>
                  <th className="px-3 py-2 text-right">24h Delta</th>
                  <th className="px-3 py-2 text-right">Supply</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/70">
                {!data || data.risingItems.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-zinc-500">
                      No +10% 24h price surges among tracked creature drops right now.
                    </td>
                  </tr>
                ) : (
                  data.risingItems.map((it) => {
                    const r = getRarityMeta(it.quality);
                    return (
                      <tr key={it.itemId} className="hover:bg-amber-500/[0.03]">
                        <td className="px-3 py-2">
                          <Link
                            href={`/items/${it.itemId}?marketId=${encodeURIComponent(marketId)}`}
                            className={`font-medium hover:underline ${r.textClass}`}
                          >
                            {it.name}
                          </Link>
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-amber-300">
                          {formatCopperFull(it.clearingPriceCopper)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-semibold text-emerald-400">
                          +{it.change24hPct.toFixed(1)}%
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-zinc-400">
                          {it.availableQty.toLocaleString()}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </section>

          <section className="overflow-hidden rounded-xl border border-zinc-800 bg-[#12161f]">
            <div className="border-b border-zinc-800 px-4 py-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-amber-200">
                <PackageOpen className="h-4 w-4 text-amber-400" />
                Scarce High-Demand Drops (&le; 1.5 Days of Supply)
              </h2>
            </div>
            <table className="w-full text-left text-xs">
              <thead className="bg-[#0d1017] text-[10px] uppercase text-zinc-400">
                <tr>
                  <th className="px-3 py-2">Item</th>
                  <th className="px-3 py-2 text-right">Price</th>
                  <th className="px-3 py-2 text-right">Supply / Sold</th>
                  <th className="px-3 py-2 text-right">Days Supply</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/70">
                {!data || data.scarceItems.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-zinc-500">
                      No scarce tracked drops detected in this snapshot.
                    </td>
                  </tr>
                ) : (
                  data.scarceItems.map((it) => {
                    const r = getRarityMeta(it.quality);
                    return (
                      <tr key={it.itemId} className="hover:bg-amber-500/[0.03]">
                        <td className="px-3 py-2">
                          <Link
                            href={`/items/${it.itemId}?marketId=${encodeURIComponent(marketId)}`}
                            className={`font-medium hover:underline ${r.textClass}`}
                          >
                            {it.name}
                          </Link>
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-amber-300">
                          {formatCopperFull(it.clearingPriceCopper)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-zinc-300">
                          {it.availableQty} / {it.estimatedSoldPerDay.toFixed(1)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-semibold text-amber-300">
                          {it.daysOfSupply.toFixed(2)}d
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </section>
        </div>
      )}
    </div>
  );
}
