"use client";

import { useEffect, useState } from "react";
import { Dice5, Play, Scale } from "lucide-react";
import { formatCopperFull, formatCopperShort, getRarityMeta } from "@/lib/wow-ui";

interface MarketOption {
  id: string;
  displayName: string;
}

interface CreatureOption {
  creatureId: number;
  creatureName: string;
  zoneName: string | null;
}

interface SimResponse {
  creature: { id: number; name: string; zoneName: string | null };
  market: { id: string; displayName: string } | null;
  simulation: {
    analytical: {
      expectedKills: number;
      expectedRawCoinCopper: number;
      expectedGrossEvCopper: number;
      expectedLiquidityAdjustedCopper: number;
      totalExpensesCopper: number;
      expectedLoot: Array<{
        itemId: number;
        itemName: string;
        expectedDrops: number;
        expectedUnits: number;
        expectedGrossCopper: number;
        expectedLiquidityAdjustedCopper: number;
      }>;
    };
    sampleRun: {
      kills: number;
      rawCoinCopper: number;
      grossLootCopper: number;
      netProfitCopper: number;
      loot: Array<{
        itemId: number;
        itemName: string;
        quality: number;
        dropsCount: number;
        totalUnits: number;
        realizedCopper: number;
      }>;
    };
    distribution: {
      iterations: number;
      meanNetCopper: number;
      p10NetCopper: number;
      p50NetCopper: number;
      p90NetCopper: number;
      minNetCopper: number;
      maxNetCopper: number;
      profitableRunPct: number;
    };
  };
}

export function SimulatorClient({
  initialCreatureId,
  initialMarketId,
  initialKph,
}: {
  initialCreatureId?: number;
  initialMarketId?: string;
  initialKph?: number;
}) {
  const [markets, setMarkets] = useState<MarketOption[]>([]);
  const [creatures, setCreatures] = useState<CreatureOption[]>([]);
  const [creatureId, setCreatureId] = useState<number>(initialCreatureId ?? 0);
  const [marketId, setMarketId] = useState<string>(initialMarketId ?? "us:110");
  const [durationHours, setDurationHours] = useState<number>(2);
  const [killsPerHour, setKillsPerHour] = useState<number>(initialKph ?? 60);
  const [expensesGold, setExpensesGold] = useState<number>(0);
  const [iterations, setIterations] = useState<number>(500);

  const [result, setResult] = useState<SimResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/v1/markets").then((r) => r.json()),
      fetch(`/api/v1/rankings?marketId=${encodeURIComponent(marketId)}&limit=100`).then((r) =>
        r.json()
      ),
    ])
      .then(([mData, rData]) => {
        if (Array.isArray(mData.markets)) setMarkets(mData.markets);
        if (Array.isArray(rData.rows)) {
          setCreatures(rData.rows);
          if (!creatureId && rData.rows.length > 0) {
            setCreatureId(rData.rows[0].creatureId);
          }
        }
      })
      .catch(() => {});
  }, [marketId, creatureId]);

  const runSimulation = async () => {
    if (!creatureId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          creatureId,
          marketId,
          durationHours,
          killsPerHour,
          hourlyExpensesCopper: Math.round(Math.max(0, expensesGold) * 10_000),
          iterations,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Simulation failed");
      setResult(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Simulation failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <header className="rounded-xl border border-amber-500/20 bg-[#12161f] p-5">
        <h1 className="flex items-center gap-2 text-xl font-bold text-amber-100">
          <Dice5 className="h-5 w-5 text-amber-400" />
          Farming Session Simulator
        </h1>
        <p className="mt-1 text-xs text-zinc-400">
          Compares <strong>statistical expected value (EV)</strong> against{" "}
          <strong>simulated random loot outcomes</strong> (Monte Carlo).
          Expected value is a long-run mathematical average — never guaranteed
          earnings for a single session.
        </p>
      </header>

      <section className="grid gap-3 rounded-xl border border-zinc-800 bg-[#12161f] p-4 sm:grid-cols-2 lg:grid-cols-6">
        <div className="lg:col-span-2">
          <label className="mb-1 block text-[11px] text-zinc-400">
            Creature
          </label>
          <select
            value={creatureId}
            onChange={(e) => setCreatureId(Number(e.target.value))}
            className="w-full rounded border border-zinc-700 bg-[#0d1016] px-2.5 py-1.5 text-xs text-zinc-100"
          >
            {creatures.map((c) => (
              <option key={c.creatureId} value={c.creatureId}>
                {c.creatureName} ({c.zoneName ?? "Unknown"})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-[11px] text-zinc-400">
            Auction House
          </label>
          <select
            value={marketId}
            onChange={(e) => setMarketId(e.target.value)}
            className="w-full rounded border border-zinc-700 bg-[#0d1016] px-2.5 py-1.5 text-xs text-zinc-100"
          >
            {markets.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-[11px] text-zinc-400">
            Duration (Hours)
          </label>
          <input
            type="number"
            min={0.5}
            max={48}
            step={0.5}
            value={durationHours}
            onChange={(e) =>
              setDurationHours(Math.max(0.5, Number(e.target.value) || 1))
            }
            className="w-full rounded border border-zinc-700 bg-[#0d1016] px-2.5 py-1.5 text-xs text-zinc-100"
          />
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
            onChange={(e) =>
              setKillsPerHour(Math.max(1, Number(e.target.value) || 1))
            }
            className="w-full rounded border border-zinc-700 bg-[#0d1016] px-2.5 py-1.5 text-xs text-zinc-100"
          />
        </div>

        <div className="flex flex-col justify-end">
          <button
            type="button"
            disabled={loading || !creatureId}
            onClick={runSimulation}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded border border-amber-500/50 bg-amber-500/20 px-3 py-1.5 text-xs font-semibold text-amber-100 hover:bg-amber-500/30 disabled:opacity-50"
          >
            <Play className="h-3.5 w-3.5" />
            {loading ? "Simulating..." : "Run Simulation"}
          </button>
        </div>

        <div className="sm:col-span-2 lg:col-span-6 flex flex-wrap gap-4 border-t border-zinc-800/80 pt-3 text-xs">
          <label className="flex items-center gap-2 text-zinc-400">
            <span>Expenses/hr (g):</span>
            <input
              type="number"
              min={0}
              step={0.5}
              value={expensesGold}
              onChange={(e) =>
                setExpensesGold(Math.max(0, Number(e.target.value) || 0))
              }
              className="w-20 rounded border border-zinc-700 bg-[#0d1016] px-2 py-1 text-zinc-100"
            />
          </label>
          <label className="flex items-center gap-2 text-zinc-400">
            <span>Monte Carlo Trials:</span>
            <select
              value={iterations}
              onChange={(e) => setIterations(Number(e.target.value))}
              className="rounded border border-zinc-700 bg-[#0d1016] px-2 py-1 text-zinc-100"
            >
              <option value={250}>250 runs</option>
              <option value={500}>500 runs</option>
              <option value={1000}>1,000 runs</option>
            </select>
          </label>
        </div>
      </section>

      {error && (
        <div className="rounded border border-red-500/40 bg-red-950/30 p-3 text-xs text-red-200">
          {error}
        </div>
      )}

      {result && (
        <div className="grid gap-5 lg:grid-cols-2">
          {/* Panel A: Statistical Expected Value */}
          <section className="rounded-xl border border-emerald-500/30 bg-[#12161f] p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2">
                <Scale className="h-4 w-4 text-emerald-400" />
                <h2 className="text-sm font-bold uppercase tracking-wider text-emerald-200">
                  Statistical Expected Value (Analytical)
                </h2>
              </div>
              <span className="font-mono text-xs text-zinc-400">
                {result.simulation.analytical.expectedKills} kills
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-zinc-800 bg-[#0d1016] p-3">
                <div className="text-[11px] text-zinc-500">
                  Expected Net (Liquidity-Adjusted)
                </div>
                <div className="mt-1 font-mono text-lg font-bold text-emerald-300">
                  {formatCopperFull(
                    result.simulation.analytical.expectedLiquidityAdjustedCopper
                  )}
                </div>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-[#0d1016] p-3">
                <div className="text-[11px] text-zinc-500">
                  Expected Gross EV (Si = 1.0)
                </div>
                <div className="mt-1 font-mono text-lg font-bold text-zinc-200">
                  {formatCopperFull(
                    result.simulation.analytical.expectedGrossEvCopper
                  )}
                </div>
              </div>
            </div>

            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase text-zinc-400">
                Expected Drops Breakdown
              </h3>
              <div className="max-h-64 overflow-y-auto rounded border border-zinc-800">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#0d1016] text-[10px] uppercase text-zinc-500">
                    <tr>
                      <th className="px-2.5 py-2">Item</th>
                      <th className="px-2.5 py-2 text-right">Exp. Units</th>
                      <th className="px-2.5 py-2 text-right">Exp. Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/70">
                    {result.simulation.analytical.expectedLoot.slice(0, 15).map((l) => (
                      <tr key={l.itemId}>
                        <td className="px-2.5 py-1.5 text-zinc-200">
                          {l.itemName}
                        </td>
                        <td className="px-2.5 py-1.5 text-right font-mono text-zinc-400">
                          {l.expectedUnits.toFixed(2)}
                        </td>
                        <td className="px-2.5 py-1.5 text-right font-mono text-emerald-300">
                          {formatCopperShort(l.expectedLiquidityAdjustedCopper)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          {/* Panel B: Simulated Random Outcome & Distribution */}
          <section className="rounded-xl border border-amber-500/30 bg-[#12161f] p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2">
                <Dice5 className="h-4 w-4 text-amber-400" />
                <h2 className="text-sm font-bold uppercase tracking-wider text-amber-200">
                  Simulated Random Outcome (RNG)
                </h2>
              </div>
              <span className="font-mono text-xs text-zinc-400">
                {result.simulation.distribution.iterations} Monte Carlo trials
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg border border-zinc-800 bg-[#0d1016] p-2.5">
                <div className="text-[10px] uppercase text-zinc-500">
                  Unlucky (P10)
                </div>
                <div className="mt-1 font-mono text-sm font-bold text-red-300">
                  {formatCopperShort(result.simulation.distribution.p10NetCopper)}
                </div>
              </div>
              <div className="rounded-lg border border-amber-500/30 bg-[#0d1016] p-2.5">
                <div className="text-[10px] uppercase text-zinc-400">
                  Median (P50)
                </div>
                <div className="mt-1 font-mono text-sm font-bold text-amber-300">
                  {formatCopperShort(result.simulation.distribution.p50NetCopper)}
                </div>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-[#0d1016] p-2.5">
                <div className="text-[10px] uppercase text-zinc-500">
                  Lucky (P90)
                </div>
                <div className="mt-1 font-mono text-sm font-bold text-emerald-300">
                  {formatCopperShort(result.simulation.distribution.p90NetCopper)}
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-zinc-800 bg-[#0d1016] p-3 text-xs flex items-center justify-between">
              <span className="text-zinc-400">Sample Single-Session Result:</span>
              <span className="font-mono text-base font-bold text-amber-200">
                {formatCopperFull(result.simulation.sampleRun.netProfitCopper)}
              </span>
            </div>

            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase text-zinc-400">
                Sample Session Loot Rolled
              </h3>
              <div className="max-h-56 overflow-y-auto rounded border border-zinc-800">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#0d1016] text-[10px] uppercase text-zinc-500">
                    <tr>
                      <th className="px-2.5 py-2">Item</th>
                      <th className="px-2.5 py-2 text-right">Units</th>
                      <th className="px-2.5 py-2 text-right">Realized</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/70">
                    {result.simulation.sampleRun.loot.length === 0 ? (
                      <tr>
                        <td
                          colSpan={3}
                          className="px-3 py-4 text-center text-zinc-500"
                        >
                          No sellable items dropped in this single sample roll.
                        </td>
                      </tr>
                    ) : (
                      result.simulation.sampleRun.loot.map((l) => {
                        const r = getRarityMeta(l.quality);
                        return (
                          <tr key={l.itemId}>
                            <td className={`px-2.5 py-1.5 font-medium ${r.textClass}`}>
                              {l.itemName}
                            </td>
                            <td className="px-2.5 py-1.5 text-right font-mono text-zinc-300">
                              {l.totalUnits}
                            </td>
                            <td className="px-2.5 py-1.5 text-right font-mono text-amber-300">
                              {formatCopperShort(l.realizedCopper)}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
