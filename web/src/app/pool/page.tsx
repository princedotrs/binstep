"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { DepositPanel, type Draft } from "@/components/DepositPanel";
import { Loading } from "@/components/Loading";
import { ManualRange } from "@/components/ManualRange";
import { RangeChart } from "@/components/RangeChart";
import { SwapPanel } from "@/components/SwapPanel";
import { PairIcon, Panel, Stat } from "@/components/ui";
import { feePercent, percent, price, usd } from "@/lib/format";
import { liquidityUsd, usePool, useStats } from "@/lib/hooks";
import { depositSplit, estimateEarnings, type Strategy } from "@/lib/math";
import { binAtOffset, lowerBinOf, type Range } from "@/lib/range";
import type { PoolState } from "@/lib/read";
import { mintSides } from "@/lib/validate";

const trim = (value: number, decimals: number) => (value > 0 ? String(Number(value.toFixed(decimals))) : "");

function Workspace({ pool }: { pool: PoolState }) {
  const { data: stats } = useStats(pool);
  const [tab, setTab] = useState<"deposit" | "swap">("deposit");
  const [strategy, setStrategy] = useState<Strategy>(1);
  const [range, setRange] = useState<Range>({ lo: -8, hi: 7 });
  const [scrub, setScrub] = useState(0);
  const [manual, setManual] = useState(false);
  const [anchor, setAnchor] = useState<{ side: "weth" | "usdc"; text: string }>({ side: "weth", text: "" });
  const [autoCompound, setAutoCompound] = useState(true);
  const [autoRebalance, setAutoRebalance] = useState(true);

  useEffect(() => {
    if (new URLSearchParams(location.search).get("tab") === "swap") setTab("swap");
  }, []);

  const { activeBin, tick, wethIsToken0: flip } = pool;
  const numBins = range.hi - range.lo + 1;
  const lowerBin = lowerBinOf(activeBin, range, flip);
  const sides = mintSides(lowerBin, numBins, activeBin, flip);

  /** The other token follows the one the user typed, at the ratio the contract spends. */
  const amounts = useMemo(() => {
    const split = depositSplit(strategy, lowerBin, numBins, tick, flip);
    const typed = Number(anchor.text) || 0;
    const usdValue = anchor.side === "weth" ? typed * pool.usd : typed;
    if (!sides.weth) return { weth: "", usdc: anchor.side === "usdc" ? anchor.text : trim(usdValue, 2), wethUsd: 0, usdcUsd: usdValue };
    if (!sides.usdc) return { usdc: "", weth: anchor.side === "weth" ? anchor.text : trim(usdValue / pool.usd, 6), wethUsd: usdValue, usdcUsd: 0 };
    const weth = anchor.side === "weth" ? typed : (typed * split.weth) / split.usdc;
    const usdc = anchor.side === "usdc" ? typed : (typed * split.usdc) / split.weth;
    return {
      weth: anchor.side === "weth" ? anchor.text : trim(weth, 6),
      usdc: anchor.side === "usdc" ? anchor.text : trim(usdc, 2),
      wethUsd: weth * pool.usd,
      usdcUsd: usdc,
    };
  }, [anchor, strategy, lowerBin, numBins, tick, flip, sides.weth, sides.usdc, pool.usd]);

  const depositUsd = amounts.wethUsd + amounts.usdcUsd;
  const earnings = estimateEarnings({
    strategy,
    lowerBin,
    numBins,
    tick,
    activeBin: binAtOffset(activeBin, scrub, flip),
    usdPrice: pool.usd,
    wethIsToken0: flip,
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
    weth: amounts.weth,
    usdc: amounts.usdc,
    onWeth: (text) => setAnchor({ side: "weth", text }),
    onUsdc: (text) => setAnchor({ side: "usdc", text }),
    onReset: () => setAnchor({ side: "weth", text: "" }),
    wethUsd: amounts.wethUsd,
    usdcUsd: amounts.usdcUsd,
    earnings,
    autoCompound,
    onAutoCompound: setAutoCompound,
    autoRebalance,
    onAutoRebalance: setAutoRebalance,
  };

  const tabButton = (id: typeof tab, label: string) => (
    <button
      className={`-mb-px border-b-2 pb-2.5 font-medium ${tab === id ? "border-accent text-text" : "border-transparent text-muted"}`}
      onClick={() => setTab(id)}
    >
      {label}
    </button>
  );
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
      <Link href="/" className="inline-block text-sm text-muted hover:text-text">← All markets</Link>

      <Panel className="py-3">
        <dl className="flex flex-wrap items-center gap-x-8 gap-y-2.5">
          <div className="flex items-center gap-3">
            <PairIcon />
            <div>
              <b className="block text-sm font-semibold">tWETH / tUSDC</b>
              <small className="text-xs text-muted">Dynamic fee · 0.10% bins</small>
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
                <ManualRange activeBin={activeBin} flip={flip} range={range} onRange={setRange} />
              </div>
            )}
          </div>
        </Panel>

        <Panel>
          <div className="-mt-1 mb-3.5 flex gap-4.5 border-b border-line">
            {tabButton("deposit", "Deposit")}
            {tabButton("swap", "Swap")}
          </div>
          {tab === "deposit" ? <DepositPanel pool={pool} stats={stats} draft={draft} /> : <SwapPanel pool={pool} />}
        </Panel>
      </div>
    </div>
  );
}

export default function PoolPage() {
  const { data: pool, isError } = usePool();
  if (!pool) return <Loading error={isError} />;
  return <Workspace pool={pool} />;
}
