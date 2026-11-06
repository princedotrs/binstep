import { describe, expect, test } from "bun:test";
import { decide, poolEthPriceUsd, type Rules, type PositionView } from "./decide";

// tWETH is token0 with 18 decimals and tUSDC is token1 with 6.
const rules: Rules = {
  wethIsToken0: true,
  token0Decimals: 18,
  token1Decimals: 6,
  maxPriceDeviationBps: 300,
  minCompoundUsd: 1,
  minDistanceBins: 2,
  maxTickDrift: 50,
  maxActions: 2,
};

// Tick where one tWETH is worth about $3,000 in raw token units.
const tickFor = (usd: number, r = rules) => {
  const raw = r.wethIsToken0
    ? (usd * 10 ** r.token1Decimals) / 10 ** r.token0Decimals
    : 10 ** r.token1Decimals / (usd * 10 ** r.token0Decimals);
  return Math.round(Math.log(raw) / Math.log(1.0001));
};

const TICK = tickFor(3000);
const NOW = 1_800_000_000;

const position = (over: Partial<PositionView> = {}): PositionView => ({
  positionId: 1n,
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

describe("poolEthPriceUsd", () => {
  test("reads the price when WETH is token0", () => {
    expect(poolEthPriceUsd(TICK, rules)).toBeCloseTo(3000, -1);
  });

  test("inverts the price when USDC is token0", () => {
    const flipped: Rules = { ...rules, wethIsToken0: false, token0Decimals: 6, token1Decimals: 18 };
    expect(poolEthPriceUsd(tickFor(3000, flipped), flipped)).toBeCloseTo(3000, -1);
  });
});

describe("compounding", () => {
  test("compounds an in-range position with enough fees", () => {
    const result = decide([position({ pending1: 5_000_000n })], 3000, NOW, rules);
    expect(result.actions).toEqual([{ kind: 0, positionId: 1n }]);
  });

  test("values WETH fees with the market price", () => {
    const result = decide([position({ pending0: 10n ** 15n })], 3000, NOW, rules);
    expect(result.actions).toHaveLength(1);
  });

  test("counts idle balances as deployable", () => {
    const result = decide([position({ idle1: 2_000_000n })], 3000, NOW, rules);
    expect(result.actions).toHaveLength(1);
  });

  test("skips fees below the threshold", () => {
    const result = decide([position({ pending1: 100n })], 3000, NOW, rules);
    expect(result.actions).toEqual([]);
    expect(result.skipped[0]?.reason).toBe("fees below threshold");
  });

  test("respects a position that opted out", () => {
    const result = decide([position({ pending1: 5_000_000n, autoCompound: false })], 3000, NOW, rules);
    expect(result.actions).toEqual([]);
  });
});

describe("rebalancing", () => {
  const outside = (over: Partial<PositionView> = {}) =>
    position({ inRange: false, successorLowerBin: Math.floor(TICK / 10) + 1, ...over });

  test("rebalances a settled out-of-range position", () => {
    expect(decide([outside()], 3000, NOW, rules).actions).toEqual([{ kind: 1, positionId: 1n }]);
  });

  test("waits while the price is settling", () => {
    const result = decide([outside({ stableTick: TICK + 51 })], 3000, NOW, rules);
    expect(result.actions).toEqual([]);
    expect(result.skipped[0]?.reason).toBe("price still settling");
  });

  test("waits for the cooldown", () => {
    const result = decide([outside({ nextRebalanceAt: BigInt(NOW + 1) })], 3000, NOW, rules);
    expect(result.skipped[0]?.reason).toBe("cooldown");
  });

  test("skips a move that gains too little distance", () => {
    const lowerBin = Math.floor(TICK / 10);
    const result = decide([outside({ lowerBin, successorLowerBin: lowerBin + 1 })], 3000, NOW, rules);
    expect(result.skipped[0]?.reason).toBe("too little distance gained");
  });

  test("respects a position that opted out", () => {
    const result = decide([outside({ autoRebalance: false })], 3000, NOW, rules);
    expect(result.actions).toEqual([]);
  });
});

describe("market check", () => {
  test("refuses to act when the pool disagrees with the market", () => {
    const result = decide([position({ pending1: 5_000_000n })], 3200, NOW, rules);
    expect(result.actions).toEqual([]);
    expect(result.skipped[0]?.reason).toBe("pool disagrees with market");
    expect(result.deviationBps).toBeGreaterThan(300);
  });

  test("allows a price inside the tolerance", () => {
    const result = decide([position({ pending1: 5_000_000n })], 3050, NOW, rules);
    expect(result.actions).toHaveLength(1);
  });

  test("refuses a nonsense market price", () => {
    expect(() => decide([position()], 0, NOW, rules)).toThrow("invalid market price");
    expect(() => decide([position()], Number.NaN, NOW, rules)).toThrow("invalid market price");
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
      3000,
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
    expect(decide([], 3000, NOW, rules).actions).toEqual([]);
  });
});
