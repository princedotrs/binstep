"use client";

import { Loading } from "./Loading";
import { PoolView } from "./PoolView";
import { SwapView } from "./SwapView";
import { usePools } from "@/lib/hooks";

/** Created markets are not known at build time, so the page finds them in the pool data. */
export function CommunityMarket({ id, view }: { id: string; view: "pool" | "swap" }) {
  const { data: pools, isError } = usePools();
  const market = pools?.[id]?.market;

  if (market) return view === "pool" ? <PoolView market={market} /> : <SwapView market={market} />;
  if (!pools) return <Loading error={isError} />;
  return <p className="text-sm text-muted">No market here. A new market can take a few seconds to appear.</p>;
}
