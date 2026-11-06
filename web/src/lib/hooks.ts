"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState, useSyncExternalStore } from "react";
import { useAccount, useConfig, useSwitchChain, useWriteContract } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import { CHAIN_ID } from "./addresses";
import { poolLiquidity } from "./math";
import { readPool, type PoolState } from "./read";
import { getStatus, readClient, subscribeStatus } from "./route";
import { aprOf, type MarketStats } from "./stats";

const POLL_MS = 15_000;
const STATS_POLL_MS = 60_000;

export function useAnonStatus() {
  return useSyncExternalStore(subscribeStatus, getStatus, getStatus);
}

export function usePool() {
  const { address } = useAccount();
  return useQuery<PoolState>({
    queryKey: ["pool", address ?? "none"],
    queryFn: () => readPool(readClient, address),
    // Keeps the page and the user's draft on screen while a newly connected wallet loads.
    placeholderData: (previous) => previous,
    refetchInterval: POLL_MS,
    retry: false,
  });
}

export function liquidityUsd(pool: PoolState) {
  const { weth, usdc } = poolLiquidity(pool.bins, pool.tick, pool.wethIsToken0);
  return weth * pool.usd + usdc;
}

export type MarketSummary = MarketStats & { apr: number };

/** Waits for the pool so APR has a liquidity figure to divide by. */
export function useStats(pool: PoolState | undefined) {
  const query = useQuery<MarketStats>({
    queryKey: ["stats"],
    queryFn: async () => {
      const res = await fetch("/api/stats");
      if (!res.ok) throw new Error("Stats are unavailable");
      return res.json();
    },
    refetchInterval: STATS_POLL_MS,
    retry: 1,
  });
  const data: MarketSummary | undefined =
    query.data && pool ? { ...query.data, apr: aprOf(query.data.fees, liquidityUsd(pool)) } : undefined;
  return { data, isError: query.isError };
}

type Call = Parameters<ReturnType<typeof useWriteContract>["writeContractAsync"]>[0];

/** Sends calls in order through the wallet and waits for each one. */
export function useTransactions() {
  const { chainId, isConnected } = useAccount();
  const config = useConfig();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (label: string, calls: readonly unknown[]) => {
      setError(null);
      setBusy(label);
      try {
        if (chainId !== CHAIN_ID) await switchChainAsync({ chainId: CHAIN_ID });
        for (const call of calls) {
          const hash = await writeContractAsync(call as Call);
          await waitForTransactionReceipt(config, { hash, chainId: CHAIN_ID });
        }
        await queryClient.invalidateQueries({ queryKey: ["pool"] });
      } catch (e) {
        const message = (e as { shortMessage?: string; message?: string }).shortMessage ?? (e as Error).message;
        setError(message);
      } finally {
        setBusy(null);
      }
    },
    [chainId, config, queryClient, switchChainAsync, writeContractAsync],
  );

  return { run, busy, error, canSend: isConnected };
}
