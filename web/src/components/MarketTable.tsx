"use client";

import Link from "next/link";
import { useState } from "react";
import { percent, price, usd } from "@/lib/format";
import { liquidityUsd, summarize, useAllStats, usePools } from "@/lib/hooks";
import { CATEGORIES, MARKETS, type Category } from "@/lib/markets";
import { LiquidityShape } from "./LiquidityShape";
import { PairIcon } from "./ui";

const HEAD = "px-4 py-3 text-right text-xs font-medium text-muted";
const CELL = "px-4 py-3.5 text-right font-mono text-sm";
const WIDE = "hidden md:table-cell";
const MID = "hidden sm:table-cell";

/** Every market. A row opens that market's pool or swap page. */
export function MarketTable({ link }: { link: "pool" | "swap" }) {
  const { data: pools, isError } = usePools();
  const { data: allStats, isError: statsFailed } = useAllStats();
  const [category, setCategory] = useState<Category | "All">("All");

  const wait = <span className="text-muted">{isError ? "Unavailable" : "…"}</span>;
  const waitStats = <span className="text-muted">{isError || statsFailed ? "Unavailable" : "…"}</span>;
  const markets = pools ? Object.values(pools).map((pool) => pool.market) : MARKETS;
  const present = CATEGORIES.filter((name) => markets.some((market) => market.category === name));
  const shown = markets.filter((market) => category === "All" || market.category === category);

  return (
    <>
      {present.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Filter markets">
          {(["All", ...present] as const).map((name) => (
            <button
              key={name}
              aria-pressed={category === name}
              className={`rounded-full border px-3 py-1 text-sm ${category === name ? "border-accent bg-accent/15 text-text" : "border-line text-muted hover:border-muted"}`}
              onClick={() => setCategory(name)}
            >
              {name}
            </button>
          ))}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-line bg-panel">
        <table className="w-full border-collapse">
          <thead className="border-b border-line">
            <tr>
              <th className={`${HEAD} text-left!`}>Market</th>
              <th className={HEAD}>Price</th>
              <th className={`${HEAD} ${WIDE}`}>Liquidity shape</th>
              <th className={HEAD}>Liquidity</th>
              <th className={`${HEAD} ${MID}`}>24h volume</th>
              <th className={`${HEAD} ${WIDE}`}>24h fees</th>
              <th className={HEAD}>APR</th>
              <th className={`${HEAD} ${MID}`}><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {shown.map((market) => {
              const pool = pools?.[market.id];
              const stats = summarize(allStats, pool);
              return (
              <tr key={market.id} className="market-row relative">
                <td className="px-4 py-3.5">
                  <Link href={link === "swap" ? market.swapHref : market.href} className="flex items-center gap-3 after:absolute after:inset-0">
                    <PairIcon symbol={market.symbol} />
                    <span>
                      <b className="block text-sm font-semibold">{market.name}</b>
                      <small className="text-xs text-muted">{market.title} · {market.category}</small>
                    </span>
                  </Link>
                </td>
                <td className={CELL}>{pool ? price(pool.usd) : wait}</td>
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
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
