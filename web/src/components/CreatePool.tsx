"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { parseEventLogs } from "viem";
import { useAccount } from "wagmi";
import { Primary, Panel } from "./ui";
import { registryAbi } from "@/lib/abi";
import { REGISTRY, USDC_DECIMALS } from "@/lib/addresses";
import { useTransactions } from "@/lib/hooks";
import { createCall } from "@/lib/tx";
import { createBlocker, parseAmount } from "@/lib/validate";

/** BinStepRegistry.CREATOR_USD */
const CREATOR_USD = 100_000;
const FIELD = "mt-1 w-full rounded-lg border border-line bg-raised px-3 py-2 text-base outline-none focus:border-accent sm:text-sm";

export function CreatePool() {
  const { address } = useAccount();
  const router = useRouter();
  const { run, busy, error } = useTransactions();
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [priceUsd, setPriceUsd] = useState("");

  const blocker = !REGISTRY ? "Not available yet" : !address ? "Connect a wallet" : createBlocker(name, symbol, priceUsd);
  const label = symbol.trim() || "your token";
  const starting = (CREATOR_USD / Number(priceUsd)).toLocaleString("en-US", { maximumFractionDigits: 4 });

  const submit = async () => {
    const call = createCall(REGISTRY!, name.trim(), symbol.trim(), parseAmount(priceUsd, USDC_DECIMALS)!);
    const receipt = await run("Creating pool", [call], "Pool created");
    if (!receipt) return;
    const [created] = parseEventLogs({ abi: registryAbi, eventName: "Created", logs: receipt.logs });
    if (created) router.push(`/pool/${created.args.token.toLowerCase()}`);
  };

  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-lg font-semibold">Create a pool</h1>
      <p className="mt-1 text-sm leading-relaxed text-muted">
        This makes a new test token and a pool for it against tUSDC. Anyone can create one, so it is listed under Community
        as unverified.
      </p>
      <Panel className="mt-4">
        <label className="block text-xs text-muted">
          Token name
          <input className={FIELD} value={name} placeholder="Moon Coin" autoComplete="off" onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="mt-3 block text-xs text-muted">
          Symbol
          <input className={FIELD} value={symbol} placeholder="MOON" autoComplete="off" onChange={(e) => setSymbol(e.target.value)} />
        </label>
        <label className="mt-3 block text-xs text-muted">
          Starting price in USD
          <input
            className={`${FIELD} font-mono`}
            value={priceUsd}
            placeholder="1.00"
            inputMode="decimal"
            autoComplete="off"
            onChange={(e) => setPriceUsd(e.target.value)}
          />
        </label>
        <dl className="my-4 space-y-1.5 text-xs">
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Pool</dt>
            <dd className="font-mono">{label} / tUSDC</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted">You start with</dt>
            <dd className="font-mono">{Number(priceUsd) > 0 ? `${starting} ${label}` : "–"}</dd>
          </div>
        </dl>
        <Primary disabled={!!blocker || !!busy} onClick={submit}>
          {busy ?? blocker ?? "Create pool"}
        </Primary>
        <p className="mt-3 text-xs leading-relaxed text-muted">
          A new pool has no liquidity. Add some on its page, and people can swap once you do.
        </p>
        {error && <p role="alert" className="mt-2 text-xs text-bad">{error}</p>}
      </Panel>
    </div>
  );
}
