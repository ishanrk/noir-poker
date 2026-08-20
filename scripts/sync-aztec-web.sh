#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
artifact="$root/apps/web/lib/aztec/artifacts/PlayChips.ts"
target="$root/apps/web/lib/aztec/target/play_chips_contract-PlayChips.json"
stamp="$root/apps/web/lib/aztec/artifacts/source.sha256"
sources=(
  "$root/aztec/package.json"
  "$root/aztec/Nargo.toml"
  "$root/aztec/play_chips_contract/Nargo.toml"
  "$root/aztec/play_chips_contract/src/main.nr"
)

source_hash="$(
  {
    printf 'aztec 5.1.0\0'
    for source in "${sources[@]}"; do
      printf '%s\0' "${source#"$root/"}"
      cat "$source"
    done
  } | sha256sum | awk '{print $1}'
)"

if test "${1:-}" != "--force" \
  && test -s "$artifact" \
  && test -s "$target" \
  && test -s "$stamp" \
  && test "$(cat "$stamp")" = "$source_hash"; then
  exit 0
fi

if ! command -v aztec >/dev/null 2>&1; then
  echo "aztec 5.1.0 required to refresh play chips bindings" >&2
  exit 1
fi

if ! aztec --version 2>&1 | grep -q "5.1.0"; then
  echo "aztec 5.1.0 required to refresh play chips bindings" >&2
  exit 1
fi

(
  cd "$root/aztec"
  aztec compile --force
  rm -rf artifacts
  mkdir -p artifacts
  aztec codegen ./target -o ./artifacts
)

test -s "$root/aztec/artifacts/PlayChips.ts"
test -s "$root/aztec/target/play_chips_contract-PlayChips.json"

mkdir -p "$(dirname "$artifact")" "$(dirname "$target")"
install -m 0644 "$root/aztec/artifacts/PlayChips.ts" "$artifact"
install -m 0644 "$root/aztec/target/play_chips_contract-PlayChips.json" "$target"
printf '%s\n' "$source_hash" > "$stamp"
