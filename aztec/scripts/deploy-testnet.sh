#!/usr/bin/env bash
set -euo pipefail

AZTEC_VERSION="${AZTEC_VERSION:-5.2.0}"
NODE_URL="${AZTEC_NODE_URL:-https://v5.testnet.rpc.aztec-labs.com}"
SPONSORED_FPC_ADDRESS="${SPONSORED_FPC_ADDRESS:-0x130925fbd734a252e3d8ddff87f6c346052dd5c13314eb96026b32baa1923296}"
ACCOUNT_ALIAS="${AZTEC_ACCOUNT_ALIAS:-noir-poker-deployer}"
CONTRACT_ALIAS="${AZTEC_CONTRACT_ALIAS:-noir-poker-play-chips}"

command -v aztec >/dev/null || {
  echo "aztec is not installed"
  echo "install ${AZTEC_VERSION} with:"
  echo "VERSION=${AZTEC_VERSION} bash -i <(curl -fsSL https://install.aztec.network/${AZTEC_VERSION})"
  exit 1
}
command -v aztec-wallet >/dev/null || {
  echo "aztec-wallet is not installed"
  exit 1
}

installed="$(aztec --version 2>/dev/null || true)"
case "$installed" in
  *"${AZTEC_VERSION}"*) ;;
  *)
    echo "expected Aztec ${AZTEC_VERSION}, found: ${installed:-unknown}"
    exit 1
    ;;
esac

cd "$(dirname "$0")/.."

npm install
npm run build

aztec-wallet register-contract \
  --node-url "$NODE_URL" \
  --alias sponsoredfpc \
  "$SPONSORED_FPC_ADDRESS" SponsoredFPC \
  --salt 0

if ! aztec-wallet get-alias "accounts:${ACCOUNT_ALIAS}" >/dev/null 2>&1; then
  aztec-wallet create-account \
    --node-url "$NODE_URL" \
    --alias "$ACCOUNT_ALIAS" \
    --payment "method=fpc-sponsored,fpc=${SPONSORED_FPC_ADDRESS}"
fi

echo "Deploying PlayChips from accounts:${ACCOUNT_ALIAS}"
output="$({
  aztec-wallet deploy \
    --node-url "$NODE_URL" \
    --from "accounts:${ACCOUNT_ALIAS}" \
    --payment "method=fpc-sponsored,fpc=${SPONSORED_FPC_ADDRESS}" \
    --alias "$CONTRACT_ALIAS" \
    PlayChips
} 2>&1 | tee /dev/stderr)"

address="$(printf '%s\n' "$output" | grep -Eo '0x[0-9a-fA-F]{64}' | tail -1)"
if [[ -z "$address" ]]; then
  echo "deployment completed but no contract address was found in the output"
  exit 1
fi

cat <<EOF

PlayChips deployed

NEXT_PUBLIC_AZTEC_NODE_URL=${NODE_URL}
NEXT_PUBLIC_AZTEC_PLAY_CHIPS_ADDRESS=${address}

Add both values to the Vercel Preview environment for the Aztec branch.
EOF
