"use client";

import Link from "next/link";
import { HeroWave } from "@/components/HeroWave";
import { LiquidityShape } from "@/components/LiquidityShape";
import { AimIcon, LoopIcon, PairIcon } from "@/components/ui";
import { percent, usd } from "@/lib/format";
import { liquidityUsd, usePool, useStats } from "@/lib/hooks";
import { MARKETS } from "@/lib/markets";

const HEAD = "px-4 py-3 text-right text-xs font-medium text-muted";
const CELL = "px-4 py-3.5 text-right font-mono text-sm";
const WIDE = "hidden md:table-cell";
const MID = "hidden sm:table-cell";

export default function MarketsPage() {
  const { data: pool, isError } = usePool();
  const { data: stats, isError: statsFailed } = useStats(pool);

  const wait = <span className="text-muted">{isError ? "Unavailable" : "…"}</span>;
  const waitStats = <span className="text-muted">{isError || statsFailed ? "Unavailable" : "…"}</span>;

  const totals = [
    ["Total liquidity", pool ? usd(liquidityUsd(pool)) : wait],
    ["24h volume", stats ? usd(stats.volume) : waitStats],
    ["24h fees", stats ? usd(stats.fees) : waitStats],
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

      <div className="overflow-hidden rounded-xl border border-line bg-panel">
        <table className="w-full border-collapse">
          <thead className="border-b border-line">
            <tr>
              <th className={`${HEAD} text-left!`}>Market</th>
              <th className={`${HEAD} ${WIDE}`}>Liquidity shape</th>
              <th className={HEAD}>Liquidity</th>
              <th className={`${HEAD} ${MID}`}>24h volume</th>
              <th className={`${HEAD} ${WIDE}`}>24h fees</th>
              <th className={HEAD}>APR</th>
              <th className={`${HEAD} ${MID}`}><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {MARKETS.map((market) => (
              <tr key={market.id} className="market-row relative">
                <td className="px-4 py-3.5">
                  <Link href={market.href} className="flex items-center gap-3 after:absolute after:inset-0">
                    <PairIcon />
                    <span>
                      <b className="block text-sm font-semibold">{market.name}</b>
                      <small className="text-xs text-muted">Dynamic fee · {market.binWidth} bins</small>
                    </span>
                  </Link>
                </td>
                <td className={`${CELL} ${WIDE}`}>{pool ? <LiquidityShape pool={pool} /> : wait}</td>
                <td className={CELL}>{pool ? usd(liquidityUsd(pool)) : wait}</td>
                <td className={`${CELL} ${MID}`}>{stats ? usd(stats.volume) : waitStats}</td>
                <td className={`${CELL} ${WIDE}`}>{stats ? usd(stats.fees) : waitStats}</td>
                <td className={`${CELL} text-good`}>{stats ? percent(stats.apr) : waitStats}</td>
                <td className={`${CELL} ${MID}`}>
                  <span className="relative z-10 inline-flex gap-1.5 font-sans">
                    <Link href={market.swapHref} className="rounded-lg border border-line bg-raised px-3 py-2 text-sm hover:border-muted">
                      Swap
                    </Link>
                    <Link href={market.href} className="brand rounded-lg px-3.5 py-2 text-sm font-semibold hover:brightness-110">
                      Deposit
                    </Link>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
