"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { USDC_DECIMALS, WETH_DECIMALS, addresses } from "@/lib/addresses";
import { feePercent, price, token } from "@/lib/format";
import { useTransactions } from "@/lib/hooks";
import type { PoolState } from "@/lib/read";
import { SWAP_LIMIT_TICKS, approveCall, swapCall } from "@/lib/tx";
import { parseAmount, swapBlocker } from "@/lib/validate";
import { formatUnits } from "viem";
import { AmountField, FlipIcon, Primary } from "./ui";

const TOKENS = {
  weth: { name: "tWETH", dot: "bg-weth", decimals: WETH_DECIMALS, shownDecimals: 6, address: addresses.weth },
  usdc: { name: "tUSDC", dot: "bg-usdc", decimals: USDC_DECIMALS, shownDecimals: 2, address: addresses.usdc },
} as const;

export function SwapPanel({ pool }: { pool: PoolState }) {
  const { address } = useAccount();
  const { run, busy, error } = useTransactions();
  const [sell, setSell] = useState<"weth" | "usdc">("weth");
  const [amount, setAmount] = useState("");

  useEffect(() => {
    if (new URLSearchParams(location.search).get("from") === TOKENS.usdc.name) setSell("usdc");
  }, []);

  const buy = sell === "weth" ? "usdc" : "weth";
  const from = TOKENS[sell];
  const to = TOKENS[buy];
  const wallet = pool.wallet;
  const balances = { weth: wallet?.weth ?? 0n, usdc: wallet?.usdc ?? 0n };
  const balance = balances[sell];
  const allowance = wallet ? (sell === "weth" ? wallet.routerAllowanceWeth : wallet.routerAllowanceUsdc) : 0n;
  const parsed = parseAmount(amount, from.decimals);
  const blocker = !address ? "Connect a wallet" : swapBlocker(amount, from.decimals, balance);

  const value = Number(amount) || 0;
  const estimate = (sell === "weth" ? value * pool.usd : value / pool.usd) * (1 - pool.feePips / 1e6);
  const receive = estimate > 0 ? String(Number(estimate.toFixed(to.shownDecimals))) : "";
  const limit = pool.usd * 1.0001 ** (sell === "weth" ? -SWAP_LIMIT_TICKS : SWAP_LIMIT_TICKS);

  const flip = () => {
    setSell(buy);
    setAmount(receive);
    history.replaceState(null, "", `/swap?from=${to.name}`);
  };

  const submit = () => {
    if (!parsed) return;
    const calls = [
      ...(allowance < parsed ? [approveCall(from.address, addresses.swapRouter)] : []),
      swapCall({ sell, amount: parsed, tick: pool.tick }),
    ];
    run("Swapping", calls).then(() => setAmount(""));
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
        {detail("Rate", `1 tWETH ≈ ${pool.usd.toLocaleString("en-US", { maximumFractionDigits: 2 })} tUSDC`)}
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
