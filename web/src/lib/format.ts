import { formatUnits } from "viem";

export const usd = (value: number) =>
  value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: value < 100 ? 2 : 0 });

/** A created token can trade far below a dollar, where two decimals would read $0.00. */
export const priceDigits = (value: number) =>
  value > 0 && value < 1 ? { maximumSignificantDigits: 4 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 };

export const price = (value: number) =>
  value.toLocaleString("en-US", { style: "currency", currency: "USD", ...priceDigits(value) });

export const percent = (value: number) => `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)}%`;

export function token(amount: bigint, decimals: number, places = 4) {
  const value = Number(formatUnits(amount, decimals));
  if (value > 0 && value < 10 ** -places) return `<${10 ** -places}`;
  return value.toLocaleString("en-US", { maximumFractionDigits: places });
}

export const txUrl = (hash: string) => `https://sepolia.basescan.org/tx/${hash}`;

export const shortAddress = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

/** Fee is in pips: 1,000,000 is 100%. */
export const feePercent = (pips: number) => `${(pips / 10_000).toFixed(pips % 100 === 0 ? 2 : 3)}%`;
