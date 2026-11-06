# BinStep automation

A Chainlink CRE workflow that keeps opted-in BinStep positions compounded and
near the price.

Each run it:

1. Fetches the live ETH price from a public API.
2. Reads every position in one call to `automationSnapshot`.
3. Runs `automation/decide.ts`, which refuses to act if the pool is more than 3%
   from the market, and otherwise picks the actions worth paying gas for.
4. Sends a report naming those positions to `BinStepAutomation`.

The report only says which positions to act on. The contracts work out the new
range and enforce the stability checks and cooldown themselves.

## Run it

```bash
cd automation && bun install && bunx cre-setup && bun test && cd ..
anvil --fork-url https://sepolia.base.org --port 8545   # in another terminal
cre login
./scripts/fork-e2e.sh
```

The script deploys a test WETH/USDC pool at the live ETH price, then runs the
workflow through compounding, waiting, rebalancing and refusing a mispriced pool.
`cre/.env` must hold Anvil's public test key for this. Never use a real key with
the `local-fork` target.
