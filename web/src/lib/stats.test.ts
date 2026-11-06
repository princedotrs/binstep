import { describe, expect, test } from "bun:test";
import { aprOf, blockChunks, summarizeSwaps } from "./stats";

const swap = (amountUsdc: bigint, fee: number) => ({ amountUsdc, fee });

describe("summarizeSwaps", () => {
  test("no swaps is zero", () => {
    expect(summarizeSwaps([])).toEqual({ volume: 0, fees: 0, swaps: 0 });
  });
  test("counts both directions and each swap's own fee", () => {
    const s = summarizeSwaps([swap(-1000n * 10n ** 6n, 500), swap(2000n * 10n ** 6n, 1000)]);
    expect(s.volume).toBe(3000);
    expect(s.fees).toBeCloseTo(2.5, 9);
    expect(s.swaps).toBe(2);
  });
});

describe("aprOf", () => {
  test("annualizes a day of fees", () => {
    expect(aprOf(2.5, 1_000_000)).toBeCloseTo(0.09125, 9);
  });
  test("an empty pool has no APR", () => {
    expect(aprOf(1, 0)).toBe(0);
  });
});

describe("blockChunks", () => {
  test("covers the range with no gaps or overlaps", () => {
    const chunks = blockChunks(1000n, 1450n, 200n);
    expect(chunks).toEqual([
      [1000n, 1199n],
      [1200n, 1399n],
      [1400n, 1450n],
    ]);
  });
  test("one short range is one chunk", () => {
    expect(blockChunks(5n, 5n, 200n)).toEqual([[5n, 5n]]);
  });
});
