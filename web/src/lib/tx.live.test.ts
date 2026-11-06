import { expect, test } from "bun:test";
import { createPublicClient, type PublicClient, http, parseUnits } from "viem";
import { baseSepolia } from "viem/chains";
import { DEFAULT_MARKET } from "./markets";
import { readPools } from "./read";
import { binOf, depositSplit } from "./math";
import { closeCall, compoundCall, mintCall, swapCall } from "./tx";

const client = createPublicClient({ chain: baseSepolia, transport: http("https://sepolia.base.org") }) as unknown as PublicClient;
const account = "0x447FD5029328238646CBf3DCf8c7f5DCA3111842" as const;
const stranger = "0x000000000000000000000000000000000000dEaD" as const;

test("a mint simulates from a funded wallet", async () => {
  const { tick } = (await readPools(client))[DEFAULT_MARKET.id];
  const call = mintCall({
    market: DEFAULT_MARKET,
    lowerBin: binOf(tick) - 4,
    numBins: 8,
    strategy: 1,
    baseAmount: parseUnits("1", 18),
    usdcAmount: parseUnits("2000", 6),
    tick,
    autoCompound: true,
    autoRebalance: false,
  });
  await client.simulateContract({ ...call, account });
});

test("a swap simulates in both directions", async () => {
  const { tick } = (await readPools(client))[DEFAULT_MARKET.id];
  await client.simulateContract({ ...swapCall({ market: DEFAULT_MARKET, sell: "base", amount: parseUnits("0.01", 18), tick }), account });
  await client.simulateContract({ ...swapCall({ market: DEFAULT_MARKET, sell: "usdc", amount: parseUnits("10", 6), tick }), account });
});

test("a position owner can act and a stranger cannot", async () => {
  const { tick } = (await readPools(client))[DEFAULT_MARKET.id];
  await client.simulateContract({ ...compoundCall(1n, tick), account });
  await client.simulateContract({ ...closeCall(1n), account });
  await expect(client.simulateContract({ ...closeCall(1n), account: stranger })).rejects.toThrow();
});

test("a tick guard stops a mint after the price moves", async () => {
  const { tick } = (await readPools(client))[DEFAULT_MARKET.id];
  const call = mintCall({
    market: DEFAULT_MARKET,
    lowerBin: binOf(tick) - 4,
    numBins: 8,
    strategy: 0,
    baseAmount: parseUnits("1", 18),
    usdcAmount: parseUnits("2000", 6),
    tick: tick + 500,
    autoCompound: false,
    autoRebalance: false,
  });
  await expect(client.simulateContract({ ...call, account })).rejects.toThrow();
});

test("a mint simulates with amounts from the auto-fill", async () => {
  const { tick } = (await readPools(client))[DEFAULT_MARKET.id];
  const lowerBin = binOf(tick) - 8;
  for (const strategy of [0, 1, 2] as const) {
    const split = depositSplit(strategy, lowerBin, 16, tick, DEFAULT_MARKET);
    const baseAmount = parseUnits("1", 18);
    const usdc = (split.usdc / split.base).toFixed(6);
    const call = mintCall({ market: DEFAULT_MARKET, lowerBin, numBins: 16, strategy, baseAmount, usdcAmount: parseUnits(usdc, 6), tick, autoCompound: true, autoRebalance: true });
    const { result } = await client.simulateContract({ ...call, account });
    expect(result).toBeGreaterThan(0n);
  }
}, 30_000);
