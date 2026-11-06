import { parseEther, parseUnits } from "viem";

export const AIRDROP_WETH = parseUnits("10", 18);
export const AIRDROP_USDC = parseUnits("25000", 6);

/** Enough Base Sepolia ETH for dozens of transactions at current gas prices. */
export const GAS_DRIP = parseEther("0.0003");
export const MIN_GAS = parseEther("0.0001");

const CAP_MULTIPLE = 10n;

export type AirdropKind = "first" | "more";
export type AirdropWallet = { weth: bigint; usdc: bigint; eth: bigint };
export type AirdropDecision = { send: true; gas: bigint } | { send: false; reason: "already" | "capped" };

export function decideAirdrop(kind: AirdropKind, wallet: AirdropWallet): AirdropDecision {
  if (kind === "first" && (wallet.weth > 0n || wallet.usdc > 0n)) return { send: false, reason: "already" };
  const capped = wallet.weth >= AIRDROP_WETH * CAP_MULTIPLE && wallet.usdc >= AIRDROP_USDC * CAP_MULTIPLE;
  if (capped) return { send: false, reason: "capped" };
  return { send: true, gas: wallet.eth < MIN_GAS ? GAS_DRIP : 0n };
}
