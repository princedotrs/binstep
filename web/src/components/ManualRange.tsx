"use client";

import { useEffect, useState } from "react";
import { MAX_BINS } from "@/lib/addresses";
import { edgeUsd, offsetOfUsd, type Range } from "@/lib/range";
import { REACH } from "./RangeChart";

const PRESETS = [
  { label: "±0.5%", bins: 5 },
  { label: "±1%", bins: 10 },
  { label: "±1.5%", bins: 15 },
];

const plain = (value: number) => value.toFixed(2);
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

function PriceBox(props: {
  label: string;
  value: number;
  now: number;
  onCommit: (usd: number) => void;
  onStep: (bins: number) => void;
}) {
  const [text, setText] = useState(plain(props.value));
  useEffect(() => setText(plain(props.value)), [props.value]);
  const change = (props.value / props.now - 1) * 100;
  const commit = () => {
    const usd = Number(text.replace(/,/g, ""));
    if (usd > 0) props.onCommit(usd);
    else setText(plain(props.value));
  };
  const step = "h-7 w-7 flex-none rounded-md bg-raised text-base leading-none hover:bg-line";
  return (
    <div className="rounded-lg border border-line bg-ink px-2.5 py-2 focus-within:border-accent">
      <label className="mb-1 flex justify-between text-xs text-muted">
        {props.label}
        <span className="font-mono">{change >= 0 ? "+" : ""}{change.toFixed(2)}%</span>
      </label>
      <div className="flex items-center gap-1.5">
        <input
          aria-label={props.label}
          inputMode="decimal"
          className="w-full min-w-0 flex-1 bg-transparent font-mono font-medium outline-none"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        />
        <button type="button" className={step} aria-label={`Lower ${props.label}`} onClick={() => props.onStep(-1)}>−</button>
        <button type="button" className={step} aria-label={`Raise ${props.label}`} onClick={() => props.onStep(1)}>+</button>
      </div>
    </div>
  );
}

export function ManualRange(p: { activeBin: number; flip: boolean; range: Range; onRange: (range: Range) => void }) {
  const { lo, hi } = p.range;
  const usdAt = (offset: number) => edgeUsd(p.activeBin, offset, p.flip);
  const now = usdAt(0);
  const n = hi - lo + 1;
  const setLow = (offset: number) => p.onRange({ lo: clamp(offset, Math.max(-REACH, hi - MAX_BINS + 1), hi), hi });
  const setHigh = (offset: number) => p.onRange({ lo, hi: clamp(offset, lo, Math.min(REACH - 1, lo + MAX_BINS - 1)) });

  return (
    <div>
      <div className="grid gap-2.5 sm:grid-cols-2">
        <PriceBox label="Min price" value={usdAt(lo)} now={now} onStep={(d) => setLow(lo + d)} onCommit={(usd) => setLow(offsetOfUsd(usd, p.activeBin, p.flip))} />
        <PriceBox label="Max price" value={usdAt(hi + 1)} now={now} onStep={(d) => setHigh(hi + d)} onCommit={(usd) => setHigh(offsetOfUsd(usd, p.activeBin, p.flip) - 1)} />
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {PRESETS.map(({ label, bins }) => {
          const on = lo === -bins && hi === bins;
          return (
            <button
              key={label}
              type="button"
              className={`rounded-full border px-2.5 py-1 text-xs ${on ? "border-accent bg-accent/15 text-text" : "border-line text-muted hover:border-muted"}`}
              onClick={() => p.onRange({ lo: -bins, hi: bins })}
            >
              {label}
            </button>
          );
        })}
        <span className={`ml-auto font-mono text-xs ${n >= MAX_BINS ? "text-warn" : "text-muted"}`}>
          {n} of {MAX_BINS} bins{n >= MAX_BINS ? ", the maximum" : ""}
        </span>
      </div>
    </div>
  );
}
