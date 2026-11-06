"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { USDC_DECIMALS, WETH_DECIMALS, addresses } from "@/lib/addresses";
import { token } from "@/lib/format";
import { useTransactions } from "@/lib/hooks";
import type { PoolState } from "@/lib/read";
import { approveCall, swapCall } from "@/lib/tx";
import { parseAmount, swapBlocker } from "@/lib/validate";
import { formatUnits } from "viem";
import { AmountField, Panel, Primary } from "./ui";

export function SwapPanel({ pool }: { pool: PoolState }) {
  const { address } = useAccount();
  const { run, busy, error } = useTransactions();
  const [sell, setSell] = useState<"weth" | "usdc">("weth");
  const [amount, setAmount] = useState("");

  const decimals = sell === "weth" ? WETH_DECIMALS : USDC_DECIMALS;
  const wallet = pool.wallet;
  const balance = wallet ? (sell === "weth" ? wallet.weth : wallet.usdc) : 0n;
  const allowance = wallet ? (sell === "weth" ? wallet.routerAllowanceWeth : wallet.routerAllowanceUsdc) : 0n;
  const parsed = parseAmount(amount, decimals);
  const blocker = !address ? "Connect a wallet" : swapBlocker(amount, decimals, balance);

  const value = Number(amount) || 0;
  const estimate = (sell === "weth" ? value * pool.usd : value / pool.usd) * (1 - pool.feePips / 1e6);

  const submit = () => {
    if (!parsed) return;
    const tokenAddress = sell === "weth" ? addresses.weth : addresses.usdc;
    const calls = [
      ...(allowance < parsed ? [approveCall(tokenAddress, addresses.swapRouter)] : []),
      swapCall({ sell, amount: parsed, tick: pool.tick }),
    ];
    run("Swapping", calls).then(() => setAmount(""));
  };

  return (
    <Panel title="Swap">
      <div className="mb-3 grid grid-cols-2 gap-1 rounded-md bg-ink p-1 text-sm">
        {(["weth", "usdc"] as const).map((side) => (
          <button
            key={side}
            className={`rounded px-2 py-1 ${sell === side ? "bg-raised" : "text-muted"}`}
            onClick={() => {
              setSell(side);
              setAmount("");
            }}
          >
            Sell {side === "weth" ? "tWETH" : "tUSDC"}
          </button>
        ))}
      </div>
      <AmountField
        label="Amount"
        value={amount}
        onChange={setAmount}
        balance={wallet ? token(balance, decimals) : undefined}
        onMax={() => setAmount(formatUnits(balance, decimals))}
      />
      <p className="my-3 text-xs leading-relaxed text-muted">
        {value > 0 && (
          <>
            About <span className="font-mono text-text">{estimate.toLocaleString("en-US", { maximumFractionDigits: 4 })}</span>{" "}
            {sell === "weth" ? "tUSDC" : "tWETH"}.{" "}
          </>
        )}
        A swap stops 3% from the price, so a large one may fill in part.
      </p>
      <Primary disabled={!!blocker || !!busy} onClick={submit}>
        {busy ?? blocker ?? "Swap"}
      </Primary>
      {error && <p role="alert" className="mt-2 text-xs text-bad">{error}</p>}

    </Panel>
  );
}
