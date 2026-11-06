import type { NextConfig } from "next";
import { DEFAULT_MARKET } from "./src/lib/markets";

const config: NextConfig = {
  reactStrictMode: true,
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Stops another site framing this one to trick a user into approving a transaction.
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
    ];
  },
  async redirects() {
    return [
      { source: "/pool", destination: DEFAULT_MARKET.href, permanent: false },
    ];
  },
};

export default config;
