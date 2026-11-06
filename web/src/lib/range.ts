import { binToUsd } from "./math";

/**
 * A range as bin offsets from the active bin, in display order: lower offsets are
 * lower USD prices. This keeps the chart the same whichever token is token0.
 */
export type Range = { lo: number; hi: number };

export const binAtOffset = (activeBin: number, offset: number, wethIsToken0: boolean) =>
  wethIsToken0 ? activeBin + offset : activeBin - offset;

export const lowerBinOf = (activeBin: number, range: Range, wethIsToken0: boolean) =>
  wethIsToken0 ? activeBin + range.lo : activeBin - range.hi;

/** USD price at the low edge of the column at this offset. */
export const edgeUsd = (activeBin: number, offset: number, wethIsToken0: boolean) =>
  binToUsd(wethIsToken0 ? activeBin + offset : activeBin - offset + 1, wethIsToken0);

export function offsetOfUsd(usd: number, activeBin: number, wethIsToken0: boolean) {
  const base = edgeUsd(activeBin, 0, wethIsToken0);
  const step = edgeUsd(activeBin, 1, wethIsToken0) / base;
  return Math.round(Math.log(usd / base) / Math.log(step));
}
