"use client";

import Link from "next/link";
import { LiquidityShape } from "@/components/LiquidityShape";
import { Loading } from "@/components/Loading";
import { SwapPanel } from "@/components/SwapPanel";
import { PairIcon, Panel, Stat } from "@/components/ui";
import { feePercent, price, usd } from "@/lib/format";
import { liquidityUsd, usePool, useStats } from "@/lib/hooks";
import type { PoolState } from "@/lib/read";

function MarketPanel({ pool }: { pool: PoolState }) {
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
          <PairIcon />
          <div>
            <b className="block text-sm font-semibold">tWETH / tUSDC</b>
            <small className="text-xs text-muted">Dynamic fee · 0.10% bins</small>
          </div>
        </div>
        <Link href="/pool" className="rounded-lg border border-line bg-raised px-3 py-1.5 text-sm hover:border-muted">
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
            {legend("bg-weth", "tWETH")}
          </span>
        </div>
        <LiquidityShape pool={pool} reach={30} className="h-56 w-full" />
      </div>
    </Panel>
  );
}

export default function SwapPage() {
  const { data: pool, isError } = usePool();
  if (!pool) return <Loading error={isError} />;
  return (
    <div className="grid items-start gap-3.5 lg:grid-cols-[minmax(0,1fr)_26rem]">
      <div className="lg:order-last">
        <Panel>
          <h1 className="mb-3 text-sm font-semibold">Swap</h1>
          <SwapPanel pool={pool} />
        </Panel>
      </div>
      <MarketPanel pool={pool} />
    </div>
  );
}
