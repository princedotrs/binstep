import { erc20Abi, maxUint256, type Address } from "viem";
import { managerAbi, swapRouterAbi } from "./abi";
import { TICK_GUARD, WETH_IS_TOKEN0, addresses, poolKey } from "./addresses";
import type { Strategy } from "./math";

/** Stops a swap about 3% from the price, so one trade cannot empty the test pool. */
export const SWAP_LIMIT_TICKS = 300;

const sqrtPriceAtTick = (tick: number) => BigInt(Math.floor(1.0001 ** (tick / 2) * 2 ** 96));

export function approveCall(token: Address, spender: Address) {
  return { address: token, abi: erc20Abi, functionName: "approve", args: [spender, maxUint256] } as const;
}

const guard = (tick: number) => [tick - TICK_GUARD, tick + TICK_GUARD] as const;

export function mintCall(p: {
  lowerBin: number;
  numBins: number;
  strategy: Strategy;
  wethAmount: bigint;
  usdcAmount: bigint;
  tick: number;
  autoCompound: boolean;
  autoRebalance: boolean;
}) {
  const [minTick, maxTick] = guard(p.tick);
  return {
    address: addresses.manager,
    abi: managerAbi,
    functionName: "mint",
    args: [
      {
        key: poolKey,
        lowerBin: p.lowerBin,
        numBins: p.numBins,
        strategy: p.strategy,
        amount0Max: WETH_IS_TOKEN0 ? p.wethAmount : p.usdcAmount,
        amount1Max: WETH_IS_TOKEN0 ? p.usdcAmount : p.wethAmount,
        minTick,
        maxTick,
        autoCompound: p.autoCompound,
        autoRebalance: p.autoRebalance,
      },
    ],
  } as const;
}

export function swapCall({ sell, amount, tick }: { sell: "weth" | "usdc"; amount: bigint; tick: number }) {
  const zeroForOne = (sell === "weth") === WETH_IS_TOKEN0;
  return {
    address: addresses.swapRouter,
    abi: swapRouterAbi,
    functionName: "swap",
    args: [
      poolKey,
      {
        zeroForOne,
        amountSpecified: -amount,
        sqrtPriceLimitX96: sqrtPriceAtTick(zeroForOne ? tick - SWAP_LIMIT_TICKS : tick + SWAP_LIMIT_TICKS),
      },
      { takeClaims: false, settleUsingBurn: false },
      "0x",
    ],
  } as const;
}

export function compoundCall(id: bigint, tick: number) {
  const [minTick, maxTick] = guard(tick);
  return { address: addresses.manager, abi: managerAbi, functionName: "compound", args: [id, minTick, maxTick] } as const;
}

export function rebalanceCall(id: bigint, newLowerBin: number, tick: number) {
  const [minTick, maxTick] = guard(tick);
  return {
    address: addresses.manager,
    abi: managerAbi,
    functionName: "rebalance",
    args: [id, newLowerBin, minTick, maxTick],
  } as const;
}

export function closeCall(id: bigint) {
  return { address: addresses.manager, abi: managerAbi, functionName: "close", args: [id] } as const;
}

export function automationCall(id: bigint, autoCompound: boolean, autoRebalance: boolean) {
  return {
    address: addresses.manager,
    abi: managerAbi,
    functionName: "setAutomation",
    args: [id, autoCompound, autoRebalance],
  } as const;
}
