import { parseAbiItem, type PublicClient } from "viem";
import { FIRST_BLOCK, POOL_MANAGER } from "./addresses";
import { readMarkets } from "./read";

/** Base Sepolia makes a block every 0.2 seconds. */
const BLOCKS_PER_DAY = 432_000n;
/** The default public RPC refuses eth_getLogs over wider ranges. */
const DEFAULT_LOG_RANGE = 200n;
const CONCURRENT_READS = 6;

const swapEvent = parseAbiItem(
  "event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)",
);

export type MarketStats = { volume: number; fees: number; swaps: number };

/** fee is in pips, so 1,000,000 is 100%. */
export function summarizeSwaps(swaps: { amountUsdc: bigint; fee: number }[]): MarketStats {
  let volume = 0;
  let fees = 0;
  for (const { amountUsdc, fee } of swaps) {
    const usd = Math.abs(Number(amountUsdc)) / 1e6;
    volume += usd;
    fees += (usd * fee) / 1e6;
  }
  return { volume, fees, swaps: swaps.length };
}

export const aprOf = (feesPerDay: number, liquidityUsd: number) =>
  liquidityUsd > 0 ? (feesPerDay * 365 * 100) / liquidityUsd : 0;

export function blockChunks(from: bigint, to: bigint, size: bigint): [bigint, bigint][] {
  const chunks: [bigint, bigint][] = [];
  for (let start = from; start <= to; start += size) {
    const end = start + size - 1n;
    chunks.push([start, end < to ? end : to]);
  }
  return chunks;
}

/** Reads a few chunks at a time, so a long range does not flood the RPC. */
export async function forEachChunk(chunks: [bigint, bigint][], read: (from: bigint, to: bigint) => Promise<void>) {
  const queue = [...chunks];
  const worker = async () => {
    for (let chunk = queue.shift(); chunk; chunk = queue.shift()) await read(chunk[0], chunk[1]);
  };
  await Promise.all(Array.from({ length: CONCURRENT_READS }, worker));
}

/** Runs on the server, because a day of logs is too heavy to send through a mixnet per visitor. */
export async function scanStats(client: PublicClient, logRange = DEFAULT_LOG_RANGE): Promise<Record<string, MarketStats>> {
  const [toBlock, markets] = await Promise.all([client.getBlockNumber(), readMarkets(client)]);
  const dayAgo = toBlock - BLOCKS_PER_DAY;
  const chunks = blockChunks(dayAgo > FIRST_BLOCK ? dayAgo : FIRST_BLOCK, toBlock, logRange);
  const swaps = new Map<string, { amountUsdc: bigint; fee: number }[]>();

  await forEachChunk(chunks, async (fromBlock, to) => {
    const logs = await client.getLogs({
      address: POOL_MANAGER,
      event: swapEvent,
      args: { id: markets.map((market) => market.poolId) },
      fromBlock,
      toBlock: to,
    });
    for (const { args } of logs) {
      const market = markets.find(({ poolId }) => poolId === args.id);
      if (!market) continue;
      const amountUsdc = (market.baseIsToken0 ? args.amount1 : args.amount0) ?? 0n;
      swaps.set(market.id, [...(swaps.get(market.id) ?? []), { amountUsdc, fee: args.fee ?? 0 }]);
    }
  });
  return Object.fromEntries(markets.map(({ id }) => [id, summarizeSwaps(swaps.get(id) ?? [])]));
}
