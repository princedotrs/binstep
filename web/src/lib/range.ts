import { binToUsd, type Pair } from "./math";

/**
 * A range as bin offsets from the active bin, in display order: lower offsets are
 * lower USD prices. This keeps the chart the same whichever token is token0.
 */
export type Range = { lo: number; hi: number };

export const binAtOffset = (activeBin: number, offset: number, pair: Pair) =>
  pair.baseIsToken0 ? activeBin + offset : activeBin - offset;

export const lowerBinOf = (activeBin: number, range: Range, pair: Pair) =>
  pair.baseIsToken0 ? activeBin + range.lo : activeBin - range.hi;

/** USD price at the low edge of the column at this offset. */
export const edgeUsd = (activeBin: number, offset: number, pair: Pair) =>
  binToUsd(pair.baseIsToken0 ? activeBin + offset : activeBin - offset + 1, pair);

export function offsetOfUsd(usd: number, activeBin: number, pair: Pair) {
  const base = edgeUsd(activeBin, 0, pair);
  const step = edgeUsd(activeBin, 1, pair) / base;
  return Math.round(Math.log(usd / base) / Math.log(step));
}
