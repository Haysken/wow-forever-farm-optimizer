"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChevronLeft,
  ChevronRight,
  Info,
  ReceiptText,
  TrendingUp,
} from "lucide-react";
import {
  analyzeHourlyStockExits,
  type HourlySnapshotInput,
} from "@/domain/market/stock-exits";
import { formatCopperFull, formatCopperShort } from "@/lib/wow-ui";

interface EstimatedSalesSectionProps {
  hourlyPoints: HourlySnapshotInput[];
  marketLabel: string;
}

const PAGE_SIZE = 15;

function formatDateTime(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleString([], {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatTimeOnly(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function EstimatedSalesSection({
  hourlyPoints,
  marketLabel,
}: EstimatedSalesSectionProps) {
  const [range, setRange] = useState<"24h" | "7d" | "all">("7d");
  const [cheapestClearedOnly, setCheapestClearedOnly] = useState(false);
  const [page, setPage] = useState(0);

  const filteredPoints = useMemo(() => {
    if (range === "all" || hourlyPoints.length === 0) return hourlyPoints;
    const latestMs = hourlyPoints.reduce((max, pt) => {
      const t = Date.parse(pt.ts);
      return Number.isFinite(t) && t > max ? t : max;
    }, 0);
    const spanMs =
      range === "24h" ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
    const cutoff = latestMs - spanMs;
    return hourlyPoints.filter((pt) => Date.parse(pt.ts) >= cutoff);
  }, [hourlyPoints, range]);

  const analysis = useMemo(
    () => analyzeHourlyStockExits(filteredPoints),
    [filteredPoints]
  );

  const visibleEventsDesc = useMemo(
    () =>
      cheapestClearedOnly
        ? analysis.eventsDesc.filter((e) => e.cheapestCleared)
        : analysis.eventsDesc,
    [analysis.eventsDesc, cheapestClearedOnly]
  );

  const visibleEventsAsc = useMemo(
    () =>
      cheapestClearedOnly
        ? analysis.eventsAsc.filter((e) => e.cheapestCleared)
        : analysis.eventsAsc,
    [analysis.eventsAsc, cheapestClearedOnly]
  );

  const totalPages = Math.max(
    1,
    Math.ceil(visibleEventsDesc.length / PAGE_SIZE)
  );
  const safePage = Math.min(page, totalPages - 1);
  const pageEvents = visibleEventsDesc.slice(
    safePage * PAGE_SIZE,
    (safePage + 1) * PAGE_SIZE
  );

  const chartData = useMemo(
    () =>
      visibleEventsAsc.map((ev) => {
        const d = new Date(ev.ts);
        return {
          label:
            range === "24h"
              ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
              : d.toLocaleDateString([], {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                }),
          fullWindow: `${formatDateTime(ev.prevTs)} -> ${formatTimeOnly(ev.ts)}`,
          unitsExited: ev.unitsExited,
          estUnitCopper: ev.estimatedUnitCopper ?? 0,
        };
      }),
    [visibleEventsAsc, range]
  );

  return (
    <section className="overflow-hidden rounded-xl border border-zinc-800 bg-[#12161f]">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-800 px-4 py-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-amber-100">
              <ReceiptText className="h-4 w-4 text-amber-400" />
              Estimated Sales / Stock Exits ({marketLabel})
            </h2>
            <span className="rounded border border-amber-500/40 bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-300">
              ESTIMATED
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-zinc-400">
            Hourly intervals where listed quantity dropped between consecutive
            real Auction House snapshots ({analysis.summary.analyzedSnapshots}{" "}
            snapshots analyzed).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <label className="flex cursor-pointer items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] text-emerald-200">
            <input
              type="checkbox"
              checked={cheapestClearedOnly}
              onChange={(e) => {
                setCheapestClearedOnly(e.target.checked);
                setPage(0);
              }}
              className="accent-emerald-400"
            />
            <TrendingUp className="h-3 w-3" />
            <span>Cheapest Cleared Only</span>
          </label>

          <div className="flex items-center gap-1 rounded-md border border-zinc-800 bg-[#0d1016] p-0.5">
            {(["24h", "7d", "all"] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => {
                  setRange(r);
                  setPage(0);
                }}
                className={`rounded px-2 py-1 text-[11px] font-medium transition-colors ${
                  range === r
                    ? "bg-amber-500/20 text-amber-200"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {r === "all" ? "ALL" : r.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Transparency Banner */}
      <div className="flex items-start gap-2 border-b border-zinc-800/80 bg-[#0d1017] px-4 py-2 text-[11px] text-zinc-400">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400/80" />
        <span>
          Blizzard&apos;s API publishes hourly active listings only (no trade
          logs). Each row below is a real net stock decrease between consecutive
          hourly snapshots — it may represent{" "}
          <strong className="text-zinc-200">
            purchases, seller cancellations, or expirations
          </strong>
          . Events marked{" "}
          <span className="font-semibold text-emerald-300">
            Cheapest Cleared
          </span>{" "}
          also saw the minimum buyout price rise after stock dropped, a stronger
          buy-out signal.
        </span>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 gap-3 border-b border-zinc-800/80 p-4 sm:grid-cols-4">
        <div className="rounded-lg border border-zinc-800 bg-[#0e1118] p-3">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">
            Exit Events
          </div>
          <div className="mt-1 font-mono text-lg font-bold text-zinc-100">
            {analysis.summary.totalEvents.toLocaleString()}
          </div>
          <div className="text-[10px] text-emerald-400/90">
            {analysis.summary.cheapestClearedEvents} cheapest cleared
          </div>
        </div>

        <div className="rounded-lg border border-zinc-800 bg-[#0e1118] p-3">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">
            Est. Units Exited
          </div>
          <div className="mt-1 font-mono text-lg font-bold text-emerald-300">
            {analysis.summary.totalUnitsExited.toLocaleString()}
          </div>
          <div className="text-[10px] text-zinc-500">
            Across {analysis.summary.analyzedSpanHours}h span
          </div>
        </div>

        <div className="rounded-lg border border-zinc-800 bg-[#0e1118] p-3">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">
            Weighted Avg Unit (Est.)
          </div>
          <div className="mt-1 font-mono text-lg font-bold text-amber-300">
            {analysis.summary.weightedAvgUnitCopper !== null
              ? formatCopperFull(analysis.summary.weightedAvgUnitCopper)
              : "—"}
          </div>
          <div className="text-[10px] text-zinc-500">
            Based on prev-hour lowest buyout
          </div>
        </div>

        <div className="rounded-lg border border-zinc-800 bg-[#0e1118] p-3">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">
            Est. Gross Volume
          </div>
          <div className="mt-1 font-mono text-lg font-bold text-zinc-100">
            {analysis.summary.totalEstimatedVolumeCopper > 0
              ? formatCopperShort(analysis.summary.totalEstimatedVolumeCopper)
              : "—"}
          </div>
          <div className="text-[10px] text-zinc-500">
            Sum(units exited × prev min)
          </div>
        </div>
      </div>

      {/* Composed Chart: Units Exited (Bars) + Estimated Unit Price (Line) */}
      {chartData.length > 0 && (
        <div className="border-b border-zinc-800/80 p-4">
          <div className="mb-2 flex items-center justify-between text-[11px] text-zinc-400">
            <span>
              Estimated Units Exited (bars) &amp; Prev-Hour Lowest Price (gold
              line)
            </span>
            <span className="font-mono text-zinc-500">
              {chartData.length} exit windows plotted
            </span>
          </div>
          <div className="h-52 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e2330" />
                <XAxis
                  dataKey="label"
                  stroke="#71717a"
                  tick={{ fontSize: 10, fill: "#a1a1aa" }}
                />
                <YAxis
                  yAxisId="qty"
                  orientation="left"
                  stroke="#34d399"
                  tick={{ fontSize: 10, fill: "#6ee7b7" }}
                  width={44}
                />
                <YAxis
                  yAxisId="price"
                  orientation="right"
                  stroke="#d4a94b"
                  tick={{ fontSize: 10, fill: "#fcd34d" }}
                  tickFormatter={(v: number) => formatCopperShort(v)}
                  width={62}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#0e1117",
                    borderColor: "#3f3f46",
                    borderRadius: "8px",
                    fontSize: "12px",
                  }}
                  labelStyle={{ color: "#fbbf24" }}
                  labelFormatter={(_, payload) =>
                    payload?.[0]?.payload?.fullWindow ?? ""
                  }
                  formatter={(value, name) => {
                    const num =
                      typeof value === "number" ? value : Number(value ?? 0);
                    if (name === "unitsExited") {
                      return [num.toLocaleString(), "Est. Units Exited"];
                    }
                    return [formatCopperFull(num), "Prev-Hour Lowest Price"];
                  }}
                />
                <Bar
                  yAxisId="qty"
                  dataKey="unitsExited"
                  fill="#10b981"
                  fillOpacity={0.75}
                  radius={[2, 2, 0, 0]}
                  maxBarSize={28}
                />
                <Line
                  yAxisId="price"
                  type="monotone"
                  dataKey="estUnitCopper"
                  stroke="#fbbf24"
                  strokeWidth={2}
                  dot={{ r: 2.5, fill: "#fbbf24" }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Event Table */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-zinc-800 bg-[#0d1017] text-[10px] uppercase tracking-wider text-zinc-400">
              <th className="px-3 py-2.5">Date &amp; Time Window</th>
              <th className="px-3 py-2.5 text-right">Est. Units Exited</th>
              <th className="px-3 py-2.5 text-right">Supply (Prev → Now)</th>
              <th className="px-3 py-2.5 text-right">
                Est. Unit Price (Prev Min)
              </th>
              <th className="px-3 py-2.5 text-right">New Lowest</th>
              <th className="px-3 py-2.5 text-right">Prev Median</th>
              <th className="px-3 py-2.5 text-right">Est. Gross Value</th>
              <th className="px-3 py-2.5">Signal</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/70">
            {pageEvents.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-4 py-8 text-center text-zinc-500"
                >
                  {hourlyPoints.length < 2
                    ? "Not enough consecutive hourly snapshots yet to detect stock exits."
                    : "No hourly stock decreases detected in the selected time range."}
                </td>
              </tr>
            ) : (
              pageEvents.map((ev) => (
                <tr
                  key={`${ev.prevTs}-${ev.ts}`}
                  className="hover:bg-amber-500/[0.03]"
                >
                  <td className="px-3 py-2 font-mono text-[11px] text-zinc-200">
                    {formatDateTime(ev.prevTs)}{" "}
                    <span className="text-zinc-500">→</span>{" "}
                    {formatTimeOnly(ev.ts)}
                    {ev.windowHours > 1.2 && (
                      <span className="ml-1.5 text-[10px] text-zinc-500">
                        ({ev.windowHours}h)
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-bold text-emerald-300">
                    -{ev.unitsExited.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-zinc-400">
                    {ev.prevQty.toLocaleString()} →{" "}
                    <span className="text-zinc-200">
                      {ev.currQty.toLocaleString()}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-semibold text-amber-300">
                    {formatCopperFull(ev.estimatedUnitCopper)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-zinc-300">
                    {ev.currMinCopper !== null
                      ? formatCopperShort(ev.currMinCopper)
                      : "Unlisted"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-zinc-400">
                    {formatCopperShort(ev.prevMedianCopper)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-zinc-200">
                    {formatCopperShort(ev.estimatedGrossCopper)}
                  </td>
                  <td className="px-3 py-2">
                    {ev.cheapestCleared ? (
                      <span className="rounded border border-emerald-500/40 bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
                        Cheapest Cleared
                      </span>
                    ) : (
                      <span className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-400">
                        Stock Drop (Est.)
                      </span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {visibleEventsDesc.length > PAGE_SIZE && (
        <div className="flex items-center justify-between border-t border-zinc-800 px-4 py-2.5 text-[11px] text-zinc-400">
          <span>
            Showing {safePage * PAGE_SIZE + 1}–
            {Math.min((safePage + 1) * PAGE_SIZE, visibleEventsDesc.length)} of{" "}
            {visibleEventsDesc.length.toLocaleString()} estimated exit events
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={safePage <= 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="inline-flex items-center gap-1 rounded border border-zinc-800 bg-[#0d1016] px-2 py-1 text-zinc-300 disabled:opacity-40 hover:border-amber-500/40"
            >
              <ChevronLeft className="h-3 w-3" />
              Prev
            </button>
            <span className="font-mono">
              Page {safePage + 1} / {totalPages}
            </span>
            <button
              type="button"
              disabled={safePage + 1 >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="inline-flex items-center gap-1 rounded border border-zinc-800 bg-[#0d1016] px-2 py-1 text-zinc-300 disabled:opacity-40 hover:border-amber-500/40"
            >
              Next
              <ChevronRight className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
