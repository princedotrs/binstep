import { parseUnits } from "viem";
import { USDC_DECIMALS } from "./addresses";
import type { Market } from "./markets";
import type { Pair } from "./math";

export function parseAmount(text: string, decimals: number): bigint | null {
  const value = text.trim();
  if (!/^\d*\.?\d+$|^\d+\.$/.test(value)) return null;
  const fraction = value.split(".")[1] ?? "";
  if (fraction.length > decimals) return null;
  return parseUnits(value, decimals);
}

/** Bins above the price hold token0 and bins below it hold token1. */
export function mintSides(lowerBin: number, numBins: number, activeBin: number, pair: Pair) {
  const needsToken0 = lowerBin + numBins - 1 >= activeBin;
  const needsToken1 = lowerBin <= activeBin;
  return pair.baseIsToken0 ? { base: needsToken0, usdc: needsToken1 } : { base: needsToken1, usdc: needsToken0 };
}

export function mintBlocker(p: {
  market: Pick<Market, "symbol" | "baseDecimals">;
  base: string;
  usdc: string;
  baseBalance: bigint;
  usdcBalance: bigint;
  sides: { base: boolean; usdc: boolean };
}): string | null {
  const base = parseAmount(p.base, p.market.baseDecimals);
  const usdc = parseAmount(p.usdc, USDC_DECIMALS);
  if (p.sides.base && !base) return `Enter a ${p.market.symbol} amount`;
  if (p.sides.usdc && !usdc) return "Enter a tUSDC amount";
  if (p.sides.base && base! > p.baseBalance) return `Not enough ${p.market.symbol}`;
  if (p.sides.usdc && usdc! > p.usdcBalance) return "Not enough tUSDC";
  return null;
}

/** The limits BinStepRegistry enforces. */
const MAX_NAME_BYTES = 32;
const MAX_SYMBOL_BYTES = 11;
const MIN_PRICE_E6 = 1_000n;
const MAX_PRICE_E6 = 10_000_000_000_000n;

const byteLength = (text: string) => new TextEncoder().encode(text).length;

export function createBlocker(name: string, symbol: string, priceUsd: string): string | null {
  if (!name.trim()) return "Enter a token name";
  if (byteLength(name.trim()) > MAX_NAME_BYTES) return "That name is too long";
  if (!symbol.trim()) return "Enter a symbol";
  if (byteLength(symbol.trim()) > MAX_SYMBOL_BYTES) return "That symbol is too long";
  const price = parseAmount(priceUsd, USDC_DECIMALS);
  if (!price) return "Enter a starting price";
  return price < MIN_PRICE_E6 || price > MAX_PRICE_E6 ? "Use a price from $0.001 to $10,000,000" : null;
}

export function swapBlocker(text: string, decimals: number, balance: bigint): string | null {
  const amount = parseAmount(text, decimals);
  if (!amount) return "Enter an amount";
  return amount > balance ? "Not enough balance" : null;
}
