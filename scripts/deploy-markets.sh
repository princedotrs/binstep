#!/usr/bin/env bash
# Adds the test markets in contracts/script/DeployMarkets.s.sol to Base Sepolia.
#
# Put a wallet holding Base Sepolia ETH in contracts/deployer.env, which git ignores:
#   DEPLOYER_KEY=0x...
# Any funded wallet works: creating pools and minting positions needs no contract rights.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
RPC=${BASE_SEPOLIA_RPC_URL:-https://sepolia.base.org}
MIN_ETH=0.005
export PATH="$HOME/.foundry/bin:$PATH"

ENV_FILE=$ROOT/contracts/deployer.env
[ -f "$ENV_FILE" ] || { echo "Missing $ENV_FILE. See the top of this script."; exit 1; }
set -a; . "$ENV_FILE"; set +a
[ -n "${DEPLOYER_KEY:-}" ] || { echo "DEPLOYER_KEY is empty in $ENV_FILE"; exit 1; }

[ "$(cast chain-id --rpc-url "$RPC")" = 84532 ] || { echo "$RPC is not Base Sepolia"; exit 1; }
DEPLOYER=$(cast wallet address "$DEPLOYER_KEY")
BALANCE=$(cast balance --ether --rpc-url "$RPC" "$DEPLOYER")
echo "Deploying from $DEPLOYER, holding $BALANCE ETH"
python3 -c "import sys; sys.exit(float('$BALANCE') < $MIN_ETH)" || { echo "Needs at least $MIN_ETH ETH"; exit 1; }

MARKETS=$ROOT/contracts/deployments/base-sepolia.markets.json
[ ! -f "$MARKETS" ] || { echo "$MARKETS already exists, so these markets are live."; exit 1; }

# Forge writes the file before it broadcasts, so a failed run must not leave it behind.
(cd "$ROOT/contracts" && forge script script/DeployMarkets.s.sol:DeployMarkets --rpc-url "$RPC" --broadcast --slow) ||
  { rm -f "$MARKETS"; exit 1; }
python3 "$ROOT/web/scripts/sync-abi.py"
echo "Done. Restart the app to list the new markets."
