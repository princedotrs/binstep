"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useAnonStatus } from "@/lib/hooks";
import { anonRoute } from "@/lib/route";

const NETWORK = { nox: "Nox", nym: "Nym" } as const;

export function PrivacyBadge() {
  const status = useAnonStatus();
  const style = {
    connecting: ["bg-warn", "text-warn"],
    private: ["bg-usdc", "text-usdc"],
    failed: ["bg-bad", "text-bad"],
    plain: ["bg-bad", "text-bad"],
  }[status.state];
  const label =
    status.state === "connecting"
      ? `Connecting via ${NETWORK[status.worker]}`
      : status.state === "private"
        ? `Private via ${NETWORK[status.worker]}`
        : status.state === "failed"
          ? "No private route"
          : "Plain RPC";
  return (
    <span aria-live="polite" className={`flex items-center gap-1.5 whitespace-nowrap text-xs ${style[1]}`}>
      <span className={`h-2 w-2 rounded-full ${style[0]} ${status.state === "connecting" ? "animate-pulse" : ""}`} />
      {label}
    </span>
  );
}

export function PrivacyBanner() {
  const status = useAnonStatus();
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["pool"] });

  if (status.state === "failed") {
    return (
      <div role="alert" className="border-b border-line bg-panel">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-3 px-4 py-3 text-sm">
          <p className="min-w-60 flex-1">
            Nox and Nym both failed, so nothing is being read. A plain RPC would work, but it can see your IP address and
            which wallet you look up.
          </p>
          <button
            className="rounded-md bg-text px-3 py-1.5 font-medium text-ink"
            onClick={() => {
              anonRoute.retry();
              refresh();
            }}
          >
            Try again
          </button>
          <button
            className="rounded-md border border-line px-3 py-1.5 hover:border-muted"
            onClick={() => {
              anonRoute.usePlainRpc();
              refresh();
            }}
          >
            Use plain RPC
          </button>
        </div>
      </div>
    );
  }
  if (status.state === "plain") {
    return (
      <div className="border-b border-line bg-panel">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-3 px-4 py-2 text-sm text-muted">
          <p className="flex-1">You chose plain RPC. Reads are not anonymized.</p>
          <button
            className="text-text underline"
            onClick={() => {
              anonRoute.retry();
              refresh();
            }}
          >
            Go private again
          </button>
        </div>
      </div>
    );
  }
  return null;
}
