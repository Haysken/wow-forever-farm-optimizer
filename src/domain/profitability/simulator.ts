import { calculateCreatureProfitability } from "./engine";
import type {
  CreatureProfitInput,
  ItemContribution,
  ProfitabilityParams,
} from "./types";

export interface SimulationOptions {
  /** Farming session duration in hours (must be > 0). */
  durationHours: number;
  /** Number of Monte Carlo runs for percentile distribution (default 500, max 5000). */
  iterations?: number;
  /** Optional integer seed for deterministic/reproducible simulations. */
  seed?: number;
}

export interface SimulatedItemLoot {
  itemId: number;
  itemName: string;
  quality: number;
  dropsCount: number;
  totalUnits: number;
  realizedCopper: number;
}

export interface FarmingSimulationResult {
  /** Pure mathematical expected value — NOT a simulated roll. */
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
  /** Single concrete random session outcome (clearly distinct from EV). */
  sampleRun: {
    kills: number;
    rawCoinCopper: number;
    grossLootCopper: number;
    netProfitCopper: number;
    loot: SimulatedItemLoot[];
  };
  /** Empirical distribution across Monte Carlo trials. */
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
}

/** Deterministic fast PRNG (Mulberry32). */
function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function drawBinomial(n: number, p: number, rng: () => number): number {
  if (n <= 0 || p <= 0) return 0;
  if (p >= 1) return n;

  // Exact Bernoulli sum for moderate n, normal approximation for very large n
  if (n <= 1000) {
    let hits = 0;
    for (let i = 0; i < n; i++) {
      if (rng() < p) hits++;
    }
    return hits;
  }

  const mean = n * p;
  const std = Math.sqrt(n * p * (1 - p));
  const u1 = Math.max(1e-12, rng());
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.min(n, Math.max(0, Math.round(mean + z * std)));
}

function simulateSingleRun(
  kills: number,
  rawCoinMin: number,
  rawCoinMax: number,
  items: ItemContribution[],
  itemQtyBounds: Map<number, { minQty: number; maxQty: number }>,
  expensesCopper: number,
  rng: () => number
): FarmingSimulationResult["sampleRun"] {
  let rawCoinCopper = 0;
  if (rawCoinMax > 0) {
    const span = Math.max(0, rawCoinMax - rawCoinMin);
    if (kills <= 1000) {
      for (let k = 0; k < kills; k++) {
        rawCoinCopper += rawCoinMin + Math.floor(rng() * (span + 1));
      }
    } else {
      rawCoinCopper = Math.round(kills * ((rawCoinMin + rawCoinMax) / 2));
    }
  }

  let grossLootCopper = rawCoinCopper;
  const loot: SimulatedItemLoot[] = [];

  for (const item of items) {
    if (item.liquidationChannel === "none" || item.dropRate <= 0) continue;

    const dropsCount = drawBinomial(kills, item.dropRate, rng);
    if (dropsCount === 0) continue;

    const bounds = itemQtyBounds.get(item.itemId) ?? {
      minQty: 1,
      maxQty: Math.max(1, Math.round(item.avgQty)),
    };

    let totalUnits = 0;
    if (bounds.minQty === bounds.maxQty) {
      totalUnits = dropsCount * bounds.minQty;
    } else if (dropsCount <= 500) {
      const span = bounds.maxQty - bounds.minQty;
      for (let d = 0; d < dropsCount; d++) {
        totalUnits += bounds.minQty + Math.floor(rng() * (span + 1));
      }
    } else {
      totalUnits = Math.round(dropsCount * item.avgQty);
    }

    const netUnitCopper =
      item.liquidationChannel === "auction_house"
        ? item.unitGrossCopper * (1 - item.effectiveCommissionRate)
        : item.unitGrossCopper;

    // Simulate whether AH units sell within horizon if Si is known
    let soldUnits = totalUnits;
    if (
      item.liquidationChannel === "auction_house" &&
      item.liquidity.sellingProbability !== null
    ) {
      soldUnits = drawBinomial(totalUnits, item.liquidity.sellingProbability, rng);
    }

    const realizedCopper = Math.round(soldUnits * netUnitCopper);
    grossLootCopper += realizedCopper;

    loot.push({
      itemId: item.itemId,
      itemName: item.itemName,
      quality: item.quality,
      dropsCount,
      totalUnits,
      realizedCopper,
    });
  }

  loot.sort((a, b) => b.realizedCopper - a.realizedCopper);

  return {
    kills,
    rawCoinCopper,
    grossLootCopper,
    netProfitCopper: Math.round(grossLootCopper - expensesCopper),
    loot,
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor(p * (sorted.length - 1)))
  );
  return sorted[idx] ?? 0;
}

/**
 * Simulates a farming session while strictly separating analytical Expected Value
 * from random Monte Carlo session outcomes.
 */
export function simulateFarmingSession(
  input: CreatureProfitInput,
  params: ProfitabilityParams,
  options: SimulationOptions
): FarmingSimulationResult {
  if (!Number.isFinite(options.durationHours) || options.durationHours <= 0) {
    throw new Error(
      `durationHours must be a positive finite number, received ${options.durationHours}`
    );
  }

  const iterations = Math.min(
    5000,
    Math.max(1, Math.round(options.iterations ?? 500))
  );
  const seed = options.seed ?? Date.now();
  const rng = createRng(seed);

  const ev = calculateCreatureProfitability(input, params);
  const expectedKills = Math.max(
    1,
    Math.round(params.killsPerHour * options.durationHours)
  );
  const totalExpensesCopper = Math.round(
    ev.appliedParams.hourlyExpensesCopper * options.durationHours
  );

  const itemQtyBounds = new Map<number, { minQty: number; maxQty: number }>();
  for (const l of input.loot) {
    itemQtyBounds.set(l.itemId, {
      minQty: Math.max(1, l.minQty),
      maxQty: Math.max(1, l.maxQty),
    });
  }

  const rawCoinMin = Math.max(0, input.rawCoinMinCopper ?? 0);
  const rawCoinMax = Math.max(rawCoinMin, input.rawCoinMaxCopper ?? rawCoinMin);

  const sampleRun = simulateSingleRun(
    expectedKills,
    rawCoinMin,
    rawCoinMax,
    ev.items,
    itemQtyBounds,
    totalExpensesCopper,
    rng
  );

  const netOutcomes: number[] = [sampleRun.netProfitCopper];
  for (let i = 1; i < iterations; i++) {
    const run = simulateSingleRun(
      expectedKills,
      rawCoinMin,
      rawCoinMax,
      ev.items,
      itemQtyBounds,
      totalExpensesCopper,
      rng
    );
    netOutcomes.push(run.netProfitCopper);
  }

  netOutcomes.sort((a, b) => a - b);
  const sum = netOutcomes.reduce((acc, v) => acc + v, 0);
  const profitableCount = netOutcomes.filter((v) => v > 0).length;

  return {
    analytical: {
      expectedKills,
      expectedRawCoinCopper: Math.round(ev.rawCoinPerKillCopper * expectedKills),
      expectedGrossEvCopper: Math.round(
        ev.egphGrossEvCopper * options.durationHours
      ),
      expectedLiquidityAdjustedCopper: Math.round(
        ev.egphLiquidityAdjustedCopper * options.durationHours
      ),
      totalExpensesCopper,
      expectedLoot: ev.items
        .filter((item) => item.expectedGrossEvPerKillCopper > 0)
        .map((item) => ({
          itemId: item.itemId,
          itemName: item.itemName,
          expectedDrops: Number((item.dropRate * expectedKills).toFixed(3)),
          expectedUnits: Number(
            (item.dropRate * item.avgQty * expectedKills).toFixed(3)
          ),
          expectedGrossCopper: Math.round(
            item.expectedGrossEvPerKillCopper * expectedKills
          ),
          expectedLiquidityAdjustedCopper: Math.round(
            item.expectedLiquidityAdjustedPerKillCopper * expectedKills
          ),
        })),
    },
    sampleRun,
    distribution: {
      iterations,
      meanNetCopper: Math.round(sum / netOutcomes.length),
      p10NetCopper: percentile(netOutcomes, 0.1),
      p50NetCopper: percentile(netOutcomes, 0.5),
      p90NetCopper: percentile(netOutcomes, 0.9),
      minNetCopper: netOutcomes[0] ?? 0,
      maxNetCopper: netOutcomes[netOutcomes.length - 1] ?? 0,
      profitableRunPct: Number(
        ((profitableCount / netOutcomes.length) * 100).toFixed(2)
      ),
    },
  };
}
