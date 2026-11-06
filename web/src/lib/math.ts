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

/** Token amounts behind bin liquidity, using the standard v4 range formulas. */
export function poolLiquidity(bins: { bin: number; liquidity: bigint }[], tick: number, wethIsToken0: boolean) {
  const sqrtAt = (t: number) => TICK_BASE ** (t / 2);
  const now = sqrtAt(tick);
  let raw0 = 0;
  let raw1 = 0;
  for (const { bin, liquidity } of bins) {
    const lower = sqrtAt(bin * TICK_SPACING);
    const upper = sqrtAt((bin + 1) * TICK_SPACING);
    const inner = Math.min(Math.max(now, lower), upper);
    raw0 += Number(liquidity) * (1 / inner - 1 / upper);
    raw1 += Number(liquidity) * (inner - lower);
  }
  return wethIsToken0 ? { weth: raw0 / 1e18, usdc: raw1 / 1e6 } : { weth: raw1 / 1e18, usdc: raw0 / 1e6 };
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

/** Soft outline of each strategy, for decoration only. Bars always use strategyWeights. */
export function shapeCurve(strategy: Strategy, u: number): number {
  const d = (2 * u - 1) ** 2;
  if (strategy === 0) return 1;
  return strategy === 1 ? 1 - d : d;
}

const LIQUIDITY_UNIT = 10n ** 18n;

/** Token amounts one unit of k would cost, as in BinDistribution's cost0 and cost1. */
export function depositSplit(strategy: Strategy, lowerBin: number, n: number, tick: number, wethIsToken0: boolean) {
  const bins = strategyWeights(strategy, n).map((weight, i) => ({
    bin: lowerBin + i,
    liquidity: BigInt(weight) * LIQUIDITY_UNIT,
  }));
  return poolLiquidity(bins, tick, wethIsToken0);
}

/** Share of the last day's fees this deposit would have taken while the price sat in activeBin. */
export function estimateEarnings(p: {
  strategy: Strategy;
  lowerBin: number;
  numBins: number;
  tick: number;
  activeBin: number;
  usdPrice: number;
  wethIsToken0: boolean;
  depositUsd: number;
  bins: { bin: number; liquidity: bigint }[];
  fees24h: number;
}) {
  const index = p.activeBin - p.lowerBin;
  if (p.depositUsd <= 0 || index < 0 || index >= p.numBins) return { perDay: 0, apr: 0 };
  const unit = depositSplit(p.strategy, p.lowerBin, p.numBins, p.tick, p.wethIsToken0);
  const k = p.depositUsd / (unit.weth * p.usdPrice + unit.usdc);
  const mine = k * strategyWeights(p.strategy, p.numBins)[index] * Number(LIQUIDITY_UNIT);
  const existing = Number(p.bins.find((b) => b.bin === p.activeBin)?.liquidity ?? 0n);
  const perDay = (p.fees24h * mine) / (mine + existing);
  return { perDay, apr: (perDay * 365 * 100) / p.depositUsd };
}

/** Mirrors BinStepManager.successorLowerBin. */
export function successorBin(lowerBin: number, n: number, activeBin: number): number | null {
  if (activeBin >= lowerBin + n) return activeBin - n;
  return activeBin < lowerBin ? activeBin + 1 : null;
}

/** How much deeper this range is than the same capital spread across all prices. */
export function capitalEfficiency(n: number): number {
  return 1 / (1 - TICK_BASE ** ((-n * TICK_SPACING) / 4));
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
