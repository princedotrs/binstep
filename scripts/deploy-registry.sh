#!/usr/bin/env bash
# Deploys the registry behind the Create pool page, using contracts/deployer.env.
# See scripts/deploy-markets.sh for that file. Any funded wallet works.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
RPC=${BASE_SEPOLIA_RPC_URL:-https://sepolia.base.org}
export PATH="$HOME/.foundry/bin:$PATH"

ENV_FILE=$ROOT/contracts/deployer.env
[ -f "$ENV_FILE" ] || { echo "Missing $ENV_FILE."; exit 1; }
set -a; . "$ENV_FILE"; set +a
[ "$(cast chain-id --rpc-url "$RPC")" = 84532 ] || { echo "$RPC is not Base Sepolia"; exit 1; }

# Forge writes the address before it broadcasts, so a failed run must not leave it behind.
FILE=contracts/deployments/base-sepolia.json
(cd "$ROOT/contracts" && forge script script/DeployRegistry.s.sol:DeployRegistry --rpc-url "$RPC" --broadcast --slow) ||
  { git -C "$ROOT" checkout -- "$FILE"; exit 1; }
python3 "$ROOT/web/scripts/sync-abi.py"
echo "Done. Restart the app to turn on the Create pool page."
