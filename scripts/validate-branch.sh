#!/usr/bin/env bash
set -uo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"

if test "${1:-}" = "--help"; then
  echo "usage $0 [quick] [db] [proof] [runtime] [browser] [aztec]"
  echo "default quick uses installed rust and web dependencies without installing tools"
  echo "db and proof require an isolated TEST_DATABASE_URL and ALLOW_TEST_DATABASE_RESET=1"
  echo "proof also requires BB_PATH pointing to bb 5.2.0"
  echo "runtime requires nargo 1.0.0-beta.26 and bb 5.2.0"
  echo "browser requires a running local web server and installed playwright chromium"
  echo "aztec checks the installed sdk only and does not start a network or deploy"
  exit 0
fi

if test "$#" -eq 0; then set -- quick; fi
for mode in "$@"; do
  case "$mode" in
    quick | db | proof | runtime | browser | aztec) ;;
    *) echo "unknown check group $mode" >&2; exit 1 ;;
  esac
done

out="$(mktemp -d "${TMPDIR:-/tmp}/noir-poker-validation.XXXXXXXX")" || exit 1
failed=0
printf 'logs %s\n' "$out"
if test -n "${VALIDATION_OUT:-}"; then
  echo "VALIDATION_OUT is no longer used existing output is preserved"
fi

check() {
  local name="$1"
  shift
  local code=0
  "$@" > "$out/$name.log" 2>&1 || code=$?
  printf '%s\t%s\n' "$name" "$code" >> "$out/status.tsv"
  if test "$code" -eq 0; then
    printf 'PASS %s\n' "$name"
  else
    printf 'FAIL %s see %s/%s.log\n' "$name" "$out" "$name"
    failed=1
  fi
}

test_database() {
  if test -z "${TEST_DATABASE_URL:-}" || test "${ALLOW_TEST_DATABASE_RESET:-}" != 1; then
    echo "use a disposable isolated TEST_DATABASE_URL and ALLOW_TEST_DATABASE_RESET=1 these tests truncate game tables" >&2
    return 1
  fi
}

database_checks() {
  test_database || return 1
  cargo test -p server --locked persistence -- --ignored --test-threads=1 --nocapture
}

proof_checks() {
  test_database || return 1
  if test -z "${BB_PATH:-}" || test "$("$BB_PATH" --version)" != "5.2.0"; then
    echo "BB_PATH must point to bb 5.2.0" >&2
    return 1
  fi
  cargo test -p server --locked real_proof_roundtrip -- --list | rg -q '(^|::)real_proof_roundtrip: test$' || {
    echo "real_proof_roundtrip test unavailable" >&2
    return 1
  }
  cargo test -p server --locked real_proof_roundtrip -- --ignored --test-threads=1 --nocapture
}

web_typegen() {
  (
    cd "$root/apps/web" || exit 1
    ./node_modules/.bin/next typegen
  )
}

cd "$root" || exit 1
for mode in "$@"; do
  case "$mode" in
    quick)
      check rust-format cargo fmt --all -- --check
      check rust-test cargo test --workspace --locked
      check rust-clippy cargo clippy --workspace --all-targets --locked -- -D warnings
      check web-lint npm --prefix apps/web run lint
      check web-typegen web_typegen
      check web-typecheck npm --prefix apps/web run typecheck
      check challenge-test npm --prefix apps/web run challenge:test
      check deal-test npm --prefix apps/web run deal:test
      check receipt-test npm --prefix apps/web run receipt:test
      check session-test node --experimental-strip-types apps/web/lib/room-session.test.ts
      check web-build npm --prefix apps/web run build
      check diff-check git diff --check
      ;;
    db) check postgres-persistence database_checks ;;
    proof) check real-proof proof_checks ;;
    runtime) check challenge-runtime bash scripts/web-runtime.sh check ;;
    browser) check browser-smoke env SMOKE_DIR="$out/browser" npm --prefix apps/web run browser:smoke ;;
    aztec)
      check aztec-policy npm --prefix aztec run test:protocol
      check aztec-identities npm --prefix apps/web run aztec:test
      ;;
  esac
done

printf 'results %s/status.tsv\n' "$out"
exit "$failed"
