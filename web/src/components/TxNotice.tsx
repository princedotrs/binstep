"use client";

import { useEffect, useSyncExternalStore } from "react";
import { txUrl } from "@/lib/format";
import { closeNotice, getNotice, subscribeNotice } from "@/lib/notice";

const SHOWN_MS = 8_000;

/** Confirms a transaction without covering the page or taking focus. */
export function TxNotice() {
  const notice = useSyncExternalStore(subscribeNotice, getNotice, () => null);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(closeNotice, SHOWN_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  if (!notice) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center px-4">
      <div role="status" className="tx-notice pointer-events-auto flex items-center gap-3 rounded-xl border border-line bg-raised px-4 py-3">
        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-good/15 text-sm text-good" aria-hidden>
          ✓
        </span>
        <div>
          <b className="block text-sm font-semibold">{notice.title}</b>
          <a href={txUrl(notice.hash)} target="_blank" rel="noreferrer" className="text-xs text-muted underline hover:text-text">
            View on Basescan
          </a>
        </div>
        <button aria-label="Dismiss" className="ml-2 text-muted hover:text-text" onClick={closeNotice}>
          ×
        </button>
      </div>
    </div>
  );
}
