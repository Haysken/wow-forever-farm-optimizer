"use client";

import Link from "next/link";
import { useState } from "react";
import { CheckCircle2, FileCode2, FolderDown, Upload } from "lucide-react";

interface ImportSummary {
  clientBuild: string | null;
  region: string | null;
  creaturesParsed: number;
  observationsSaved: number;
  spawnsSaved: number;
  itemsHydrated: number;
  creatures: Array<{
    npcId: number;
    name: string;
    kills: number;
    measuredKillsPerHour: number | null;
    dropsRecorded: number;
  }>;
}

export function ImportAddonClient() {
  const [region, setRegion] = useState("us");
  const [luaText, setLuaText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  const handleFilePick = async (file: File | null) => {
    if (!file) return;
    setFileName(file.name);
    setError(null);
    const text = await file.text();
    setLuaText(text);
  };

  const handleUpload = async () => {
    if (!luaText.trim()) return;
    setSubmitting(true);
    setError(null);
    setSummary(null);
    try {
      const res = await fetch("/api/v1/import/savedvariables", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          luaContent: luaText,
          marketId: `${region}:0`,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Import failed");
      setSummary(json.summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <header className="rounded-xl border border-amber-500/20 bg-[#12161f] p-5">
        <h1 className="flex items-center gap-2 text-xl font-bold text-amber-100">
          <Upload className="h-5 w-5 text-amber-400" />
          Import In-Game Addon Data (SavedVariables)
        </h1>
        <p className="mt-1 text-xs text-zinc-400">
          Upload your <code>WoWForeverFarmOptimizer.lua</code> file to import
          real WoW Forever creature kills, brand-new <code>250xxx</code> item
          drops, exact drop quantities, spawns, and measured kills/hour.
          Imported drops are tagged transparently as{" "}
          <strong className="text-sky-300">OBSERVED (addon_import)</strong> and
          immediately paired with live AH prices across all regional houses.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Upload Form */}
        <section className="space-y-4 rounded-xl border border-zinc-800 bg-[#12161f] p-5 lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-amber-100">
              <FileCode2 className="h-4 w-4 text-amber-400" />
              Select SavedVariables File
            </h2>
            <select
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              className="rounded border border-zinc-700 bg-[#0d1016] px-2.5 py-1 text-xs text-zinc-100"
            >
              <option value="us">Hydrate AH Prices: US</option>
              <option value="eu">Hydrate AH Prices: EU</option>
            </select>
          </div>

          <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-amber-500/35 bg-[#0d1016] px-4 py-8 text-center transition-colors hover:border-amber-400/60">
            <Upload className="h-6 w-6 text-amber-400" />
            <span className="mt-2 text-xs font-medium text-zinc-200">
              {fileName
                ? `Loaded: ${fileName} (${luaText.length.toLocaleString()} bytes)`
                : "Click to select SavedVariables/WoWForeverFarmOptimizer.lua"}
            </span>
            <span className="mt-1 text-[11px] text-zinc-500">
              Parsed safely in TypeScript without code execution (max 10 MB)
            </span>
            <input
              type="file"
              accept=".lua,.txt"
              className="hidden"
              onChange={(e) => void handleFilePick(e.target.files?.[0] ?? null)}
            />
          </label>

          <div>
            <label className="mb-1 block text-[11px] text-zinc-400">
              Or paste raw <code>WoWForeverFarmOptimizerDB = &#123; ... &#125;</code>{" "}
              contents directly:
            </label>
            <textarea
              rows={7}
              value={luaText}
              onChange={(e) => setLuaText(e.target.value)}
              placeholder='WoWForeverFarmOptimizerDB = { ["schemaVersion"] = 1, ["creatures"] = { ... } }'
              className="w-full rounded border border-zinc-800 bg-[#0d1016] p-2.5 font-mono text-xs text-zinc-200 placeholder:text-zinc-600"
            />
          </div>

          <div className="flex items-center justify-end">
            <button
              type="button"
              disabled={!luaText.trim() || submitting}
              onClick={handleUpload}
              className="inline-flex items-center gap-2 rounded border border-amber-500/50 bg-amber-500/20 px-4 py-2 text-xs font-semibold text-amber-100 hover:bg-amber-500/30 disabled:opacity-40"
            >
              <Upload className="h-3.5 w-3.5" />
              {submitting ? "Importing & Hydrating AH Prices..." : "Import Observed Drops"}
            </button>
          </div>

          {error && (
            <div className="rounded border border-red-500/40 bg-red-950/30 p-3 text-xs text-red-200">
              {error}
            </div>
          )}

          {summary && (
            <div className="space-y-3 rounded-lg border border-emerald-500/35 bg-emerald-950/20 p-4 text-xs">
              <div className="flex items-center gap-2 font-semibold text-emerald-300">
                <CheckCircle2 className="h-4 w-4" />
                <span>
                  Imported {summary.creaturesParsed} creatures,{" "}
                  {summary.observationsSaved} resolved loot entries,{" "}
                  {summary.spawnsSaved} spawns, and hydrated live AH prices for{" "}
                  {summary.itemsHydrated} items.
                </span>
              </div>

              {summary.creatures.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  {summary.creatures.map((c) => (
                    <div
                      key={c.npcId}
                      className="flex flex-wrap items-center justify-between gap-2 rounded border border-zinc-800 bg-[#0d1016] px-3 py-1.5"
                    >
                      <Link
                        href={`/creatures/${c.npcId}?marketId=${encodeURIComponent(`${region}:0`)}`}
                        className="font-semibold text-amber-200 hover:underline"
                      >
                        {c.name} (#{c.npcId})
                      </Link>
                      <span className="font-mono text-[11px] text-zinc-400">
                        {c.kills} kills · {c.dropsRecorded} drop types
                        {c.measuredKillsPerHour
                          ? ` · Measured ${c.measuredKillsPerHour} KPH`
                          : ""}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        {/* Addon Setup Guide */}
        <aside className="space-y-4 rounded-xl border border-zinc-800 bg-[#12161f] p-5 text-xs text-zinc-300">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-amber-100">
            <FolderDown className="h-4 w-4 text-amber-400" />
            In-Game Addon Setup
          </h2>
          <ol className="list-decimal space-y-2.5 pl-4 text-zinc-400">
            <li>
              Copy{" "}
              <code className="text-amber-200">
                addon/WoWForeverFarmOptimizer
              </code>{" "}
              into your WoW Forever folder:{" "}
              <code className="block mt-1 rounded bg-[#0d1016] p-1.5 text-[11px] text-zinc-300">
                _forever_/Interface/AddOns/WoWForeverFarmOptimizer/
              </code>
            </li>
            <li>
              Play normally. The addon passively records kills, empty corpses,
              new <code>250xxx</code> item drops, stack quantities, spawns, and
              kills/hour. Use <code>/wffo</code> in chat to check stats or{" "}
              <code>/wffo start</code> / <code>/wffo stop</code> for timed
              sessions.
            </li>
            <li>
              Type <code>/reload</code> (or log out) and upload:
              <code className="block mt-1 rounded bg-[#0d1016] p-1.5 text-[11px] text-zinc-300">
                _forever_/WTF/Account/&lt;ACCOUNT&gt;/SavedVariables/WoWForeverFarmOptimizer.lua
              </code>
            </li>
            <li>
              <strong>Optional auto-sync:</strong> set{" "}
              <code>WOW_SAVEDVARS_PATH</code> in <code>.env.local</code> and run{" "}
              <code>npm run watch:addon</code>.
            </li>
          </ol>
          <p className="rounded border border-zinc-800 bg-[#0d1016] p-2.5 text-[11px] text-zinc-500">
            100% Blizzard ToS compliant: read-only event listeners, no AH
            automation, no memory reading.
          </p>
        </aside>
      </div>
    </div>
  );
}
