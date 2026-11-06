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

Meteora publishes these shapes without formulas, so the weights are our call.
Bins above the active bin hold only token0, bins below hold only token1, and
the active bin holds both. Each side scales independently to its token budget.

## Fee model
Follows Meteora's published DLMM formulas. A bin is one `tickSpacing` wide, and
one tick is 1 bp of price, so `tickSpacing` plays the role of `binStep`.

    volatilityAccumulator = min(vr + |indexReference - activeBin| * 10_000, 350_000)
    variableFee (1e9)     = ceil(C * (accumulator * binStep)^2 / 1e11), C = 100_000
    fee                   = min(0.05% + variableFee, 1%)

With `t` the seconds since the last swap:
- `t < 30`: references are unchanged, so rapid swaps accumulate.
- `30 <= t < 600`: `indexReference` moves to the active bin and `vr` is half of
  the accumulator.
- `t >= 600`: `vr` resets to 0.

Meteora's docs do not define how `indexReference` updates, so that rule comes
from the Trader Joe Liquidity Book design. The constants are our calibration: a
1% move adds about 0.1%, and the 1% cap is reached near a 3.5% move. v4 fixes the
fee for a whole swap, so it cannot step up per bin inside one swap.

## Stable tick
v4 pools have no time-weighted price, so the hook keeps one:

    stable' = stable + (lastTick - stable) * min(t, 300) / 300

It uses the price held since the last swap, so a move made in the current block
has no effect. A price must hold for real time to shift it.

## Compounding
Collected fees and idle balances go back into the same bins, using each bin's
current liquidity as its weight. A Curve stays a Curve and empty bins stay empty.
Fees a position cannot place stay idle.

## Rebalancing
An out-of-range position holds one token, which can only sit on one side of the
price. A keeper rebalance therefore moves to the same width directly beside the
active bin, on the side that token can occupy:
- price above the range: `[activeBin - n, activeBin - 1]`, holding token1
- price below the range: `[activeBin + 1, activeBin + n]`, holding token0

This is a limit-order style re-entry. It earns nothing until the price returns,
and the interface must say so. A true re-centre needs a swap, which is out of
scope. The contract derives the range. Reports never supply it.

## Automation trust model
A report only names positions and actions. Onchain checks enforce:
- caller is the configured forwarder
- workflow owner matches, when configured
- report is newer than the last one, not in the future, and not stale
- the position opted in to that action
- live tick is within `maxTickDrift` of the hook's stable tick
- a rebalance needs an out-of-range position, a cooldown since the last one, and
  a successor different from the current range

`maxTickDrift` must stay well below the position width, or a spike passes as
stable. Drift also acts as an onchain dwell: after a real move, a rebalance waits
for the stable tick to catch up.

## CRE decision rules
The workflow decides whether an allowed action is worth doing. It compares the
pool with an external price and refuses to act when they disagree.
- Compound: `deployable * feeRate * horizon >= gas * multiple`. Use what can
  actually be deployed, not the fee balance.
- Rebalance: require the condition to hold across a dwell window, a minimum
  distance gain, and gas below a set fraction of position value.
- Fee share: `ourL / (activeL + ourL)`, since we dilute ourselves.

## Limits
- At most 32 bins per position.
- A 32-bin rebalance onto fresh ticks measures about 4.04M gas. `onReport` needs
  4.5M available per action and reverts below that, so a report is never used up
  by a silent out-of-gas skip. CRE allows 10M gas per transaction, so a report
  fits about two maximum-size rebalances.
