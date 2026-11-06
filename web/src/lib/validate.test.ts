import { describe, expect, test } from "bun:test";
import { createBlocker, mintBlocker, mintSides, parseAmount, swapBlocker } from "./validate";

describe("parseAmount", () => {
  test("reads plain decimals", () => {
    expect(parseAmount("1.5", 18)).toBe(1500000000000000000n);
  });
  test("rejects junk, blanks and excess precision", () => {
    for (const bad of ["", " ", "abc", "1e3", "-1", "1.1234567", "."]) expect(parseAmount(bad, 6)).toBeNull();
  });
});

const FIRST = { baseIsToken0: true, baseDecimals: 18 };

describe("mintSides", () => {
  test("a range across the price needs both", () => {
    expect(mintSides(10, 5, 12, FIRST)).toEqual({ base: true, usdc: true });
  });
  test("a range above needs WETH, below needs USDC", () => {
    expect(mintSides(20, 5, 12, FIRST)).toEqual({ base: true, usdc: false });
    expect(mintSides(0, 5, 12, FIRST)).toEqual({ base: false, usdc: true });
  });
});

describe("mintBlocker", () => {
  const ok = { market: { symbol: "tWETH", baseDecimals: 18 }, base: "1", usdc: "2000", baseBalance: 5n * 10n ** 18n, usdcBalance: 9000n * 10n ** 6n };
  const across = { sides: { base: true, usdc: true } };
  test("passes a funded form", () => {
    expect(mintBlocker({ ...ok, ...across })).toBeNull();
  });
  test("needs both tokens across the price", () => {
    expect(mintBlocker({ ...ok, ...across, usdc: "" })).toBe("Enter a tUSDC amount");
    expect(mintBlocker({ ...ok, ...across, base: "0" })).toBe("Enter a tWETH amount");
  });
  test("ignores the unused side", () => {
    expect(mintBlocker({ ...ok, usdc: "", sides: { base: true, usdc: false } })).toBeNull();
  });
  test("names the short token", () => {
    expect(mintBlocker({ ...ok, ...across, base: "6" })).toBe("Not enough tWETH");
    expect(mintBlocker({ ...ok, ...across, usdc: "9000.1" })).toBe("Not enough tUSDC");
  });
});

describe("swapBlocker", () => {
  test("needs a real amount within balance", () => {
    expect(swapBlocker("", 18, 1n)).toBe("Enter an amount");
    expect(swapBlocker("0", 18, 1n)).toBe("Enter an amount");
    expect(swapBlocker("2", 18, 10n ** 18n)).toBe("Not enough balance");
    expect(swapBlocker("1", 18, 10n ** 18n)).toBeNull();
  });
});

describe("createBlocker", () => {
  test("accepts a token the registry would", () => {
    expect(createBlocker("Moon Coin", "MOON", "1.25")).toBeNull();
    expect(createBlocker("a".repeat(32), "A".repeat(11), "0.001")).toBeNull();
    expect(createBlocker("Moon", "MOON", "10000000")).toBeNull();
  });
  test("asks for each field in order", () => {
    expect(createBlocker(" ", "MOON", "1")).toBe("Enter a token name");
    expect(createBlocker("Moon", " ", "1")).toBe("Enter a symbol");
    expect(createBlocker("Moon", "MOON", "")).toBe("Enter a starting price");
  });
  test("counts bytes as the contract does", () => {
    expect(createBlocker("é".repeat(17), "MOON", "1")).toBe("That name is too long");
    expect(createBlocker("Moon", "é".repeat(6), "1")).toBe("That symbol is too long");
  });
  test("rejects a price outside the limits", () => {
    for (const bad of ["0.000999", "10000000.01"]) expect(createBlocker("Moon", "MOON", bad)).toMatch(/^Use a price/);
    expect(createBlocker("Moon", "MOON", "0.0000001")).toBe("Enter a starting price");
  });
});
