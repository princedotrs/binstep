import type { Address } from "viem";
import liveDeployment from "./deployment.json";

export type DeployedMarket = {
  symbol: string;
  decimals: number;
  token: string;
  poolId: string;
  baseIsToken0: boolean;
};

type Deployment = typeof liveDeployment & { deployBlock?: number; markets?: DeployedMarket[]; registry?: string; automationBlock?: number };

/** Set by scripts/devnet.sh. The app runs against Base Sepolia when these are absent. */
export const deployment: Deployment = process.env.NEXT_PUBLIC_DEPLOYMENT
  ? JSON.parse(process.env.NEXT_PUBLIC_DEPLOYMENT)
  : liveDeployment;

export const CHAIN_ID = 84532;
export const TICK_SPACING = 10;
export const DYNAMIC_FEE_FLAG = 8388608;
export const TICK_GUARD = 100;
export const MAX_BINS = 32;

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
  usdc: deployment.usdc as Address,
  swapRouter: deployment.swapRouter as Address,
};

/** Log scans start here on a devnet, because older blocks live on the upstream RPC. */
export const FIRST_BLOCK = BigInt(deployment.deployBlock ?? 0);
export const POOL_MANAGER = deployment.poolManager as Address;
/** Automation counts start here. The chain holds older runs, but no log scan reaches them. */
export const AUTOMATION_BLOCK = deployment.automationBlock ?? deployment.deployBlock;
/** Absent until a deployment has one, and Create pool waits for it. */
export const REGISTRY = deployment.registry as Address | undefined;
