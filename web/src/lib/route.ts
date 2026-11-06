"use client";

import { createPublicClient, http, type PublicClient } from "viem";
import { baseSepolia } from "viem/chains";
import { BASE_SEPOLIA_RPC } from "./addresses";
import { createAnonRoute, type AnonStatus } from "./anon";
import { makeBrowserWorker, plainFetch } from "./anon-workers";

/** Nox can take about a minute to reopen a tunnel, and Nym takes 40s to start. */
const PROBE_TIMEOUT_MS = 75_000;

let status: AnonStatus = { state: "connecting", worker: "nox" };
const listeners = new Set<() => void>();

const route = createAnonRoute({
  makeWorker: makeBrowserWorker,
  plainFetch,
  onStatus: (next) => {
    status = next;
    listeners.forEach((notify) => notify());
  },
  probeTimeoutMs: PROBE_TIMEOUT_MS,
  probeUrl: BASE_SEPOLIA_RPC,
});

export const anonRoute = route;

export const readClient = createPublicClient({
  chain: baseSepolia,
  transport: http(BASE_SEPOLIA_RPC, { fetchFn: route.fetch, retryCount: 0, timeout: PROBE_TIMEOUT_MS * 3 }),
}) as unknown as PublicClient;

export const getStatus = () => status;
export const subscribeStatus = (notify: () => void) => {
  listeners.add(notify);
  return () => listeners.delete(notify);
};
