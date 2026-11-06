"use client";

import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import { useAccount } from "wagmi";
import { MAX_BINS, USDC_DECIMALS, WETH_DECIMALS, addresses } from "@/lib/addresses";
import { price, token } from "@/lib/format";
import { useTransactions } from "@/lib/hooks";
import { STRATEGY_NAMES, binToUsd, previewShape, strategyWeights, type ShapeBin, type Strategy } from "@/lib/math";
import type { PoolState } from "@/lib/read";
import { approveCall, mintCall } from "@/lib/tx";
import { mintBlocker, mintSides, parseAmount } from "@/lib/validate";
import { AmountField, Panel, Primary, Toggle } from "./ui";

const HINT: Record<Strategy, string> = {
  0: "Even across the range. A simple default.",
  1: "Most liquidity near the middle. Suits a calm market.",
  2: "Most liquidity at the edges. Suits a choppy market.",
};

function ShapeIcon({ strategy }: { strategy: Strategy }) {
  const weights = strategyWeights(strategy, 7);
  const peak = Math.max(...weights);
  return (
    <span className="flex h-5 items-end gap-px" aria-hidden>
      {weights.map((w, i) => (
        <i key={i} className="w-1 bg-current" style={{ height: `${(w / peak) * 100}%` }} />
      ))}
    </span>
  );
}

export function CreatePosition({ pool, onPreview }: { pool: PoolState; onPreview: (shape: ShapeBin[]) => void }) {
  const { address } = useAccount();
  const { run, busy, error } = useTransactions();
  const [strategy, setStrategy] = useState<Strategy>(1);
  const [numBins, setNumBins] = useState(16);
  const [offset, setOffset] = useState(0);
  const [weth, setWeth] = useState("");
  const [usdc, setUsdc] = useState("");
  const [autoCompound, setAutoCompound] = useState(true);
  const [autoRebalance, setAutoRebalance] = useState(true);

  const lowerBin = pool.activeBin - Math.floor(numBins / 2) + offset;
  const { activeBin, wethIsToken0 } = pool;
  const sides = mintSides(lowerBin, numBins, activeBin, wethIsToken0);
  const [low, high] = [lowerBin, lowerBin + numBins].map((b) => binToUsd(b, wethIsToken0)).sort((a, b) => a - b);

  useEffect(() => {
    onPreview(previewShape(strategy, lowerBin, numBins, activeBin, wethIsToken0));
  }, [strategy, lowerBin, numBins, activeBin, wethIsToken0, onPreview]);

  const wallet = pool.wallet;
  const blocker = !address
    ? "Connect a wallet"
    : mintBlocker({ weth, usdc, wethBalance: wallet?.weth ?? 0n, usdcBalance: wallet?.usdc ?? 0n, sides });

  const submit = () => {
    const wethAmount = sides.weth ? parseAmount(weth, WETH_DECIMALS)! : 0n;
    const usdcAmount = sides.usdc ? parseAmount(usdc, USDC_DECIMALS)! : 0n;
    const calls = [
      ...((wallet?.managerAllowanceWeth ?? 0n) < wethAmount ? [approveCall(addresses.weth, addresses.manager)] : []),
      ...((wallet?.managerAllowanceUsdc ?? 0n) < usdcAmount ? [approveCall(addresses.usdc, addresses.manager)] : []),
      mintCall({ lowerBin, numBins, strategy, wethAmount, usdcAmount, tick: pool.tick, autoCompound, autoRebalance }),
    ];
    run("Creating position", calls).then(() => {
      setWeth("");
      setUsdc("");
    });
  };

  return (
    <Panel title="Create a position">
      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Strategy">
            {([0, 1, 2] as const).map((s) => (
              <button
                key={s}
                role="radio"
                aria-checked={strategy === s}
                className={`flex flex-col items-center gap-1.5 rounded-md border px-2 py-2 text-sm ${
                  strategy === s ? "border-text" : "border-line text-muted hover:border-muted"
                }`}
                onClick={() => setStrategy(s)}
              >
                <ShapeIcon strategy={s} />
                {STRATEGY_NAMES[s]}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">{HINT[strategy]}</p>

          <label className="mt-4 block text-xs text-muted">
            <span className="mb-1 flex justify-between">
              Width <span className="font-mono text-text">{numBins} bins</span>
            </span>
            <input
              type="range"
              className="w-full accent-[var(--color-usdc)]"
              min={1}
              max={MAX_BINS}
              value={numBins}
              onChange={(e) => setNumBins(Number(e.target.value))}
            />
          </label>
          <label className="mt-3 block text-xs text-muted">
            <span className="mb-1 flex justify-between">
              Shift from price
              <button type="button" className="underline" onClick={() => setOffset(0)}>
                Center
              </button>
            </span>
            <input
              type="range"
              className="w-full accent-[var(--color-usdc)]"
              min={-MAX_BINS}
              max={MAX_BINS}
              value={offset}
              onChange={(e) => setOffset(Number(e.target.value))}
            />
          </label>
          <p className="mt-2 font-mono text-sm">
            {price(low)} – {price(high)}
          </p>
        </div>

        <div className="space-y-3">
          <AmountField
            label="tWETH"
            value={weth}
            onChange={setWeth}
            disabled={!sides.weth}
            note={sides.weth ? undefined : "Not needed for this range"}
            balance={wallet ? token(wallet.weth, WETH_DECIMALS) : undefined}
            onMax={() => wallet && setWeth(formatUnits(wallet.weth, WETH_DECIMALS))}
          />
          <AmountField
            label="tUSDC"
            value={usdc}
            onChange={setUsdc}
            disabled={!sides.usdc}
            note={sides.usdc ? undefined : "Not needed for this range"}
            balance={wallet ? token(wallet.usdc, USDC_DECIMALS, 2) : undefined}
            onMax={() => wallet && setUsdc(formatUnits(wallet.usdc, USDC_DECIMALS))}
          />
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <Toggle label="Auto-compound" checked={autoCompound} onChange={setAutoCompound} />
            <Toggle label="Auto-rebalance" checked={autoRebalance} onChange={setAutoRebalance} />
          </div>
          {autoRebalance && (
            <p className="text-xs leading-relaxed text-muted">
              After a rebalance, a position sits just beside the price in one token and earns nothing until the price
              moves back into it.
            </p>
          )}
          <Primary disabled={!!blocker || !!busy} onClick={submit}>
            {busy ?? blocker ?? "Create position"}
          </Primary>
          {error && <p role="alert" className="text-xs text-bad">{error}</p>}
        </div>
      </div>
    </Panel>
  );
}
