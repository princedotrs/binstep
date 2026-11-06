import type { Address, Hex } from "viem";
import { DYNAMIC_FEE_FLAG, TICK_SPACING, addresses, deployment, type DeployedMarket } from "./addresses";
import type { Pair } from "./math";

export const COMMUNITY = "Community";
export const CATEGORIES = ["Crypto", "Staked", "Stocks", "Commodities", "Treasuries", COMMUNITY] as const;
export type Category = (typeof CATEGORIES)[number];

export type Market = Pair & {
  id: string;
  name: string;
  symbol: string;
  /** What the test token stands for. */
  title: string;
  category: Category;
  token: Address;
  poolId: Hex;
  /** Base tokens sent per airdrop, about $25,000 at the seed price. */
  airdrop: string;
  href: string;
  swapHref: string;
  binWidth: string;
};

const LISTINGS: Record<string, Pick<Market, "title" | "category" | "airdrop">> = {
  tWETH: { title: "Ethereum", category: "Crypto", airdrop: "10" },
  tWBTC: { title: "Bitcoin", category: "Crypto", airdrop: "0.33" },
  tZEC: { title: "Zcash", category: "Crypto", airdrop: "19" },
  tstETH: { title: "Staked Ether", category: "Staked", airdrop: "11" },
  tNVDA: { title: "NVIDIA stock", category: "Stocks", airdrop: "114" },
  tXAU: { title: "Gold", category: "Commodities", airdrop: "6" },
  tWTI: { title: "WTI crude oil", category: "Commodities", airdrop: "275" },
  tOUSG: { title: "US Treasuries fund", category: "Treasuries", airdrop: "215" },
};

const withLinks = (id: string, fields: Omit<Market, "id" | "name" | "href" | "swapHref" | "binWidth">): Market => ({
  ...fields,
  id,
  name: `${fields.symbol} / tUSDC`,
  href: `/pool/${id}`,
  swapHref: `/swap/${id}`,
  binWidth: "0.10%",
});

function listed({ symbol, decimals, token, poolId, baseIsToken0 }: DeployedMarket): Market | null {
  const listing = LISTINGS[symbol];
  if (!listing) return null;
  return withLinks(`${symbol}-tusdc`.toLowerCase(), {
    ...listing,
    symbol,
    baseDecimals: decimals,
    baseIsToken0,
    token: token as Address,
    poolId: poolId as Hex,
  });
}

/** Markets appear here once they are in the deployment file. Each one's data comes from `usePool`. */
export const MARKETS: Market[] = [
  {
    symbol: "tWETH",
    decimals: 18,
    token: deployment.weth,
    poolId: deployment.poolId,
    baseIsToken0: deployment.wethIsToken0,
  },
  ...(deployment.markets ?? []),
].flatMap((entry) => listed(entry) ?? []);

export const DEFAULT_MARKET = MARKETS[0];

export type Listing = Pick<Market, "token" | "poolId" | "baseIsToken0" | "symbol"> & { name: string; priceE6: bigint };

const AIRDROP_USD = 25_000;
export const COMMUNITY_DECIMALS = 18;

/** About $25,000 of a token at this price, rounded so it reads well. */
export const airdropAt = (priceE6: bigint) => String(Number(((AIRDROP_USD * 1e6) / Number(priceE6)).toPrecision(3)));

/** A market a user created. Symbols can repeat, so the token address is the id. */
export const communityMarket = ({ token, poolId, baseIsToken0, symbol, name, priceE6 }: Listing): Market =>
  withLinks(token.toLowerCase(), {
    symbol,
    title: name,
    category: COMMUNITY,
    baseDecimals: COMMUNITY_DECIMALS,
    baseIsToken0,
    token,
    poolId,
    airdrop: airdropAt(priceE6),
  });

export const findMarket = (id: string) => MARKETS.find((market) => market.id === id);

export function poolKeyOf({ token, baseIsToken0 }: Market) {
  return {
    currency0: baseIsToken0 ? token : addresses.usdc,
    currency1: baseIsToken0 ? addresses.usdc : token,
    fee: DYNAMIC_FEE_FLAG,
    tickSpacing: TICK_SPACING,
    hooks: addresses.hook,
  } as const;
}
