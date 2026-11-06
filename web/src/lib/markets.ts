export type Market = {
  id: string;
  name: string;
  href: string;
  swapHref: string;
  binWidth: string;
};

const market = (id: string, name: string, binWidth: string): Market => ({
  id,
  name,
  binWidth,
  href: `/pool/${id}`,
  swapHref: `/swap/${id}`,
});

/** Pools the app can trade. Each one's live data comes from `usePool`. */
export const MARKETS: Market[] = [market("tweth-tusdc", "tWETH / tUSDC", "0.10%")];

export const DEFAULT_MARKET = MARKETS[0];

export const findMarket = (id: string) => MARKETS.find((entry) => entry.id === id);
