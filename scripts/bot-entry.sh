#!/bin/sh
# Starts the bot inside the container from scripts/bot.Dockerfile.
set -eu

: "${DEPLOYER_KEY:?Set DEPLOYER_KEY on the host}"
: "${CRE_API_KEY:?Set CRE_API_KEY on the host}"

# The workflow reads its signing key from this file.
(umask 077; echo "CRE_ETH_PRIVATE_KEY=${DEPLOYER_KEY#0x}" >/app/cre/base-sepolia.env)

cd /app/web
exec bun run scripts/volume-bot.ts
