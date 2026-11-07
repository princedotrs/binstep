# Uniswap developer feedback

## What we built

BinStep is a Uniswap v4 hook and position manager on Base Sepolia. It offers bin-based liquidity
with a volatility-based dynamic fee, plus optional auto-compound and auto-rebalance.

## What worked well

- **The `salt` in `ModifyLiquidityParams`.** One contract owns every position, so using the position
  id as the salt kept each position's fees separate without extra accounting.
- **`unlock` and flash accounting.** A compound or rebalance removes and re-adds many bins in one
  transaction, and only the final balance has to settle.
- **Dynamic fees from a hook.** Setting the fee in `beforeSwap` fit our volatility model directly.
- **The fee in the `Swap` event.** We could compute fees earned from logs alone, with no extra reads.
- **`HookMiner`.** It made it practical to find an address that encodes the hook's permissions.

## What was hard

- **Swapping on a hook pool from a frontend.** We ended up with a test-style router, using the
  `takeClaims` and `settleUsingBurn` settings. A clear recommended path for testing a custom hook
  pool from an app would have helped.
- **Hook address errors.** Our local devnet script still fails with `HookAddressNotValid`, and we have
  not confirmed why. That error doesn't say which part of the address or setup is wrong, so more
  detail would help.
- **Reading history.** The `PoolManager` emits `Swap` for every pool, and a public Base Sepolia RPC
  we used caps `eth_getLogs` at 200 blocks a request. With 0.2 second blocks, one day of stats is
  432,000 blocks, so we had to scan from a server.

## What we would like to see

- A short guide to the recommended swap path for custom hook pools on testnets.
- A hosted way to query swaps for a single hook's pools on testnets.
- An end-to-end example of a manager contract that owns many positions in one hook pool.
- Maybe ways to airdrop more because i had to use 2-3 account to airdrop eth sepolia and bridge it to base.
