import { parseAbiItem, type PublicClient } from "viem";
import { FIRST_BLOCK, POOL_MANAGER } from "./addresses";
import { readMarkets } from "./read";

/** Base Sepolia makes a block every 2 seconds. */
const BLOCKS_PER_DAY = 43_200n;
/** The public RPC refuses eth_getLogs over wider ranges. */
const LOG_RANGE = 200n;
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

/** Runs on the server: about 216 reads is too heavy to send through a mixnet per visitor. */
export async function scanStats(client: PublicClient): Promise<Record<string, MarketStats>> {
  const [toBlock, markets] = await Promise.all([client.getBlockNumber(), readMarkets(client)]);
  const dayAgo = toBlock - BLOCKS_PER_DAY;
  const queue = blockChunks(dayAgo > FIRST_BLOCK ? dayAgo : FIRST_BLOCK, toBlock, LOG_RANGE);
  const swaps = new Map<string, { amountUsdc: bigint; fee: number }[]>();

  const worker = async () => {
    for (let chunk = queue.shift(); chunk; chunk = queue.shift()) {
      const logs = await client.getLogs({
        address: POOL_MANAGER,
        event: swapEvent,
        args: { id: markets.map((market) => market.poolId) },
        fromBlock: chunk[0],
        toBlock: chunk[1],
      });
      for (const { args } of logs) {
        const market = markets.find(({ poolId }) => poolId === args.id);
        if (!market) continue;
        const amountUsdc = (market.baseIsToken0 ? args.amount1 : args.amount0) ?? 0n;
        swaps.set(market.id, [...(swaps.get(market.id) ?? []), { amountUsdc, fee: args.fee ?? 0 }]);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENT_READS }, worker));
  return Object.fromEntries(markets.map(({ id }) => [id, summarizeSwaps(swaps.get(id) ?? [])]));
}
