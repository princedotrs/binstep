import { parseEther, parseUnits } from "viem";
import type { Market } from "./markets";

export const AIRDROP_USDC = parseUnits("25000", 6);

/** Enough Base Sepolia ETH for dozens of transactions at current gas prices. */
export const GAS_DRIP = parseEther("0.0003");

const CAP_MULTIPLE = 10n;

export const airdropBase = (market: Pick<Market, "airdrop" | "baseDecimals">) => parseUnits(market.airdrop, market.baseDecimals);

/** `usdc` sends only tUSDC, so it names no market. */
export type AirdropKind = "first" | "more" | "usdc";
export type AirdropWallet = { base: bigint; usdc: bigint; eth: bigint };
export type AirdropDecision = { send: true; gas: bigint } | { send: false; reason: "already" | "capped" };

export function decideAirdrop(kind: AirdropKind, wallet: AirdropWallet, baseAmount: bigint): AirdropDecision {
  if (kind === "first" && (wallet.base > 0n || wallet.usdc > 0n)) return { send: false, reason: "already" };
  const capped = wallet.base >= baseAmount * CAP_MULTIPLE && wallet.usdc >= AIRDROP_USDC * CAP_MULTIPLE;
  if (capped) return { send: false, reason: "capped" };
  return { send: true, gas: wallet.eth === 0n ? GAS_DRIP : 0n };
}
