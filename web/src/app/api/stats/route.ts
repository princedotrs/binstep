import { createPublicClient, http, type PublicClient } from "viem";
import { baseSepolia } from "viem/chains";
import { BASE_SEPOLIA_RPC } from "@/lib/addresses";
import { scanStats, type MarketStats } from "@/lib/stats";

export const dynamic = "force-dynamic";

const FRESH_MS = 5 * 60_000;
const CACHE_HEADER = "public, s-maxage=300, stale-while-revalidate=3600";

const client = createPublicClient({
  chain: baseSepolia,
  transport: http(BASE_SEPOLIA_RPC, { retryCount: 3 }),
}) as unknown as PublicClient;

let cached: { at: number; stats: MarketStats } | null = null;
let scanning: Promise<MarketStats> | null = null;

function refresh() {
  scanning ??= scanStats(client)
    .then((stats) => {
      cached = { at: Date.now(), stats };
      return stats;
    })
    .finally(() => {
      scanning = null;
    });
  return scanning;
}

/** Public market totals. No wallet address is sent or read here. */
export async function GET() {
  try {
    const fresh = cached && Date.now() - cached.at < FRESH_MS;
    const stats = fresh ? cached!.stats : await refresh();
    return Response.json(stats, { headers: { "cache-control": CACHE_HEADER } });
  } catch {
    if (cached) return Response.json(cached.stats);
    return Response.json({ error: "Stats are unavailable" }, { status: 502 });
  }
}
