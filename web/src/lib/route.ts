"use client";

import { createPublicClient, http, type PublicClient } from "viem";
import { baseSepolia } from "viem/chains";
import { DEVNET, RPC_URL } from "./addresses";
import { createAnonRoute, type AnonStatus } from "./anon";
import { makeBrowserWorker, plainFetch } from "./anon-workers";

/** Nox can take about a minute to reopen a tunnel, and Nym takes 40s to start. */
const PROBE_TIMEOUT_MS = 75_000;

/** Mixnets cannot reach a chain on localhost, so a devnet reads it directly. */
export type RouteStatus = AnonStatus | { state: "devnet" };

let status: RouteStatus = DEVNET ? { state: "devnet" } : { state: "connecting", worker: "nox" };
const listeners = new Set<() => void>();

const route = createAnonRoute({
  // Browsers withhold what the workers need on plain http, so failing now saves two minutes.
  makeWorker: (name) =>
    globalThis.isSecureContext ? makeBrowserWorker(name) : Promise.reject(new Error("insecure context")),
  plainFetch,
  onStatus: (next) => {
    status = next;
    listeners.forEach((notify) => notify());
  },
  probeTimeoutMs: PROBE_TIMEOUT_MS,
  probeUrl: RPC_URL,
});

export const anonRoute = route;

export const readClient = createPublicClient({
  chain: baseSepolia,
  transport: http(RPC_URL, { fetchFn: DEVNET ? undefined : route.fetch, retryCount: 0, timeout: PROBE_TIMEOUT_MS * 3 }),
}) as unknown as PublicClient;

export const getStatus = () => status;
export const subscribeStatus = (notify: () => void) => {
  listeners.add(notify);
  return () => listeners.delete(notify);
};
