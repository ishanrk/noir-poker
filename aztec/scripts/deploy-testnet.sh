#!/usr/bin/env bash
set -euo pipefail
umask 077

: "${AZTEC_SERVER_WALLET_DIR:?AZTEC_SERVER_WALLET_DIR missing}"

cd "$(dirname "$0")/.."

exec 9>"${AZTEC_SERVER_WALLET_DIR}.init.lock"
if ! flock -n 9; then
    echo "Aztec initialization already running" >&2
    exit 1
fi

exec node scripts/init-testnet.mjs
