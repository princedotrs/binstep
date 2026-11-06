#!/usr/bin/env bash
# Runs the whole position lifecycle against a local Anvil node on port 8545.
# Start the node first with: anvil
set -euo pipefail
cd "$(dirname "$0")/.."

RPC=${RPC:-http://127.0.0.1:8545}
KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
ME=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
MIN_LIMIT=4295128740
MAX_LIMIT=1461446703485210103287273052203988822378723970341

forge script script/DeployLocal.s.sol:DeployLocal --rpc-url "$RPC" --broadcast --skip-simulation -q >/dev/null

json() { python3 -c "import json;print(json.load(open('deployments/local.json'))['$1'])"; }
MANAGER=$(json manager); AUTOMATION=$(json automation); HOOK=$(json hook)
ROUTER=$(json swapRouter); TOKEN0=$(json token0); TOKEN1=$(json token1); POOL=$(json poolId)
KEYT="($TOKEN0,$TOKEN1,8388608,10,$HOOK)"

send() { cast send -q --rpc-url "$RPC" --private-key "$KEY" "$@"; }
call() { cast call --rpc-url "$RPC" "$@"; }
pass() { echo "PASS  $1"; }
die() { echo "FAIL  $1"; exit 1; }

swap() { # zeroForOne amount
  local limit=$MIN_LIMIT; [ "$1" = true ] || limit=$MAX_LIMIT
  send "$ROUTER" 'swap((address,address,uint24,int24,address),(bool,int256,uint160),(bool,bool),bytes)' \
    "$KEYT" "($1,-$2,$limit)" "(false,false)" 0x
}
tick() { call "$HOOK" 'poolStates(bytes32)(int24,int24,int24,int24,uint40,uint32,uint32)' "$POOL" | head -1 | awk '{print $1}'; }
stable() { call "$HOOK" 'stableTick(bytes32)(int24)' "$POOL" | awk '{print $1}'; }
successor() { call "$MANAGER" 'successorLowerBin(uint256)(int24)' "$1" | awk '{print $1}'; }
wait_seconds() { cast rpc --rpc-url "$RPC" evm_increaseTime "$1" >/dev/null; cast rpc --rpc-url "$RPC" evm_mine >/dev/null; }
fee() { call "$HOOK" 'currentFee(bytes32)(uint24)' "$POOL" | awk '{print $1}'; }
lower_bin() {
  call "$MANAGER" 'getPosition(uint256)((address,(address,address,uint24,int24,address),int24,uint8,uint8,bool,bool,uint256,uint256))' "$1" |
    python3 -c "import re,sys;s=sys.stdin.read();print(re.sub(r'\[[^\]]*\]','',s).replace('(','').replace(')','').split(',')[6].strip())"
}
bin_sum() {
  call "$MANAGER" 'getBinLiquidity(uint256)(uint128[])' "$1" |
    python3 -c "import re,sys;s=re.sub(r'\[[0-9.e]+\]','',sys.stdin.read());print(sum(int(x) for x in re.findall(r'\d+',s)))"
}
report() { # actions
  wait_seconds 5
  local now payload metadata
  now=$(cast block latest --rpc-url "$RPC" --field timestamp)
  payload=$(cast abi-encode 'f(uint64,(uint8,uint256)[])' "$now" "$1")
  metadata=$(cast concat-hex 0x$(printf '%064x' 1) 0x$(printf '%020x' 0) "$ME")
  cast send --json --rpc-url "$RPC" --private-key "$KEY" "$AUTOMATION" 'onReport(bytes,bytes)' "$metadata" "$payload"
}
count_topic() { # receipt-json event-signature
  local topic; topic=$(cast keccak "$2")
  python3 -c "import json,sys;print(sum(1 for l in json.loads(sys.argv[1])['logs'] if l['topics'][0]==sys.argv[2]))" "$1" "$topic"
}

EXECUTED='ActionExecuted(uint256,uint8)'
SKIPPED='ActionSkipped(uint256,bytes)'

base=$(fee)
[ "$base" = 500 ] && pass "pool starts at the base fee" || die "base fee was $base"

for _ in 1 2 3 4 5; do swap true 200000000000000000000; swap false 200000000000000000000; done
swap true 300000000000000000000
[ "$(fee)" -gt "$base" ] && pass "fee rose to $(fee) after swaps" || die "fee did not rise"
swap false 300000000000000000000
wait_seconds 300

before=$(bin_sum 1)
receipt=$(report "[(0,1)]")
[ "$(count_topic "$receipt" "$EXECUTED")" = 1 ] || die "compound report did not execute"
after=$(bin_sum 1)
python3 -c "import sys;sys.exit(0 if $after > $before else 1)" && pass "CRE report compounded fees into liquidity" || die "liquidity did not grow"

swap true 3500000000000000000000
now_tick=$(tick)
[ "$now_tick" -lt -80 ] || die "price stayed in range at tick $now_tick"
receipt=$(report "[(1,1)]")
[ "$(count_topic "$receipt" "$SKIPPED")" = 1 ] || die "unstable price was not skipped"
[ "$(lower_bin 1)" = -8 ] && pass "report during a price spike was skipped (live $now_tick, stable $(stable))" || die "spike moved the position"

wait_seconds 300
expected=$(successor 1)
receipt=$(report "[(1,1)]")
[ "$(count_topic "$receipt" "$EXECUTED")" = 1 ] || die "rebalance report did not execute"
[ "$(lower_bin 1)" = "$expected" ] && pass "report rebalanced to the contract's own bin $expected at tick $now_tick" || die "position did not move"

receipt=$(report "[(1,1)]")
[ "$(count_topic "$receipt" "$SKIPPED")" = 1 ] && pass "immediate second rebalance was blocked" || die "cooldown did not hold"

b0=$(call "$TOKEN0" 'balanceOf(address)(uint256)' "$ME" | awk '{print $1}')
b1=$(call "$TOKEN1" 'balanceOf(address)(uint256)' "$ME" | awk '{print $1}')
send "$MANAGER" 'close(uint256)' 1
a0=$(call "$TOKEN0" 'balanceOf(address)(uint256)' "$ME" | awk '{print $1}')
a1=$(call "$TOKEN1" 'balanceOf(address)(uint256)' "$ME" | awk '{print $1}')
python3 -c "import sys;sys.exit(0 if $a0+$a1 > $b0+$b1 else 1)" && pass "close returned tokens to the owner" || die "close returned nothing"
echo "All local checks passed."
