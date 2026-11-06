# BinStep web

The app for the live Base Sepolia pool: see the bins, swap, create Spot, Curve or
Bid-Ask positions, and manage them.

```bash
npm install
npm run dev
npm test              # math, Anon-RPC route, form validation
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

## Deploying to Vercel

Set the project's root directory to `web`. No environment variables are needed.
