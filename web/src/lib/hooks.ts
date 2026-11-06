"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { useAccount, useConfig, useSwitchChain, useWriteContract } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import { CHAIN_ID, DEVNET } from "./addresses";
import { poolLiquidity } from "./math";
import { decodePool, readWallet, type PoolState } from "./read";
import { getStatus, readClient, subscribeStatus } from "./route";
import { aprOf, type MarketStats } from "./stats";

const POLL_MS = DEVNET ? 3_000 : 15_000;
const STATS_POLL_MS = DEVNET ? 5_000 : 60_000;
const STATS_RETRY_MS = 10_000;

export function useAnonStatus() {
  return useSyncExternalStore(subscribeStatus, getStatus, getStatus);
}

/**
 * Market data is public and carries no wallet, so the app's server reads it. Only reads that
 * name the user's wallet use the anon route, so a failed route never blanks the market.
 */
export function usePool() {
  const { address } = useAccount();
  const market = useQuery<PoolState>({
    queryKey: ["pool", "market"],
    queryFn: async () => {
      const res = await fetch("/api/pool");
      if (!res.ok) throw new Error("Pool data is unavailable");
      return decodePool(await res.text());
    },
    refetchInterval: POLL_MS,
    retry: 1,
  });
  const wallet = useQuery({
    queryKey: ["pool", "wallet", address],
    queryFn: () => readWallet(readClient, address!),
    enabled: Boolean(address),
    refetchInterval: POLL_MS,
    retry: false,
  });
  const data = useMemo(
    () => market.data && { ...market.data, wallet: address ? (wallet.data ?? null) : null },
    [market.data, wallet.data, address],
  );
  return { data, isError: market.isError };
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
    refetchInterval: (query) => (query.state.status === "error" ? STATS_RETRY_MS : STATS_POLL_MS),
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
        await fetch("/api/pool?fresh=1").catch(() => {});
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
