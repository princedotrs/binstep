# BinStep web app design

## Intent
Give an LP one page to see the pool's bins, create a Spot, Curve or Bid-Ask
position, watch it, and trade against it, on Base Sepolia. Every chain read goes
through Anon-RPC by default, so viewing a position does not tie an IP to a wallet.

## Goals
- A real user can get test tokens, swap, mint, manage and close from the browser.
- Reads use a real anonymizing network by default, and the UI shows which route
  is in use.
- Out-of-range positions explain themselves, including limit-order style re-entry.

## Non-goals
Indexer, backend, Railway, price history charts, multiple pools, mainnet, a
Uniswap app integration, native ETH.

## Anti-goals
- Silently falling back to a plain RPC. Failure stops reads until the user agrees.
- Showing a re-entered position as healthy when it earns nothing.

## Decisions
From the user: no backend, frontend on Vercel, Anon-RPC default reads.
My calls:
- Next.js app router, client-rendered pages, wagmi and viem, Tailwind. One route
  per screen: `/` pool, `/positions`.
- Injected wallet only. WalletConnect needs a project id and adds nothing to a demo.
- Nox first because it connects in 6s, Nym on failure. One worker runs at a time,
  because parallel workers failed in testing. tor-js is excluded: its demo gateway
  failed every run.
- Reads are batched through Multicall3 to keep anonymized traffic small.
- Polling every 15s once connected. Reads pause while the tab is hidden.
- A swap uses the deployed `PoolSwapTest` router, and a position uses `BinStepManager`.
- A mint or manage call takes a tick guard of +/-100 ticks around the price read.

## Exclusions from Anon-RPC, stated in the UI and submission
- Wallet transactions and wallet-side reads use the wallet's own RPC.
- One bootstrap read of the worker's specifier contract uses a public RPC.

## Screens
Pool: price, market fee, bin chart with the active bin marked, swap panel, faucet
button, create-position form with a shape preview.
Positions: the connected wallet's positions with range state, fees, idle balances
and automation toggles. Actions are compound, rebalance, close.

Range states:
- Earning: the active bin is inside the range.
- Waiting for price to return: out of range, and the next rebalance would not move it.
- Rebalance pending: out of range, and automation can still move it.

## Left to the builder
Exact layout and visual details, within the rule that bins are the page's centerpiece.
