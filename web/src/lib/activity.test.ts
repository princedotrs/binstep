import { describe, expect, test } from "bun:test";
import { countActions } from "./activity";

describe("countActions", () => {
  test("counts each kind per position", () => {
    const counts = countActions([
      { positionId: 7n, kind: 0 },
      { positionId: 7n, kind: 0 },
      { positionId: 7n, kind: 1 },
      { positionId: 9n, kind: 1 },
    ]);
    expect(counts).toEqual({ "7": { compounds: 2, rebalances: 1 }, "9": { compounds: 0, rebalances: 1 } });
  });
  test("is empty with no actions", () => {
    expect(countActions([])).toEqual({});
  });
});
