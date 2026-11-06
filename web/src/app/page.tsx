"use client";

import { HeroWave } from "@/components/HeroWave";
import { MarketTable } from "@/components/MarketTable";
import { AimIcon, LoopIcon } from "@/components/ui";
import { usd } from "@/lib/format";
import { liquidityUsd, useAllStats, usePools } from "@/lib/hooks";

export default function MarketsPage() {
  const { data: pools, isError } = usePools();
  const { data: allStats, isError: statsFailed } = useAllStats();

  const wait = <span className="text-muted">{isError ? "Unavailable" : "…"}</span>;
  const waitStats = <span className="text-muted">{isError || statsFailed ? "Unavailable" : "…"}</span>;

  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
  const statTotal = (field: "volume" | "fees") => sum(Object.values(allStats ?? {}).map((stats) => stats[field]));

  const totals = [
    ["Total liquidity", pools ? usd(sum(Object.values(pools).map(liquidityUsd))) : wait],
    ["24h volume", allStats ? usd(statTotal("volume")) : waitStats],
    ["24h fees", allStats ? usd(statTotal("fees")) : waitStats],
  ] as const;


  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="min-w-72 flex-1">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Shape your liquidity.</h1>
          <p className="mt-2 max-w-md leading-relaxed text-muted">
            Pick a market, then draw exactly where your capital sits with Spot, Curve or Bid-Ask.
          </p>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
            <span className="flex items-center gap-1.5">
              <span className="text-accent"><LoopIcon size={15} /></span> Auto-compound
            </span>
            <span className="flex items-center gap-1.5">
              <span className="text-accent"><AimIcon size={15} /></span> Auto-rebalance
            </span>
          </div>
        </div>
        <HeroWave />
      </div>

      <dl className="my-5 flex flex-wrap gap-x-9 gap-y-3 border-t border-line pt-4">
        {totals.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-muted">{label}</dt>
            <dd className="font-mono text-xl font-medium">{value}</dd>
          </div>
        ))}
      </dl>

      <MarketTable link="pool" />
    </div>
  );
}
