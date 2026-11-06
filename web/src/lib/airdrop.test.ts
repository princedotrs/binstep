import { describe, expect, test } from "bun:test";
import { AIRDROP_USDC, AIRDROP_WETH, GAS_DRIP, MIN_GAS, decideAirdrop } from "./airdrop";

const empty = { weth: 0n, usdc: 0n, eth: 0n };

describe("decideAirdrop", () => {
  test("a new wallet gets tokens and gas", () => {
    expect(decideAirdrop("first", empty)).toEqual({ send: true, gas: GAS_DRIP });
  });
  test("first only fires for a wallet with no test tokens", () => {
    expect(decideAirdrop("first", { ...empty, weth: 1n })).toEqual({ send: false, reason: "already" });
    expect(decideAirdrop("first", { ...empty, usdc: 1n })).toEqual({ send: false, reason: "already" });
  });
  test("a wallet with enough gas gets none", () => {
    expect(decideAirdrop("first", { ...empty, eth: MIN_GAS })).toEqual({ send: true, gas: 0n });
  });
  test("a low wallet is topped up", () => {
    expect(decideAirdrop("first", { ...empty, eth: MIN_GAS - 1n })).toEqual({ send: true, gas: GAS_DRIP });
  });
  test("more works for a wallet that already has tokens", () => {
    const wallet = { weth: AIRDROP_WETH, usdc: AIRDROP_USDC, eth: MIN_GAS };
    expect(decideAirdrop("more", wallet)).toEqual({ send: true, gas: 0n });
  });
  test("more stops at the cap", () => {
    const wallet = { weth: AIRDROP_WETH * 10n, usdc: AIRDROP_USDC * 10n, eth: MIN_GAS };
    expect(decideAirdrop("more", wallet)).toEqual({ send: false, reason: "capped" });
  });
  test("more still works when only one token is at the cap", () => {
    const wallet = { weth: AIRDROP_WETH * 10n, usdc: 0n, eth: MIN_GAS };
    expect(decideAirdrop("more", wallet).send).toBe(true);
  });
});
