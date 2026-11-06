/**
 * Decides which allowed actions are worth taking. Pure, so it can be tested
 * without a chain or a network.
 *
 * The contracts still enforce every safety rule. This only decides what is worth
 * paying gas for, and refuses to act on a pool whose price disagrees with a market
 * feed. Most test tokens have no feed, so only the contracts' checks cover them.
 */

export const ActionKind = { Compound: 0, Rebalance: 1 } as const;

export type Action = { kind: number; positionId: bigint };

/** Every pool pairs its token with tUSDC. */
export type Pool = {
  poolId: string;
  baseIsToken0: boolean;
  baseDecimals: number;
  /** The token's price from a feed, or null when it has none. */
  marketUsd: number | null;
};

export type Rules = {
  maxPriceDeviationBps: number;
  minCompoundUsd: number;
  minDistanceBins: number;
  maxTickDrift: number;
  maxActions: number;
};

export type PositionView = {
  positionId: bigint;
  poolId: string;
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

/** How far a pool sits from its feed. Pools with no feed have no check. */
export type PriceCheck = { poolId: string; poolPriceUsd: number; marketUsd: number; deviationBps: number };

export type Decision = {
  checks: PriceCheck[];
  actions: Action[];
  skipped: Skipped[];
};

const TICK_BASE = 1.0001;
const USDC_DECIMALS = 6;

/** Pool price of the token in tUSDC, from a tick. */
export function poolPriceUsd(tick: number, pool: Pool): number {
  const decimals0 = pool.baseIsToken0 ? pool.baseDecimals : USDC_DECIMALS;
  const decimals1 = pool.baseIsToken0 ? USDC_DECIMALS : pool.baseDecimals;
  const token1PerToken0 = TICK_BASE ** tick * 10 ** (decimals0 - decimals1);
  return pool.baseIsToken0 ? token1PerToken0 : 1 / token1PerToken0;
}

function amountUsd(amount0: bigint, amount1: bigint, priceUsd: number, pool: Pool): number {
  const [base, usdc] = pool.baseIsToken0 ? [amount0, amount1] : [amount1, amount0];
  return (Number(base) / 10 ** pool.baseDecimals) * priceUsd + Number(usdc) / 10 ** USDC_DECIMALS;
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
  pools: readonly Pool[],
  nowSeconds: number,
  rules: Rules,
): Decision {
  for (const { marketUsd } of pools) {
    if (marketUsd !== null && !(Number.isFinite(marketUsd) && marketUsd > 0)) throw new Error("invalid market price");
  }
  const poolById = new Map(pools.map((pool) => [pool.poolId.toLowerCase(), pool]));

  const candidates: Candidate[] = [];
  const skipped: Skipped[] = [];
  const checks = new Map<string, PriceCheck>();

  for (const p of positions) {
    const skip = (reason: string) => skipped.push({ positionId: p.positionId, reason });

    const pool = poolById.get(p.poolId.toLowerCase());
    if (!pool) {
      skip("pool not listed");
      continue;
    }

    const livePrice = poolPriceUsd(p.liveTick, pool);
    if (pool.marketUsd !== null) {
      const deviation = deviationBps(livePrice, pool.marketUsd);
      checks.set(pool.poolId, { poolId: pool.poolId, poolPriceUsd: livePrice, marketUsd: pool.marketUsd, deviationBps: deviation });
      if (deviation > rules.maxPriceDeviationBps) {
        skip("pool disagrees with market");
        continue;
      }
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
    const valueUsd = amountUsd(p.pending0 + p.idle0, p.pending1 + p.idle1, pool.marketUsd ?? livePrice, pool);
    if (valueUsd < rules.minCompoundUsd) skip("fees below threshold");
    else candidates.push({ kind: ActionKind.Compound, positionId: p.positionId, priority: 0, valueUsd });
  }

  candidates.sort((a, b) => b.priority - a.priority || b.valueUsd - a.valueUsd);
  for (const c of candidates.slice(rules.maxActions)) {
    skipped.push({ positionId: c.positionId, reason: "batch full" });
  }

  return {
    checks: [...checks.values()],
    actions: candidates.slice(0, rules.maxActions).map(({ kind, positionId }) => ({ kind, positionId })),
    skipped,
  };
}
