import { TICK_SPACING } from "./addresses";

/** tUSDC per tWETH in base units differs from USD by the decimals gap, 10^12. */
const DECIMALS_GAP = 1e12;
const TICK_BASE = 1.0001;

export type Strategy = 0 | 1 | 2;
export const STRATEGY_NAMES = ["Spot", "Curve", "Bid-Ask"] as const;

export function tickToUsd(tick: number, wethIsToken0: boolean): number {
  const raw = TICK_BASE ** tick;
  return wethIsToken0 ? raw * DECIMALS_GAP : DECIMALS_GAP / raw;
}

export function usdToTick(usd: number, wethIsToken0: boolean): number {
  const raw = wethIsToken0 ? usd / DECIMALS_GAP : DECIMALS_GAP / usd;
  return Math.round(Math.log(raw) / Math.log(TICK_BASE));
}

export function binOf(tick: number): number {
  return Math.floor(tick / TICK_SPACING);
}

export function binToUsd(bin: number, wethIsToken0: boolean): number {
  return tickToUsd(bin * TICK_SPACING, wethIsToken0);
}

/** Mirrors StrategyLib.weights in the contracts. */
export function strategyWeights(strategy: Strategy, n: number): number[] {
  return Array.from({ length: n }, (_, i) => {
    const d = Math.abs(2 * i - (n - 1));
    if (strategy === 0) return 1;
    return strategy === 1 ? n - d : d + 1;
  });
}

export type ShapeBin = { bin: number; weight: number; holds: "weth" | "usdc" | "both" };

export function previewShape(
  strategy: Strategy,
  lowerBin: number,
  n: number,
  activeBin: number,
  wethIsToken0: boolean,
): ShapeBin[] {
  const [above, below]: ShapeBin["holds"][] = wethIsToken0 ? ["weth", "usdc"] : ["usdc", "weth"];
  return strategyWeights(strategy, n).map((weight, i) => {
    const bin = lowerBin + i;
    const holds = bin === activeBin ? "both" : bin > activeBin ? above : below;
    return { bin, weight, holds };
  });
}

/** The automation workflow's minDistanceBins: smaller moves are not worth the gas. */
const MIN_REBALANCE_BINS = 2;

export type RangeState = "earning" | "pending" | "waiting";

export function rangeState(p: {
  inRange: boolean;
  autoRebalance: boolean;
  lowerBin: number;
  successorLowerBin: number;
}): RangeState {
  if (p.inRange) return "earning";
  const worthMoving = Math.abs(p.successorLowerBin - p.lowerBin) >= MIN_REBALANCE_BINS;
  return p.autoRebalance && worthMoving ? "pending" : "waiting";
}
