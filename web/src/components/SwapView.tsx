"use client";

import Link from "next/link";
import { AirdropButton } from "./Airdrop";
import { LiquidityShape } from "./LiquidityShape";
import { Loading } from "./Loading";
import { SwapPanel } from "./SwapPanel";
import { PairIcon, Panel, Stat, UnverifiedNote } from "./ui";
import { feePercent, price, usd } from "@/lib/format";
import { liquidityUsd, usePool, useStats } from "@/lib/hooks";
import type { Market } from "@/lib/markets";
import type { PoolState } from "@/lib/read";

function MarketPanel({ pool }: { pool: PoolState }) {
  const { market } = pool;
  const { data: stats } = useStats(pool);
  const legend = (dot: string, label: string) => (
    <span className="flex items-center gap-1.5">
      <i className={`h-2 w-2 rounded-full ${dot}`} />
      {label}
    </span>
  );
  return (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <PairIcon symbol={market.symbol} />
          <div>
            <b className="block text-sm font-semibold">{market.name}</b>
            <small className="text-xs text-muted">{market.title} · Dynamic fee · {market.binWidth} bins</small>
          </div>
        </div>
        <Link href={market.href} className="rounded-lg border border-line bg-raised px-3 py-1.5 text-sm hover:border-muted">
          View pool
        </Link>
      </div>
      <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-2.5">
        <Stat label="Price" value={price(pool.usd)} />
        <Stat label="Liquidity" value={usd(liquidityUsd(pool))} />
        <Stat label="24h volume" value={stats ? usd(stats.volume) : "–"} />
        <Stat label="Swap fee now" value={feePercent(pool.feePips)} />
      </dl>
      <div className="mt-5 border-t border-line pt-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
          <span className="text-sm font-semibold text-text">Liquidity by bin</span>
          <span className="flex gap-3">
            {legend("bg-usdc", "tUSDC")}
            {legend("bg-now", "Price")}
            {legend("bg-asset", market.symbol)}
          </span>
        </div>
        <LiquidityShape pool={pool} reach={30} className="h-56 w-full" />
      </div>
    </Panel>
  );
}

export function SwapView({ market }: { market: Market }) {
  const { data: pool, isError } = usePool(market);
  if (!pool) return <Loading error={isError} />;
  return (
    <div className="space-y-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href="/swap" className="text-sm text-muted hover:text-text">← All markets</Link>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <AirdropButton market={market} />
        </div>
      </div>
      <UnverifiedNote market={market} />
      <div className="grid items-start gap-3.5 lg:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="lg:order-last">
          <Panel>
            <h1 className="mb-3 text-sm font-semibold">Swap</h1>
            <SwapPanel pool={pool} />
          </Panel>
        </div>
        <MarketPanel pool={pool} />
      </div>
    </div>
  );
}
