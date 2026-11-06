"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState, useSyncExternalStore } from "react";
import { useAccount, useSwitchChain, useWriteContract } from "wagmi";
import { CHAIN_ID } from "./addresses";
import { readPool, type PoolState } from "./read";
import { getStatus, readClient, subscribeStatus } from "./route";

const POLL_MS = 15_000;

export function useAnonStatus() {
  return useSyncExternalStore(subscribeStatus, getStatus, getStatus);
}

export function usePool() {
  const { address } = useAccount();
  return useQuery<PoolState>({
    queryKey: ["pool", address ?? "none"],
    queryFn: () => readPool(readClient, address),
    refetchInterval: POLL_MS,
    retry: false,
  });
}

type Call = Parameters<ReturnType<typeof useWriteContract>["writeContractAsync"]>[0];

/** Sends calls in order through the wallet and waits for each one. */
export function useTransactions() {
  const { chainId, isConnected } = useAccount();
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
          await readClient.waitForTransactionReceipt({ hash });
        }
        await queryClient.invalidateQueries({ queryKey: ["pool"] });
      } catch (e) {
        const message = (e as { shortMessage?: string; message?: string }).shortMessage ?? (e as Error).message;
        setError(message);
      } finally {
        setBusy(null);
      }
    },
    [chainId, queryClient, switchChainAsync, writeContractAsync],
  );

  return { run, busy, error, canSend: isConnected };
}
