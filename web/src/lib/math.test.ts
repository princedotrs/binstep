import { describe, expect, test } from "bun:test";
import { binOf, binToUsd, poolLiquidity, previewShape, rangeState, strategyWeights, tickToUsd, usdToTick } from "./math";

describe("prices", () => {
  test("a live tick reads as the real price", () => {
    expect(tickToUsd(-199223, true)).toBeCloseTo(2230, -1);
  });

  test("inverts when USDC is token0", () => {
    const tick = usdToTick(2230, false);
    expect(tick).toBeGreaterThan(0);
    expect(tickToUsd(tick, false)).toBeCloseTo(2230, -1);
  });

  test("a price round trips within one tick", () => {
    expect(Math.abs(usdToTick(tickToUsd(-199223, true), true) + 199223)).toBeLessThanOrEqual(1);
  });

  test("a bin price is its lower edge", () => {
    expect(binToUsd(-19923, true)).toBeCloseTo(tickToUsd(-199230, true), 6);
  });
});

describe("binOf", () => {
  test("floors negative ticks", () => {
    expect(binOf(-199223)).toBe(-19923);
    expect(binOf(-199230)).toBe(-19923);
    expect(binOf(-1)).toBe(-1);
    expect(binOf(0)).toBe(0);
    expect(binOf(19)).toBe(1);
  });
});

describe("strategyWeights matches StrategyLib", () => {
  test("Spot is flat", () => {
    expect(strategyWeights(0, 5)).toEqual([1, 1, 1, 1, 1]);
  });
  test("Curve peaks in the middle", () => {
    expect(strategyWeights(1, 5)).toEqual([1, 3, 5, 3, 1]);
    expect(strategyWeights(1, 2)).toEqual([1, 1]);
  });
  test("Bid-Ask peaks at the edges", () => {
    expect(strategyWeights(2, 5)).toEqual([5, 3, 1, 3, 5]);
    expect(strategyWeights(2, 2)).toEqual([2, 2]);
  });
  test("one bin works for every strategy", () => {
    for (const s of [0, 1, 2] as const) expect(strategyWeights(s, 1)).toEqual([1]);
  });
  test("sixteen bins stay symmetric and positive", () => {
    for (const s of [0, 1, 2] as const) {
      const w = strategyWeights(s, 16);
      expect(w).toHaveLength(16);
      expect(w).toEqual([...w].reverse());
      expect(Math.min(...w)).toBeGreaterThan(0);
    }
  });
});

describe("previewShape", () => {
  test("splits tokens around the active bin", () => {
    const bins = previewShape(0, 10, 5, 12, true);
    expect(bins.map((b) => b.holds)).toEqual(["usdc", "usdc", "both", "weth", "weth"]);
  });
  test("a range above the price holds only WETH", () => {
    expect(previewShape(1, 20, 3, 12, true).every((b) => b.holds === "weth")).toBe(true);
  });
  test("a range below the price holds only USDC", () => {
    expect(previewShape(2, 0, 3, 12, true).every((b) => b.holds === "usdc")).toBe(true);
  });
  test("flips sides when USDC is token0", () => {
    expect(previewShape(0, 10, 3, 11, false).map((b) => b.holds)).toEqual(["weth", "both", "usdc"]);
  });
});

describe("rangeState", () => {
  const base = { inRange: false, autoRebalance: true, lowerBin: -19935, successorLowerBin: -19935 };
  test("in range earns", () => {
    expect(rangeState({ ...base, inRange: true })).toBe("earning");
  });
  test("re-entered just beside the price waits", () => {
    expect(rangeState(base)).toBe("waiting");
    expect(rangeState({ ...base, successorLowerBin: -19936 })).toBe("waiting");
  });
  test("a real move is pending", () => {
    expect(rangeState({ ...base, successorLowerBin: -19950 })).toBe("pending");
  });
  test("without automation it waits", () => {
    expect(rangeState({ ...base, autoRebalance: false, successorLowerBin: -19950 })).toBe("waiting");
  });
});

describe("poolLiquidity", () => {
  const L = 10n ** 15n;
  const WIDTH = 1.0001 ** 5 - 1; // sqrt(1.0001^10) - 1, the sqrt-price width of one bin
  const near = (a: number, b: number) => expect(Math.abs(a - b) / b).toBeLessThan(1e-6);

  test("a bin above the price holds only token0", () => {
    const { weth, usdc } = poolLiquidity([{ bin: 5, liquidity: L }], 0, true);
    expect(usdc).toBe(0);
    near(weth, (Number(L) * (1 - 1 / (1 + WIDTH)) / 1.0001 ** 25) / 1e18);
  });

  test("a bin below the price holds only token1", () => {
    const { weth, usdc } = poolLiquidity([{ bin: -6, liquidity: L }], 0, true);
    expect(weth).toBe(0);
    near(usdc, (Number(L) * WIDTH * 1.0001 ** -30) / 1e6);
  });

  test("the active bin splits at the price", () => {
    const { weth, usdc } = poolLiquidity([{ bin: 0, liquidity: L }], 5, true);
    expect(weth).toBeGreaterThan(0);
    expect(usdc).toBeGreaterThan(0);
  });

  test("swaps the token names when WETH is token1", () => {
    const flipped = poolLiquidity([{ bin: 5, liquidity: L }], 0, false);
    expect(flipped.weth).toBe(0);
    expect(flipped.usdc).toBeGreaterThan(0);
  });

  test("an empty pool is zero", () => {
    expect(poolLiquidity([], 0, true)).toEqual({ weth: 0, usdc: 0 });
  });
});
