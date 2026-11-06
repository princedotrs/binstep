import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import type { ReactNode } from "react";
import { Header } from "@/components/Header";
import { TxNotice } from "@/components/TxNotice";
import { DEVNET } from "@/lib/addresses";
import { Providers } from "./providers";
import "./globals.css";

const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-plex-sans" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex-mono" });

export const metadata: Metadata = {
  title: "BinStep",
  description: "Spot, Curve and Bid-Ask liquidity bins on Uniswap v4, with private reads.",
};

export const viewport: Viewport = {
  themeColor: "#0a0b18",
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <body className="min-h-dvh">
        <Providers>
          <Header />
          <TxNotice />
          <main className="mx-auto w-full max-w-7xl px-4 py-6">{children}</main>
          <footer className="mx-auto w-full max-w-7xl px-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] text-xs leading-relaxed text-muted sm:pb-8">
            {DEVNET ? (
              "Local devnet: a private fork of Base Sepolia on this machine. Reads go straight to it, with no mixnet."
            ) : (
              <>
                Market data comes from this app&apos;s server and names no wallet. Reads about your wallet go through an anonymizing
                network. Transactions use your wallet&apos;s
                RPC. One public RPC read loads the network client when the app starts. The test token airdrop sends your wallet
                address to this app&apos;s server. Base Sepolia test tokens only. Not audited.
              </>
            )}
          </footer>
        </Providers>
      </body>
    </html>
  );
}
