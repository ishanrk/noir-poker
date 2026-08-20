#!/usr/bin/env bash
set -uo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
out="${VALIDATION_OUT:-$root/artifacts/branch-validation}"

rm -rf "$out"
mkdir -p "$out/browser"
: > "$out/status.tsv"
failed=0

record() {
  printf '%s\t%s\n' "$1" "$2" >> "$out/status.tsv"
  if test "$2" -ne 0; then
    failed=1
  fi
}

check() {
  local name="$1"
  local command="$2"
  local log="$out/$name.log"

  printf '$ %s\n\n' "$command" > "$log"
  bash -o pipefail -c "$command" >> "$log" 2>&1
  local code=$?
  record "$name" "$code"
  return 0
}

check_fn() {
  local name="$1"
  shift
  local log="$out/$name.log"

  printf '$ %s\n\n' "$*" > "$log"
  "$@" >> "$log" 2>&1
  local code=$?
  record "$name" "$code"
  return 0
}

install_aztec() {
  local aztec_bin

  printf 'Y\n' | VERSION=5.1.0 bash -i <(curl -fsSL https://install.aztec.network/5.1.0)
  aztec_bin="$(find -L "$HOME/.aztec" -type f -name aztec -perm -111 2>/dev/null | head -n 1)"
  test -n "$aztec_bin"
  export PATH="$(dirname "$aztec_bin"):$PATH"
}

install_noir() {
  curl -fsSL https://raw.githubusercontent.com/noir-lang/noirup/main/install | bash
  export PATH="$HOME/.nargo/bin:$PATH"
  noirup --version 1.0.0-beta.26
}

install_bb() {
  local tmp

  tmp="$(mktemp -d)"
  curl -fL --retry 5 --retry-delay 2 \
    -o "$tmp/bb.tar.gz" \
    https://github.com/AztecProtocol/aztec-packages/releases/download/v5.2.0/barretenberg-amd64-linux.tar.gz
  printf '%s  %s\n' \
    17ab8476961728cdc5c69b6c4ff427c9092cef11d1e0b0166929a0417dfa7cfb \
    "$tmp/bb.tar.gz" | sha256sum -c -
  tar -xzf "$tmp/bb.tar.gz" -C "$tmp"
  mkdir -p "$HOME/.local/bin"
  install -m 0755 "$tmp/bb" "$HOME/.local/bin/bb"
  rm -rf "$tmp"
}

find_bb() {
  command -v bb 2>/dev/null || find "$HOME/.bb" "$HOME/.local/bin" -type f -name bb -perm -111 2>/dev/null | head -n 1
}

runtime_smoke() {
  local server_log="$out/server.log"
  local web_log="$out/web.log"
  local server_pid
  local web_pid
  local created
  local joined
  local room

  DATABASE_URL="$TEST_DATABASE_URL" \
  BB_PATH="$BB_PATH" \
  CHALLENGE_VK_PATH="$root/apps/server/zk/challenge_v2.vk" \
  WEB_ORIGINS="http://127.0.0.1:3000" \
  PORT=3001 \
  cargo run -p server > "$server_log" 2>&1 &
  server_pid=$!

  for _ in $(seq 1 120); do
    if curl -fsS http://127.0.0.1:3001/health >/dev/null 2>&1; then
      break
    fi
    if ! kill -0 "$server_pid" 2>/dev/null; then
      cat "$server_log"
      return 1
    fi
    sleep 1
  done

  curl -fsS http://127.0.0.1:3001/health >/dev/null
  created="$(
    curl -fsS \
      -H 'content-type: application/json' \
      -d "{\"players\":2,\"stack\":1000,\"small_blind\":5,\"big_blind\":10,\"entropy\":\"$(printf '11%.0s' {1..32})\"}" \
      http://127.0.0.1:3001/rooms
  )"
  room="$(printf '%s' "$created" | python3 -c 'import json,sys; print(json.load(sys.stdin)["room"])')"
  joined="$(
    curl -fsS \
      -H 'content-type: application/json' \
      -d "{\"entropy\":\"$(printf '22%.0s' {1..32})\"}" \
      "http://127.0.0.1:3001/rooms/$room/join"
  )"
  printf '%s\n%s\n' "$created" "$joined"

  (
    cd "$root/apps/web"
    npm run start
  ) > "$web_log" 2>&1 &
  web_pid=$!

  for _ in $(seq 1 120); do
    if curl -fsS http://127.0.0.1:3000 >/dev/null 2>&1; then
      break
    fi
    if ! kill -0 "$web_pid" 2>/dev/null; then
      cat "$web_log"
      kill "$server_pid" 2>/dev/null || true
      wait "$server_pid" 2>/dev/null || true
      return 1
    fi
    sleep 1
  done

  BASE_URL=http://127.0.0.1:3000 \
  SMOKE_DIR="$out/browser" \
  npm --prefix "$root/apps/web" run browser:smoke
  local code=$?

  kill "$web_pid" "$server_pid" 2>/dev/null || true
  wait "$web_pid" 2>/dev/null || true
  wait "$server_pid" 2>/dev/null || true
  return "$code"
}

aztec_local() {
  local node_log="$out/aztec-node.log"
  local node_pid
  local ready=0

  aztec start --local-network > "$node_log" 2>&1 &
  node_pid=$!

  for _ in $(seq 1 180); do
    if grep -q "Aztec Server listening on port 8080" "$node_log"; then
      ready=1
      break
    fi
    if ! kill -0 "$node_pid" 2>/dev/null; then
      cat "$node_log"
      wait "$node_pid" 2>/dev/null || true
      return 1
    fi
    sleep 1
  done

  if test "$ready" -ne 1; then
    cat "$node_log"
    kill "$node_pid" 2>/dev/null || true
    wait "$node_pid" 2>/dev/null || true
    return 1
  fi

  timeout 25m npm --prefix "$root/aztec" run test:local
  local code=$?

  kill "$node_pid" 2>/dev/null || true
  wait "$node_pid" 2>/dev/null || true
  return "$code"
}

cd "$root"

check_fn install-aztec install_aztec
check_fn install-noir install_noir
check_fn install-bb install_bb

export PATH="$HOME/.aztec/bin:$HOME/.nargo/bin:$HOME/.bb/bin:$HOME/.local/bin:$PATH"
export NARGO_PATH="$(command -v nargo 2>/dev/null || true)"
export BB_PATH="$(find_bb)"
export NEXT_PUBLIC_SERVER_URL="http://127.0.0.1:3001"
export NEXT_PUBLIC_AZTEC_NODE_URL="https://v5.testnet.rpc.aztec-labs.com"
export NEXT_PUBLIC_AZTEC_PLAY_CHIPS_ADDRESS="0x1111111111111111111111111111111111111111111111111111111111111111"
export AZTEC_NODE_URL="http://127.0.0.1:8080"
export TEST_DATABASE_URL="${TEST_DATABASE_URL:-postgres://postgres:postgres@127.0.0.1:5432/noir_poker}"

check tool-versions 'node --version && npm --version && rustc --version && cargo --version && aztec --version && nargo --version && "$BB_PATH" --version'
check contract-install 'npm --prefix aztec install'
check contract-policy 'npm --prefix aztec run test:protocol'
check aztec-bindings 'bash scripts/sync-aztec-web.sh --force'
check web-install 'npm --prefix apps/web install'
check playwright-install 'cd apps/web && npx playwright install --with-deps chromium'
check challenge-test 'npm --prefix apps/web run challenge:test'
check deal-test 'npm --prefix apps/web run deal:test'
check receipt-test 'npm --prefix apps/web run receipt:test'
check aztec-id-test 'npm --prefix apps/web run aztec:test'
check web-lint 'npm --prefix apps/web run lint'
check web-typecheck 'npm --prefix apps/web run typecheck'
check challenge-build 'NARGO_PATH="$NARGO_PATH" BB_PATH="$BB_PATH" bash scripts/build-zk.sh'
check proof-smoke 'npm --prefix apps/web run proof:smoke'
check web-build 'npm --prefix apps/web run build'
check rust-format 'cargo fmt --all -- --check'
check rust-test 'cargo test --workspace --locked'
check rust-clippy 'cargo clippy --workspace --all-targets --locked -- -D warnings'
check postgres-persistence 'cargo test -p server tests::persistence -- --ignored --exact --nocapture'
check db-integrity 'psql "$TEST_DATABASE_URL" -f scripts/check-db.sql'
check_fn runtime-smoke runtime_smoke
check_fn aztec-local aztec_local
check comment-style 'python3 scripts/check-comments.py'
check diff-check 'git diff --check'

npm --prefix apps/web audit --omit=dev --json > "$out/web-audit.json" 2>&1 || true
npm --prefix aztec audit --omit=dev --json > "$out/aztec-audit.json" 2>&1 || true
git status --short > "$out/git-status.txt"
git diff --stat > "$out/diff-stat.txt"

{
  printf '# branch validation\n\n'
  if test "$failed" -eq 0; then
    printf '**PASS**\n\n'
  else
    printf '**FAIL**\n\n'
  fi
  printf '| check | exit |\n|---|---:|\n'
  while IFS=$'\t' read -r name code; do
    printf '| `%s` | %s |\n' "$name" "$code"
  done < "$out/status.tsv"
} > "$out/README.md"

exit "$failed"
