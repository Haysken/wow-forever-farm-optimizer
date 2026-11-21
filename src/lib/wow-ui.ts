import type { ConfidenceTier, DataStatus, MarketFaction } from "@/providers/types";

export const WOW_RARITY_META: Record<
  number,
  { name: string; textClass: string; borderClass: string; hex: string }
> = {
  0: {
    name: "Poor",
    textClass: "text-[#9d9d9d]",
    borderClass: "border-[#9d9d9d]/40",
    hex: "#9d9d9d",
  },
  1: {
    name: "Common",
    textClass: "text-zinc-100",
    borderClass: "border-zinc-500/40",
    hex: "#ffffff",
  },
  2: {
    name: "Uncommon",
    textClass: "text-[#1eff00]",
    borderClass: "border-[#1eff00]/40",
    hex: "#1eff00",
  },
  3: {
    name: "Rare",
    textClass: "text-[#3b9eff]",
    borderClass: "border-[#0070dd]/50",
    hex: "#0070dd",
  },
  4: {
    name: "Epic",
    textClass: "text-[#c06aff]",
    borderClass: "border-[#a335ee]/50",
    hex: "#a335ee",
  },
  5: {
    name: "Legendary",
    textClass: "text-[#ff9929]",
    borderClass: "border-[#ff8000]/50",
    hex: "#ff8000",
  },
};

export function getRarityMeta(quality: number) {
  return (
    WOW_RARITY_META[quality] ?? {
      name: "Common",
      textClass: "text-zinc-100",
      borderClass: "border-zinc-700",
      hex: "#ffffff",
    }
  );
}

export const CONFIDENCE_BADGE: Record<
  ConfidenceTier,
  { label: string; short: string; className: string; tooltip: string }
> = {
  VERIFIED: {
    label: "Verified Forever",
    short: "VERIFIED",
    className:
      "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
    tooltip: "Confirmed by >=3 independent WoW Forever players with >=30 kills",
  },
  OBSERVED: {
    label: "Observed Forever",
    short: "OBSERVED",
    className: "border-sky-500/40 bg-sky-500/15 text-sky-300",
    tooltip: "Observed in WoW Forever; smaller sample or fewer reporters",
  },
  ESTIMATED: {
    label: "Classic 1.12 Est.",
    short: "ESTIMATED",
    className: "border-amber-500/40 bg-amber-500/15 text-amber-300",
    tooltip: "Fallback estimate from Classic 1.12 (CMaNGOS); not yet verified in Forever",
  },
  UNKNOWN: {
    label: "Unknown",
    short: "UNKNOWN",
    className: "border-zinc-600/50 bg-zinc-800/60 text-zinc-400",
    tooltip: "No reliable drop probability available",
  },
};

export const DATA_STATUS_LABEL: Record<DataStatus, string> = {
  ACTUAL: "Actual",
  CALCULATED: "Calculated",
  ESTIMATED: "Estimated",
  MISSING: "Unavailable",
};

export function formatGoldParts(copper: number | null | undefined): {
  sign: string;
  gold: number;
  silver: number;
  copper: number;
} | null {
  if (copper === null || copper === undefined || !Number.isFinite(copper)) {
    return null;
  }
  const sign = copper < 0 ? "-" : "";
  const abs = Math.round(Math.abs(copper));
  return {
    sign,
    gold: Math.floor(abs / 10_000),
    silver: Math.floor((abs % 10_000) / 100),
    copper: abs % 100,
  };
}

export function formatCopperShort(copper: number | null | undefined): string {
  const p = formatGoldParts(copper);
  if (!p) return "—";
  if (p.gold > 0) return `${p.sign}${p.gold}g ${p.silver}s`;
  if (p.silver > 0) return `${p.sign}${p.silver}s ${p.copper}c`;
  return `${p.sign}${p.copper}c`;
}

export function formatCopperFull(copper: number | null | undefined): string {
  const p = formatGoldParts(copper);
  if (!p) return "—";
  if (p.gold > 0) return `${p.sign}${p.gold}g ${p.silver}s ${p.copper}c`;
  if (p.silver > 0) return `${p.sign}${p.silver}s ${p.copper}c`;
  return `${p.sign}${p.copper}c`;
}

export function formatPercent(ratio: number | null | undefined, digits = 2): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return "—";
  return `${(ratio * 100).toFixed(digits)}%`;
}

export function formatRelativeAge(isoDate: string | null | undefined): string {
  if (!isoDate) return "Unknown age";
  const ms = Date.now() - Date.parse(isoDate);
  if (Number.isNaN(ms)) return "Unknown age";
  const mins = Math.max(0, Math.floor(ms / 60_000));
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function factionBadgeClass(faction: MarketFaction): string {
  switch (faction) {
    case "alliance":
      return "border-blue-500/40 bg-blue-500/15 text-blue-300";
    case "horde":
      return "border-red-500/40 bg-red-500/15 text-red-300";
    case "neutral":
      return "border-amber-500/40 bg-amber-500/15 text-amber-300";
    default:
      return "border-zinc-600/40 bg-zinc-700/30 text-zinc-300";
  }
}
