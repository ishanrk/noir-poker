#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
artifact="$root/apps/web/lib/aztec/artifacts/PlayChips.ts"
target="$root/apps/web/lib/aztec/target/play_chips_contract-PlayChips.json"
mode="${1:-}"

case "$mode" in
  generate | check) ;;
  *)
    echo "usage $0 generate or check" >&2
    exit 1
    ;;
esac

if ! command -v aztec >/dev/null 2>&1; then
  echo "aztec 5.1.0 required" >&2
  exit 1
fi

version="$(aztec --version 2>&1)"

case "$version" in
  *5.1.0*) ;;
  *)
    echo "aztec 5.1.0 required found $version" >&2
    exit 1
    ;;
esac

(
  cd "$root/aztec"
  aztec compile --force
  rm -rf artifacts
  mkdir -p artifacts
  aztec codegen ./target -o ./artifacts
)

test -s "$root/aztec/artifacts/PlayChips.ts"
test -s "$root/aztec/target/play_chips_contract-PlayChips.json"

normalized_artifact="$(mktemp)"
normalized_target="$(mktemp)"
trap 'rm -f "$normalized_artifact" "$normalized_target"' EXIT

sed -E 's/[[:space:]]+$//' \
  "$root/aztec/artifacts/PlayChips.ts" >"$normalized_artifact"

# stable source paths
sed -E \
  -e 's#("path"[[:space:]]*:[[:space:]]*")[^"]*/aztec/play_chips_contract/#\1/repo/aztec/play_chips_contract/#g' \
  -e 's#("path"[[:space:]]*:[[:space:]]*")[^"]*/nargo/github.com/#\1/nargo/github.com/#g' \
  "$root/aztec/target/play_chips_contract-PlayChips.json" >"$normalized_target"

case "$mode" in
  generate)
    mkdir -p "$(dirname "$artifact")" "$(dirname "$target")"
    install -m 0644 "$normalized_artifact" "$artifact"
    install -m 0644 "$normalized_target" "$target"
    ;;
  check)
    cmp -s "$normalized_artifact" "$artifact" \
      && cmp -s "$normalized_target" "$target" \
      || {
        echo "aztec browser runtime drift" >&2
        exit 1
      }
    ;;
esac
