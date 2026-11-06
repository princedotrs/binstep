"use client";

import { useState } from "react";
import { BinChart } from "@/components/BinChart";
import { CreatePosition } from "@/components/CreatePosition";
import { Loading } from "@/components/Loading";
import { SwapPanel } from "@/components/SwapPanel";
import { Panel, Stat } from "@/components/ui";
import { feePercent, price } from "@/lib/format";
import { usePool } from "@/lib/hooks";
import type { ShapeBin } from "@/lib/math";

export default function PoolPage() {
  const { data: pool, isError } = usePool();
  const [preview, setPreview] = useState<ShapeBin[]>([]);

  if (!pool) return <Loading error={isError} />;

  return (
    <div className="space-y-4">
      <Panel>
        <dl className="mb-5 flex flex-wrap gap-x-10 gap-y-3">
          <Stat label="tWETH / tUSDC" value={price(pool.usd)} />
          <Stat label="Swap fee now" value={feePercent(pool.feePips)} />
          <Stat label="Bin width" value="0.10%" />
          <Stat label="Positions" value={pool.positions.length} />
        </dl>
        <BinChart bins={pool.bins} activeBin={pool.activeBin} preview={preview} />
        <p className="mt-3 text-xs text-muted">
          The outlined shape previews your new position. This test pool only moves when someone swaps in it.
        </p>
      </Panel>
      <div className="grid items-start gap-4 lg:grid-cols-[1fr_20rem]">
        <CreatePosition pool={pool} onPreview={setPreview} />
        <SwapPanel pool={pool} />
      </div>
    </div>
  );
}
