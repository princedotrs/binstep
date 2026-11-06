#!/usr/bin/env bash
# Swaps the live Base Sepolia test pool to a target ETH price in USD.
# Nothing else moves this pool, so this stands in for arbitrage in demos.
#   ./scripts/move-price.sh 2200
set -euo pipefail
[ $# -eq 1 ] || { echo "usage: $0 <eth-price-usd>"; exit 1; }
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
DEPLOYMENT=$ROOT/contracts/deployments/base-sepolia.json
RPC=https://sepolia.base.org
KEY=$(grep -oP '^DEPLOYER_KEY=\K.*' "$ROOT/contracts/.env")

field() { python3 -c "import json;print(json.load(open('$DEPLOYMENT'))['$1'])"; }
HOOK=$(field hook)
POOL=$(field poolId)
WETH_IS_0=$(field wethIsToken0)
POOL_KEY="($(field token0),$(field token1),8388608,10,$HOOK)"

# Raw price is token1 base units per token0 base units, so decimals count.
read -r TARGET LIMIT < <(python3 - "$1" "$WETH_IS_0" <<'PY'
import math, sys
usd, weth_is_0 = float(sys.argv[1]), sys.argv[2] == "True"
raw = usd * 1e-12 if weth_is_0 else 1e12 / usd
print(round(math.log(raw) / math.log(1.0001)), int(math.sqrt(raw) * 2**96))
PY
)

NOW=$(cast call "$HOOK" 'poolStates(bytes32)(int24,int24,int24,int24,uint40,uint32,uint32)' "$POOL" --rpc-url "$RPC" | head -1 | awk '{print $1}')
ZERO_FOR_ONE=true
[ "$TARGET" -gt "$NOW" ] && ZERO_FOR_ONE=false

cast send -q --rpc-url "$RPC" --private-key "$KEY" "$(field swapRouter)" \
  'swap((address,address,uint24,int24,address),(bool,int256,uint160),(bool,bool),bytes)' \
  "$POOL_KEY" "($ZERO_FOR_ONE,-1000000000000000000000000,$LIMIT)" "(false,false)" 0x
echo "Pool moved from tick $NOW toward tick $TARGET (\$$1)"
