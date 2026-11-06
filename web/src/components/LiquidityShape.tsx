import { binAtOffset } from "@/lib/range";
import type { PoolState } from "@/lib/read";

/** The liquidity around the price, low USD prices first, using the range chart's colors. */
export function LiquidityShape({ pool, reach = 15, className = "h-6.5 w-22" }: { pool: PoolState; reach?: number; className?: string }) {
  const heights = Array.from({ length: reach * 2 + 1 }, (_, i) => {
    const offset = i - reach;
    const bin = binAtOffset(pool.activeBin, offset, pool.market);
    return { offset, liquidity: pool.bins.find((b) => b.bin === bin)?.liquidity ?? 0n };
  });
  const peak = heights.reduce((max, b) => (b.liquidity > max ? b.liquidity : max), 1n);
  return (
    <span className={`inline-flex items-end gap-px ${className}`} aria-hidden>
      {heights.map(({ offset, liquidity }) => (
        <i
          key={offset}
          className={`min-h-px flex-1 ${offset === 0 ? "bg-now" : offset > 0 ? "bg-asset" : "bg-usdc"}`}
          style={{ height: `${Number((liquidity * 100n) / peak)}%` }}
        />
      ))}
    </span>
  );
}
