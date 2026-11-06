"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AirdropButton } from "./Airdrop";
import { DepositPanel, type Draft } from "./DepositPanel";
import { Loading } from "./Loading";
import { ManualRange } from "./ManualRange";
import { RangeChart } from "./RangeChart";
import { PairIcon, Panel, Stat, UnverifiedNote } from "./ui";
import { feePercent, percent, price, usd } from "@/lib/format";
import { liquidityUsd, usePool, useStats } from "@/lib/hooks";
import type { Market } from "@/lib/markets";
import { depositSplit, estimateEarnings, type Strategy } from "@/lib/math";
import { binAtOffset, lowerBinOf, type Range } from "@/lib/range";
import type { PoolState } from "@/lib/read";
import { mintSides } from "@/lib/validate";

const trim = (value: number, decimals: number) => (value > 0 ? String(Number(value.toFixed(decimals))) : "");

function Workspace({ pool }: { pool: PoolState }) {
  const { data: stats } = useStats(pool);
  const [strategy, setStrategy] = useState<Strategy>(1);
  const [range, setRange] = useState<Range>({ lo: -8, hi: 7 });
  const [scrub, setScrub] = useState(0);
  const [manual, setManual] = useState(false);
  const [anchor, setAnchor] = useState<{ side: "base" | "usdc"; text: string }>({ side: "base", text: "" });
  const { market } = pool;
  const [autoCompound, setAutoCompound] = useState(true);
  const [autoRebalance, setAutoRebalance] = useState(true);

  const { activeBin, tick, market: pair } = pool;
  const numBins = range.hi - range.lo + 1;
  const lowerBin = lowerBinOf(activeBin, range, pair);
  const sides = mintSides(lowerBin, numBins, activeBin, pair);

  /** The other token follows the one the user typed, at the ratio the contract spends. */
  const amounts = useMemo(() => {
    const split = depositSplit(strategy, lowerBin, numBins, tick, pair);
    const typed = Number(anchor.text) || 0;
    const usdValue = anchor.side === "base" ? typed * pool.usd : typed;
    if (!sides.base) return { base: "", usdc: anchor.side === "usdc" ? anchor.text : trim(usdValue, 2), baseUsd: 0, usdcUsd: usdValue };
    if (!sides.usdc) return { usdc: "", base: anchor.side === "base" ? anchor.text : trim(usdValue / pool.usd, 6), baseUsd: usdValue, usdcUsd: 0 };
    const base = anchor.side === "base" ? typed : (typed * split.base) / split.usdc;
    const usdc = anchor.side === "usdc" ? typed : (typed * split.usdc) / split.base;
    return {
      base: anchor.side === "base" ? anchor.text : trim(base, 6),
      usdc: anchor.side === "usdc" ? anchor.text : trim(usdc, 2),
      baseUsd: base * pool.usd,
      usdcUsd: usdc,
    };
  }, [anchor, strategy, lowerBin, numBins, tick, pair, sides.base, sides.usdc, pool.usd]);

  const depositUsd = amounts.baseUsd + amounts.usdcUsd;
  const earnings = estimateEarnings({
    strategy,
    lowerBin,
    numBins,
    tick,
    activeBin: binAtOffset(activeBin, scrub, pair),
    usdPrice: pool.usd,
    pair,
    depositUsd,
    bins: pool.bins,
    fees24h: stats?.fees ?? 0,
  });

  const draft: Draft = {
    strategy,
    onStrategy: setStrategy,
    lowerBin,
    numBins,
    sides,
    base: amounts.base,
    usdc: amounts.usdc,
    onBase: (text) => setAnchor({ side: "base", text }),
    onUsdc: (text) => setAnchor({ side: "usdc", text }),
    onReset: () => setAnchor({ side: "base", text: "" }),
    baseUsd: amounts.baseUsd,
    usdcUsd: amounts.usdcUsd,
    earnings,
    autoCompound,
    onAutoCompound: setAutoCompound,
    autoRebalance,
    onAutoRebalance: setAutoRebalance,
  };

  const mode = (on: boolean, label: string, value: boolean) => (
    <button
      type="button"
      className={`rounded-md px-3 py-1 text-xs ${on ? "bg-raised text-text" : "text-muted"}`}
      onClick={() => setManual(value)}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href="/" className="text-sm text-muted hover:text-text">← All markets</Link>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <AirdropButton market={market} />
        </div>
      </div>

      <UnverifiedNote market={market} />
      <Panel className="py-3">
        <dl className="flex flex-wrap items-center gap-x-8 gap-y-2.5">
          <div className="flex items-center gap-3">
            <PairIcon symbol={market.symbol} />
            <div>
              <b className="block text-sm font-semibold">{market.name}</b>
              <small className="text-xs text-muted">{market.title} · Dynamic fee · {market.binWidth} bins</small>
            </div>
          </div>
          <Stat label="Price" value={price(pool.usd)} />
          <Stat label="Liquidity" value={usd(liquidityUsd(pool))} />
          <Stat label="24h volume" value={stats ? usd(stats.volume) : "–"} />
          <Stat label="Swap fee now" value={feePercent(pool.feePips)} />
          <Stat label="APR" tone="text-good" value={stats ? percent(stats.apr) : "–"} />
        </dl>
      </Panel>

      <div className="grid items-start gap-3.5 lg:grid-cols-[minmax(0,1fr)_23.5rem]">
        <Panel>
          <RangeChart
            pool={pool}
            strategy={strategy}
            range={range}
            onRange={setRange}
            scrub={scrub}
            onScrub={setScrub}
            depositUsd={depositUsd}
            autoRebalance={autoRebalance}
          />
          <div className="mt-3 border-t border-line pt-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">How to set it</span>
              <span className="inline-flex rounded-lg bg-ink p-0.5">
                {mode(!manual, "Chart", false)}
                {mode(manual, "Manual", true)}
              </span>
            </div>
            {manual && (
              <div className="mt-3">
                <ManualRange activeBin={activeBin} pair={pair} range={range} onRange={setRange} />
              </div>
            )}
          </div>
        </Panel>

        <Panel>
          <div className="-mt-1 mb-3.5 flex items-center justify-between border-b border-line pb-2.5">
            <h2 className="font-medium">Deposit</h2>
            <Link href={market.swapHref} className="text-sm text-muted hover:text-text">Swap →</Link>
          </div>
          <DepositPanel pool={pool} stats={stats} draft={draft} />
        </Panel>
      </div>
    </div>
  );
}

export function PoolView({ market }: { market: Market }) {
  const { data: pool, isError } = usePool(market);
  if (!pool) return <Loading error={isError} />;
  return <Workspace pool={pool} />;
}
