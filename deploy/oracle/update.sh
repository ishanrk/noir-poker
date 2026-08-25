#!/usr/bin/env bash
set -euo pipefail
umask 022

root="$(cd "$(dirname "$0")/../.." && pwd)"
branch="${DEPLOY_BRANCH:-oracle-deploy}"

if (( EUID == 0 )); then
    echo "run as the repository owner without sudo" >&2
    exit 1
fi

if [[ "$root" != "/opt/noir-poker" ]]; then
    echo "expected repository at /opt/noir-poker" >&2
    exit 1
fi

if [[ "$(stat -c '%U' "$root")" != "$(id -un)" ]]; then
    echo "run as the repository owner" >&2
    exit 1
fi

if [[ "$(git -C "$root" branch --show-current)" != "$branch" ]]; then
    echo "expected branch $branch" >&2
    exit 1
fi

if [[ -n "$(git -C "$root" status --short)" ]]; then
    echo "repository must be clean before update" >&2
    exit 1
fi

git -C "$root" fetch --prune origin "$branch"
target="$(git -C "$root" rev-parse "origin/$branch")"
old="$(git -C "$root" rev-parse HEAD)"

if ! git -C "$root" merge-base --is-ancestor HEAD "$target"; then
    echo "origin/$branch cannot be fast-forwarded" >&2
    exit 1
fi

if ! git -C "$root" diff --quiet HEAD "$target" -- apps/server/migrations; then
    echo "database migrations changed" >&2
    echo "back up PostgreSQL and inspect the migrations before updating" >&2
    exit 1
fi

if [[ "$(/usr/local/bin/node --version 2>/dev/null || true)" != "v24.12.0" ]]; then
    echo "expected Node 24.12.0" >&2
    exit 1
fi
if [[ ! -x /usr/local/bin/npm ]]; then
    echo "npm path missing" >&2
    exit 1
fi
if [[ "$(/usr/local/bin/nargo --version 2>/dev/null | sed -n '1s/nargo version = //p')" != "1.0.0-beta.26" ]]; then
    echo "expected Nargo 1.0.0-beta.26" >&2
    exit 1
fi
if [[ "$(/usr/local/bin/bb --version 2>/dev/null || true)" != "5.2.0" ]]; then
    echo "expected BB 5.2.0" >&2
    exit 1
fi
if [[ "$(/usr/local/bin/rustc --version 2>/dev/null | awk '{print $2}')" != "1.93.0" ]]; then
    echo "expected Rust 1.93.0" >&2
    exit 1
fi

if [[ ! -f /etc/noir-poker/server.env ]]; then
    echo "/etc/noir-poker/server.env missing" >&2
    exit 1
fi

if ! sudo systemctl is-active --quiet noir-poker; then
    echo "noir-poker must be active before update" >&2
    exit 1
fi

echo "stopping Noir Poker at $old"
sudo systemctl stop noir-poker
trap 'echo "update failed after stopping Noir Poker" >&2; echo "previous commit was $old" >&2' ERR

git -C "$root" merge --ff-only "$target"
/usr/local/bin/npm --prefix "$root/aztec" ci --omit=dev
/usr/local/bin/npm --prefix "$root/apps/web" ci --omit=dev
NARGO_PATH=/usr/local/bin/nargo \
    BB_PATH=/usr/local/bin/bb \
    "$root/scripts/build-zk.sh"
/usr/local/bin/cargo build --locked --release -p server --manifest-path "$root/Cargo.toml"

if [[ -n "$(git -C "$root" status --short)" ]]; then
    echo "build changed tracked repository files" >&2
    git -C "$root" status --short >&2
    exit 1
fi

sudo systemctl start noir-poker
sudo systemctl is-active --quiet noir-poker
sudo bash -c '
    set -a
    source /etc/noir-poker/server.env
    set +a
    for _ in {1..30}; do
        if curl -fsS "http://127.0.0.1:${PORT:-3001}/health" >/dev/null; then
            exit 0
        fi
        sleep 1
    done
    exit 1
'
trap - ERR

echo "Noir Poker updated to $(git -C "$root" rev-parse --short HEAD)"
