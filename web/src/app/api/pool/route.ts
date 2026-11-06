import { encodePool, readPool } from "@/lib/read";
import { serverClient } from "@/lib/server-rpc";

export const dynamic = "force-dynamic";

const FRESH_MS = 5_000;

let cached: { at: number; body: string } | null = null;
let reading: Promise<string> | null = null;

function refresh() {
  reading ??= readPool(serverClient)
    .then((pool) => {
      const body = encodePool(pool);
      cached = { at: Date.now(), body };
      return body;
    })
    .finally(() => {
      reading = null;
    });
  return reading;
}

const reply = (body: string) => new Response(body, { headers: { "content-type": "application/json" } });

/** Public pool state. No wallet address is sent or read here. `fresh` follows a transaction. */
export async function GET(request: Request) {
  const force = new URL(request.url).searchParams.has("fresh");
  try {
    const usable = !force && cached && Date.now() - cached.at < FRESH_MS;
    return reply(usable ? cached!.body : await refresh());
  } catch {
    if (cached) return reply(cached.body);
    return Response.json({ error: "Pool data is unavailable" }, { status: 502 });
  }
}
