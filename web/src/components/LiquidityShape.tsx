import type { PoolState } from "@/lib/read";

/** The liquidity in each bin around the price, using the same colors as the range chart. */
export function LiquidityShape({ pool, reach = 15, className = "h-6.5 w-22" }: { pool: PoolState; reach?: number; className?: string }) {
  const heights = Array.from({ length: reach * 2 + 1 }, (_, i) => {
    const bin = pool.activeBin - reach + i;
    return { i, bin, liquidity: pool.bins.find((b) => b.bin === bin)?.liquidity ?? 0n };
  });
  const peak = heights.reduce((max, b) => (b.liquidity > max ? b.liquidity : max), 1n);
  return (
    <span className={`inline-flex items-end gap-px ${className}`} aria-hidden>
      {heights.map(({ i, bin, liquidity }) => (
        <i
          key={i}
          className={`min-h-px flex-1 ${bin === pool.activeBin ? "bg-now" : bin > pool.activeBin === pool.wethIsToken0 ? "bg-weth" : "bg-usdc"}`}
          style={{ height: `${Number((liquidity * 100n) / peak)}%` }}
        />
      ))}
    </span>
  );
}
