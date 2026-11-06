import { erc20Abi, parseAbi, type Address, type PublicClient } from "viem";
import { hookAbi, managerAbi, registryAbi } from "./abi";
import { REGISTRY, STATE_VIEW, addresses } from "./addresses";
import { MARKETS, communityMarket, type Market } from "./markets";
import { binOf, tickToUsd } from "./math";

const stateViewAbi = parseAbi([
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)",
]);

/** Snapshots cost about 630k gas each, and public RPCs cap the gas of a read. */
const PAGE = 25n;
/** Anyone can create markets, so the server reads only the newest ones. */
const COMMUNITY_SHOWN = 100n;

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
  pendingBase: bigint;
  pendingUsdc: bigint;
  idleBase: bigint;
  idleUsdc: bigint;
  nextRebalanceAt: bigint;
  bins: readonly bigint[];
};

export type WalletState = {
  base: bigint;
  usdc: bigint;
  managerAllowanceBase: bigint;
  managerAllowanceUsdc: bigint;
  routerAllowanceBase: bigint;
  routerAllowanceUsdc: bigint;
};

export type PoolState = {
  market: Market;
  tick: number;
  usd: number;
  activeBin: number;
  feePips: number;
  stableTick: number;
  positions: Position[];
  bins: { bin: number; liquidity: bigint }[];
  wallet: WalletState | null;
};

export type Pools = Record<string, PoolState>;

const manager = { address: addresses.manager, abi: managerAbi } as const;
const hook = { address: addresses.hook, abi: hookAbi } as const;

const BIGINT_KEY = "$bigint";

/** JSON has no bigint, and these values overflow a number. */
export function encodePools(pools: Pools) {
  return JSON.stringify(pools, (_, value) => (typeof value === "bigint" ? { [BIGINT_KEY]: value.toString() } : value));
}

export function decodePools(json: string): Pools {
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

export async function readWallet(client: PublicClient, market: Market, wallet: Address): Promise<WalletState> {
  const token = (address: Address, functionName: "balanceOf" | "allowance", args: readonly Address[]) =>
    ({ address, abi: erc20Abi, functionName, args }) as never;
  const { usdc, manager: m, swapRouter: r } = addresses;
  const base = market.token;
  const [baseBal, usdcBal, mBase, mUsdc, rBase, rUsdc] = (await client.multicall({
    allowFailure: false,
    contracts: [
      token(base, "balanceOf", [wallet]),
      token(usdc, "balanceOf", [wallet]),
      token(base, "allowance", [wallet, m]),
      token(usdc, "allowance", [wallet, m]),
      token(base, "allowance", [wallet, r]),
      token(usdc, "allowance", [wallet, r]),
    ],
  })) as bigint[];
  return {
    base: baseBal,
    usdc: usdcBal,
    managerAllowanceBase: mBase,
    managerAllowanceUsdc: mUsdc,
    routerAllowanceBase: rBase,
    routerAllowanceUsdc: rUsdc,
  };
}

async function readSnapshots(client: PublicClient) {
  const last = await client.readContract({ ...manager, functionName: "lastPositionId" });
  const pages = Array.from({ length: Math.ceil(Number(last) / Number(PAGE)) }, (_, i) =>
    client.readContract({ ...manager, functionName: "automationSnapshot", args: [BigInt(i) * PAGE + 1n, PAGE] }),
  );
  return (await Promise.all(pages)).flat();
}

/** The listed markets, then the community markets with the newest first. */
export async function readMarkets(client: PublicClient): Promise<Market[]> {
  if (!REGISTRY) return MARKETS;
  const registry = { address: REGISTRY, abi: registryAbi } as const;
  const count = await client.readContract({ ...registry, functionName: "count" });
  const offset = count > COMMUNITY_SHOWN ? count - COMMUNITY_SHOWN : 0n;
  const listings = await client.readContract({ ...registry, functionName: "page", args: [offset, COMMUNITY_SHOWN] });
  return [...MARKETS, ...listings.map((listing) => communityMarket(listing as Parameters<typeof communityMarket>[0])).reverse()];
}

/** Reads every market at once. Positions in pools this app does not list are left out. */
export async function readPools(client: PublicClient): Promise<Pools> {
  const markets = await readMarkets(client);
  const [states, snapshots] = await Promise.all([
    client.multicall({
      allowFailure: false,
      contracts: markets.flatMap(({ poolId }) => [
        { address: STATE_VIEW, abi: stateViewAbi, functionName: "getSlot0", args: [poolId] },
        { ...hook, functionName: "currentFee", args: [poolId] },
        { ...hook, functionName: "stableTick", args: [poolId] },
      ]),
    }),
    readSnapshots(client),
  ]);

  const details = await client.multicall({
    allowFailure: false,
    contracts: snapshots.flatMap((s) => [
      { ...manager, functionName: "getBinLiquidity", args: [s.positionId] },
      { ...manager, functionName: "getPosition", args: [s.positionId] },
    ]),
  });

  const positions = snapshots.map((s, i) => {
    const bins = details[i * 2] as unknown as readonly bigint[];
    const stored = details[i * 2 + 1] as unknown as { strategy: number };
    const baseIsToken0 = markets.find((m) => m.poolId === s.poolId)?.baseIsToken0 ?? true;
    const position: Position = {
      id: s.positionId,
      owner: s.owner,
      lowerBin: s.lowerBin,
      numBins: s.numBins,
      strategy: stored.strategy,
      autoCompound: s.autoCompound,
      autoRebalance: s.autoRebalance,
      inRange: s.inRange,
      successorLowerBin: s.successorLowerBin,
      pendingBase: baseIsToken0 ? s.pending0 : s.pending1,
      pendingUsdc: baseIsToken0 ? s.pending1 : s.pending0,
      idleBase: baseIsToken0 ? s.idle0 : s.idle1,
      idleUsdc: baseIsToken0 ? s.idle1 : s.idle0,
      nextRebalanceAt: s.nextRebalanceAt,
      bins,
    };
    return { poolId: s.poolId, position };
  });

  const pools: Pools = {};
  markets.forEach((market, i) => {
    const slot0 = states[i * 3] as readonly [bigint, number, number, number];
    const tick = slot0[1];
    const mine = positions.filter((p) => p.poolId === market.poolId).map((p) => p.position);
    pools[market.id] = {
      market,
      tick,
      usd: tickToUsd(tick, market),
      activeBin: binOf(tick),
      feePips: states[i * 3 + 1] as number,
      stableTick: states[i * 3 + 2] as number,
      positions: mine,
      bins: aggregateBins(mine),
      wallet: null,
    };
  });
  return pools;
}
