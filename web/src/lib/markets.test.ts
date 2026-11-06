import { describe, expect, test } from "bun:test";
import { airdropBase } from "./airdrop";
import { txUrl, price } from "./format";
import { airdropAt, communityMarket, poolKeyOf } from "./markets";
import { closeNotice, getNotice, showNotice, subscribeNotice } from "./notice";

const listing = {
  token: "0xAbCdEf0000000000000000000000000000000001",
  poolId: `0x${"11".repeat(32)}`,
  baseIsToken0: false,
  symbol: "MOON",
  name: "Moon Coin",
  priceE6: 2_000_000n,
} as const;

describe("communityMarket", () => {
  const market = communityMarket(listing);

  test("uses the token address as a url-safe id, since symbols repeat", () => {
    expect(market.id).toBe(listing.token.toLowerCase());
    expect(market.href).toBe(`/pool/${market.id}`);
    expect(market.swapHref).toBe(`/swap/${market.id}`);
    expect(market.name).toBe("MOON / tUSDC");
  });
  test("is listed under Community", () => {
    expect(market.category).toBe("Community");
  });
  test("keeps the token order in its pool key", () => {
    expect(poolKeyOf(market).currency1).toBe(listing.token);
  });
});

describe("airdropAt", () => {
  test("sends about $25,000 of the token", () => {
    expect(airdropAt(2_000_000n)).toBe("12500");
    expect(airdropAt(3_000_000n)).toBe("8330");
  });
  test("always gives an amount parseUnits can read", () => {
    for (const priceE6 of [1_000n, 10_000_000_000_000n]) {
      const market = communityMarket({ ...listing, priceE6 });
      expect(airdropBase(market)).toBeGreaterThan(0n);
    }
  });
});

describe("price", () => {
  test("keeps small prices readable", () => {
    expect(price(0.00123456)).toBe("$0.001235");
    expect(price(2199.79)).toBe("$2,199.79");
    expect(price(0)).toBe("$0.00");
  });
});

describe("notice", () => {
  test("links to the transaction on Basescan", () => {
    expect(txUrl("0xabc")).toBe("https://sepolia.basescan.org/tx/0xabc");
  });
  test("tells subscribers and closes", () => {
    let calls = 0;
    const stop = subscribeNotice(() => calls++);
    showNotice("Swap confirmed", "0xabc");
    expect(getNotice()).toEqual({ title: "Swap confirmed", hash: "0xabc" });
    closeNotice();
    expect(getNotice()).toBeNull();
    stop();
    showNotice("Later", "0xdef");
    expect(calls).toBe(2);
    closeNotice();
  });
});
