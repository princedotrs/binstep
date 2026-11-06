# BinStep web

The app for the live Base Sepolia pool: browse markets, see the bins, swap, create
Spot, Curve or Bid-Ask positions, and manage them.

The homepage lists the markets in `src/lib/markets.ts`. Each has a `/pool/<id>` and a
`/swap/<id>` page. Only tWETH / tUSDC is deployed, and `usePool` reads that one pool.
Volume, fees and APR come from the last 43,200 blocks of swap logs. `/api/stats` scans
them on the server and caches the totals, because the public RPC only serves 200 blocks
of logs per request. No wallet address is involved.

The chart's bars use the contract's real strategy weights. The parabola behind them,
the strategy icons and the homepage animation are decoration only.

```bash
npm install
npm run dev
npm test              # math, Anon-RPC route, form validation, airdrop rules
npm run test:live     # reads and simulates against Base Sepolia
```

Run `npm run sync-abi` after redeploying contracts.

## Private reads

Reads that name the user's wallet go through Anon-RPC, tried in this order: Nox, then
Nym. Only one worker runs at a time. If both fail, those reads stop and the user chooses
between trying again and a plain RPC. Nothing falls back on its own.

Market data names no wallet, so `/api/pool` and `/api/stats` read it on the server and it
loads whatever happens to the route. The workers need https or `localhost`. On plain http,
such as a LAN address, the route fails at once and the market still works.

The first read usually takes under a minute. These networks are young, so
connecting can sometimes take a few minutes.

Not covered by Anon-RPC:

- Transactions, and waiting for their receipts, use the wallet's RPC.
- One read of each worker's specifier contract uses a public RPC at startup.
- The airdrop sends the wallet address to this app's server.

## Airdrop

A new wallet gets 10 tWETH, 25,000 tUSDC and 0.0003 test ETH when it first connects.
The header button sends more, until a wallet holds ten airdrops of both tokens.

`/api/airdrop` signs with `AIRDROP_PRIVATE_KEY`, in `.env.local`. Use a dedicated
wallet holding only test ETH. It needs no rights on any contract, because the test
tokens can be minted by anyone. See `.env.example`.

## Local devnet

`../scripts/devnet.sh up` runs everything on this machine: a fork of Base Sepolia, fresh
contracts, this app on port 3001, and the automation workflow every 30 seconds. The top of
that script lists the commands that earn fees, move the price and fast-forward time.

The mixnet cannot reach `localhost`, so devnet reads use the local RPC directly.

## Deploying to Vercel

Set the project's root directory to `web`, and set `AIRDROP_PRIVATE_KEY`.
