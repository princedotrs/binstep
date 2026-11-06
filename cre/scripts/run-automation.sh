#!/usr/bin/env bash
# Runs the automation workflow on a timer, for use until CRE deploy access is enabled.
# It stops working when this machine sleeps, so it suits demos, not production.
#
#   ./scripts/run-automation.sh [seconds between runs, default 300]
set -euo pipefail

cd "$(dirname "$0")/.."
INTERVAL="${1:-300}"

while true; do
  echo "--- $(date -u +%H:%M:%S) running automation"
  cre workflow simulate automation --target base-sepolia -e base-sepolia.env \
    --non-interactive --trigger-index 0 --broadcast 2>&1 | grep -E 'USER LOG|txHash|rror' || true
  sleep "$INTERVAL"
done
