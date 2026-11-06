"use client";

import { WETH_IS_TOKEN0 } from "@/lib/addresses";
import { price } from "@/lib/format";
import { binToUsd, type ShapeBin } from "@/lib/math";

const REACH = 44;

type Props = {
  bins: { bin: number; liquidity: bigint }[];
  activeBin: number;
  preview?: ShapeBin[];
};

const SCALE = 10_000n;

export function BinChart({ bins, activeBin, preview = [] }: Props) {
  const first = activeBin - REACH;
  const count = REACH * 2 + 1;
  const byBin = new Map(bins.map((b) => [b.bin, b.liquidity]));
  const peak = bins.reduce((max, b) => (b.liquidity > max ? b.liquidity : max), 1n);
  const peakWeight = Math.max(1, ...preview.map((b) => b.weight));
  const shape = new Map(preview.map((b) => [b.bin, b.weight / peakWeight]));

  const columns = Array.from({ length: count }, (_, i) => {
    const bin = first + i;
    const liquidity = byBin.get(bin) ?? 0n;
    const height = Number((liquidity * SCALE) / peak) / Number(SCALE);
    const above = bin > activeBin === WETH_IS_TOKEN0;
    return { bin, height, ghost: shape.get(bin), color: bin === activeBin ? "bg-now" : above ? "bg-weth" : "bg-usdc" };
  });

  const edge = (bin: number) => price(binToUsd(bin, WETH_IS_TOKEN0));
  const low = WETH_IS_TOKEN0 ? first : first + count - 1;
  const high = WETH_IS_TOKEN0 ? first + count - 1 : first;
  const ordered = WETH_IS_TOKEN0 ? columns : [...columns].reverse();

  return (
    <figure>
      <div
        className="flex h-52 items-end gap-px sm:h-64"
        role="img"
        aria-label={`Liquidity by bin from ${edge(low)} to ${edge(high)}. The active bin is marked in white.`}
      >
        {ordered.map((c) => (
          <div key={c.bin} className="relative flex h-full min-w-0 flex-1 items-end" title={edge(c.bin)}>
            <div className={`w-full rounded-t-[1px] ${c.color}`} style={{ height: `${Math.max(c.height * 100, c.height > 0 ? 1 : 0)}%` }} />
            {c.ghost !== undefined && (
              <div
                className="absolute bottom-0 w-full border-x-0 border-t-2 border-text/80 bg-text/15"
                style={{ height: `${c.ghost * 100}%` }}
              />
            )}
          </div>
        ))}
      </div>
      <figcaption className="mt-2 flex items-center justify-between gap-3 font-mono text-xs text-muted">
        <span>{edge(low)}</span>
        <span className="flex gap-3 font-sans">
          <span className="flex items-center gap-1"><i className="h-2 w-2 bg-usdc" /> tUSDC</span>
          <span className="flex items-center gap-1"><i className="h-2 w-2 bg-now" /> Active</span>
          <span className="flex items-center gap-1"><i className="h-2 w-2 bg-weth" /> tWETH</span>
        </span>
        <span>{edge(high)}</span>
      </figcaption>
    </figure>
  );
}
