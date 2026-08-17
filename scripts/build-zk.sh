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
    "$nargo" compile --force
)

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

"$bb" write_vk \
    -b "$root/circuits/challenge-v1/target/challenge_v1.json" \
    -o "$tmp/vk" \
    -t noir-recursive

mkdir -p "$root/apps/web/zk" "$root/apps/server/zk"
cp "$tmp/vk/vk" "$root/apps/server/zk/challenge_v1.vk"

# remove checkout path from debug metadata
sed -E 's#"path":"[^"]*/circuits/challenge-v1/src/main.nr"#"path":"/repo/circuits/challenge-v1/src/main.nr"#g' \
    "$root/circuits/challenge-v1/target/challenge_v1.json" > "$tmp/challenge_v1.json"
cp "$tmp/challenge_v1.json" "$root/apps/web/zk/challenge_v1.json"

artifact_digest="$(sha256sum "$root/apps/web/zk/challenge_v1.json" | awk '{print $1}')"
vk_digest="$(sha256sum "$root/apps/server/zk/challenge_v1.vk" | awk '{print $1}')"

if test "$artifact_digest" != "94125fd41b87a412605169b5839ad9d7c9022d4009e795ba63ff1efcf8adc28d"; then
    echo "challenge artifact digest mismatch" >&2
    exit 1
fi

if test "$vk_digest" != "5a70d3d6e804c894ee334ef0cb324c5d062a116ca73bb564fb040acc30fbfaa0"; then
    echo "challenge verification key digest mismatch" >&2
    exit 1
fi

echo "$artifact_digest  $root/apps/web/zk/challenge_v1.json"
echo "$vk_digest  $root/apps/server/zk/challenge_v1.vk"
