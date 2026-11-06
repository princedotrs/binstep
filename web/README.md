# BinStep web

The app for the live Base Sepolia pool: browse markets, see the bins, swap, create
Spot, Curve or Bid-Ask positions, and manage them.

The homepage lists the markets in `src/lib/markets.ts`. Only tWETH / tUSDC is deployed.

```bash
npm install
npm run dev
npm test              # math, Anon-RPC route, form validation, airdrop rules
npm run test:live     # reads and simulates against Base Sepolia
```

Run `npm run sync-abi` after redeploying contracts.

## Private reads

Every app read goes through Anon-RPC, tried in this order: Nox, then Nym. Only one
worker runs at a time. If both fail, reads stop and the user chooses between trying
again and a plain RPC. Nothing falls back on its own.

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

## Deploying to Vercel

Set the project's root directory to `web`, and set `AIRDROP_PRIVATE_KEY`.
