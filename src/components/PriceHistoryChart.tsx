"use client";

import { useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatCopperFull, formatCopperShort } from "@/lib/wow-ui";

export interface HistoryChartPoint {
  ts: string;
  minCopper: number | null;
  p10Copper?: number | null;
  medianCopper: number | null;
  availableQty: number;
  estimatedCreatureEgphCopper?: number;
}

interface PriceHistoryChartProps {
  hourlyPoints?: HistoryChartPoint[];
  dailyPoints: HistoryChartPoint[];
  mode?: "item" | "profitability";
  title?: string;
}

export function PriceHistoryChart({
  hourlyPoints = [],
  dailyPoints,
  mode = "item",
  title,
}: PriceHistoryChartProps) {
  const [range, setRange] = useState<"24h" | "7d" | "30d">("7d");

  const now = Date.now();
  const selectedPoints = (() => {
    if (mode === "profitability") {
      return dailyPoints;
    }
    if (range === "24h" && hourlyPoints.length > 0) {
      const cutoff = now - 24 * 60 * 60 * 1000;
      const filtered = hourlyPoints.filter((p) => Date.parse(p.ts) >= cutoff);
      return filtered.length > 0 ? filtered : hourlyPoints.slice(-24);
    }
    if (range === "7d") {
      const source = hourlyPoints.length > 0 ? hourlyPoints : dailyPoints;
      const cutoff = now - 7 * 24 * 60 * 60 * 1000;
      const filtered = source.filter((p) => Date.parse(p.ts) >= cutoff);
      return filtered.length > 0 ? filtered : source.slice(-14);
    }
    const cutoff = now - 30 * 24 * 60 * 60 * 1000;
    const filtered = dailyPoints.filter((p) => Date.parse(p.ts) >= cutoff);
    return filtered.length > 0 ? filtered : dailyPoints;
  })();

  const chartData = selectedPoints.map((pt) => {
    const d = new Date(pt.ts);
    const label =
      range === "24h"
        ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        : d.toLocaleDateString([], { month: "short", day: "numeric" });
    return {
      label,
      fullTs: d.toLocaleString(),
      median: pt.medianCopper ?? pt.minCopper ?? 0,
      lowest: pt.minCopper ?? 0,
      supply: pt.availableQty,
      egph: pt.estimatedCreatureEgphCopper ?? 0,
    };
  });

  if (chartData.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-[#12161f] p-5 text-center">
        <p className="text-sm font-medium text-zinc-300">
          {title ?? "Historical Price & Supply"}
        </p>
        <p className="mt-1 text-xs text-zinc-500">
          No verified historical snapshots are available for this selection yet.
          Historical data is never fabricated.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-[#12161f] p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-amber-100">
            {title ??
              (mode === "profitability"
                ? "Historical Profitability Trend (Real Market Snapshots)"
                : "Price & Supply History")}
          </h3>
          <p className="text-[11px] text-zinc-500">
            {chartData.length} real snapshots · Actual Auction House history
          </p>
        </div>

        {mode === "item" && (
          <div className="flex items-center gap-1 rounded-md border border-zinc-800 bg-[#0d1016] p-0.5 text-xs">
            {(["24h", "7d", "30d"] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
                className={`rounded px-2.5 py-1 font-medium transition-colors ${
                  range === r
                    ? "bg-amber-500/20 text-amber-200"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {r.toUpperCase()}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="h-60 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="goldFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#d4a94b" stopOpacity={0.35} />
                <stop offset="95%" stopColor="#d4a94b" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#222735" />
            <XAxis
              dataKey="label"
              stroke="#71717a"
              tick={{ fontSize: 11, fill: "#a1a1aa" }}
            />
            <YAxis
              stroke="#71717a"
              tick={{ fontSize: 11, fill: "#a1a1aa" }}
              tickFormatter={(v: number) => formatCopperShort(v)}
              width={64}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#0e1117",
                borderColor: "#3f3f46",
                borderRadius: "8px",
                fontSize: "12px",
              }}
              labelStyle={{ color: "#fbbf24" }}
              formatter={(value, name) => [
                formatCopperFull(typeof value === "number" ? value : Number(value ?? 0)),
                name === "egph"
                  ? "Est. Gross EGPH"
                  : name === "median"
                    ? "Median Price"
                    : "Lowest Buyout",
              ]}
            />
            {mode === "profitability" ? (
              <Area
                type="monotone"
                dataKey="egph"
                stroke="#d4a94b"
                strokeWidth={2}
                fill="url(#goldFill)"
              />
            ) : (
              <>
                <Area
                  type="monotone"
                  dataKey="median"
                  stroke="#d4a94b"
                  strokeWidth={2}
                  fill="url(#goldFill)"
                />
                <Area
                  type="monotone"
                  dataKey="lowest"
                  stroke="#38bdf8"
                  strokeWidth={1.5}
                  fillOpacity={0}
                />
              </>
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {mode === "item" && (
        <div className="mt-4 border-t border-zinc-800/80 pt-3">
          <div className="mb-1 text-[11px] font-medium text-zinc-400">
            Historical Available Supply (Units Listed)
          </div>
          <div className="h-28 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e2330" />
                <XAxis
                  dataKey="label"
                  stroke="#71717a"
                  tick={{ fontSize: 10, fill: "#71717a" }}
                />
                <YAxis
                  stroke="#71717a"
                  tick={{ fontSize: 10, fill: "#71717a" }}
                  width={54}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#0e1117",
                    borderColor: "#3f3f46",
                    borderRadius: "8px",
                    fontSize: "12px",
                  }}
                  formatter={(value) => [
                    Number(value ?? 0).toLocaleString(),
                    "Units Listed",
                  ]}
                />
                <Bar dataKey="supply" fill="#6366f1" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
