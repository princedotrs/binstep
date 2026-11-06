import { describe, expect, test } from "bun:test";
import { mintBlocker, mintSides, parseAmount, swapBlocker } from "./validate";

describe("parseAmount", () => {
  test("reads plain decimals", () => {
    expect(parseAmount("1.5", 18)).toBe(1500000000000000000n);
  });
  test("rejects junk, blanks and excess precision", () => {
    for (const bad of ["", " ", "abc", "1e3", "-1", "1.1234567", "."]) expect(parseAmount(bad, 6)).toBeNull();
  });
});

describe("mintSides", () => {
  test("a range across the price needs both", () => {
    expect(mintSides(10, 5, 12, true)).toEqual({ weth: true, usdc: true });
  });
  test("a range above needs WETH, below needs USDC", () => {
    expect(mintSides(20, 5, 12, true)).toEqual({ weth: true, usdc: false });
    expect(mintSides(0, 5, 12, true)).toEqual({ weth: false, usdc: true });
  });
});

describe("mintBlocker", () => {
  const ok = { weth: "1", usdc: "2000", wethBalance: 5n * 10n ** 18n, usdcBalance: 9000n * 10n ** 6n };
  const across = { sides: { weth: true, usdc: true } };
  test("passes a funded form", () => {
    expect(mintBlocker({ ...ok, ...across })).toBeNull();
  });
  test("needs both tokens across the price", () => {
    expect(mintBlocker({ ...ok, ...across, usdc: "" })).toBe("Enter a tUSDC amount");
    expect(mintBlocker({ ...ok, ...across, weth: "0" })).toBe("Enter a tWETH amount");
  });
  test("ignores the unused side", () => {
    expect(mintBlocker({ ...ok, usdc: "", sides: { weth: true, usdc: false } })).toBeNull();
  });
  test("names the short token", () => {
    expect(mintBlocker({ ...ok, ...across, weth: "6" })).toBe("Not enough tWETH");
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
