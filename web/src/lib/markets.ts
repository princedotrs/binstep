export type Market = {
  id: string;
  name: string;
  href: string;
  swapHref: string;
  binWidth: string;
};

/** Pools the app can trade. Each one's live data comes from `usePool`. */
export const MARKETS: Market[] = [{ id: "tweth-tusdc", name: "tWETH / tUSDC", href: "/pool", swapHref: "/swap", binWidth: "0.10%" }];
