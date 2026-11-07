# BinStep web

The app for the live Base Sepolia pool: browse markets, see the bins, swap, create
Spot, Curve or Bid-Ask positions, and manage them.

The homepage lists the markets in `src/lib/markets.ts` that appear in the deployment file.
Each has a `/pool/<id>` and a `/swap/<id>` page. `../scripts/deploy-markets.sh` adds the test
markets in `contracts/script/DeployMarkets.s.sol`, which share the hook and manager.

`/create` lets anyone create a test token and its tUSDC pool through `BinStepRegistry`, which
`../scripts/deploy-registry.sh` deploys. These appear under Community as unverified, with the
token address as the id.

Every pool can use auto-compound and auto-rebalance. `scripts/keeper.ts` is the job that acts on
them. Each run it reads every position, picks the actions worth paying gas for with
`scripts/decide.ts`, and sends at most two to `BinStepAutomation`. It refuses to act on tWETH if the
pool is more than 3% from the live ETH price. Other pools have no price feed, so they rely on the
contracts' stable price check and cooldown, which apply to every action.

The contracts accept reports only through their forwarder, so the keeper sends each one there. The
forwarder on Base Sepolia is a mock that checks no signatures, so anyone can send a report. That is
only safe here because a report just names positions that opted in. Replace it before using real funds.
Volume, fees and APR come from the last 24 hours of swap logs, which is 432,000 blocks at
Base Sepolia's 0.2 second block time. `/api/stats` scans them on the server and caches the totals.
No wallet address is involved.

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

A new wallet gets 10 tWETH and 25,000 tUSDC when it first connects. Each market's button
sends its token and tUSDC, until a wallet holds ten airdrops of both. An airdrop adds 0.0003
test ETH only when the wallet holds no ETH at all.

`/api/airdrop` signs with `AIRDROP_PRIVATE_KEY`, in `.env.local`. Use a dedicated
wallet holding only test ETH. It needs no rights on any contract, because the test
tokens can be minted by anyone. See `.env.example`.

## Local devnet

`../scripts/devnet.sh up` runs everything on this machine: a fork of Base Sepolia, fresh
contracts, this app on port 3001, and the automation workflow every 30 seconds. The top of
that script lists the commands that earn fees, move the price and fast-forward time.

The mixnet cannot reach `localhost`, so devnet reads use the local RPC directly.

## Demo bot

`../scripts/demo-bot.sh start` trades on every pool and runs the keeper every 5 minutes, so
positions earn fees, fall out of range and get compounded and rebalanced. It uses
`contracts/deployer.env`, and stops itself when that wallet runs low on ETH. It stops when
this machine sleeps. `../scripts/demo-bot.sh stop` ends it, and `logs` follows it.

On Railway it runs from `railway.json` and `scripts/bot.Dockerfile`, so it does not depend on this
machine. Set `DEPLOYER_KEY` on the Railway service. Run only one bot at a time, because both would
send from the same wallet.

## Deploying to Vercel

Set the project's root directory to `web`, and set `AIRDROP_PRIVATE_KEY`.
