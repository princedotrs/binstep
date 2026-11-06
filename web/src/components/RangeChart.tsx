"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { MAX_BINS } from "@/lib/addresses";
import { price, usd } from "@/lib/format";
import { poolLiquidity, shapeCurve, strategyWeights, successorBin, type Strategy } from "@/lib/math";
import type { PoolState } from "@/lib/read";
import { binAtOffset, edgeUsd, type Range } from "@/lib/range";

/** Bins shown either side of the price. */
export const REACH = 40;
const COLUMNS = REACH * 2;
const SCRUB_BINS = 30;

const POOL_HEIGHT = 0.56;
const MINE_HEIGHT = 0.42;
const MARK_HEIGHT = 0.8;
const FULL_SIZE_DEPOSIT_USD = 40_000;
const SAMPLES = 64;
const SETTLE = 0.0015;
const EASE = 0.2;

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const percentOf = (offset: number) => ((offset + REACH) / COLUMNS) * 100;

type Props = {
  pool: PoolState;
  strategy: Strategy;
  range: Range;
  onRange: (range: Range) => void;
  scrub: number;
  onScrub: (bins: number) => void;
  depositUsd: number;
  autoRebalance: boolean;
};

/** Soft strategy outline behind the bars. It eases toward its target as the bars do. */
function Watermark({ strategy, left, width }: { strategy: Strategy; left: number; width: number }) {
  const fill = useRef<SVGPathElement>(null);
  const line = useRef<SVGPathElement>(null);
  const now = useRef<number[]>(new Array(SAMPLES + 1).fill(0));

  useEffect(() => {
    const target = Array.from({ length: SAMPLES + 1 }, (_, k) => shapeCurve(strategy, k / SAMPLES) * MARK_HEIGHT);
    const instant = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    const step = () => {
      let moving = false;
      now.current = now.current.map((value, k) => {
        const gap = target[k] - value;
        if (Math.abs(gap) <= SETTLE || instant) return target[k];
        moving = true;
        return value + gap * EASE;
      });
      const points = now.current.map((v, k) => `${(k / SAMPLES) * 100},${100 - v * 100}`).join(" L");
      line.current?.setAttribute("d", `M${points}`);
      fill.current?.setAttribute("d", `M0,100 L${points} L100,100 Z`);
      if (moving) frame = requestAnimationFrame(step);
    };
    step();
    return () => cancelAnimationFrame(frame);
  }, [strategy]);

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className="pointer-events-none absolute top-8.5 bottom-0 h-[calc(100%-2.125rem)] overflow-visible"
      style={{ left: `${left}%`, width: `${width}%` }}
      aria-hidden
    >
      <defs>
        <linearGradient id="watermark" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="var(--color-accent)" stopOpacity=".2" />
          <stop offset="1" stopColor="var(--color-accent)" stopOpacity=".03" />
        </linearGradient>
      </defs>
      <path ref={fill} fill="url(#watermark)" />
      <path ref={line} fill="none" stroke="var(--color-accent)" strokeOpacity=".35" strokeWidth="1" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function RangeChart({ pool, strategy, range, onRange, scrub, onScrub, depositUsd, autoRebalance }: Props) {
  const chart = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const { activeBin, wethIsToken0: flip } = pool;
  const { lo, hi } = range;
  const n = hi - lo + 1;
  const eff = scrub;

  const liquidityByOffset = useMemo(() => {
    const byBin = new Map(pool.bins.map((b) => [b.bin, b.liquidity]));
    return Array.from({ length: COLUMNS }, (_, i) => byBin.get(binAtOffset(activeBin, i - REACH, flip)) ?? 0n);
  }, [pool.bins, activeBin, flip]);
  const peak = liquidityByOffset.reduce((max, l) => (l > max ? l : max), 1n);
  const weights = strategyWeights(strategy, n);
  const heaviest = Math.max(...weights);
  const total = weights.reduce((a, b) => a + b, 0);
  const size = Math.min(1, 0.5 + depositUsd / FULL_SIZE_DEPOSIT_USD);

  const offsetAt = (x: number) => {
    const box = chart.current!.getBoundingClientRect();
    return ((x - box.left) / box.width) * COLUMNS - REACH;
  };

  function drag(event: ReactPointerEvent<HTMLElement>, move: (x: number, startX: number) => void) {
    event.preventDefault();
    const target = event.currentTarget;
    const startX = event.clientX;
    target.setPointerCapture(event.pointerId);
    setHover(null);
    const onMove = (e: PointerEvent) => move(e.clientX, startX);
    const onUp = () => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
  }

  const setLow = (offset: number) => onRange({ lo: clamp(offset, Math.max(-REACH, hi - MAX_BINS + 1), hi), hi });
  const setHigh = (offset: number) => onRange({ lo, hi: clamp(offset, lo, Math.min(REACH - 1, lo + MAX_BINS - 1)) });

  const dragBand = (event: ReactPointerEvent<HTMLElement>) => {
    const start = { lo, hi };
    drag(event, (x, startX) => {
      const moved = Math.round(offsetAt(x) - offsetAt(startX));
      const nextLo = clamp(start.lo + moved, -REACH, REACH - 1 - (start.hi - start.lo));
      onRange({ lo: nextLo, hi: nextLo + start.hi - start.lo });
    });
  };

  const keys = (set: (offset: number) => void, value: number) => (e: React.KeyboardEvent) => {
    const step = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
    if (!step) return;
    e.preventDefault();
    set(value + step);
  };

  const left = percentOf(lo);
  const right = percentOf(hi + 1);
  const close = right - left < 13;

  const lowerBin = flip ? activeBin + lo : activeBin - hi;
  const inRange = eff >= lo && eff <= hi;
  const successor = successorBin(lowerBin, n, binAtOffset(activeBin, eff, flip));
  const ghostLo = eff > hi ? eff - n : eff + 1;
  const showGhost = !inRange && autoRebalance && successor !== null && ghostLo >= -REACH && ghostLo + n <= REACH;
  const held = eff > hi ? "tUSDC" : "tWETH";
  const scrubPercent = (edgeUsd(activeBin, eff, flip) / edgeUsd(activeBin, 0, flip) - 1) * 100;

  const hovered = hover === null ? null : (() => {
    const bin = binAtOffset(activeBin, hover, flip);
    const liquidity = liquidityByOffset[hover + REACH];
    const amounts = poolLiquidity([{ bin, liquidity }], pool.tick, flip);
    const yours = hover >= lo && hover <= hi ? (depositUsd * weights[hover - lo]) / total : 0;
    return { at: edgeUsd(activeBin, hover, flip), pool: amounts.weth * pool.usd + amounts.usdc, yours };
  })();

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Set your range</h2>
        <div className="flex gap-3 text-xs text-muted">
          <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-sm bg-usdc" />tUSDC</span>
          <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-sm bg-now" />Price</span>
          <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-sm bg-weth" />tWETH</span>
        </div>
      </div>

      <div
        ref={chart}
        className="relative h-68 overflow-hidden rounded-lg border border-line bg-ink select-none sm:h-85"
        onPointerMove={(e) => {
          if (e.pointerType === "touch" || e.buttons) return;
          setHover(clamp(Math.floor(offsetAt(e.clientX)), -REACH, REACH - 1));
        }}
        onPointerLeave={() => setHover(null)}
      >
        <Watermark strategy={strategy} left={left} width={right - left} />

        <div className="absolute inset-x-0 top-8.5 bottom-0 flex items-end gap-px">
          {liquidityByOffset.map((liquidity, i) => {
            const offset = i - REACH;
            const base = (Number((liquidity * 10_000n) / peak) / 10_000) * POOL_HEIGHT * 100;
            const mine = offset >= lo && offset <= hi ? (weights[offset - lo] / heaviest) * MINE_HEIGHT * size * 100 : 0;
            const side = offset < eff ? "usdc" : offset > eff ? "weth" : "";
            return (
              <div key={offset} className={`chart-col ${side} ${offset === hover ? "hover" : ""}`}>
                <div className="chart-pool" style={{ height: `${base}%` }} />
                <div className="chart-mine" style={{ bottom: `${base}%`, height: `${mine}%` }} />
              </div>
            );
          })}
        </div>

        <div
          className="chart-band"
          title="Drag to move the whole range"
          style={{ left: `${left}%`, width: `${right - left}%` }}
          onPointerDown={dragBand}
        />

        {showGhost && (
          <div
            className="pointer-events-none absolute top-8.5 bottom-0 z-2 rounded-t-md border-[1.5px] border-b-0 border-dashed border-good bg-good/8"
            style={{ left: `${percentOf(ghostLo)}%`, width: `${(n / COLUMNS) * 100}%` }}
          >
            <span className="absolute top-1.5 left-1/2 -translate-x-1/2 text-[11px] font-medium whitespace-nowrap text-good">
              Rebalances here
            </span>
          </div>
        )}

        <div
          className="pointer-events-none absolute top-0 bottom-0 z-2 border-l border-dashed border-white/60 transition-[left] duration-150"
          style={{ left: `${percentOf(eff) + 50 / COLUMNS}%` }}
        />

        {[
          { edge: left, offset: lo, label: "Minimum price", side: close ? "-translate-x-full" : "-translate-x-1/2" },
          { edge: right, offset: hi + 1, label: "Maximum price", side: close ? "" : "-translate-x-1/2" },
        ].map(({ edge, offset, side }) => (
          <span
            key={offset}
            className={`pointer-events-none absolute top-2 z-4 rounded-md border border-line bg-raised px-1.5 py-0.5 font-mono text-[11.5px] font-medium whitespace-nowrap ${side}`}
            style={{ left: `${clamp(edge, 5, 95)}%` }}
          >
            {price(edgeUsd(activeBin, offset, flip))}
          </span>
        ))}

        <button
          type="button"
          role="slider"
          aria-label="Minimum price"
          aria-valuemin={-REACH}
          aria-valuemax={REACH}
          aria-valuenow={lo}
          aria-valuetext={price(edgeUsd(activeBin, lo, flip))}
          className="chart-handle"
          style={{ left: `${left}%` }}
          onKeyDown={keys(setLow, lo)}
          onPointerDown={(e) => drag(e, (x) => setLow(Math.round(offsetAt(x))))}
        >
          <span className="chart-grip">⋮</span>
        </button>
        <button
          type="button"
          role="slider"
          aria-label="Maximum price"
          aria-valuemin={-REACH}
          aria-valuemax={REACH}
          aria-valuenow={hi + 1}
          aria-valuetext={price(edgeUsd(activeBin, hi + 1, flip))}
          className="chart-handle"
          style={{ left: `${right}%` }}
          onKeyDown={keys(setHigh, hi)}
          onPointerDown={(e) => drag(e, (x) => setHigh(Math.round(offsetAt(x)) - 1))}
        >
          <span className="chart-grip">⋮</span>
        </button>

        {hovered && hover !== null && (
          <div
            className={`pointer-events-none absolute top-11 z-5 rounded-lg border border-line bg-raised px-2.5 py-1.5 font-mono text-xs leading-relaxed whitespace-nowrap shadow-xl ${percentOf(hover) > 70 ? "-translate-x-full" : ""}`}
            style={{ left: `calc(${percentOf(hover)}% + ${percentOf(hover) > 70 ? "-10px" : "14px"})` }}
          >
            <div><small className="mr-2 font-sans text-muted">Price</small>{price(hovered.at)}</div>
            <div><small className="mr-2 font-sans text-muted">Pool</small>{usd(hovered.pool)}</div>
            <div><small className="mr-2 font-sans text-muted">Yours</small>{usd(hovered.yours)}</div>
          </div>
        )}
      </div>

      <div className="mt-1.5 flex justify-between font-mono text-xs text-muted">
        {[-REACH, -REACH / 2, 0, REACH / 2, REACH].map((offset, i) => (
          <span key={offset} className={i % 2 ? "hidden sm:inline" : ""}>{price(edgeUsd(activeBin, offset, flip))}</span>
        ))}
      </div>
      <p className="mt-1 text-xs text-faint">Your bars are enlarged so they stay visible. Hover a bin for exact amounts.</p>

      <div className="mt-3 grid items-center gap-x-3 gap-y-1 rounded-lg bg-raised px-3 py-2.5 text-sm sm:grid-cols-[auto_1fr_auto]">
        <label htmlFor="whatif">What if the price moves?</label>
        <input
          id="whatif"
          type="range"
          className="w-full accent-accent"
          min={-SCRUB_BINS}
          max={SCRUB_BINS}
          value={scrub}
          onChange={(e) => onScrub(Number(e.target.value))}
        />
        <span className="font-mono text-xs sm:min-w-34 sm:text-right">
          {scrub === 0 ? "No move" : `${scrubPercent >= 0 ? "+" : ""}${scrubPercent.toFixed(1)}% → ${price(edgeUsd(activeBin, eff, flip))}`}
        </span>
      </div>
      <p className="mt-2 flex items-start gap-2 text-sm">
        <i className={`mt-1.5 h-2 w-2 flex-none rounded-full ${inRange ? "bg-good" : "bg-warn"}`} />
        {inRange
          ? "Earning fees at this price."
          : autoRebalance
            ? `Out of range, all in ${held}. Auto-rebalance moves it beside the price, where it waits in one token for the price to return.`
            : `Out of range, all in ${held}. It earns nothing until the price moves back.`}
      </p>
    </div>
  );
}
