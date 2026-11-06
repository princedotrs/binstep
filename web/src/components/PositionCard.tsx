"use client";

import { USDC_DECIMALS, WETH_DECIMALS } from "@/lib/addresses";
import { price, shortAddress, token } from "@/lib/format";
import { useTransactions } from "@/lib/hooks";
import { STRATEGY_NAMES, binToUsd, rangeState, type RangeState } from "@/lib/math";
import type { PoolState, Position } from "@/lib/read";
import { automationCall, closeCall, compoundCall, rebalanceCall } from "@/lib/tx";
import { Panel, Toggle } from "./ui";

const STATE: Record<RangeState, { label: string; tone: string; detail: string }> = {
  earning: { label: "Earning", tone: "text-usdc", detail: "The price is inside this range." },
  pending: {
    label: "Rebalance pending",
    tone: "text-warn",
    detail: "Out of range. Automation moves it once the price settles for five minutes.",
  },
  waiting: {
    label: "Waiting for price to return",
    tone: "text-warn",
    detail: "Out of range in one token. It earns nothing until the price moves back into it.",
  },
};

function MiniBars({ position, activeBin }: { position: Position; activeBin: number }) {
  const peak = position.bins.reduce((max, l) => (l > max ? l : max), 1n);
  return (
    <div className="flex h-10 items-end gap-px" aria-hidden>
      {position.bins.map((liquidity, i) => (
        <i
          key={i}
          className={`flex-1 ${position.lowerBin + i === activeBin ? "bg-now" : "bg-muted/50"}`}
          style={{ height: `${Math.max(Number((liquidity * 100n) / peak), 2)}%` }}
        />
      ))}
    </div>
  );
}

export function PositionCard({ position: p, pool, mine }: { position: Position; pool: PoolState; mine: boolean }) {
  const { run, busy, error } = useTransactions();
  const state = STATE[rangeState(p)];
  const [low, high] = [p.lowerBin, p.lowerBin + p.numBins].map((b) => binToUsd(b, pool.wethIsToken0)).sort((a, b) => a - b);
  const canMove = !p.inRange && p.successorLowerBin !== p.lowerBin;
  const button = "rounded-md border border-line px-3 py-1.5 text-sm hover:border-muted disabled:text-muted";

  return (
    <Panel>
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <p className="font-medium">
            #{p.id.toString()} {STRATEGY_NAMES[p.strategy]} <span className="text-sm text-muted">{p.numBins} bins</span>
          </p>
          <p className="font-mono text-sm text-muted">
            {price(low)} – {price(high)}
          </p>
        </div>
        <span className={`text-right text-sm ${state.tone}`}>{state.label}</span>
      </div>
      <MiniBars position={p} activeBin={pool.activeBin} />
      <p className="mt-2 text-xs text-muted">{state.detail}</p>

      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <div>
          <dt className="text-xs text-muted">Unclaimed fees</dt>
          <dd className="font-mono">
            {token(p.pendingWeth, WETH_DECIMALS)} tWETH
            <br />
            {token(p.pendingUsdc, USDC_DECIMALS, 2)} tUSDC
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Idle</dt>
          <dd className="font-mono">
            {token(p.idleWeth, WETH_DECIMALS)} tWETH
            <br />
            {token(p.idleUsdc, USDC_DECIMALS, 2)} tUSDC
          </dd>
        </div>
      </dl>

      {mine ? (
        <div className="mt-3 border-t border-line pt-3">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <Toggle
              label="Auto-compound"
              checked={p.autoCompound}
              disabled={!!busy}
              onChange={(v) => run("Updating", [automationCall(p.id, v, p.autoRebalance)])}
            />
            <Toggle
              label="Auto-rebalance"
              checked={p.autoRebalance}
              disabled={!!busy}
              onChange={(v) => run("Updating", [automationCall(p.id, p.autoCompound, v)])}
            />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className={button} disabled={!!busy} onClick={() => run("Compounding", [compoundCall(p.id, pool.tick)])}>
              Compound
            </button>
            <button
              className={button}
              disabled={!!busy || !canMove}
              onClick={() => run("Rebalancing", [rebalanceCall(p.id, p.successorLowerBin, pool.tick)])}
            >
              Rebalance
            </button>
            <button className={`${button} text-bad`} disabled={!!busy} onClick={() => run("Closing", [closeCall(p.id)])}>
              Close
            </button>
          </div>
          {busy && <p className="mt-2 text-xs text-muted">{busy}…</p>}
          {error && <p role="alert" className="mt-2 text-xs text-bad">{error}</p>}
        </div>
      ) : (
        <p className="mt-3 border-t border-line pt-3 text-xs text-muted">Owned by {shortAddress(p.owner)}</p>
      )}
    </Panel>
  );
}
