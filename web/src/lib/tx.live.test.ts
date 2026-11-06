import { expect, test } from "bun:test";
import { createPublicClient, type PublicClient, http, parseUnits } from "viem";
import { baseSepolia } from "viem/chains";
import { readPool } from "./read";
import { binOf } from "./math";
import { closeCall, compoundCall, mintCall, swapCall } from "./tx";

const client = createPublicClient({ chain: baseSepolia, transport: http("https://sepolia.base.org") }) as unknown as PublicClient;
const account = "0x447FD5029328238646CBf3DCf8c7f5DCA3111842" as const;
const stranger = "0x000000000000000000000000000000000000dEaD" as const;

test("a mint simulates from a funded wallet", async () => {
  const { tick } = await readPool(client);
  const call = mintCall({
    lowerBin: binOf(tick) - 4,
    numBins: 8,
    strategy: 1,
    wethAmount: parseUnits("1", 18),
    usdcAmount: parseUnits("2000", 6),
    tick,
    autoCompound: true,
    autoRebalance: false,
  });
  await client.simulateContract({ ...call, account });
});

test("a swap simulates in both directions", async () => {
  const { tick } = await readPool(client);
  await client.simulateContract({ ...swapCall({ sell: "weth", amount: parseUnits("0.01", 18), tick }), account });
  await client.simulateContract({ ...swapCall({ sell: "usdc", amount: parseUnits("10", 6), tick }), account });
});

test("a position owner can act and a stranger cannot", async () => {
  const { tick } = await readPool(client);
  await client.simulateContract({ ...compoundCall(1n, tick), account });
  await client.simulateContract({ ...closeCall(1n), account });
  await expect(client.simulateContract({ ...closeCall(1n), account: stranger })).rejects.toThrow();
});

test("a tick guard stops a mint after the price moves", async () => {
  const { tick } = await readPool(client);
  const call = mintCall({
    lowerBin: binOf(tick) - 4,
    numBins: 8,
    strategy: 0,
    wethAmount: parseUnits("1", 18),
    usdcAmount: parseUnits("2000", 6),
    tick: tick + 500,
    autoCompound: false,
    autoRebalance: false,
  });
  await expect(client.simulateContract({ ...call, account })).rejects.toThrow();
});
