import { describe, expect, test } from "bun:test";
import { decodeAbiParameters, parseAbiParameters, size, slice, type Hex } from "viem";
import { ActionKind } from "./decide";
import { rawReport } from "./keeper";

const EXECUTION_ID = `0x${"ab".repeat(32)}` as Hex;
const HEADER_BYTES = 109;

describe("rawReport", () => {
  const actions = [
    { kind: ActionKind.Compound, positionId: 7n },
    { kind: ActionKind.Rebalance, positionId: 9n },
  ];
  const raw = rawReport(actions, 1_800_000_000, EXECUTION_ID);

  test("puts the version and execution id where the forwarder reads them", () => {
    expect(slice(raw, 0, 1)).toBe("0x01");
    expect(slice(raw, 1, 33)).toBe(EXECUTION_ID);
    expect(slice(raw, HEADER_BYTES - 2, HEADER_BYTES)).toBe("0x0001");
  });

  test("ends the header at 109 bytes, followed by the report", () => {
    const [observedAt, decoded] = decodeAbiParameters(
      parseAbiParameters("uint64, (uint8 kind, uint256 positionId)[]"),
      slice(raw, HEADER_BYTES),
    );
    expect(observedAt).toBe(1_800_000_000n);
    expect(decoded).toEqual(actions);
    expect(size(raw)).toBeGreaterThan(HEADER_BYTES);
  });
});
