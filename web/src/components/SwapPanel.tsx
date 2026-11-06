"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { USDC_DECIMALS, addresses } from "@/lib/addresses";
import { feePercent, price, priceDigits, token } from "@/lib/format";
import { useTransactions } from "@/lib/hooks";
import type { PoolState } from "@/lib/read";
import { SWAP_LIMIT_TICKS, approveCall, swapCall } from "@/lib/tx";
import { parseAmount, swapBlocker } from "@/lib/validate";
import { formatUnits } from "viem";
import { AmountField, FlipIcon, Primary } from "./ui";

const USDC = { name: "tUSDC", dot: "bg-usdc", decimals: USDC_DECIMALS, shownDecimals: 2, address: addresses.usdc };

export function SwapPanel({ pool }: { pool: PoolState }) {
  const { address } = useAccount();
  const { run, busy, error } = useTransactions();
  const { market } = pool;
  const tokens = {
    base: { name: market.symbol, dot: "bg-asset", decimals: market.baseDecimals, shownDecimals: 6, address: market.token },
    usdc: USDC,
  };
  const [sell, setSell] = useState<"base" | "usdc">("base");
  const [amount, setAmount] = useState("");

  useEffect(() => {
    if (new URLSearchParams(location.search).get("from") === USDC.name) setSell("usdc");
  }, []);

  const buy = sell === "base" ? "usdc" : "base";
  const from = tokens[sell];
  const to = tokens[buy];
  const wallet = pool.wallet;
  const balances = { base: wallet?.base ?? 0n, usdc: wallet?.usdc ?? 0n };
  const balance = balances[sell];
  const allowance = wallet ? (sell === "base" ? wallet.routerAllowanceBase : wallet.routerAllowanceUsdc) : 0n;
  const parsed = parseAmount(amount, from.decimals);
  // A swap with nothing to fill it trades nothing and still moves the price to its limit.
  const empty = !pool.bins.some(({ liquidity }) => liquidity > 0n);
  const blocker = empty ? "No liquidity yet" : !address ? "Connect a wallet" : swapBlocker(amount, from.decimals, balance);

  const value = Number(amount) || 0;
  const estimate = (sell === "base" ? value * pool.usd : value / pool.usd) * (1 - pool.feePips / 1e6);
  const receive = estimate > 0 ? String(Number(estimate.toFixed(to.shownDecimals))) : "";
  const limit = pool.usd * 1.0001 ** (sell === "base" ? -SWAP_LIMIT_TICKS : SWAP_LIMIT_TICKS);

  const flip = () => {
    setSell(buy);
    setAmount(receive);
    history.replaceState(null, "", `?from=${to.name}`);
  };

  const submit = () => {
    if (!parsed) return;
    const calls = [
      ...(allowance < parsed ? [approveCall(from.address, addresses.swapRouter)] : []),
      swapCall({ market, sell, amount: parsed, tick: pool.tick }),
    ];
    run("Swapping", calls, "Swap confirmed").then((receipt) => receipt && setAmount(""));
  };

  const detail = (label: string, text: string) => (
    <div className="flex justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="font-mono">{text}</dd>
    </div>
  );

  return (
    <div>
      <AmountField
        label="From"
        token={from.name}
        dot={from.dot}
        value={amount}
        onChange={setAmount}
        balance={wallet ? token(balance, from.decimals) : undefined}
        onMax={() => setAmount(formatUnits(balance, from.decimals))}
        onHalf={() => setAmount(formatUnits(balance / 2n, from.decimals))}
      />
      <div className="relative z-10 -my-2.5 flex justify-center">
        <button
          type="button"
          aria-label={`Swap ${to.name} for ${from.name} instead`}
          className="grid size-9 place-items-center rounded-full border border-line bg-raised text-muted hover:border-muted hover:text-text"
          onClick={flip}
        >
          <FlipIcon />
        </button>
      </div>
      <AmountField
        label="To (estimated)"
        token={to.name}
        dot={to.dot}
        value={receive}
        balance={wallet ? token(balances[buy], to.decimals) : undefined}
      />
      <dl className="my-3 space-y-1.5 text-xs">
        {detail("Rate", `1 ${market.symbol} ≈ ${pool.usd.toLocaleString("en-US", priceDigits(pool.usd))} tUSDC`)}
        {detail("Swap fee", feePercent(pool.feePips))}
        {detail("Stops at", price(limit))}
      </dl>
      <p className="mb-3 text-xs leading-relaxed text-muted">
        The estimate uses the current price and fee, so price impact can lower it. A large swap may fill in part.
      </p>
      <Primary disabled={!!blocker || !!busy} onClick={submit}>
        {busy ?? blocker ?? "Swap"}
      </Primary>
      {error && <p role="alert" className="mt-2 text-xs text-bad">{error}</p>}
    </div>
  );
}
