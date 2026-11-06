import type { Address, Hex } from "viem";
import deployment from "./deployment.json";

export const CHAIN_ID = 84532;
export const TICK_SPACING = 10;
export const DYNAMIC_FEE_FLAG = 8388608;
export const TICK_GUARD = 100;
export const MAX_BINS = 32;

export const WETH_DECIMALS = 18;
export const USDC_DECIMALS = 6;

export const STATE_VIEW: Address = "0x571291b572ed32ce6751a2cb2486ebee8defb9b4";
export const BASE_SEPOLIA_RPC = "https://sepolia.base.org";

export const addresses = {
  manager: deployment.manager as Address,
  automation: deployment.automation as Address,
  hook: deployment.hook as Address,
  weth: deployment.weth as Address,
  usdc: deployment.usdc as Address,
  swapRouter: deployment.swapRouter as Address,
};

export const POOL_ID = deployment.poolId as Hex;
export const POOL_MANAGER = deployment.poolManager as Address;
export const WETH_IS_TOKEN0 = deployment.wethIsToken0;

export const poolKey = {
  currency0: deployment.token0 as Address,
  currency1: deployment.token1 as Address,
  fee: DYNAMIC_FEE_FLAG,
  tickSpacing: TICK_SPACING,
  hooks: deployment.hook as Address,
} as const;
