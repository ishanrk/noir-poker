#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
nargo="${NARGO_PATH:-nargo}"
bb="${BB_PATH:-bb}"
wasm_pack="${WASM_PACK_PATH:-wasm-pack}"
assets=(
    "apps/web/zk/challenge_v1.json"
    "apps/web/wasm/game_wasm.js"
    "apps/web/wasm/game_wasm_bg.wasm"
    "apps/web/wasm/game_wasm.d.ts"
)

resolve_tool() {
    local tool="$1"
    local path

    path="$(type -P -- "$tool")" || {
        echo "executable not found using $tool" >&2
        exit 1
    }
    realpath -- "$path"
}

verify_tools() {
    local nargo_version
    local bb_version
    local wasm_pack_version

    nargo="$(resolve_tool "$nargo")"
    bb="$(resolve_tool "$bb")"
    wasm_pack="$(resolve_tool "$wasm_pack")"
    nargo_version="$("$nargo" --version | sed -n '1s/nargo version = //p')"
    bb_version="$("$bb" --version | sed -n '1p')"
    wasm_pack_version="$("$wasm_pack" --version | sed -n '1s/wasm-pack //p')"

    if test "$nargo_version" != "1.0.0-beta.26"; then
        echo "expected nargo 1.0.0-beta.26 got ${nargo_version:-unknown} using $nargo" >&2
        exit 1
    fi

    if test "$bb_version" != "5.2.0"; then
        echo "expected bb 5.2.0 got ${bb_version:-unknown} using $bb" >&2
        exit 1
    fi

    if test "$wasm_pack_version" != "0.15.0"; then
        echo "expected wasm-pack 0.15.0 got ${wasm_pack_version:-unknown} using $wasm_pack" >&2
        exit 1
    fi
}

update() {
    local cargo_home="${CARGO_HOME:-$HOME/.cargo}"
    local rustflags="--remap-path-prefix=$root=/repo --remap-path-prefix=$cargo_home=/cargo"

    NARGO_PATH="$nargo" BB_PATH="$bb" "$root/scripts/build-zk.sh"
    RUSTFLAGS="$rustflags" "$wasm_pack" build "$root/crates/game-wasm" \
        --target web \
        --out-dir "$root/apps/web/wasm"
    rm -f \
        "$root/apps/web/wasm/.gitignore" \
        "$root/apps/web/wasm/game_wasm_bg.wasm.d.ts" \
        "$root/apps/web/wasm/package.json"
}

check() {
    local tmp
    local saved=0
    local status=0

    tmp="$(mktemp -d)"

    restore() {
        local file

        if test "$saved" = 1; then
            for file in "${assets[@]}"; do
                cp "$tmp/$file" "$root/$file"
            done
        fi

        rm -rf "$tmp"
    }

    trap restore EXIT

    for file in "${assets[@]}"; do
        if ! test -f "$root/$file"; then
            echo "missing runtime artifact $file" >&2
            exit 1
        fi

        mkdir -p "$tmp/$(dirname "$file")"
        cp "$root/$file" "$tmp/$file"
    done

    saved=1
    update

    for file in "${assets[@]}"; do
        if ! cmp -s "$tmp/$file" "$root/$file"; then
            echo "runtime artifact drift $file" >&2
            status=1
        fi
    done

    if test "$status" = 0; then
        echo "web runtime matches source"
    fi

    restore
    trap - EXIT
    return "$status"
}

verify_tools

case "${1:-}" in
    update)
        update
        ;;
    check)
        check
        ;;
    *)
        echo "usage $0 update or check" >&2
        exit 1
        ;;
esac
