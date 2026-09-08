#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
cargo test --workspace --locked
(cd circuits/challenge-v2 && nargo test)
(cd circuits/deck-v1 && nargo test)
(
  cd apps/web
  npm run lint
  npm run typecheck
  npm run state:test
  npm run challenge:test
  npm run deck:test
  npm run deal:test
  npm run receipt:test
  npm run aztec:test
  npm run build
)
