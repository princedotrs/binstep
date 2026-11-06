import type { AutomationCounts } from "@/lib/activity";
import { scanAutomation } from "@/lib/activity";
import { DEVNET } from "@/lib/addresses";
import { LOG_RANGE, logClient } from "@/lib/server-rpc";

export const dynamic = "force-dynamic";

const FRESH_MS = DEVNET ? 3_000 : 60_000;
const CACHE_HEADER = DEVNET ? "no-store" : "public, s-maxage=60, stale-while-revalidate=300";

type Counts = Record<string, AutomationCounts>;

let cached: { at: number; counts: Counts } | null = null;
let scanning: Promise<Counts> | null = null;

function refresh() {
  scanning ??= scanAutomation(logClient, LOG_RANGE)
    .then((counts) => {
      cached = { at: Date.now(), counts };
      return counts;
    })
    .finally(() => {
      scanning = null;
    });
  return scanning;
}

/** Public counts per position. No wallet address is sent or read here. */
export async function GET() {
  try {
    const fresh = cached && Date.now() - cached.at < FRESH_MS;
    const counts = fresh ? cached!.counts : await refresh();
    return Response.json(counts, { headers: { "cache-control": CACHE_HEADER } });
  } catch {
    if (cached) return Response.json(cached.counts);
    return Response.json({ error: "Automation counts are unavailable" }, { status: 502 });
  }
}
