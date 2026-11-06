#!/usr/bin/env bash
# Runs the CRE workflow against an Anvil fork of Base Sepolia, end to end.
# Start the fork first, from any directory:
#   anvil --fork-url https://sepolia.base.org --port 8545
# It uses Anvil's public test key, so it must never point at a real chain.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
CONTRACTS=$ROOT/../contracts
cd "$ROOT"

RPC=http://127.0.0.1:8545
KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
PRICE_API=https://api.coinbase.com/v2/prices/ETH-USD/spot
MIN_LIMIT=4295128740
MAX_LIMIT=1461446703485210103287273052203988822378723970341

[ "$(cast chain-id --rpc-url "$RPC")" = 84532 ] || { echo "start an Anvil fork of Base Sepolia first"; exit 1; }

ETH_USD=$(curl -fsS "$PRICE_API" | python3 -c "import json,sys;print(int(float(json.load(sys.stdin)['data']['amount'])))")
echo "Live ETH price: \$$ETH_USD"

(cd "$CONTRACTS" && DEPLOYMENT_FILE=./deployments/fork.json DEPLOYER_KEY=$KEY ETH_PRICE_USD=$ETH_USD forge script \
  script/DeployBaseSepolia.s.sol:DeployBaseSepolia --rpc-url "$RPC" --broadcast --skip-simulation -q >/dev/null)

json() { python3 -c "import json;print(json.load(open('$CONTRACTS/deployments/fork.json'))['$1'])"; }
MANAGER=$(json manager); AUTOMATION=$(json automation); HOOK=$(json hook); ROUTER=$(json swapRouter)
POOL=$(json poolId); WETH_IS_0=$(json wethIsToken0 | tr '[:upper:]' '[:lower:]')
KEYT="($(json token0),$(json token1),8388608,10,$HOOK)"

if [ "$WETH_IS_0" = true ]; then DEC0=18; DEC1=6; else DEC0=6; DEC1=18; fi
cat > automation/config.local-fork.json <<CONFIG
{
  "schedule": "*/30 * * * * *",
  "chainSelectorName": "ethereum-testnet-sepolia-base-1",
  "managerAddress": "$MANAGER",
  "automationAddress": "$AUTOMATION",
  "priceApiUrl": "$PRICE_API",
  "firstPositionId": 1,
  "pageSize": 3,
  "gasLimit": "9500000",
  "wethIsToken0": $WETH_IS_0,
  "token0Decimals": $DEC0,
  "token1Decimals": $DEC1,
  "maxPriceDeviationBps": 300,
  "minCompoundUsd": 1,
  "minDistanceBins": 2,
  "maxTickDrift": 50,
  "maxActions": 2
}
CONFIG

send() { cast send -q --rpc-url "$RPC" --private-key "$KEY" "$@"; }
call() { cast call --rpc-url "$RPC" "$@"; }
pass() { echo "PASS  $1"; }
die() { echo "FAIL  $1"; [ -n "${LAST_RUN:-}" ] && echo "$LAST_RUN" | tail -25; exit 1; }

tick() { call "$HOOK" 'poolStates(bytes32)(int24,int24,int24,int24,uint40,uint32,uint32)' "$POOL" | head -1 | awk '{print $1}'; }
wait_seconds() { cast rpc --rpc-url "$RPC" evm_increaseTime "$1" >/dev/null; cast rpc --rpc-url "$RPC" evm_mine >/dev/null; }
lower_bin() {
  call "$MANAGER" 'automationSnapshot(uint256,uint256)((uint256,address,bytes32,int24,uint8,bool,bool,bool,int24,int24,int24,uint256,uint256,uint256,uint256,uint256)[])' "$1" 1 |
    python3 -c "import re,sys;s=sys.stdin.read();print(re.sub(r'\[[0-9.e]+\]','',s).strip('[]() \n').split(',')[3].strip())"
}
liquidity() {
  call "$MANAGER" 'getBinLiquidity(uint256)(uint128[])' "$1" |
    python3 -c "import re,sys;s=re.sub(r'\[[0-9.e]+\]','',sys.stdin.read());print(sum(int(x) for x in re.findall(r'\d+',s)))"
}
swap_to_tick() { # target tick; a price limit stops the swap exactly there
  local target=$1 now zero limit
  now=$(tick); zero=true; [ "$target" -gt "$now" ] && zero=false
  limit=$(python3 -c "print(int(1.0001**($target/2)*2**96))")
  send "$ROUTER" 'swap((address,address,uint24,int24,address),(bool,int256,uint160),(bool,bool),bytes)' \
    "$KEYT" "($zero,-1000000000000000000000000,$limit)" "(false,false)" 0x
}
workflow() {
  LAST_RUN=$(cre workflow simulate automation --target local-fork --non-interactive --trigger-index 0 --broadcast 2>&1) || die "workflow run failed"
}
has() { echo "$LAST_RUN" | grep -q "$1"; }

START=$(tick)

workflow
has 'fees below threshold' && pass "new positions have nothing worth compounding" || die "expected no action"

for _ in 1 2 3 4 5 6; do swap_to_tick $((START - 30)); swap_to_tick $((START + 30)); done
swap_to_tick "$START"
wait_seconds 300
LIQUIDITY_BEFORE=$(liquidity 1)
workflow
has 'act #1: compound' || die "expected a compound"
LIQUIDITY_AFTER=$(liquidity 1)
python3 -c "import sys;sys.exit(0 if $LIQUIDITY_AFTER > $LIQUIDITY_BEFORE else 1)" &&
  pass "workflow compounded fees onchain using the live ETH price" || die "liquidity did not grow onchain"

# About 1.4% down: past the +/-0.8% range, inside the 3% market tolerance.
BEFORE=$(lower_bin 1)
swap_to_tick $((START - 140))
workflow
has 'price still settling' && pass "workflow waited while the price settled" || die "expected it to wait"

wait_seconds 300
workflow
has 'act #1: rebalance' || die "expected a rebalance"
AFTER=$(lower_bin 1)
[ "$AFTER" != "$BEFORE" ] && pass "workflow rebalanced position 1 from bin $BEFORE to $AFTER" || die "position did not move onchain"

# About 6% off: the pool no longer matches the real market.
swap_to_tick $((START - 600))
wait_seconds 300
workflow
has 'pool disagrees with market' && pass "workflow refused to act on a pool 6% off the market" || die "market check did not trigger"

echo "All fork checks passed."
