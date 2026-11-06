"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { WagmiProvider, createConfig, http, unstable_connector } from "wagmi";
import { baseSepolia } from "wagmi/chains";
import { injected, mock } from "wagmi/connectors";
import { DEVNET, DEV_WALLET, RPC_URL } from "@/lib/addresses";

/** Transactions and their receipts use the wallet's RPC. App reads use the anon route. */
const chain = DEVNET ? { ...baseSepolia, rpcUrls: { default: { http: [RPC_URL] } } } : baseSepolia;

const config = createConfig({
  chains: [chain],
  connectors: DEVNET ? [mock({ accounts: [DEV_WALLET], features: { reconnect: true } }), injected()] : [injected()],
  transports: { [chain.id]: DEVNET ? http(RPC_URL) : unstable_connector(injected) },
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
