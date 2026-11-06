import { expect, test } from "bun:test";
import { decodePool, encodePool, type PoolState } from "./read";

const pool = {
  tick: -76_930,
  usd: 2199.79,
  activeBin: -7693,
  feePips: 1000,
  stableTick: -76_930,
  wethIsToken0: true,
  positions: [
    {
      id: 7n,
      owner: "0x447FD5029328238646CBf3DCf8c7f5DCA3111842",
      lowerBin: -7701,
      numBins: 2,
      strategy: 0,
      autoCompound: true,
      autoRebalance: false,
      inRange: true,
      successorLowerBin: -7700,
      pendingWeth: 123456789012345678901234n,
      pendingUsdc: 0n,
      idleWeth: 1n,
      idleUsdc: 2n,
      nextRebalanceAt: 1793958644n,
      bins: [5n, 340282366920938463463374607431768211455n],
    },
  ],
  bins: [{ bin: -7701, liquidity: 5n }],
  wallet: null,
} satisfies PoolState;

test("pool state survives the trip from server to browser", () => {
  expect(decodePool(encodePool(pool))).toEqual(pool);
});

test("only encoded bigints become bigints", () => {
  const plain = { ...pool, positions: [], bins: [], tick: 12 };
  expect(decodePool(JSON.stringify({ ...plain, note: "12n" })).tick).toBe(12);
  expect((decodePool(JSON.stringify({ ...plain, note: "12n" })) as unknown as { note: string }).note).toBe("12n");
});
