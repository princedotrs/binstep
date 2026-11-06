import { expect, test } from "bun:test";
import { createPublicClient, type PublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";
import { readPool } from "./read";
import { tickToUsd } from "./math";

const client = createPublicClient({ chain: baseSepolia, transport: http("https://sepolia.base.org") }) as unknown as PublicClient;
const DEPLOYER = "0x447FD5029328238646CBf3DCf8c7f5DCA3111842";

test("reads the live pool in one round", async () => {
  const state = await readPool(client, DEPLOYER);
  expect(state.positions.length).toBeGreaterThanOrEqual(5);
  expect(state.usd).toBeCloseTo(tickToUsd(state.tick, state.wethIsToken0), 1);
  expect(state.usd).toBeGreaterThan(500);
  expect(state.feePips).toBeGreaterThanOrEqual(500);
  expect(state.bins.length).toBeGreaterThan(16);
  expect(state.bins.some((b) => b.liquidity > 0n)).toBe(true);
  expect(state.bins).toEqual([...state.bins].sort((a, b) => a.bin - b.bin));
  expect(state.wallet?.weth).toBeGreaterThan(0n);
  expect(state.wallet?.managerAllowanceWeth).toBeGreaterThan(0n);
});

test("reads without a wallet", async () => {
  const state = await readPool(client);
  expect(state.wallet).toBeNull();
  expect(state.positions.length).toBeGreaterThanOrEqual(5);
});
