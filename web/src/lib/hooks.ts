"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import type { TransactionReceipt } from "viem";
import { useAccount, useConfig, useSwitchChain, useWriteContract } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import { CHAIN_ID, DEVNET } from "./addresses";
import type { Market } from "./markets";
import { poolLiquidity } from "./math";
import { showNotice } from "./notice";
import { decodePools, readWallet, type PoolState, type Pools } from "./read";
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
export function usePools() {
  return useQuery<Pools>({
    queryKey: ["pool", "market"],
    queryFn: async () => {
      const res = await fetch("/api/pool");
      if (!res.ok) throw new Error("Pool data is unavailable");
      return decodePools(await res.text());
    },
    refetchInterval: POLL_MS,
    retry: 1,
  });
}

export function usePool(market: Market) {
  const { address } = useAccount();
  const pools = usePools();
  const wallet = useQuery({
    queryKey: ["pool", "wallet", market.id, address],
    queryFn: () => readWallet(readClient, market, address!),
    enabled: Boolean(address),
    refetchInterval: POLL_MS,
    retry: false,
  });
  const pool = pools.data?.[market.id];
  const data = useMemo(
    () => pool && { ...pool, wallet: address ? (wallet.data ?? null) : null },
    [pool, wallet.data, address],
  );
  return { data, isError: pools.isError };
}

export function liquidityUsd(pool: PoolState) {
  const { base, usdc } = poolLiquidity(pool.bins, pool.tick, pool.market);
  return base * pool.usd + usdc;
}

export type MarketSummary = MarketStats & { apr: number };

/** Stats refresh slowly, so a new market has none yet. */
const NO_SWAPS: MarketStats = { volume: 0, fees: 0, swaps: 0 };

export function useAllStats() {
  return useQuery<Record<string, MarketStats>>({
    queryKey: ["stats"],
    queryFn: async () => {
      const res = await fetch("/api/stats");
      if (!res.ok) throw new Error("Stats are unavailable");
      return res.json();
    },
    refetchInterval: (query) => (query.state.status === "error" ? STATS_RETRY_MS : STATS_POLL_MS),
    retry: 1,
  });
}

/** Waits for the pool so APR has a liquidity figure to divide by. */
export function summarize(all: Record<string, MarketStats> | undefined, pool: PoolState | undefined): MarketSummary | undefined {
  if (!all || !pool) return undefined;
  const stats = all[pool.market.id] ?? NO_SWAPS;
  return { ...stats, apr: aprOf(stats.fees, liquidityUsd(pool)) };
}

export function useStats(pool: PoolState | undefined) {
  const query = useAllStats();
  return { data: summarize(query.data, pool), isError: query.isError };
}

type Call = Parameters<ReturnType<typeof useWriteContract>["writeContractAsync"]>[0];

/**
 * Sends calls in order through the wallet and waits for each one. Shows `done` when the last
 * lands, and returns its receipt, or null if any call failed.
 */
export function useTransactions() {
  const { chainId, isConnected } = useAccount();
  const config = useConfig();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (label: string, calls: readonly unknown[], done: string): Promise<TransactionReceipt | null> => {
      setError(null);
      setBusy(label);
      try {
        if (chainId !== CHAIN_ID) await switchChainAsync({ chainId: CHAIN_ID });
        let receipt: TransactionReceipt | null = null;
        for (const call of calls) {
          const hash = await writeContractAsync(call as Call);
          receipt = await waitForTransactionReceipt(config, { hash, chainId: CHAIN_ID });
          if (receipt.status !== "success") throw new Error("The transaction failed on chain");
        }
        if (receipt) showNotice(done, receipt.transactionHash);
        await fetch("/api/pool?fresh=1").catch(() => {});
        await queryClient.invalidateQueries({ queryKey: ["pool"] });
        return receipt;
      } catch (e) {
        const message = (e as { shortMessage?: string; message?: string }).shortMessage ?? (e as Error).message;
        setError(message);
        return null;
      } finally {
        setBusy(null);
      }
    },
    [chainId, config, queryClient, switchChainAsync, writeContractAsync],
  );

  return { run, busy, error, canSend: isConnected };
}
