import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Header } from "@/components/Header";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "BinStep",
  description: "Spot, Curve and Bid-Ask liquidity bins on Uniswap v4, with private reads.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">
        <Providers>
          <Header />
          <main className="mx-auto w-full max-w-6xl px-4 py-6">{children}</main>
          <footer className="mx-auto w-full max-w-6xl px-4 pb-8 text-xs leading-relaxed text-muted">
            App reads go through an anonymizing network. Transactions and your wallet&apos;s own reads use your wallet&apos;s
            RPC. One public RPC read loads the network client when the app starts. The test token airdrop sends your wallet
            address to this app&apos;s server. Base Sepolia test tokens only. Not audited.
          </footer>
        </Providers>
      </body>
    </html>
  );
}
