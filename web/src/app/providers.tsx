"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { WagmiProvider, createConfig, custom, http } from "wagmi";
import { getConnection } from "wagmi/actions";
import { baseSepolia } from "wagmi/chains";
import { injected, mock } from "wagmi/connectors";
import { DEVNET, DEV_WALLET, RPC_URL } from "@/lib/addresses";

/** Transactions and their receipts use the wallet's RPC. App reads use the anon route. */
const chain = DEVNET ? { ...baseSepolia, rpcUrls: { default: { http: [RPC_URL] } } } : baseSepolia;

/** Sends to the connected wallet, which may not be the one holding window.ethereum. */
const connectedWallet = custom({
  async request({ method, params }): Promise<unknown> {
    const provider = (await getConnection(config).connector?.getProvider()) as
      | { request(args: { method: string; params?: unknown }): Promise<unknown> }
      | undefined;
    if (!provider) throw new Error("No wallet is connected");
    return provider.request({ method, params });
  },
});

const config = createConfig({
  chains: [chain],
  connectors: DEVNET ? [mock({ accounts: [DEV_WALLET], features: { reconnect: true } }), injected()] : [injected()],
  transports: { [chain.id]: DEVNET ? http(RPC_URL) : connectedWallet },
  ssr: true,
});

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
