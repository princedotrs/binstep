import { erc20Abi, parseAbi, type Address, type PublicClient } from "viem";
import { hookAbi, managerAbi } from "./abi";
import { POOL_ID, STATE_VIEW, WETH_IS_TOKEN0, addresses } from "./addresses";
import { binOf, tickToUsd } from "./math";

const stateViewAbi = parseAbi([
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)",
]);

const PAGE = 100n;

export type Position = {
  id: bigint;
  owner: Address;
  lowerBin: number;
  numBins: number;
  strategy: number;
  autoCompound: boolean;
  autoRebalance: boolean;
  inRange: boolean;
  successorLowerBin: number;
  pendingWeth: bigint;
  pendingUsdc: bigint;
  idleWeth: bigint;
  idleUsdc: bigint;
  nextRebalanceAt: bigint;
  bins: readonly bigint[];
};

export type WalletState = {
  weth: bigint;
  usdc: bigint;
  managerAllowanceWeth: bigint;
  managerAllowanceUsdc: bigint;
  routerAllowanceWeth: bigint;
  routerAllowanceUsdc: bigint;
};

export type PoolState = {
  tick: number;
  usd: number;
  activeBin: number;
  feePips: number;
  stableTick: number;
  wethIsToken0: boolean;
  positions: Position[];
  bins: { bin: number; liquidity: bigint }[];
  wallet: WalletState | null;
};

const manager = { address: addresses.manager, abi: managerAbi } as const;
const hook = { address: addresses.hook, abi: hookAbi } as const;

const BIGINT_KEY = "$bigint";

/** JSON has no bigint, and these values overflow a number. */
export function encodePool(pool: PoolState) {
  return JSON.stringify(pool, (_, value) => (typeof value === "bigint" ? { [BIGINT_KEY]: value.toString() } : value));
}

export function decodePool(json: string): PoolState {
  return JSON.parse(json, (_, value) =>
    typeof value === "object" && value !== null && BIGINT_KEY in value ? BigInt(value[BIGINT_KEY]) : value,
  );
}

function aggregateBins(positions: Position[]) {
  const totals = new Map<number, bigint>();
  for (const p of positions) {
    p.bins.forEach((liquidity, i) => {
      const bin = p.lowerBin + i;
      totals.set(bin, (totals.get(bin) ?? 0n) + liquidity);
    });
  }
  return [...totals].map(([bin, liquidity]) => ({ bin, liquidity })).sort((a, b) => a.bin - b.bin);
}

export async function readWallet(client: PublicClient, wallet: Address): Promise<WalletState> {
  const token = (address: Address, functionName: "balanceOf" | "allowance", args: readonly Address[]) =>
    ({ address, abi: erc20Abi, functionName, args }) as never;
  const { weth, usdc, manager: m, swapRouter: r } = addresses;
  const [wethBal, usdcBal, mWeth, mUsdc, rWeth, rUsdc] = (await client.multicall({
    allowFailure: false,
    contracts: [
      token(weth, "balanceOf", [wallet]),
      token(usdc, "balanceOf", [wallet]),
      token(weth, "allowance", [wallet, m]),
      token(usdc, "allowance", [wallet, m]),
      token(weth, "allowance", [wallet, r]),
      token(usdc, "allowance", [wallet, r]),
    ],
  })) as bigint[];
  return {
    weth: wethBal,
    usdc: usdcBal,
    managerAllowanceWeth: mWeth,
    managerAllowanceUsdc: mUsdc,
    routerAllowanceWeth: rWeth,
    routerAllowanceUsdc: rUsdc,
  };
}

export async function readPool(client: PublicClient, wallet?: Address): Promise<PoolState> {
  const [slot0, feePips, stableTick, snapshots] = await client.multicall({
    allowFailure: false,
    contracts: [
      { address: STATE_VIEW, abi: stateViewAbi, functionName: "getSlot0", args: [POOL_ID] },
      { ...hook, functionName: "currentFee", args: [POOL_ID] },
      { ...hook, functionName: "stableTick", args: [POOL_ID] },
      { ...manager, functionName: "automationSnapshot", args: [1n, PAGE] },
    ],
  });
  const tick = slot0[1];

  const ids = snapshots.map((s) => s.positionId);
  const details = await client.multicall({
    allowFailure: false,
    contracts: ids.flatMap((id) => [
      { ...manager, functionName: "getBinLiquidity", args: [id] },
      { ...manager, functionName: "getPosition", args: [id] },
    ]),
  });

  const positions: Position[] = snapshots.map((s, i) => {
    const bins = details[i * 2] as unknown as readonly bigint[];
    const stored = details[i * 2 + 1] as unknown as { strategy: number };
    return {
      id: s.positionId,
      owner: s.owner,
      lowerBin: s.lowerBin,
      numBins: s.numBins,
      strategy: stored.strategy,
      autoCompound: s.autoCompound,
      autoRebalance: s.autoRebalance,
      inRange: s.inRange,
      successorLowerBin: s.successorLowerBin,
      pendingWeth: WETH_IS_TOKEN0 ? s.pending0 : s.pending1,
      pendingUsdc: WETH_IS_TOKEN0 ? s.pending1 : s.pending0,
      idleWeth: WETH_IS_TOKEN0 ? s.idle0 : s.idle1,
      idleUsdc: WETH_IS_TOKEN0 ? s.idle1 : s.idle0,
      nextRebalanceAt: s.nextRebalanceAt,
      bins,
    };
  });

  return {
    tick,
    usd: tickToUsd(tick, WETH_IS_TOKEN0),
    activeBin: binOf(tick),
    feePips,
    stableTick,
    wethIsToken0: WETH_IS_TOKEN0,
    positions,
    bins: aggregateBins(positions),
    wallet: wallet ? await readWallet(client, wallet) : null,
  };
}

