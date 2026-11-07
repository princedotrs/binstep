# BinStep

Bin-based liquidity on Uniswap v4. You place capital across 0.10% wide bins as Spot, Curve or
Bid-Ask, and an optional keeper compounds your fees and moves a range that drifts out. Wallet reads
go through Anon-RPC, so an RPC provider cannot link your address to your IP.

- **Live app:** https://binstep.vercel.app
- **Network:** Base Sepolia. All tokens are test tokens, and the contracts are not audited.

## Where Uniswap v4 is used

BinStep is a v4 hook plus a position manager. All swaps and liquidity live in the v4 `PoolManager`.

| What | Where |
| --- | --- |
| Hook permissions | [`BinStepHook.sol#L66`](contracts/src/BinStepHook.sol#L66) |
| Only the manager can add liquidity | [`BinStepHook.sol#L122`](contracts/src/BinStepHook.sol#L122) |
| Dynamic fee set before each swap | [`BinStepHook.sol#L132`](contracts/src/BinStepHook.sol#L132) |
| Volatility tracked after each swap | [`BinStepHook.sol#L142`](contracts/src/BinStepHook.sol#L142) |
| Fee formula | [`BinStepHook.sol#L188`](contracts/src/BinStepHook.sol#L188) |
| Stable price used by the keeper checks | [`BinStepHook.sol#L196`](contracts/src/BinStepHook.sol#L196) |
| Opening a position | [`BinStepManager.sol#L222`](contracts/src/BinStepManager.sol#L222) |
| `unlock` callback for every liquidity change | [`BinStepManager.sol#L324`](contracts/src/BinStepManager.sol#L324) |
| One `modifyLiquidity` per bin, with the position id as the salt | [`BinStepManager.sol#L437`](contracts/src/BinStepManager.sol#L437) |
| Bin amounts from strategy weights | [`BinDistribution.sol`](contracts/src/libraries/BinDistribution.sol), [`Strategy.sol`](contracts/src/libraries/Strategy.sol) |
| Pool creation from the app | [`BinStepRegistry.sol#L73`](contracts/src/BinStepRegistry.sol#L73) |
| Swap call from the app | [`web/src/lib/tx.ts`](web/src/lib/tx.ts) |

The app's swaps use a test-style router, which is fine for a testnet demo but would need replacing
before real funds.

## Automation

Each position can opt in to auto-compound and auto-rebalance.

- [`web/scripts/keeper.ts`](web/scripts/keeper.ts) reads every position and sends at most two actions a run.
- [`web/scripts/decide.ts`](web/scripts/decide.ts) picks the actions worth doing.
- [`BinStepAutomation.sol#L78`](contracts/src/BinStepAutomation.sol#L78) receives the report and runs each action.
- [`keeperCompound`](contracts/src/BinStepManager.sol#L272) and [`keeperRebalance`](contracts/src/BinStepManager.sol#L282) refuse to act unless the price is stable, and rebalances have a cooldown.

A rebalance moves the range directly beside the price ([`successorLowerBin`](contracts/src/BinStepManager.sol#L304)) without
swapping. It works like a limit order: the position holds one token and earns nothing until the
price comes back.

[`web/scripts/volume-bot.ts`](web/scripts/volume-bot.ts) makes demo trades so that this activity is
visible. The bot and keeper run on Railway, using [`scripts/bot.Dockerfile`](scripts/bot.Dockerfile).

The contract accepts reports only from its forwarder. On Base Sepolia that is a mock that checks no
signatures, so anyone can send a report. A report can only name positions that opted in, and the
contract checks still apply, but this must be replaced before real funds.

## Where Anon-RPC is used

| Traffic | Route | Why |
| --- | --- | --- |
| Reads about your wallet, such as balances | Anon-RPC | They name your address |
| Wallet menu balances | Anon-RPC | They name your address |
| Market data, positions and stats | This app's server | Public data, and no wallet is sent. The browser filters positions itself |
| Transactions | Your wallet's RPC | Your wallet sends these, and the app cannot reroute them |
| Test token airdrop | This app's server | It has to know where to send tokens |
| Start-up | One public RPC read | It loads the network client |

The route is set up in [`web/src/lib/route.ts`](web/src/lib/route.ts) and
[`web/src/lib/anon.ts`](web/src/lib/anon.ts). It tries Nox, then Nym. It never falls back to plain RPC
on its own: that takes an explicit choice by the user.

## Deployed contracts (Base Sepolia)

| Contract | Address |
| --- | --- |
| Uniswap v4 `PoolManager` | [`0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408`](https://sepolia.basescan.org/address/0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408) |
| `BinStepHook` | [`0x6ad11d9ff25761C5Aa4Bd14FeD0bbA04c170F8c0`](https://sepolia.basescan.org/address/0x6ad11d9ff25761C5Aa4Bd14FeD0bbA04c170F8c0) |
| `BinStepManager` | [`0xF5853e9da895496Da25975C94f02F0DfcBe18aeC`](https://sepolia.basescan.org/address/0xF5853e9da895496Da25975C94f02F0DfcBe18aeC) |
| `BinStepAutomation` | [`0x7963d38592C079d5917433e84a57a4fF4f91AAE6`](https://sepolia.basescan.org/address/0x7963d38592C079d5917433e84a57a4fF4f91AAE6) |
| `BinStepRegistry` | [`0xFD7401Fd8090c97450FD903dB66fEf2C333B7256`](https://sepolia.basescan.org/address/0xFD7401Fd8090c97450FD903dB66fEf2C333B7256) |

## Run it

```bash
# App
cd web
npm install
npm run dev

# Web tests, which need bun
bun test

# Contract tests, which need Foundry
cd ../contracts
forge test
```

See [`web/README.md`](web/README.md) for more on the app.

## Known limits

- Not audited, and for test tokens only.
- Liquidity placed just before a large swap (JIT) is not blocked.
- The stats shown as 24h currently cover about 2.4 hours of swaps.
- On a phone, a wallet connects only from inside a wallet app's browser.
