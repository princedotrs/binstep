"use client";

import { HeroWave } from "@/components/HeroWave";
import { MarketTable } from "@/components/MarketTable";
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
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Liquidity in bins, on Uniswap v4</h1>
          <p className="mt-2 max-w-lg leading-relaxed text-muted">
            Place your capital across 0.10% bins as Spot, Curve or Bid-Ask. Turn on automation and a keeper compounds your
            fees and moves a range that drifts out.
          </p>
        </div>
        <HeroWave />
      </div>

      <dl className="my-5 grid grid-cols-3 gap-x-3 border-t border-line pt-4 sm:flex sm:gap-x-9">
        {totals.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-muted">{label}</dt>
            <dd className="font-mono text-sm font-medium min-[380px]:text-base sm:text-xl">{value}</dd>
          </div>
        ))}
      </dl>

      <MarketTable link="pool" />
    </div>
  );
}
