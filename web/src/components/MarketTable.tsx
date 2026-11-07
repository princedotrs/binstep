"use client";

import Link from "next/link";
import { useState } from "react";
import { percent, price, usd } from "@/lib/format";
import { liquidityUsd, summarize, useAllStats, usePools } from "@/lib/hooks";
import { CATEGORIES, MARKETS, type Category } from "@/lib/markets";
import { LiquidityShape } from "./LiquidityShape";
import { PairIcon } from "./ui";

const HEAD = "px-2 py-3 text-right first:pl-0 lg:px-4 text-xs font-medium text-muted";
const CELL = "px-2 py-3.5 text-right lg:px-4 font-mono text-sm";
const WIDE = "hidden lg:table-cell";

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
        <div className="scroll-row mb-1 flex gap-5 overflow-x-auto border-b border-line" role="group" aria-label="Filter markets">
          {(["All", ...present] as const).map((name) => (
            <button
              key={name}
              aria-pressed={category === name}
              className={`-mb-px flex-none border-b-2 py-2.5 text-sm ${category === name ? "border-text text-text" : "border-transparent text-muted hover:text-text"}`}
              onClick={() => setCategory(name)}
            >
              {name}
            </button>
          ))}
        </div>
      )}

      <ul className="sm:hidden">
        {shown.map((market) => {
          const pool = pools?.[market.id];
          const stats = summarize(allStats, pool);
          return (
            <li key={market.id} className="border-b border-line">
              <Link href={link === "swap" ? market.swapHref : market.href} className="block py-3">
                <span className="flex items-center gap-2.5">
                  <PairIcon symbol={market.symbol} />
                  <span className="min-w-0 flex-1">
                    <b className="block truncate text-sm font-semibold">{market.name}</b>
                    <small className="block truncate text-xs text-muted">{market.title}</small>
                  </span>
                  {pool && <LiquidityShape pool={pool} className="h-6.5 w-16 flex-none" />}
                  <span className="w-24 flex-none text-right font-mono text-sm">{pool ? price(pool.usd) : wait}</span>
                </span>
                <span className="mt-2 flex justify-between gap-3 font-mono text-xs text-muted">
                  <span>Liq {pool ? usd(liquidityUsd(pool)) : wait}</span>
                  <span>Vol {stats ? usd(stats.volume) : waitStats}</span>
                  <span className="text-good">APR {stats ? percent(stats.apr) : waitStats}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      <table className="hidden w-full border-collapse sm:table">
        <thead className="border-b border-line">
          <tr>
            <th className={`${HEAD} text-left!`}>Market</th>
            <th className={HEAD}>Price</th>
            <th className={`${HEAD} ${WIDE}`}>Liquidity shape</th>
            <th className={HEAD}>Liquidity</th>
            <th className={HEAD}>24h volume</th>
            <th className={`${HEAD} ${WIDE}`}>24h fees</th>
            <th className={HEAD}>APR</th>
            <th className={HEAD}><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {shown.map((market) => {
            const pool = pools?.[market.id];
            const stats = summarize(allStats, pool);
            return (
              <tr key={market.id} className="market-row relative border-b border-line">
                <td className="px-2 py-3.5 first:pl-0 lg:px-4">
                  <Link href={link === "swap" ? market.swapHref : market.href} className="flex items-center gap-3 after:absolute after:inset-0">
                    <PairIcon symbol={market.symbol} />
                    <span>
                      <b className="block text-sm font-semibold whitespace-nowrap">{market.name}</b>
                      <small className="text-xs text-muted">{market.title} · {market.category}</small>
                    </span>
                  </Link>
                </td>
                <td className={CELL}>{pool ? price(pool.usd) : wait}</td>
                <td className={`${CELL} ${WIDE}`}>{pool ? <LiquidityShape pool={pool} /> : wait}</td>
                <td className={CELL}>{pool ? usd(liquidityUsd(pool)) : wait}</td>
                <td className={CELL}>{stats ? usd(stats.volume) : waitStats}</td>
                <td className={`${CELL} ${WIDE}`}>{stats ? usd(stats.fees) : waitStats}</td>
                <td className={`${CELL} text-good`}>{stats ? percent(stats.apr) : waitStats}</td>
                <td className={CELL}>
                  <span className="relative z-10 inline-flex gap-3.5 font-sans">
                    <Link href={market.swapHref} className="text-sm text-muted hover:text-text">Swap</Link>
                    <Link href={market.href} className="text-sm text-text hover:text-muted">Deposit</Link>
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
