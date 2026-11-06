import type { NextConfig } from "next";
import { DEFAULT_MARKET } from "./src/lib/markets";

const config: NextConfig = {
  reactStrictMode: true,
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  async redirects() {
    return [
      { source: "/pool", destination: DEFAULT_MARKET.href, permanent: false },
    ];
  },
};

export default config;
