/**
 * Decides which allowed actions are worth taking. Pure, so it can be tested
 * without a chain or a network.
 *
 * The contracts still enforce every safety rule. This only decides what is worth
 * paying gas for, and refuses to act on a pool whose price disagrees with the
 * market.
 */

export const ActionKind = { Compound: 0, Rebalance: 1 } as const;

export type Action = { kind: number; positionId: bigint };

export type Rules = {
  wethIsToken0: boolean;
  token0Decimals: number;
  token1Decimals: number;
  maxPriceDeviationBps: number;
  minCompoundUsd: number;
  minDistanceBins: number;
  maxTickDrift: number;
  maxActions: number;
};

export type PositionView = {
  positionId: bigint;
  lowerBin: number;
  numBins: number;
  autoCompound: boolean;
  autoRebalance: boolean;
  inRange: boolean;
  successorLowerBin: number;
  liveTick: number;
  stableTick: number;
  pending0: bigint;
  pending1: bigint;
  idle0: bigint;
  idle1: bigint;
  nextRebalanceAt: bigint;
};

export type Skipped = { positionId: bigint; reason: string };

export type Decision = {
  poolPriceUsd: number | null;
  deviationBps: number | null;
  actions: Action[];
  skipped: Skipped[];
};

const TICK_BASE = 1.0001;

/** Pool price of one WETH in USDC, from a tick and the two tokens' decimals. */
export function poolEthPriceUsd(tick: number, rules: Rules): number {
  const token1PerToken0 = TICK_BASE ** tick * 10 ** (rules.token0Decimals - rules.token1Decimals);
  return rules.wethIsToken0 ? token1PerToken0 : 1 / token1PerToken0;
}

function amountUsd(amount0: bigint, amount1: bigint, ethUsd: number, rules: Rules): number {
  const human0 = Number(amount0) / 10 ** rules.token0Decimals;
  const human1 = Number(amount1) / 10 ** rules.token1Decimals;
  return rules.wethIsToken0 ? human0 * ethUsd + human1 : human0 + human1 * ethUsd;
}

function deviationBps(poolPrice: number, marketPrice: number): number {
  return (Math.abs(poolPrice - marketPrice) / marketPrice) * 10_000;
}

type Candidate = Action & { priority: number; valueUsd: number };

function rebalanceSkipReason(p: PositionView, nowSeconds: number, rules: Rules): string | null {
  if (BigInt(nowSeconds) < p.nextRebalanceAt) return "cooldown";
  if (Math.abs(p.liveTick - p.stableTick) > rules.maxTickDrift) return "price still settling";
  if (Math.abs(p.successorLowerBin - p.lowerBin) < rules.minDistanceBins) return "too little distance gained";
  return null;
}

export function decide(
  positions: readonly PositionView[],
  marketEthUsd: number,
  nowSeconds: number,
  rules: Rules,
): Decision {
  if (!Number.isFinite(marketEthUsd) || marketEthUsd <= 0) throw new Error("invalid market price");

  const candidates: Candidate[] = [];
  const skipped: Skipped[] = [];
  let poolPriceUsd: number | null = null;
  let deviation: number | null = null;

  for (const p of positions) {
    const skip = (reason: string) => skipped.push({ positionId: p.positionId, reason });

    poolPriceUsd = poolEthPriceUsd(p.liveTick, rules);
    deviation = deviationBps(poolPriceUsd, marketEthUsd);
    if (deviation > rules.maxPriceDeviationBps) {
      skip("pool disagrees with market");
      continue;
    }

    if (!p.inRange) {
      if (!p.autoRebalance) {
        skip("rebalance not enabled");
        continue;
      }
      const reason = rebalanceSkipReason(p, nowSeconds, rules);
      if (reason) skip(reason);
      else candidates.push({ kind: ActionKind.Rebalance, positionId: p.positionId, priority: 1, valueUsd: 0 });
      continue;
    }

    if (!p.autoCompound) {
      skip("compound not enabled");
      continue;
    }
    const valueUsd = amountUsd(p.pending0 + p.idle0, p.pending1 + p.idle1, marketEthUsd, rules);
    if (valueUsd < rules.minCompoundUsd) skip("fees below threshold");
    else candidates.push({ kind: ActionKind.Compound, positionId: p.positionId, priority: 0, valueUsd });
  }

  candidates.sort((a, b) => b.priority - a.priority || b.valueUsd - a.valueUsd);
  for (const c of candidates.slice(rules.maxActions)) {
    skipped.push({ positionId: c.positionId, reason: "batch full" });
  }

  return {
    poolPriceUsd,
    deviationBps: deviation,
    actions: candidates.slice(0, rules.maxActions).map(({ kind, positionId }) => ({ kind, positionId })),
    skipped,
  };
}
