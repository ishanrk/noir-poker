#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
nargo="${NARGO_PATH:-nargo}"
bb="${BB_PATH:-bb}"

resolve_tool() {
    local tool="$1"
    local path

    path="$(type -P -- "$tool")" || {
        echo "executable not found using $tool" >&2
        exit 1
    }
    realpath -- "$path"
}

nargo="$(resolve_tool "$nargo")"
bb="$(resolve_tool "$bb")"
nargo_version="$("$nargo" --version | sed -n '1s/nargo version = //p')"
bb_version="$("$bb" --version | sed -n '1p')"

if test "$nargo_version" != "1.0.0-beta.26"; then
    echo "expected nargo 1.0.0-beta.26 got ${nargo_version:-unknown} using $nargo" >&2
    exit 1
fi

if test "$bb_version" != "5.2.0"; then
    echo "expected bb 5.2.0 got ${bb_version:-unknown} using $bb" >&2
    exit 1
fi

(
    cd "$root/circuits/challenge-v1"
    "$nargo" compile
)

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

"$bb" write_vk \
    -b "$root/circuits/challenge-v1/target/challenge_v1.json" \
    -o "$tmp/vk" \
    -t noir-recursive

mkdir -p "$root/apps/web/zk" "$root/apps/server/zk"
cp "$root/circuits/challenge-v1/target/challenge_v1.json" "$root/apps/web/zk/challenge_v1.json"
cp "$tmp/vk/vk" "$root/apps/server/zk/challenge_v1.vk"

artifact_digest="$(sha256sum "$root/apps/web/zk/challenge_v1.json" | awk '{print $1}')"
vk_digest="$(sha256sum "$root/apps/server/zk/challenge_v1.vk" | awk '{print $1}')"

if test "$artifact_digest" != "e7d1b6cee74d87f6af289cc0e33e3f5133eb8fed8c6211e0eac9a82f84aacbf1"; then
    echo "challenge artifact digest mismatch" >&2
    exit 1
fi

if test "$vk_digest" != "650e1b9a6405d6d1b2b741abe1f16c4c66cd6183a56b73f120783e0aaf71f907"; then
    echo "challenge verification key digest mismatch" >&2
    exit 1
fi

echo "$artifact_digest  $root/apps/web/zk/challenge_v1.json"
echo "$vk_digest  $root/apps/server/zk/challenge_v1.vk"
