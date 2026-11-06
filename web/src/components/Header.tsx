"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { CHAIN_ID } from "@/lib/addresses";
import { shortAddress } from "@/lib/format";
import { AirdropButton } from "./Airdrop";
import { PrivacyBadge, PrivacyBanner } from "./Privacy";

function WalletButton() {
  const { address, chainId } = useAccount();
  const { connect, connectors, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const button = "rounded-lg border border-line bg-raised px-3 py-1.5 text-sm hover:border-muted";
  if (!mounted) return <span className={button}>Connect wallet</span>;

  if (!address) {
    const wallet = connectors[0];
    return (
      <button
        className={button}
        disabled={!wallet || isPending}
        onClick={() => wallet && connect({ connector: wallet })}
        title={error?.message}
      >
        {isPending ? "Connecting…" : "Connect wallet"}
      </button>
    );
  }
  if (chainId !== CHAIN_ID) {
    return (
      <button className={`${button} text-warn`} onClick={() => switchChain({ chainId: CHAIN_ID })}>
        Switch to Base Sepolia
      </button>
    );
  }
  return (
    <button className={`${button} font-mono`} onClick={() => disconnect()} title="Disconnect">
      {shortAddress(address)}
    </button>
  );
}

export function Header() {
  const path = usePathname();
  const link = (href: string, label: string, active = path === href) => (
    <Link href={href} className={`text-sm ${active ? "text-text" : "text-muted hover:text-text"}`}>
      {label}
    </Link>
  );
  return (
    <>
      <header className="border-b border-line">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3">
          <Link href="/" className="font-mono text-base font-semibold tracking-tight">
            bin<span className="brand-text">step</span>
          </Link>
          <nav className="flex items-center gap-4">
            {link("/", "Markets", path === "/" || path === "/pool")}
            {link("/positions", "Positions")}
          </nav>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            <PrivacyBadge />
            <AirdropButton />
            <WalletButton />
          </div>
        </div>
      </header>
      <PrivacyBanner />
    </>
  );
}
