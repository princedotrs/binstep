"use client";

import Link from "next/link";
import { feePercent, price, usd } from "@/lib/format";
import { usePool } from "@/lib/hooks";
import { MARKETS } from "@/lib/markets";
import { poolLiquidity } from "@/lib/math";
import type { PoolState } from "@/lib/read";

const HEAD = "px-4 py-2.5 text-left text-xs font-medium text-muted";
const CELL = "px-4 py-3 font-mono text-sm";
const WIDE = "hidden sm:table-cell";

function totalValue(pool: PoolState) {
  const { weth, usdc } = poolLiquidity(pool.bins, pool.tick, pool.wethIsToken0);
  return weth * pool.usd + usdc;
}

const Pending = ({ failed }: { failed: boolean }) => <span className="text-muted">{failed ? "Unavailable" : "…"}</span>;

export default function MarketsPage() {
  const { data: pool, isError } = usePool();
  const show = (value: (live: PoolState) => string | number) =>
    pool ? value(pool) : <Pending failed={isError} />;

  return (
    <div>
      <h1 className="text-lg font-semibold">Markets</h1>
      <p className="mt-1 text-sm text-muted">
        Liquidity pools with Spot, Curve and Bid-Ask positions. Open one to swap or provide liquidity.
      </p>
      <div className="mt-4 overflow-hidden rounded-lg border border-line bg-panel">
        <table className="w-full">
          <thead className="border-b border-line">
            <tr>
              <th className={HEAD}>Market</th>
              <th className={HEAD}>Price</th>
              <th className={HEAD}>Liquidity</th>
              <th className={`${HEAD} ${WIDE}`}>Swap fee now</th>
              <th className={`${HEAD} ${WIDE}`}>Bin width</th>
              <th className={`${HEAD} ${WIDE}`}>Positions</th>
            </tr>
          </thead>
          <tbody>
            {MARKETS.map((market) => (
              <tr key={market.id} className="relative hover:bg-raised">
                <td className="px-4 py-3 text-sm font-medium">
                  <Link href={market.href} className="after:absolute after:inset-0">
                    {market.name}
                  </Link>
                </td>
                <td className={CELL}>{show((p) => price(p.usd))}</td>
                <td className={CELL}>{show((p) => usd(totalValue(p)))}</td>
                <td className={`${CELL} ${WIDE}`}>{show((p) => feePercent(p.feePips))}</td>
                <td className={`${CELL} ${WIDE}`}>{market.binWidth}</td>
                <td className={`${CELL} ${WIDE}`}>{show((p) => p.positions.length)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
