export * from "./types";
export * from "./probabilities";
export * from "./liquidity";
export * from "./engine";
export * from "./simulator";

export function formatCopper(copper: number): string {
  const sign = copper < 0 ? "-" : "";
  const abs = Math.round(Math.abs(copper));
  const gold = Math.floor(abs / 10_000);
  const silver = Math.floor((abs % 10_000) / 100);
  const remCopper = abs % 100;

  if (gold > 0) {
    return `${sign}${gold}g ${silver}s ${remCopper}c`;
  }
  if (silver > 0) {
    return `${sign}${silver}s ${remCopper}c`;
  }
  return `${sign}${remCopper}c`;
}
