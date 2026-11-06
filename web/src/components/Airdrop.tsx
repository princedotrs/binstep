"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount } from "wagmi";
import type { AirdropKind } from "@/lib/airdrop";
import { DEFAULT_MARKET, type Market } from "@/lib/markets";
import { showNotice } from "@/lib/notice";

const NOTE_MS = 6_000;

/** Per deployment, so a fresh devnet gives a wallet its first airdrop again. */
const flagKey = (address: string) => `binstep:airdrop:${DEFAULT_MARKET.token}:${address.toLowerCase()}`;

function alreadyDropped(address: string) {
  try {
    return localStorage.getItem(flagKey(address)) !== null;
  } catch {
    return false;
  }
}

function markDropped(address: string) {
  try {
    localStorage.setItem(flagKey(address), "1");
  } catch {}
}

const sentTitle = (market: Market | null) =>
  market ? `Sent ${Number(market.airdrop).toLocaleString("en-US")} ${market.symbol} and 25,000 tUSDC` : "Sent 25,000 tUSDC";

/** With no market, it sends only tUSDC. */
export function useAirdrop(market: Market | null) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const drop = useCallback(
    async (to: string, kind: AirdropKind) => {
      setBusy(true);
      setNote(kind === "first" ? "Sending you test tokens…" : null);
      try {
        const res = await fetch("/api/airdrop", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ address: to, kind, market: market?.id }),
        });
        const body = await res.json();
        if (kind === "first" && res.ok) markDropped(to);
        if (!res.ok) setNote(body.error ?? "Airdrop failed");
        else {
          setNote(body.reason === "capped" ? "You already have plenty of test tokens" : null);
          if (body.sent) showNotice(sentTitle(market), body.hash);
        }
        await queryClient.invalidateQueries({ queryKey: ["pool"] });
      } catch {
        setNote("Airdrop failed. Try again.");
      } finally {
        setBusy(false);
      }
    },
    [market, queryClient],
  );

  useEffect(() => {
    if (!note || busy) return;
    const timer = setTimeout(() => setNote(null), NOTE_MS);
    return () => clearTimeout(timer);
  }, [note, busy]);

  return { drop, busy, note };
}

/** Gives a new wallet tokens and gas when it first connects. */
export function FirstAirdrop() {
  const { address } = useAccount();
  const { drop, note } = useAirdrop(DEFAULT_MARKET);
  const started = useRef(new Set<string>());

  useEffect(() => {
    if (!address || started.current.has(address) || alreadyDropped(address)) return;
    started.current.add(address);
    drop(address, "first");
  }, [address, drop]);

  return address ? <span aria-live="polite" className="text-xs text-muted">{note}</span> : null;
}

/** Sends both of one market's test tokens. */
export function AirdropButton({ market }: { market: Market }) {
  const { address } = useAccount();
  const { drop, busy, note } = useAirdrop(market);

  if (!address) return null;
  return (
    <>
      <span aria-live="polite" className="text-xs text-muted">
        {note}
      </span>
      <button
        className="rounded-lg border border-line bg-raised px-3 py-1.5 text-sm hover:border-muted disabled:text-muted"
        disabled={busy}
        onClick={() => drop(address, "more")}
      >
        {busy ? "Sending…" : `Airdrop ${market.symbol} + tUSDC`}
      </button>
    </>
  );
}
