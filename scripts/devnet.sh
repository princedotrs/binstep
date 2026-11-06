#!/usr/bin/env bash
# Runs the whole stack on this machine, on a private fork of Base Sepolia.
#
#   ./scripts/devnet.sh up            start chain, contracts, app (port 3001), automation
#   ./scripts/devnet.sh down          stop everything
#   ./scripts/devnet.sh status        show what is running and the pool's tick
#   ./scripts/devnet.sh fees [n]      swap back and forth n times (default 6) to earn fees
#   ./scripts/devnet.sh price <usd>   swap the pool to a USD price
#   ./scripts/devnet.sh warp [secs]   fast-forward chain time (default 300)
#   ./scripts/devnet.sh logs          follow the automation output
#
# Keys here are Anvil's published test keys. Never point this at a real chain.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
RUN=$ROOT/.devnet
RPC=http://127.0.0.1:8545
PORT=3001
UPSTREAMS=(https://sepolia.base.org https://base-sepolia-rpc.publicnode.com)
PRICE_API=https://api.coinbase.com/v2/prices/ETH-USD/spot
DEPLOYER_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
AIRDROP_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
DEPLOYMENT=$ROOT/contracts/deployments/devnet.json
export PATH="$HOME/.foundry/bin:$HOME/.bun/bin:$HOME/.cre/bin:$PATH"

json() { python3 -c "import json;print(json.load(open('$DEPLOYMENT'))['$1'])"; }
send() { cast send -q --rpc-url "$RPC" --private-key "$DEPLOYER_KEY" "$@"; }
background() { # name, then the command; it outlives this script
  local name=$1; shift
  perl -MPOSIX -e 'POSIX::setsid(); exec @ARGV or die $!' nohup "$@" >"$RUN/$name.log" 2>&1 </dev/null &
  echo $! >"$RUN/$name.pid"
}
running() { [ -f "$RUN/$1.pid" ] && kill -0 "$(cat "$RUN/$1.pid")" 2>/dev/null; }
stop() {
  if running "$1"; then kill -- "-$(cat "$RUN/$1.pid")" 2>/dev/null || true; fi
  rm -f "$RUN/$1.pid"
}
wait_for() { # description, then a test command
  local what=$1; shift
  for _ in $(seq 1 60); do "$@" >/dev/null 2>&1 && return 0; sleep 1; done
  echo "timed out waiting for $what"; exit 1
}

write_cre_config() {
  python3 - "$DEPLOYMENT" "$PRICE_API" "$ROOT/cre/automation/config.local-fork.json" <<'CONFIG'
import json, sys
path, price_api, out = sys.argv[1:]
data = json.load(open(path))
seeded = [{"poolId": data["poolId"], "baseIsToken0": data["wethIsToken0"], "baseDecimals": 18, "priceApiUrl": price_api}]
listed = [{"poolId": m["poolId"], "baseIsToken0": m["baseIsToken0"], "baseDecimals": m["decimals"]} for m in data["markets"]]
json.dump({
    "schedule": "*/30 * * * * *",
    "chainSelectorName": "ethereum-testnet-sepolia-base-1",
    "managerAddress": data["manager"],
    "automationAddress": data["automation"],
    "registryAddress": data["registry"],
    "markets": seeded + listed,
    "firstPositionId": 1,
    "pageSize": 25,
    "gasLimit": "9500000",
    "maxPriceDeviationBps": 300,
    "minCompoundUsd": 1,
    "minDistanceBins": 2,
    "maxTickDrift": 50,
    "maxActions": 2,
}, open(out, "w"), indent=2)
CONFIG
}

start_chain() { # Anvil exits if its first upstream call fails, and public RPCs do stall
  local upstream
  for attempt in 1 2 3; do
    for upstream in "${UPSTREAMS[@]}"; do
      echo "Starting the chain from $upstream"
      background anvil anvil --fork-url "$upstream" --port 8545 --silent --retries 10 --timeout 60000
      for _ in $(seq 1 30); do
        running anvil || break
        cast chain-id --rpc-url "$RPC" >/dev/null 2>&1 && return 0
        sleep 1
      done
      stop anvil
    done
  done
  echo "No upstream RPC answered. See $RUN/anvil.log"; exit 1
}

up() {
  down >/dev/null
  mkdir -p "$RUN"
  start_chain

  local eth_usd start deployment
  eth_usd=$(curl -fsS "$PRICE_API" | python3 -c "import json,sys;print(int(float(json.load(sys.stdin)['data']['amount'])))")
  start=$(cast block-number --rpc-url "$RPC")
  echo "Deploying contracts and seeding the pool at \$$eth_usd"
  (cd "$ROOT/contracts" && DEPLOYMENT_FILE=./deployments/devnet.json DEPLOYER_KEY=$DEPLOYER_KEY ETH_PRICE_USD=$eth_usd \
    forge script script/DeployBaseSepolia.s.sol:DeployBaseSepolia --rpc-url "$RPC" --broadcast --skip-simulation -q >/dev/null)
  echo "Adding the test markets"
  (cd "$ROOT/contracts" && DEPLOYMENT_FILE=./deployments/devnet.json MARKETS_FILE=./deployments/devnet.markets.json DEPLOYER_KEY=$DEPLOYER_KEY \
    forge script script/DeployMarkets.s.sol:DeployMarkets --rpc-url "$RPC" --broadcast --skip-simulation -q >/dev/null)
  (cd "$ROOT/contracts" && DEPLOYMENT_FILE=./deployments/devnet.json DEPLOYER_KEY=$DEPLOYER_KEY \
    forge script script/DeployRegistry.s.sol:DeployRegistry --rpc-url "$RPC" --broadcast --skip-simulation -q >/dev/null)
  python3 -c "
import json
data = json.load(open('$DEPLOYMENT'))
data['deployBlock'] = $start
data['markets'] = json.load(open('$ROOT/contracts/deployments/devnet.markets.json'))
json.dump(data, open('$DEPLOYMENT', 'w'))"
  write_cre_config

  echo "Building the app"
  deployment=$(cat "$DEPLOYMENT")
  (cd "$ROOT/web" && NEXT_TELEMETRY_DISABLED=1 NEXT_DIST_DIR=.next-devnet NEXT_PUBLIC_RPC_URL=$RPC \
    NEXT_PUBLIC_DEPLOYMENT=$deployment npx next build >"$RUN/build.log" 2>&1) || { tail -20 "$RUN/build.log"; exit 1; }
  (cd "$ROOT/web" && NEXT_DIST_DIR=.next-devnet NEXT_PUBLIC_RPC_URL=$RPC NEXT_PUBLIC_DEPLOYMENT=$deployment \
    AIRDROP_PRIVATE_KEY=$AIRDROP_KEY background web npx next start -p "$PORT")
  wait_for "the app" curl -fsS -o /dev/null "http://localhost:$PORT/"

  (cd "$ROOT/cre" && background automation ./scripts/run-automation.sh 30 local-fork)
  echo "Ready: http://localhost:$PORT"
}

down() {
  stop automation; stop web; stop anvil
  echo "Stopped"
}

tick() {
  cast call --rpc-url "$RPC" "$(json hook)" 'poolStates(bytes32)(int24,int24,int24,int24,uint40,uint32,uint32)' "$(json poolId)" |
    head -1 | awk '{print $1}'
}

swap_to_tick() { # a price limit stops the swap exactly at the target tick
  local target=$1 now zero limit key
  now=$(tick)
  [ "$target" = "$now" ] && return 0
  zero=true; [ "$target" -gt "$now" ] && zero=false
  limit=$(python3 -c "print(int(1.0001**($target/2)*2**96))")
  key="($(json token0),$(json token1),8388608,10,$(json hook))"
  send "$(json swapRouter)" 'swap((address,address,uint24,int24,address),(bool,int256,uint160),(bool,bool),bytes)' \
    "$key" "($zero,-1000000000000000000000000,$limit)" "(false,false)" 0x
}

fees() {
  local rounds=$1 start
  start=$(tick)
  for _ in $(seq 1 "$rounds"); do swap_to_tick $((start - 30)); swap_to_tick $((start + 30)); done
  swap_to_tick "$start"
  echo "Swapped $rounds rounds. Run 'warp' so the automation sees a settled price."
}

price() {
  swap_to_tick "$(python3 -c "
import math
usd, weth_first = $1, '$(json wethIsToken0)' == 'True'
raw = usd / 1e12 if weth_first else 1e12 / usd
print(round(math.log(raw) / math.log(1.0001)))")"
  echo "Pool at tick $(tick). Run 'warp' so the automation sees a settled price."
}

warp() {
  cast rpc --rpc-url "$RPC" evm_increaseTime "$1" >/dev/null
  cast rpc --rpc-url "$RPC" evm_mine >/dev/null
  echo "Moved chain time forward $1 seconds"
}

status() {
  for name in anvil web automation; do
    if running "$name"; then echo "$name: running"; else echo "$name: stopped"; fi
  done
  if running anvil; then echo "tick: $(tick)"; fi
}

case "${1:-}" in
  up) up ;;
  down) down ;;
  status) status ;;
  fees) fees "${2:-6}" ;;
  price) price "${2:?usage: devnet.sh price <usd>}" ;;
  warp) warp "${2:-300}" ;;
  logs) tail -f "$RUN/automation.log" ;;
  *) sed -n 3,11p "$0" | cut -c3- ;;
esac
