import { expect, test } from "bun:test";
import { DEFAULT_MARKET } from "./markets";
import { decodePools, encodePools, type PoolState } from "./read";

const pool = {
  tick: -76_930,
  usd: 2199.79,
  activeBin: -7693,
  feePips: 1000,
  stableTick: -76_930,
  market: DEFAULT_MARKET,
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
      pendingBase: 123456789012345678901234n,
      pendingUsdc: 0n,
      idleBase: 1n,
      idleUsdc: 2n,
      nextRebalanceAt: 1793958644n,
      bins: [5n, 340282366920938463463374607431768211455n],
    },
  ],
  bins: [{ bin: -7701, liquidity: 5n }],
  wallet: null,
} satisfies PoolState;

test("pool state survives the trip from server to browser", () => {
  expect(decodePools(encodePools({ [DEFAULT_MARKET.id]: pool }))[DEFAULT_MARKET.id]).toEqual(pool);
});

test("only encoded bigints become bigints", () => {
  const plain = { ...pool, positions: [], bins: [], tick: 12 };
  const decoded = decodePools(JSON.stringify({ pool: { ...plain, note: "12n" } })).pool;
  expect(decoded.tick).toBe(12);
  expect((decoded as unknown as { note: string }).note).toBe("12n");
});
