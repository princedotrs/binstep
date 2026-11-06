import { describe, expect, test } from "bun:test";
import { decide, poolPriceUsd, type Pool, type PositionView, type Rules } from "./decide";

const rules: Rules = {
  maxPriceDeviationBps: 300,
  minCompoundUsd: 1,
  minDistanceBins: 2,
  maxTickDrift: 50,
  maxActions: 2,
};

// tWETH is token0 with 18 decimals and tUSDC is token1 with 6.
const POOL: Pool = { poolId: "0xAA", baseIsToken0: true, baseDecimals: 18, marketUsd: 3000 };
const at = (marketUsd: number | null): Pool[] => [{ ...POOL, marketUsd }];

// Tick where one token is worth this much in raw token units.
const tickFor = (usd: number, pool: Pool = POOL) => {
  const rawUsd = usd * 10 ** (6 - pool.baseDecimals);
  return Math.round(Math.log(pool.baseIsToken0 ? rawUsd : 1 / rawUsd) / Math.log(1.0001));
};

const TICK = tickFor(3000);
const NOW = 1_800_000_000;

const position = (over: Partial<PositionView> = {}): PositionView => ({
  positionId: 1n,
  poolId: POOL.poolId,
  lowerBin: Math.floor(TICK / 10) - 8,
  numBins: 16,
  autoCompound: true,
  autoRebalance: true,
  inRange: true,
  successorLowerBin: Math.floor(TICK / 10) - 8,
  liveTick: TICK,
  stableTick: TICK,
  pending0: 0n,
  pending1: 0n,
  idle0: 0n,
  idle1: 0n,
  nextRebalanceAt: 0n,
  ...over,
});

describe("poolPriceUsd", () => {
  test("reads the price when the token is token0", () => {
    expect(poolPriceUsd(TICK, POOL)).toBeCloseTo(3000, -1);
  });

  test("inverts the price when tUSDC is token0", () => {
    const flipped = { ...POOL, baseIsToken0: false };
    expect(poolPriceUsd(tickFor(3000, flipped), flipped)).toBeCloseTo(3000, -1);
  });

  test("handles 8 decimal tokens", () => {
    const btc = { ...POOL, baseDecimals: 8 };
    expect(poolPriceUsd(tickFor(75_000, btc), btc) / 75_000).toBeCloseTo(1, 2);
  });
});

describe("compounding", () => {
  test("compounds an in-range position with enough fees", () => {
    const result = decide([position({ pending1: 5_000_000n })], at(3000), NOW, rules);
    expect(result.actions).toEqual([{ kind: 0, positionId: 1n }]);
  });

  test("values WETH fees with the market price", () => {
    const result = decide([position({ pending0: 10n ** 15n })], at(3000), NOW, rules);
    expect(result.actions).toHaveLength(1);
  });

  test("counts idle balances as deployable", () => {
    const result = decide([position({ idle1: 2_000_000n })], at(3000), NOW, rules);
    expect(result.actions).toHaveLength(1);
  });

  test("skips fees below the threshold", () => {
    const result = decide([position({ pending1: 100n })], at(3000), NOW, rules);
    expect(result.actions).toEqual([]);
    expect(result.skipped[0]?.reason).toBe("fees below threshold");
  });

  test("respects a position that opted out", () => {
    const result = decide([position({ pending1: 5_000_000n, autoCompound: false })], at(3000), NOW, rules);
    expect(result.actions).toEqual([]);
  });
});

describe("rebalancing", () => {
  const outside = (over: Partial<PositionView> = {}) =>
    position({ inRange: false, successorLowerBin: Math.floor(TICK / 10) + 1, ...over });

  test("rebalances a settled out-of-range position", () => {
    expect(decide([outside()], at(3000), NOW, rules).actions).toEqual([{ kind: 1, positionId: 1n }]);
  });

  test("waits while the price is settling", () => {
    const result = decide([outside({ stableTick: TICK + 51 })], at(3000), NOW, rules);
    expect(result.actions).toEqual([]);
    expect(result.skipped[0]?.reason).toBe("price still settling");
  });

  test("waits for the cooldown", () => {
    const result = decide([outside({ nextRebalanceAt: BigInt(NOW + 1) })], at(3000), NOW, rules);
    expect(result.skipped[0]?.reason).toBe("cooldown");
  });

  test("skips a move that gains too little distance", () => {
    const lowerBin = Math.floor(TICK / 10);
    const result = decide([outside({ lowerBin, successorLowerBin: lowerBin + 1 })], at(3000), NOW, rules);
    expect(result.skipped[0]?.reason).toBe("too little distance gained");
  });

  test("respects a position that opted out", () => {
    const result = decide([outside({ autoRebalance: false })], at(3000), NOW, rules);
    expect(result.actions).toEqual([]);
  });
});

describe("market check", () => {
  test("refuses to act when the pool disagrees with the market", () => {
    const result = decide([position({ pending1: 5_000_000n })], at(3200), NOW, rules);
    expect(result.actions).toEqual([]);
    expect(result.skipped[0]?.reason).toBe("pool disagrees with market");
    expect(result.checks[0].deviationBps).toBeGreaterThan(300);
  });

  test("allows a price inside the tolerance", () => {
    const result = decide([position({ pending1: 5_000_000n })], at(3050), NOW, rules);
    expect(result.actions).toHaveLength(1);
  });

  test("refuses a nonsense market price", () => {
    expect(() => decide([position()], at(0), NOW, rules)).toThrow("invalid market price");
    expect(() => decide([position()], at(Number.NaN), NOW, rules)).toThrow("invalid market price");
  });
});

describe("batching", () => {
  test("puts rebalances first and caps the batch", () => {
    const outside = position({
      positionId: 3n,
      inRange: false,
      successorLowerBin: Math.floor(TICK / 10) + 1,
    });
    const result = decide(
      [position({ positionId: 1n, pending1: 9_000_000n }), position({ positionId: 2n, pending1: 5_000_000n }), outside],
      at(3000),
      NOW,
      rules,
    );
    expect(result.actions).toEqual([
      { kind: 1, positionId: 3n },
      { kind: 0, positionId: 1n },
    ]);
    expect(result.skipped.some((s) => s.reason === "batch full")).toBe(true);
  });

  test("handles no positions", () => {
    expect(decide([], at(3000), NOW, rules).actions).toEqual([]);
  });
});

describe("many pools", () => {
  const OTHER: Pool = { poolId: "0xbb", baseIsToken0: false, baseDecimals: 18, marketUsd: null };
  const FEES = { pending0: 5_000_000n };
  const otherTick = tickFor(2, OTHER);
  const elsewhere = (over: Partial<PositionView> = {}) =>
    position({ poolId: "0xBB", liveTick: otherTick, stableTick: otherTick, ...FEES, ...over });

  test("a pool with no feed still compounds, and counts tUSDC on the right side", () => {
    const result = decide([elsewhere({ positionId: 2n })], [POOL, OTHER], NOW, rules);
    expect(result.actions).toEqual([{ kind: 0, positionId: 2n }]);
    expect(result.checks).toEqual([]);
  });

  test("a pool with no feed still rebalances", () => {
    const lowerBin = Math.floor(otherTick / 10) + 20;
    const moved = elsewhere({ positionId: 2n, inRange: false, lowerBin, successorLowerBin: lowerBin - 30 });
    expect(decide([moved], [POOL, OTHER], NOW, rules).actions).toEqual([{ kind: 1, positionId: 2n }]);
  });

  test("a pool with no feed still waits for the price to settle", () => {
    const moved = elsewhere({ inRange: false, stableTick: otherTick + 51 });
    const result = decide([moved], [POOL, OTHER], NOW, rules);
    expect(result.actions).toEqual([]);
    expect(result.skipped[0].reason).toBe("price still settling");
  });

  test("a feed only blocks its own pool", () => {
    const mispriced = position({ positionId: 1n, pending1: 5_000_000n });
    const fine = elsewhere({ positionId: 2n });
    const result = decide([mispriced, fine], [{ ...POOL, marketUsd: 3200 }, OTHER], NOW, rules);
    expect(result.actions).toEqual([{ kind: 0, positionId: 2n }]);
    expect(result.skipped[0]).toEqual({ positionId: 1n, reason: "pool disagrees with market" });
  });

  test("the batch limit spans every pool", () => {
    const three = [position({ positionId: 1n, pending1: 5_000_000n }), elsewhere({ positionId: 2n }), elsewhere({ positionId: 3n })];
    const result = decide(three, [POOL, OTHER], NOW, rules);
    expect(result.actions).toHaveLength(2);
    expect(result.skipped.at(-1)?.reason).toBe("batch full");
  });

  test("skips a position in a pool the workflow does not know", () => {
    const result = decide([position({ poolId: "0xcc" })], [POOL], NOW, rules);
    expect(result.skipped).toEqual([{ positionId: 1n, reason: "pool not listed" }]);
  });
});
