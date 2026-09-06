#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"

case "${1:-}" in
    update | check)
        exec "$root/scripts/build-zk.sh" "$1"
        ;;
    *)
        echo "usage $0 update or check" >&2
        exit 1
        ;;
esac
