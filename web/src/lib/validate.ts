import { parseUnits } from "viem";
import { USDC_DECIMALS, WETH_DECIMALS } from "./addresses";

export function parseAmount(text: string, decimals: number): bigint | null {
  const value = text.trim();
  if (!/^\d*\.?\d+$|^\d+\.$/.test(value)) return null;
  const fraction = value.split(".")[1] ?? "";
  if (fraction.length > decimals) return null;
  return parseUnits(value, decimals);
}

/** Bins above the price hold token0 and bins below it hold token1. */
export function mintSides(lowerBin: number, numBins: number, activeBin: number, wethIsToken0: boolean) {
  const needsToken0 = lowerBin + numBins - 1 >= activeBin;
  const needsToken1 = lowerBin <= activeBin;
  return wethIsToken0 ? { weth: needsToken0, usdc: needsToken1 } : { weth: needsToken1, usdc: needsToken0 };
}

export function mintBlocker(p: {
  weth: string;
  usdc: string;
  wethBalance: bigint;
  usdcBalance: bigint;
  sides: { weth: boolean; usdc: boolean };
}): string | null {
  const weth = parseAmount(p.weth, WETH_DECIMALS);
  const usdc = parseAmount(p.usdc, USDC_DECIMALS);
  if (p.sides.weth && !weth) return "Enter a tWETH amount";
  if (p.sides.usdc && !usdc) return "Enter a tUSDC amount";
  if (p.sides.weth && weth! > p.wethBalance) return "Not enough tWETH";
  if (p.sides.usdc && usdc! > p.usdcBalance) return "Not enough tUSDC";
  return null;
}

export function swapBlocker(text: string, decimals: number, balance: bigint): string | null {
  const amount = parseAmount(text, decimals);
  if (!amount) return "Enter an amount";
  return amount > balance ? "Not enough balance" : null;
}
