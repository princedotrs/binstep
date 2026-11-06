#!/usr/bin/env bash
# Runs web/scripts/volume-bot.ts in the background, using contracts/deployer.env.
#
#   ./scripts/demo-bot.sh start | stop | status | logs
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
RUN=$ROOT/.devnet
PID=$RUN/demo-bot.pid
LOG=$RUN/demo-bot.log
export PATH="$HOME/.cre/bin:$HOME/.bun/bin:$PATH"
mkdir -p "$RUN"

running() { [ -f "$PID" ] && kill -0 "$(cat "$PID")" 2>/dev/null; }

case "${1:-}" in
  start)
    running && { echo "Already running."; exit 0; }
    ENV_FILE=$ROOT/contracts/deployer.env
    [ -f "$ENV_FILE" ] || { echo "Missing $ENV_FILE."; exit 1; }
    set -a; . "$ENV_FILE"; set +a

    # The workflow reads its key from this file, which git ignores.
    CRE_ENV=$ROOT/cre/base-sepolia.env
    [ -f "$CRE_ENV" ] || (umask 077; echo "CRE_ETH_PRIVATE_KEY=${DEPLOYER_KEY#0x}" >"$CRE_ENV")

    # caffeinate keeps the machine awake, because the bot stops when it sleeps.
    cd "$ROOT/web"
    perl -MPOSIX -e 'POSIX::setsid(); exec @ARGV or die $!' nohup caffeinate -is bun run scripts/volume-bot.ts >>"$LOG" 2>&1 &
    echo $! >"$PID"
    echo "Started. Follow it with: $0 logs"
    ;;
  stop)
    running || { echo "Not running."; exit 0; }
    kill -- "-$(cat "$PID")"
    rm -f "$PID"
    echo "Stopped."
    ;;
  status) running && echo "Running." || echo "Not running." ;;
  logs) tail -f "$LOG" ;;
  *) echo "Usage: $0 start | stop | status | logs"; exit 1 ;;
esac
