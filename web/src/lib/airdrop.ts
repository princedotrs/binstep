import { parseEther, parseUnits } from "viem";
import type { Market } from "./markets";

export const AIRDROP_USDC = parseUnits("25000", 6);

/** Enough Base Sepolia ETH for dozens of transactions at current gas prices. */
export const GAS_DRIP = parseEther("0.0003");

const CAP_MULTIPLE = 10n;

const GAS_WINDOW_MS = 60 * 60_000;
const GAS_DRIPS_PER_IP = 3;
const GAS_DRIPS_PER_SERVER = 30;
const ALL_IPS = "all";

export type GasDrips = Map<string, number[]>;

/**
 * New addresses are free, so without this anyone could script requests and drain the wallet's
 * ETH. The counts sit in one server's memory and reset with it, so this slows abuse without
 * stopping it, which suits test ETH. Tokens still go out without gas.
 */
export function takeGasDrip(drips: GasDrips, ip: string, now: number) {
  const recent = (key: string) => (drips.get(key) ?? []).filter((at) => now - at < GAS_WINDOW_MS);
  const [mine, everyone] = [recent(ip), recent(ALL_IPS)];
  if (mine.length >= GAS_DRIPS_PER_IP || everyone.length >= GAS_DRIPS_PER_SERVER) return false;
  drips.set(ip, [...mine, now]);
  drips.set(ALL_IPS, [...everyone, now]);
  return true;
}

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
