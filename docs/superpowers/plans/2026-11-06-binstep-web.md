# BinStep Web Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** A browser app for the live Base Sepolia pool with Anon-RPC default reads.

**Architecture:** Pure math and transaction builders in `web/src/lib`, tested alone. A single anon transport feeds a viem public client for reads; wagmi handles only the wallet. Components read from one polling hook.

**Tech Stack:** Next.js 16, React 19, wagmi 3, viem 2, TanStack Query 5, Tailwind 4, `@anon-rpc/browser-harness` 0.4.0, Bun tests.

**Spec:** `docs/superpowers/specs/2026-11-06-binstep-web-design.md`

## Global Constraints
- Chain 84532. Addresses come from `contracts/deployments/base-sepolia.json`.
- Nox `0x35133267A8F7EC35046a83DCA0f4Ca8A6e1b7A9A` bootstraps from Ethereum Sepolia; Nym `0x3aCD9742C68F6d993066Ae25533e09b9e1f60eD0` from Ethereum mainnet.
- Tick spacing 10, tWETH 18 decimals, tUSDC 6, MAX_BINS 32, tick guard +/-100.
- No Claude attribution anywhere. Commits authored as `princedotrs`.

## Review Focus
1. Both workers fail: reads stop, the UI says so, and plain RPC needs a click.
2. Wallet on the wrong chain: writes are blocked with a switch prompt.
3. No wallet or no positions: pages still render useful read-only state.
4. Amount empty, zero, or above balance: submit is disabled with the reason shown.
5. Bid-Ask or Curve with one bin, and a range entirely on one side of the price: preview and amounts stay correct.

---

### Task 1: Scaffold, addresses, ABIs
**Files:** `web/package.json`, `web/next.config.ts`, `web/tsconfig.json`, `web/src/lib/addresses.ts`, `web/src/lib/abi.ts`, `web/scripts/sync-abi.py`
- [x] Generate `abi.ts` from `contracts/out` with `sync-abi.py`.
- [x] `addresses.ts` exports `deployment`, `poolKey`, and `TICK_SPACING`.
- [x] `bun x tsc --noEmit` passes. Commit.

### Task 2: Pool math
**Files:** `web/src/lib/math.ts`, `math.test.ts`
**Produces:** `tickToUsd(tick)`, `usdToTick(usd)`, `binOf(tick)`, `binToUsd(bin)`, `strategyWeights(strategy, n)`, `previewShape(strategy, lowerBin, n, activeBin)`, `rangeState(position)`.
- [x] Tests: weights match `StrategyLib` for n=1, 2, 5, 16 on all strategies; a price round trip within one tick; `binOf(-199223)` is -19923; range states match the spec.
- [x] Implement, run, commit.

### Task 3: Anon transport
**Files:** `web/src/lib/anon.ts`, `anon.test.ts`
**Produces:** `createAnonRoute({ makeWorker, onStatus })` returning `{ fetch, status, retry, usePlainRpc }`; statuses `connecting`, `private`, `failed`, `plain`.
- [x] Tests with a fake worker: Nox tried first; Nym after Nox fails; never two at once; `failed` after both and no plain request is sent; `plain` only after `usePlainRpc`.
- [x] Implement, run, commit.

### Task 4: Chain reads
**Files:** `web/src/lib/read.ts`, `read.live.test.ts`
**Produces:** `readPool(client, wallet?)` returning price, fee, positions, bins, balances, allowances in one multicall round.
- [x] Live test against `sepolia.base.org` decodes real data: 5 positions, pool price near the tick, liquidity per bin.
- [x] Implement, run, commit.

### Task 5: Transaction builders
**Files:** `web/src/lib/tx.ts`, `tx.live.test.ts`
**Produces:** `mintCall`, `swapCall`, `compoundCall`, `rebalanceCall`, `closeCall`, `automationCall`, `faucetCalls`, `approveCall`.
- [x] Live test simulates mint and swap from the deployer through `eth_call`, plus zero-amount and wrong-owner failures.
- [x] Implement, run, commit.

### Task 6: App
**Files:** `web/src/app/*`, `web/src/components/*`
- [x] Providers, privacy badge with consent dialog, wallet button with chain switch.
- [x] Pool page: stats, bin chart, swap, faucet, create position.
- [x] Positions page with range state copy and actions.
- [x] Commit each screen.

### Task 7: Verify
- [x] `bun test`, typecheck, `next build`.
- [x] Headless Chrome screenshots at desktop and phone width.
- [x] Real page load reads the pool through a mixnet. Record the result. Commit.
