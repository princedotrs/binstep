import { expect, test } from "bun:test";
import { createPublicClient, type PublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";
import { scanStats } from "./stats";
import { DEFAULT_MARKET } from "./markets";
import { readPools, readWallet } from "./read";
import { tickToUsd } from "./math";

const client = createPublicClient({ chain: baseSepolia, transport: http("https://sepolia.base.org") }) as unknown as PublicClient;
const DEPLOYER = "0x447FD5029328238646CBf3DCf8c7f5DCA3111842";

test("reads the live pool in one round", async () => {
  const state = (await readPools(client))[DEFAULT_MARKET.id];
  expect(state.positions.length).toBeGreaterThanOrEqual(5);
  expect(state.usd).toBeCloseTo(tickToUsd(state.tick, state.market), 1);
  expect(state.usd).toBeGreaterThan(500);
  expect(state.feePips).toBeGreaterThanOrEqual(500);
  expect(state.bins.length).toBeGreaterThan(16);
  expect(state.bins.some((b) => b.liquidity > 0n)).toBe(true);
  expect(state.bins).toEqual([...state.bins].sort((a, b) => a.bin - b.bin));
  const wallet = await readWallet(client, DEFAULT_MARKET, DEPLOYER);
  expect(wallet.base).toBeGreaterThan(0n);
  expect(wallet.managerAllowanceBase).toBeGreaterThan(0n);
});

test("reads without a wallet", async () => {
  const state = (await readPools(client))[DEFAULT_MARKET.id];
  expect(state.wallet).toBeNull();
  expect(state.positions.length).toBeGreaterThanOrEqual(5);
});

test("scans a day of swap stats", async () => {
  const start = Date.now();
  const all = await scanStats(client);
  const stats = all[DEFAULT_MARKET.id];
  console.log(`scanned in ${Date.now() - start}ms:`, stats);
  expect(stats.volume).toBeGreaterThanOrEqual(0);
  if (stats.swaps > 0) expect(stats.fees).toBeGreaterThan(0);
}, 90_000);
