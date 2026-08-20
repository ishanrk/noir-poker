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

ensure_aztec() {
  local aztec_bin

  if command -v aztec >/dev/null 2>&1 \
    && aztec --version 2>&1 | grep -q "5.1.0"; then
    return
  fi

  # install pinned toolchain when missing
  printf 'Y\n' | VERSION=5.1.0 bash -i <(curl -fsSL https://install.aztec.network/5.1.0)

  if test -x "$HOME/.aztec/bin/aztec"; then
    aztec_bin="$HOME/.aztec/bin/aztec"
  else
    aztec_bin="$(find -L "$HOME/.aztec" -type f -name aztec -perm -111 2>/dev/null | head -n 1)"
  fi

  test -n "$aztec_bin"
  export PATH="$(dirname "$aztec_bin"):$PATH"
  aztec --version 2>&1 | grep -q "5.1.0"
}

ensure_aztec

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
