"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount } from "wagmi";
import type { AirdropKind } from "@/lib/airdrop";

const AMOUNTS = "10 tWETH and 25,000 tUSDC";
const NOTE_MS = 6_000;

const flagKey = (address: string) => `binstep:airdrop:${address.toLowerCase()}`;

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

export function AirdropButton() {
  const { address } = useAccount();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const started = useRef(new Set<string>());

  const drop = useCallback(
    async (to: string, kind: AirdropKind) => {
      setBusy(true);
      setNote(kind === "first" ? "Sending you test tokens…" : null);
      try {
        const res = await fetch("/api/airdrop", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ address: to, kind }),
        });
        const body = await res.json();
        if (kind === "first" && res.ok) markDropped(to);
        if (!res.ok) setNote(body.error ?? "Airdrop failed");
        else if (body.sent) setNote(`Sent ${AMOUNTS}`);
        else setNote(body.reason === "capped" ? "You already have plenty of test tokens" : null);
        await queryClient.invalidateQueries({ queryKey: ["pool"] });
      } catch {
        setNote("Airdrop failed. Try again.");
      } finally {
        setBusy(false);
      }
    },
    [queryClient],
  );

  useEffect(() => {
    if (!address || started.current.has(address) || alreadyDropped(address)) return;
    started.current.add(address);
    drop(address, "first");
  }, [address, drop]);

  useEffect(() => {
    if (!note || busy) return;
    const timer = setTimeout(() => setNote(null), NOTE_MS);
    return () => clearTimeout(timer);
  }, [note, busy]);

  if (!address) return null;
  return (
    <>
      <span aria-live="polite" className="text-xs text-muted">
        {note}
      </span>
      <button
        className="rounded-md border border-line px-3 py-1.5 text-sm hover:border-muted disabled:text-muted"
        disabled={busy}
        onClick={() => drop(address, "more")}
      >
        {busy ? "Sending…" : "Airdrop tokens"}
      </button>
    </>
  );
}
