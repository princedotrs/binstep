import { describe, expect, test } from "bun:test";
import { AIRDROP_USDC, GAS_DRIP, airdropBase, decideAirdrop, takeGasDrip, type GasDrips } from "./airdrop";

const empty = { base: 0n, usdc: 0n, eth: 0n };
const AIRDROP = 10n ** 19n;

describe("decideAirdrop", () => {
  test("a new wallet gets tokens and gas", () => {
    expect(decideAirdrop("first", empty, AIRDROP)).toEqual({ send: true, gas: GAS_DRIP });
  });
  test("first only fires for a wallet with no test tokens", () => {
    expect(decideAirdrop("first", { ...empty, base: 1n }, AIRDROP)).toEqual({ send: false, reason: "already" });
    expect(decideAirdrop("first", { ...empty, usdc: 1n }, AIRDROP)).toEqual({ send: false, reason: "already" });
  });
  test("a wallet holding any ETH gets only tokens", () => {
    expect(decideAirdrop("first", { ...empty, eth: 1n }, AIRDROP)).toEqual({ send: true, gas: 0n });
    expect(decideAirdrop("more", { ...empty, eth: 1n }, AIRDROP)).toEqual({ send: true, gas: 0n });
  });
  test("more sends gas to a wallet with no ETH", () => {
    expect(decideAirdrop("more", empty, AIRDROP)).toEqual({ send: true, gas: GAS_DRIP });
  });
  test("usdc is capped on tUSDC alone", () => {
    expect(decideAirdrop("usdc", empty, 0n)).toEqual({ send: true, gas: GAS_DRIP });
    expect(decideAirdrop("usdc", { ...empty, eth: 1n, usdc: AIRDROP_USDC * 9n }, 0n)).toEqual({ send: true, gas: 0n });
    expect(decideAirdrop("usdc", { ...empty, usdc: AIRDROP_USDC * 10n }, 0n)).toEqual({ send: false, reason: "capped" });
  });
  test("more works for a wallet that already has tokens", () => {
    const wallet = { base: AIRDROP, usdc: AIRDROP_USDC, eth: 1n };
    expect(decideAirdrop("more", wallet, AIRDROP)).toEqual({ send: true, gas: 0n });
  });
  test("more stops at the cap", () => {
    const wallet = { base: AIRDROP * 10n, usdc: AIRDROP_USDC * 10n, eth: 1n };
    expect(decideAirdrop("more", wallet, AIRDROP)).toEqual({ send: false, reason: "capped" });
  });
  test("more still works when only one token is at the cap", () => {
    const wallet = { base: AIRDROP * 10n, usdc: 0n, eth: 1n };
    expect(decideAirdrop("more", wallet, AIRDROP).send).toBe(true);
  });
  test("the cap follows the market's own airdrop size", () => {
    const amount = 33n * 10n ** 6n;
    const wallet = { base: amount * 10n - 1n, usdc: AIRDROP_USDC * 10n, eth: 1n };
    expect(decideAirdrop("more", wallet, amount).send).toBe(true);
    expect(decideAirdrop("more", { ...wallet, base: amount * 10n }, amount).send).toBe(false);
  });
});

describe("airdropBase", () => {
  test("uses the market's decimals", () => {
    expect(airdropBase({ airdrop: "0.33", baseDecimals: 8 })).toBe(33_000_000n);
    expect(airdropBase({ airdrop: "10", baseDecimals: 18 })).toBe(10n ** 19n);
  });
});

describe("takeGasDrip", () => {
  const HOUR = 60 * 60_000;

  test("limits one IP to three drips an hour", () => {
    const drips: GasDrips = new Map();
    const taken = [0, 1, 2, 3].map((at) => takeGasDrip(drips, "1.1.1.1", at));
    expect(taken).toEqual([true, true, true, false]);
    expect(takeGasDrip(drips, "2.2.2.2", 4)).toBe(true);
  });

  test("allows an IP again after the hour", () => {
    const drips: GasDrips = new Map();
    [0, 1, 2].forEach((at) => takeGasDrip(drips, "1.1.1.1", at));
    expect(takeGasDrip(drips, "1.1.1.1", HOUR + 3)).toBe(true);
  });

  test("limits a server to thirty drips an hour across IPs", () => {
    const drips: GasDrips = new Map();
    const taken = Array.from({ length: 31 }, (_, i) => takeGasDrip(drips, `10.0.0.${i}`, i));
    expect(taken.filter(Boolean)).toHaveLength(30);
    expect(taken[30]).toBe(false);
  });
});
