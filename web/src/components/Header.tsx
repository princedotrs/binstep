"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAccount, useConnect, useDisconnect, useSwitchChain, type Connector } from "wagmi";
import { CHAIN_ID, DEVNET, USDC_DECIMALS } from "@/lib/addresses";
import { shortAddress, token } from "@/lib/format";
import { useWalletBalances } from "@/lib/hooks";
import { FirstAirdrop, useAirdrop } from "./Airdrop";
import { PrivacyBadge, PrivacyBanner } from "./Privacy";

const button = "rounded-lg border border-line bg-raised px-3 py-1.5 text-sm hover:border-muted pointer-coarse:min-h-11";

/** Wallets the browser announced. The generic connector is only for browsers announcing none. */
function listWallets(connectors: readonly Connector[]) {
  const announced = connectors.filter((connector) => connector.id !== "injected");
  const generic = typeof window !== "undefined" && "ethereum" in window ? connectors : [];
  const wallets = announced.length ? announced : generic;
  return wallets.filter((wallet, index) => wallets.findIndex(({ id }) => id === wallet.id) === index);
}

function WalletMenu({ address }: { address: `0x${string}` }) {
  const { disconnect } = useDisconnect();
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  const { drop, busy, note } = useAirdrop(null);
  const { data: balances, isError } = useWalletBalances(address, open);
  const balance = (value: bigint | undefined, decimals: number, places?: number) =>
    value === undefined ? (isError ? "Unavailable" : "…") : token(value, decimals, places);

  useEffect(() => {
    if (!open) return;
    const clickOutside = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", clickOutside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", clickOutside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <div ref={menu} className="relative">
      <button className={`${button} font-mono`} aria-expanded={open} aria-haspopup="true" onClick={() => setOpen(!open)}>
        {shortAddress(address)}
      </button>
      {open && (
        <div className="absolute top-full right-0 z-40 mt-2 w-56 rounded-xl border border-line bg-panel p-3 shadow-[0_8px_30px_#0008]">
          <p className="text-xs text-muted">Balance on Base Sepolia</p>
          <dl className="mt-1.5 space-y-1 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted">ETH</dt>
              <dd className="font-mono">{balance(balances?.eth, 18)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">tUSDC</dt>
              <dd className="font-mono">{balance(balances?.usdc, USDC_DECIMALS, 2)}</dd>
            </div>
          </dl>
          <button
            className={`${button} mt-3 w-full disabled:text-muted`}
            disabled={busy}
            onClick={() => drop(address, "usdc")}
          >
            {busy ? "Sending…" : "Airdrop tUSDC"}
          </button>
          {note && !busy && <p aria-live="polite" className="mt-1.5 text-xs text-muted">{note}</p>}
          <button className={`${button} mt-2 w-full text-bad`} onClick={() => disconnect()}>
            Log out
          </button>
        </div>
      )}
    </div>
  );
}

const firstLine = (error: Error) => error.message.split("\n")[0];

function WalletPicker() {
  const { connect, connectors, isPending, error, reset } = useConnect();
  const [open, setOpen] = useState(false);
  const wallets = listWallets(connectors);
  const close = () => {
    setOpen(false);
    reset();
  };

  return (
    <div className="relative" onKeyDown={(event) => event.key === "Escape" && close()}>
      <button className={button} aria-expanded={open} onClick={() => setOpen(!open)}>
        Connect wallet
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={close} />
          <div className="absolute right-0 top-full z-20 mt-2 w-56 rounded-lg border border-line bg-panel p-1 shadow-lg">
            {!wallets.length && (
              <p className="px-2 py-1.5 text-xs leading-relaxed text-muted">
                No wallet found. On a phone, open this site in your wallet app&apos;s browser. On a computer, install a wallet extension.
              </p>
            )}
            {wallets.map((wallet) => (
              <button
                key={wallet.id}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-raised disabled:opacity-50 pointer-coarse:py-3"
                disabled={isPending}
                onClick={() => connect({ connector: wallet }, { onSuccess: close })}
              >
                {wallet.icon && <img src={wallet.icon} alt="" className="size-5 rounded" />}
                {wallet.id === "injected" ? "Browser wallet" : wallet.name}
              </button>
            ))}
            {error && <p className="px-2 py-1 text-xs text-bad">{firstLine(error)}</p>}
          </div>
        </>
      )}
    </div>
  );
}

function WalletButton() {
  const { address, chainId } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, error: switchError } = useSwitchChain();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) return <span className={button}>Connect wallet</span>;

  if (!address && DEVNET) {
    const dev = connectors.find((connector) => connector.type === "mock");
    const own = connectors.find((connector) => connector.type === "injected");
    return (
      <>
        {own && (
          <button className={button} disabled={isPending} onClick={() => connect({ connector: own })}>
            Use my wallet
          </button>
        )}
        {dev && (
          <button className={button} disabled={isPending} onClick={() => connect({ connector: dev })}>
            Connect dev wallet
          </button>
        )}
      </>
    );
  }
  if (!address) return <WalletPicker />;
  if (chainId !== CHAIN_ID) {
    return (
      <>
        {switchError && (
          <span className="max-w-64 truncate text-xs text-bad" title={switchError.message}>
            {firstLine(switchError)}
          </span>
        )}
        <button className={`${button} text-warn`} onClick={() => switchChain({ chainId: CHAIN_ID })}>
          Switch to Base Sepolia
        </button>
        <button className={button} onClick={() => disconnect()}>
          Disconnect
        </button>
      </>
    );
  }
  return <WalletMenu address={address} />;
}

/** Three bins stepping up, in the chart's colors. */
const BinMark = () => (
  <span className="flex h-4 items-end gap-0.5" aria-hidden>
    <i className="block h-2 w-1 bg-usdc" />
    <i className="block h-3 w-1 bg-now" />
    <i className="block h-4 w-1 bg-asset" />
  </span>
);

const NAV = [
  { href: "/", label: "Markets", match: (path: string) => path === "/" || path.startsWith("/pool") },
  { href: "/swap", label: "Swap", match: (path: string) => path.startsWith("/swap") },
  { href: "/create", label: "Create pool", match: (path: string) => path === "/create" },
  { href: "/positions", label: "Positions", match: (path: string) => path === "/positions" },
];

export function Header() {
  const path = usePathname();
  return (
    <>
      <header className="border-b border-line">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5 sm:py-0">
          <Link href="/" className="flex items-center gap-2 font-mono text-base font-semibold tracking-tight">
            <BinMark />
            binstep
          </Link>
          <nav className="hidden items-center gap-5 self-stretch sm:flex" aria-label="Main">
            {NAV.map(({ href, label, match }) => (
              <Link
                key={href}
                href={href}
                aria-current={match(path) ? "page" : undefined}
                className={`-mb-px border-b-2 py-4 text-sm ${match(path) ? "border-text text-text" : "border-transparent text-muted hover:text-text"}`}
              >
                {label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2 sm:py-2.5">
            <PrivacyBadge />
            <FirstAirdrop />
            <WalletButton />
          </div>
        </div>
      </header>
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-line bg-panel pb-[env(safe-area-inset-bottom)] sm:hidden"
      >
        {NAV.map(({ href, label, match }) => (
          <Link
            key={href}
            href={href}
            aria-current={match(path) ? "page" : undefined}
            className={`-mt-px border-t-2 py-3.5 text-center text-xs font-medium ${match(path) ? "border-text text-text" : "border-transparent text-muted"}`}
          >
            {label}
          </Link>
        ))}
      </nav>
      <PrivacyBanner />
    </>
  );
}
