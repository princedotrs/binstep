"use client";

import { useAccount } from "wagmi";
import { formatUnits } from "viem";
import { USDC_DECIMALS, addresses } from "@/lib/addresses";
import { percent, price, token } from "@/lib/format";
import { useTransactions, type MarketSummary } from "@/lib/hooks";
import { STRATEGY_NAMES, capitalEfficiency, shapeCurve, type Strategy } from "@/lib/math";
import type { PoolState } from "@/lib/read";
import { approveCall, mintCall } from "@/lib/tx";
import { mintBlocker, parseAmount } from "@/lib/validate";
import { AimIcon, AmountField, LoopIcon, Primary } from "./ui";

const HINT: Record<Strategy, string> = {
  0: "Even across the range. A simple default.",
  1: "Most liquidity near the middle. Suits a calm market.",
  2: "Most liquidity at the edges. Suits a choppy market.",
};

const ICON_BARS = 7;

function ShapeIcon({ strategy }: { strategy: Strategy }) {
  return (
    <span className="flex h-6 items-end gap-0.5" aria-hidden>
      {Array.from({ length: ICON_BARS }, (_, i) => (
        <i
          key={i}
          className="w-1 rounded-t-[1px] bg-current"
          style={{ height: `${12 + shapeCurve(strategy, (i + 0.5) / ICON_BARS) * 88}%` }}
        />
      ))}
    </span>
  );
}

function AutomationRow(p: {
  icon: React.ReactNode;
  title: string;
  detail: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 py-2.5 not-first:border-t not-first:border-line">
      <span className={p.checked ? "text-accent" : "text-faint"}>{p.icon}</span>
      <span className="min-w-0 flex-1">
        <b className="block text-[13.5px] font-medium">{p.title}</b>
        <small className="block text-xs leading-snug text-muted">{p.detail}</small>
      </span>
      <span className="relative h-5 w-8.5 flex-none">
        <input
          type="checkbox"
          className="peer absolute inset-0 cursor-pointer appearance-none rounded-full bg-line transition-colors checked:bg-accent"
          aria-label={p.title}
          checked={p.checked}
          onChange={(e) => p.onChange(e.target.checked)}
        />
        <i className="pointer-events-none absolute top-0.75 left-0.75 h-3.5 w-3.5 rounded-full bg-white transition-all peer-checked:left-4.25" />
      </span>
    </label>
  );
}

export type Draft = {
  strategy: Strategy;
  onStrategy: (strategy: Strategy) => void;
  lowerBin: number;
  numBins: number;
  sides: { base: boolean; usdc: boolean };
  base: string;
  usdc: string;
  onBase: (text: string) => void;
  onUsdc: (text: string) => void;
  onReset: () => void;
  baseUsd: number;
  usdcUsd: number;
  earnings: { perDay: number; apr: number };
  autoCompound: boolean;
  onAutoCompound: (value: boolean) => void;
  autoRebalance: boolean;
  onAutoRebalance: (value: boolean) => void;
};

export function DepositPanel({ pool, stats, draft: d }: { pool: PoolState; stats?: MarketSummary; draft: Draft }) {
  const { address } = useAccount();
  const { run, busy, error } = useTransactions();
  const { market } = pool;
  const wallet = pool.wallet;

  const blocker = !address
    ? "Connect a wallet"
    : mintBlocker({ market, base: d.base, usdc: d.usdc, baseBalance: wallet?.base ?? 0n, usdcBalance: wallet?.usdc ?? 0n, sides: d.sides });

  const submit = () => {
    const baseAmount = d.sides.base ? parseAmount(d.base, market.baseDecimals)! : 0n;
    const usdcAmount = d.sides.usdc ? parseAmount(d.usdc, USDC_DECIMALS)! : 0n;
    run("Creating position", [
      ...((wallet?.managerAllowanceBase ?? 0n) < baseAmount ? [approveCall(market.token, addresses.manager)] : []),
      ...((wallet?.managerAllowanceUsdc ?? 0n) < usdcAmount ? [approveCall(addresses.usdc, addresses.manager)] : []),
      mintCall({
        market,
        lowerBin: d.lowerBin,
        numBins: d.numBins,
        strategy: d.strategy,
        baseAmount,
        usdcAmount,
        tick: pool.tick,
        autoCompound: d.autoCompound,
        autoRebalance: d.autoRebalance,
      }),
    ], "Position created").then((receipt) => receipt && d.onReset());
  };

  const value = d.baseUsd + d.usdcUsd;
  const baseShare = value > 0 ? (d.baseUsd / value) * 100 : 50;

  return (
    <div>
      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Strategy">
        {([0, 1, 2] as const).map((s) => (
          <button
            key={s}
            role="radio"
            aria-checked={d.strategy === s}
            className={`flex flex-col items-center gap-1.5 rounded-lg border px-2 py-2.5 text-sm transition-colors ${
              d.strategy === s ? "border-accent bg-accent/13 text-text [&_i]:text-accent" : "border-line text-muted hover:border-muted"
            }`}
            onClick={() => d.onStrategy(s)}
          >
            <ShapeIcon strategy={s} />
            {STRATEGY_NAMES[s]}
          </button>
        ))}
      </div>
      <p className="mt-2 mb-3 text-xs text-muted">{HINT[d.strategy]}</p>

      <div className="space-y-2">
        <AmountField
          label="You add"
          token={market.symbol}
          dot="bg-asset"
          value={d.base}
          onChange={d.onBase}
          disabled={!d.sides.base}
          note={d.sides.base ? undefined : "Not needed for this range"}
          balance={wallet ? token(wallet.base, market.baseDecimals) : undefined}
          onMax={() => wallet && d.onBase(formatUnits(wallet.base, market.baseDecimals))}
        />
        <AmountField
          label="You add"
          token="tUSDC"
          dot="bg-usdc"
          value={d.usdc}
          onChange={d.onUsdc}
          disabled={!d.sides.usdc}
          note={d.sides.usdc ? undefined : "Not needed for this range"}
          balance={wallet ? token(wallet.usdc, USDC_DECIMALS, 2) : undefined}
          onMax={() => wallet && d.onUsdc(formatUnits(wallet.usdc, USDC_DECIMALS))}
        />
      </div>

      <div className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-raised">
        <i className="block bg-asset transition-[width] duration-250" style={{ width: `${baseShare}%` }} />
        <i className="block flex-1 bg-usdc" />
      </div>
      <div className="mt-1 flex justify-between font-mono text-xs text-muted">
        <span>{Math.round(baseShare)}% {market.symbol}</span>
        <span>{100 - Math.round(baseShare)}% tUSDC</span>
      </div>

      <div className="mt-3 rounded-lg bg-raised px-3 py-0.5">
        <AutomationRow
          icon={<LoopIcon />}
          title="Auto-compound"
          detail="Reinvests earned fees into this position."
          checked={d.autoCompound}
          onChange={d.onAutoCompound}
        />
        <AutomationRow
          icon={<AimIcon />}
          title="Auto-rebalance"
          detail="Moves your range beside the price if it drifts out."
          checked={d.autoRebalance}
          onChange={d.onAutoRebalance}
        />
      </div>

      <div className="mt-2 rounded-lg bg-raised px-3 py-2.5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs text-muted">Estimated APR at this price</span>
          <b className={`font-mono text-[22px] font-semibold ${stats && d.earnings.apr > 0 ? "text-good" : "text-muted"}`}>
            {stats ? percent(d.earnings.apr) : "–"}
          </b>
        </div>
        <dl className="mt-1 flex justify-between gap-3 text-xs text-muted">
          <div className="flex gap-1.5">
            <dt>Fees per day</dt>
            <dd className="font-mono text-text">{stats ? price(d.earnings.perDay) : "–"}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt>Capital efficiency</dt>
            <dd className="font-mono text-text">{Math.round(capitalEfficiency(d.numBins))}×</dd>
          </div>
        </dl>
        <p className="mt-1 text-[11px] text-faint">Based on the last 24 hours of fees, which can change.</p>
      </div>

      <Primary className="mt-3" disabled={!!blocker || !!busy} onClick={submit}>
        {busy ?? blocker ?? "Create position"}
      </Primary>
      {error && <p role="alert" className="mt-2 text-xs text-bad">{error}</p>}
    </div>
  );
}
