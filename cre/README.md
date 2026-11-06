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

The test pool only moves when someone swaps, so `move-price.sh` stands in for
arbitrage. Stay within 3% of the live price, or the workflow refuses to act.

First real run: compounded positions 1 and 2 in
[`0xa7b3ebc3...1188e1df`](https://sepolia.basescan.org/tx/0xa7b3ebc3baa7004203bca4db6bf2edf2d1b2a6a93ad772e175ed5acb1188e1df).

First live rebalance: moved positions 1 and 2 after the price left their range in
[`0x911247f0...1607366a`](https://sepolia.basescan.org/tx/0x911247f02224e0d093b87a15d33ae3334689f303f93bc2980b3e35a61607366a).
