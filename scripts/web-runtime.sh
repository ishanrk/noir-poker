#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
artifact="$root/apps/web/zk/challenge_v2.json"

update() {
    "$root/scripts/build-zk.sh"
}

check() {
    local tmp
    local status=0

    if ! test -f "$artifact"; then
        echo "missing runtime artifact apps/web/zk/challenge_v2.json" >&2
        exit 1
    fi

    tmp="$(mktemp)"
    cp "$artifact" "$tmp"

    restore() {
        cp "$tmp" "$artifact"
        rm -f "$tmp"
    }

    trap restore EXIT
    update

    if cmp -s "$tmp" "$artifact"; then
        echo "web runtime matches source"
    else
        echo "runtime artifact drift apps/web/zk/challenge_v2.json" >&2
        status=1
    fi

    restore
    trap - EXIT
    return "$status"
}

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
