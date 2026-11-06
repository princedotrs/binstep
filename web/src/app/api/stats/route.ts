import { DEVNET } from "@/lib/addresses";
import { serverClient } from "@/lib/server-rpc";
import { scanStats, type MarketStats } from "@/lib/stats";

export const dynamic = "force-dynamic";

const FRESH_MS = DEVNET ? 3_000 : 5 * 60_000;
const CACHE_HEADER = DEVNET ? "no-store" : "public, s-maxage=300, stale-while-revalidate=3600";

let cached: { at: number; stats: MarketStats } | null = null;
let scanning: Promise<MarketStats> | null = null;

function refresh() {
  scanning ??= scanStats(serverClient)
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
