import { createPublicClient, fallback, http, type PublicClient } from "viem";
import { baseSepolia } from "viem/chains";
import { DEVNET, RPC_URL } from "./addresses";

/** Public endpoints stall at times, so a server read moves on quickly to the next one. */
const URLS = DEVNET
  ? [RPC_URL]
  : [RPC_URL, "https://base-sepolia-rpc.publicnode.com", "https://base-sepolia.drpc.org"];

export const serverClient = createPublicClient({
  chain: baseSepolia,
  transport: fallback(URLS.map((url) => http(url, { timeout: 8_000, retryCount: 1 }))),
}) as unknown as PublicClient;
