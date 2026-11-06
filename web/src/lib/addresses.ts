import type { Address, Hex } from "viem";
import liveDeployment from "./deployment.json";

type Deployment = typeof liveDeployment & { deployBlock?: number };

/** Set by scripts/devnet.sh. The app runs against Base Sepolia when these are absent. */
const deployment: Deployment = process.env.NEXT_PUBLIC_DEPLOYMENT
  ? JSON.parse(process.env.NEXT_PUBLIC_DEPLOYMENT)
  : liveDeployment;

export const CHAIN_ID = 84532;
export const TICK_SPACING = 10;
export const DYNAMIC_FEE_FLAG = 8388608;
export const TICK_GUARD = 100;
export const MAX_BINS = 32;

export const WETH_DECIMALS = 18;
export const USDC_DECIMALS = 6;

export const STATE_VIEW: Address = "0x571291b572ed32ce6751a2cb2486ebee8defb9b4";
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? "https://sepolia.base.org";
export const DEVNET = Boolean(process.env.NEXT_PUBLIC_RPC_URL);

/** Anvil's third public test account. Anvil signs for it, so the app holds no key. */
export const DEV_WALLET: Address = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";

export const addresses = {
  manager: deployment.manager as Address,
  automation: deployment.automation as Address,
  hook: deployment.hook as Address,
  weth: deployment.weth as Address,
  usdc: deployment.usdc as Address,
  swapRouter: deployment.swapRouter as Address,
};

/** Log scans start here on a devnet, because older blocks live on the upstream RPC. */
export const FIRST_BLOCK = BigInt(deployment.deployBlock ?? 0);
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
