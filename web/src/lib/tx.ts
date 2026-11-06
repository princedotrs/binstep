import { erc20Abi, maxUint256, parseAbi, parseUnits, type Address } from "viem";
import { managerAbi, swapRouterAbi } from "./abi";
import { TICK_GUARD, WETH_IS_TOKEN0, addresses, poolKey } from "./addresses";
import type { Strategy } from "./math";

const mintableAbi = parseAbi(["function mint(address to, uint256 value)"]);

const MIN_SQRT_PRICE_LIMIT = 4295128740n;
const MAX_SQRT_PRICE_LIMIT = 1461446703485210103287273052203988822378723970341n;

export const FAUCET_WETH = parseUnits("10", 18);
export const FAUCET_USDC = parseUnits("25000", 6);

export function faucetCalls(to: Address) {
  return [
    { address: addresses.weth, abi: mintableAbi, functionName: "mint", args: [to, FAUCET_WETH] },
    { address: addresses.usdc, abi: mintableAbi, functionName: "mint", args: [to, FAUCET_USDC] },
  ] as const;
}

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

export function swapCall({ sell, amount }: { sell: "weth" | "usdc"; amount: bigint }) {
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
        sqrtPriceLimitX96: zeroForOne ? MIN_SQRT_PRICE_LIMIT : MAX_SQRT_PRICE_LIMIT,
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
