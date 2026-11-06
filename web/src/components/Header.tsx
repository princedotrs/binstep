"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { erc20Abi } from "viem";
import { useAccount, useBalance, useConnect, useDisconnect, useReadContract, useSwitchChain, type Connector } from "wagmi";
import { CHAIN_ID, DEVNET, USDC_DECIMALS, addresses } from "@/lib/addresses";
import { shortAddress, token } from "@/lib/format";
import { FirstAirdrop, useAirdrop } from "./Airdrop";
import { PrivacyBadge, PrivacyBanner } from "./Privacy";

const button = "rounded-lg border border-line bg-raised px-3 py-1.5 text-sm hover:border-muted";

/** Wallets the browser announced. The generic connector is only for browsers announcing none. */
function listWallets(connectors: readonly Connector[]) {
  const announced = connectors.filter((connector) => connector.id !== "injected");
  const wallets = announced.length ? announced : connectors;
  return wallets.filter((wallet, index) => wallets.findIndex(({ id }) => id === wallet.id) === index);
}

const BALANCE_POLL_MS = 15_000;

/** Balances come from the wallet's own RPC, so this tells no one new about the address. */
function WalletMenu({ address }: { address: `0x${string}` }) {
  const { disconnect } = useDisconnect();
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  const { drop, busy, note } = useAirdrop(null);
  const query = { enabled: open, refetchInterval: BALANCE_POLL_MS };
  const eth = useBalance({ address, chainId: CHAIN_ID, query });
  const usdc = useReadContract({
    address: addresses.usdc,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address],
    chainId: CHAIN_ID,
    query,
  });
  const balance = (value: string | null, failed: boolean) => value ?? (failed ? "Unavailable" : "…");

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
              <dd className="font-mono">{balance(eth.data ? token(eth.data.value, 18) : null, eth.isError)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">tUSDC</dt>
              <dd className="font-mono">
                {balance(usdc.data === undefined ? null : token(usdc.data, USDC_DECIMALS, 2), usdc.isError)}
              </dd>
            </div>
          </dl>
          <button
            className={`${button} mt-3 w-full disabled:text-muted`}
            disabled={busy}
            onClick={() => drop(address, "usdc").then(() => usdc.refetch())}
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
      <button className={button} disabled={!wallets.length} aria-expanded={open} onClick={() => setOpen(!open)}>
        {wallets.length ? "Connect wallet" : "No wallet found"}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={close} />
          <div className="absolute right-0 top-full z-20 mt-2 w-56 rounded-lg border border-line bg-panel p-1 shadow-lg">
            {wallets.map((wallet) => (
              <button
                key={wallet.id}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-raised disabled:opacity-50"
                disabled={isPending}
                onClick={() => connect({ connector: wallet }, { onSuccess: close })}
              >
                {wallet.icon && <img src={wallet.icon} alt="" className="size-5 rounded" />}
                {wallet.name}
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
            {link("/", "Markets", path === "/" || path.startsWith("/pool"))}
            {link("/swap", "Swap", path.startsWith("/swap"))}
            {link("/create", "Create pool")}
            {link("/positions", "Positions")}
          </nav>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            <PrivacyBadge />
            <FirstAirdrop />
            <WalletButton />
          </div>
        </div>
      </header>
      <PrivacyBanner />
    </>
  );
}
