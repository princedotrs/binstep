# BinStep Contracts Design

## Intent
Bring Meteora-style DLMM liquidity to Uniswap v4 on Base: LPs choose a price
range and a strategy shape, and a Chainlink CRE workflow keeps positions
compounded and in range.

## Goals
- Discrete bins, each exactly one `tickSpacing` wide.
- Spot, Curve and BidAsk liquidity shapes.
- One-sided deposits.
- Volatility-based dynamic swap fee.
- Opt-in auto-compound and auto-rebalance driven by CRE reports.

## Non-goals
- Constant-sum pricing inside bins. Swaps use native v4 math.
- Swapping during a rebalance. Tokens the new range cannot use stay as idle
  balance on the position.
- Native ETH pools. ERC-20 pairs only.

## Contracts
- `BinStepHook`: requires a dynamic-fee pool, only lets the manager add
  liquidity, sets the fee from recent price movement. Never returns swap
  deltas and never blocks removals.
- `BinStepManager`: owns all v4 positions. Each user position uses its id as
  the v4 salt, so fees stay isolated per position.
- `BinStepAutomation`: CRE receiver. Authenticates the forwarder, rejects
  stale or replayed reports, and forwards actions to the manager.

## Shapes
With `d = |2i - (n - 1)|` for bin index `i` of `n`:
- Spot weight: `1`
- Curve weight: `n - d`
- BidAsk weight: `d + 1`

Bins above the active bin hold only token0, bins below hold only token1, and
the active bin holds both. Each side scales independently to its token budget.

## Automation trust model
A report is not trusted for policy. Onchain checks enforce:
- caller is the configured forwarder
- workflow owner matches, when configured
- report is newer than the last one, not in the future, and not stale
- the position opted in to that action
- the live pool tick is within `maxTickDeviation` of the report's reference
- the new range stays within one range-width of the reference bin

## Limits
- At most 32 bins per position.
- Base fee 0.05%, plus 0.01% per bin of recent movement, capped at 1%.
- Volatility counts bin boundaries crossed and halves every 60 seconds.
- `onReport` needs 3M gas available per action, and reverts below that so a
  report is never consumed by a silent out-of-gas skip. A 32-bin rebalance
  measures about 2.13M gas.
