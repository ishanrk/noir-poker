#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
nargo="${NARGO_PATH:-nargo}"
bb="${BB_PATH:-bb}"
mode="${1:-check}"

case "$mode" in
    check | update) ;;
    *)
        echo "usage $0 check or update" >&2
        exit 1
        ;;
esac

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

tmp="$(mktemp -d)"
trap 'rm -rf -- "$tmp"' EXIT

mkdir -p "$tmp/circuits/challenge-v2"
cp "$root/circuits/challenge-v2/Nargo.toml" "$tmp/circuits/challenge-v2/Nargo.toml"
cp -R "$root/circuits/challenge-v2/src" "$tmp/circuits/challenge-v2/src"

(
    cd "$tmp/circuits/challenge-v2"
    "$nargo" compile --force
)

"$bb" write_vk \
    -b "$tmp/circuits/challenge-v2/target/challenge_v2.json" \
    -o "$tmp/vk" \
    -t noir-recursive

# remove checkout path from debug metadata
sed -E 's#"path":"[^"]*/circuits/challenge-v2/src/main.nr"#"path":"/repo/circuits/challenge-v2/src/main.nr"#g' \
    "$tmp/circuits/challenge-v2/target/challenge_v2.json" > "$tmp/challenge_v2.json"

artifact_digest="$(sha256sum "$tmp/challenge_v2.json" | awk '{print $1}')"
vk_digest="$(sha256sum "$tmp/vk/vk" | awk '{print $1}')"

if test "$artifact_digest" != "1c89fb88ae0fb02558efa61de73260f871b323cba2a8a3d7c6423a302237bd5d"; then
    echo "challenge artifact digest mismatch" >&2
    exit 1
fi

if test "$vk_digest" != "b435db9d240683e181d8bad47203bf85d57ca27982bc676cf2686b5cf3de1d67"; then
    echo "challenge verification key digest mismatch" >&2
    exit 1
fi

case "$mode" in
    check)
        cmp -s "$tmp/challenge_v2.json" "$root/apps/web/zk/challenge_v2.json" || {
            echo "runtime artifact drift apps/web/zk/challenge_v2.json" >&2
            exit 1
        }
        cmp -s "$tmp/vk/vk" "$root/apps/server/zk/challenge_v2.vk" || {
            echo "runtime artifact drift apps/server/zk/challenge_v2.vk" >&2
            exit 1
        }
        echo "challenge runtime and verification key match source"
        ;;
    update)
        mkdir -p "$root/apps/web/zk" "$root/apps/server/zk"
        install -m 0644 "$tmp/challenge_v2.json" "$root/apps/web/zk/challenge_v2.json"
        install -m 0644 "$tmp/vk/vk" "$root/apps/server/zk/challenge_v2.vk"
        ;;
esac

echo "$artifact_digest  $root/apps/web/zk/challenge_v2.json"
echo "$vk_digest  $root/apps/server/zk/challenge_v2.vk"
