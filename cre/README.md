# BinStep automation

A Chainlink CRE workflow that keeps opted-in BinStep positions compounded and
near the price.

Each run it:

1. Fetches a live price for each market in the config that has a `priceApiUrl`.
2. Reads the pools users created from `BinStepRegistry`.
3. Reads every position through `automationSnapshot`, a page at a time.
4. Runs `automation/decide.ts`, which picks the actions worth paying gas for. It
   refuses to act on a pool more than 3% from its price feed. Only tWETH has a feed,
   so other pools rely on the contracts' stable price check and cooldown.
5. Sends a report naming those positions to `BinStepAutomation`. A report holds two
   actions at most, across all pools.

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

## Live on Base Sepolia

Addresses are in `contracts/deployments/base-sepolia.json`. Keep the wallet key
in `cre/base-sepolia.env`, which is gitignored, and pass it with `-e`.

```bash
cre workflow simulate automation --target base-sepolia -e base-sepolia.env \
  --non-interactive --trigger-index 0            # dry run, sends nothing
# add --broadcast to send the report through MockKeystoneForwarder

./scripts/move-price.sh 2200                     # swap the test pool to a USD price
```

The workflow is not deployed to the CRE network yet, because this account's deploy access
is not enabled. Until it is, nothing acts on positions unless this timer is running:

```bash
./scripts/run-automation.sh        # broadcasts every 5 minutes while this machine is on
```

`../scripts/demo-bot.sh` also runs the workflow on this timer. Use one or the other, so two
processes never send from the same wallet.

The test pool only moves when someone swaps, so `move-price.sh` stands in for
arbitrage. Stay within 3% of the live price, or the workflow refuses to act.

First real run: compounded positions 1 and 2 in
[`0xa7b3ebc3...1188e1df`](https://sepolia.basescan.org/tx/0xa7b3ebc3baa7004203bca4db6bf2edf2d1b2a6a93ad772e175ed5acb1188e1df).

First live rebalance: moved positions 1 and 2 after the price left their range in
[`0x911247f0...1607366a`](https://sepolia.basescan.org/tx/0x911247f02224e0d093b87a15d33ae3334689f303f93bc2980b3e35a61607366a).
