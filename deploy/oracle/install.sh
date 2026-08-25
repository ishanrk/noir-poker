#!/usr/bin/env bash
set -euo pipefail
umask 022

node_version="24.12.0"
rust_version="1.93.0"
nargo_version="1.0.0-beta.26"
bb_version="5.2.0"
root="$(cd "$(dirname "$0")/../.." && pwd)"

if (( EUID != 0 )); then
    echo "run with sudo" >&2
    exit 1
fi

if [[ "$(uname -m)" != "aarch64" && "$(uname -m)" != "arm64" ]]; then
    echo "expected ARM64 got $(uname -m)" >&2
    exit 1
fi

if [[ ! -r /etc/os-release ]]; then
    echo "Ubuntu release metadata missing" >&2
    exit 1
fi

# shellcheck disable=SC1091
source /etc/os-release
if [[ "${ID:-}" != "ubuntu" || "${VERSION_ID:-}" != "24.04" ]]; then
    echo "expected Ubuntu 24.04 got ${PRETTY_NAME:-unknown}" >&2
    exit 1
fi

if [[ "$root" != "/opt/noir-poker" ]]; then
    echo "clone the repository at /opt/noir-poker" >&2
    exit 1
fi

if [[ -n "$(git -C "$root" status --short)" ]]; then
    echo "repository must be clean before installation" >&2
    exit 1
fi

repo_owner="$(stat -c '%U' "$root")"
repo_home="$(getent passwd "$repo_owner" | cut -d: -f6)"
if [[ -z "$repo_home" || ! -d "$repo_home" ]]; then
    echo "repository owner home missing" >&2
    exit 1
fi

run_owner() {
    if [[ "$repo_owner" == "root" ]]; then
        env HOME="$repo_home" "$@"
    else
        runuser -u "$repo_owner" -- env HOME="$repo_home" "$@"
    fi
}

if ! run_owner test -w "$root"; then
    echo "$repo_owner cannot write $root" >&2
    exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends \
    apt-transport-https \
    build-essential \
    ca-certificates \
    curl \
    debian-archive-keyring \
    debian-keyring \
    dnsutils \
    git \
    gnupg \
    jq \
    libssl-dev \
    openssl \
    pkg-config \
    ufw \
    xz-utils

if ! apt-cache show caddy >/dev/null 2>&1; then
    curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key \
        | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt \
        -o /etc/apt/sources.list.d/caddy-stable.list
    chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    chmod o+r /etc/apt/sources.list.d/caddy-stable.list
    apt-get update
fi
apt-get install -y --no-install-recommends caddy

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
chmod 0755 "$tmp"

curl -fsSL \
    https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    -o "$tmp/postgresql.asc"
pg_fingerprint="$(gpg --show-keys --with-colons "$tmp/postgresql.asc" \
    | awk -F: '$1 == "fpr" { print $10; exit }')"
if [[ "$pg_fingerprint" != "B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8" ]]; then
    echo "PostgreSQL signing key check failed" >&2
    exit 1
fi
install -d -m 0755 /usr/share/postgresql-common/pgdg
gpg --dearmor --yes \
    -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.gpg \
    "$tmp/postgresql.asc"
printf '%s\n' \
    "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.gpg] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" \
    > /etc/apt/sources.list.d/pgdg.list
apt-get update
apt-get install -y --no-install-recommends postgresql-client-18

fetch() {
    local url="$1"
    local sha="$2"
    local output="$3"

    curl -fL --retry 5 --retry-delay 2 -o "$output" "$url"
    printf '%s  %s\n' "$sha" "$output" | sha256sum -c -
}

link_tool() {
    local target="$1"
    local link="$2"

    if [[ -e "$link" && ! -L "$link" ]]; then
        echo "refusing to replace $link" >&2
        exit 1
    fi
    ln -sfn "$target" "$link"
}

if [[ "$(/usr/local/bin/node --version 2>/dev/null || true)" != "v$node_version" \
    || ! -x /usr/local/bin/npm \
    || ! -x /usr/local/bin/npx \
    || ! -x /usr/local/bin/corepack ]]; then
    node_archive="node-v${node_version}-linux-arm64.tar.xz"
    fetch \
        "https://nodejs.org/dist/v${node_version}/${node_archive}" \
        "a06d42807fb500f7459e5f3fa6cb431447352826ee6f07e14adfeec58a1b3210" \
        "$tmp/$node_archive"
    install -d -m 0755 /usr/local/lib/nodejs
    tar -xJf "$tmp/$node_archive" -C /usr/local/lib/nodejs
    node_root="/usr/local/lib/nodejs/node-v${node_version}-linux-arm64"
    link_tool "$node_root/bin/node" /usr/local/bin/node
    link_tool "$node_root/bin/npm" /usr/local/bin/npm
    link_tool "$node_root/bin/npx" /usr/local/bin/npx
    link_tool "$node_root/bin/corepack" /usr/local/bin/corepack
fi

if [[ "$(/usr/local/bin/nargo --version 2>/dev/null | sed -n '1s/nargo version = //p')" != "$nargo_version" ]]; then
    fetch \
        "https://github.com/noir-lang/noir/releases/download/v${nargo_version}/nargo-aarch64-unknown-linux-gnu.tar.gz" \
        "e62b9701751f2f9bd18671724b6344af598d8745ce8cde55d61cc27622371811" \
        "$tmp/nargo.tar.gz"
    tar -xzf "$tmp/nargo.tar.gz" -C "$tmp"
    install -m 0755 "$tmp/nargo" /usr/local/bin/nargo
fi

if [[ "$(/usr/local/bin/bb --version 2>/dev/null || true)" != "$bb_version" ]]; then
    fetch \
        "https://github.com/AztecProtocol/aztec-packages/releases/download/v${bb_version}/barretenberg-arm64-linux.tar.gz" \
        "5bdc0552865428ea50d81f4da25b5aa372f45cce33baa0419cbddcd532bdbf30" \
        "$tmp/bb.tar.gz"
    tar -xzf "$tmp/bb.tar.gz" -C "$tmp"
    install -m 0755 "$tmp/bb" /usr/local/bin/bb
fi

if [[ "$(/usr/local/bin/rustc --version 2>/dev/null | awk '{print $2}')" != "$rust_version" ]]; then
    rust_archive="rust-${rust_version}-aarch64-unknown-linux-gnu.tar.xz"
    fetch \
        "https://static.rust-lang.org/dist/2026-01-22/${rust_archive}" \
        "b666c705a334792a3eeb1d5984c8b24817f107bc986c6b09dcfd15a0d95b2b6a" \
        "$tmp/$rust_archive"
    tar -xJf "$tmp/$rust_archive" -C "$tmp"
    "$tmp/rust-${rust_version}-aarch64-unknown-linux-gnu/install.sh" \
        --prefix=/usr/local \
        --without=rust-docs
fi

if [[ "$(/usr/local/bin/node --version)" != "v$node_version" ]]; then
    echo "Node version check failed" >&2
    exit 1
fi
if [[ ! -x /usr/local/bin/npm ]]; then
    echo "npm path check failed" >&2
    exit 1
fi
if [[ "$(/usr/local/bin/nargo --version | sed -n '1s/nargo version = //p')" != "$nargo_version" ]]; then
    echo "Nargo version check failed" >&2
    exit 1
fi
if [[ "$(/usr/local/bin/bb --version)" != "$bb_version" ]]; then
    echo "BB version check failed" >&2
    exit 1
fi
if [[ "$(/usr/local/bin/rustc --version | awk '{print $2}')" != "$rust_version" ]]; then
    echo "Rust version check failed" >&2
    exit 1
fi
if [[ "$(/usr/lib/postgresql/18/bin/pg_dump --version 2>/dev/null || true)" != pg_dump\ \(PostgreSQL\)\ 18.* ]]; then
    echo "PostgreSQL client version check failed" >&2
    exit 1
fi

if ! getent group noir-poker >/dev/null; then
    groupadd --system noir-poker
fi
if ! id noir-poker >/dev/null 2>&1; then
    useradd \
        --system \
        --gid noir-poker \
        --home-dir /var/lib/noir-poker \
        --create-home \
        --shell /usr/sbin/nologin \
        noir-poker
fi

install -d -m 0750 -o noir-poker -g noir-poker /var/lib/noir-poker
install -d -m 0700 -o noir-poker -g noir-poker /var/lib/noir-poker/aztec-wallet
install -d -m 0750 -o root -g noir-poker /etc/noir-poker

build_path="/usr/local/bin:/usr/bin:/bin"
run_owner env PATH="$build_path" /usr/local/bin/npm --prefix "$root/aztec" ci --omit=dev
run_owner env PATH="$build_path" /usr/local/bin/npm --prefix "$root/apps/web" ci --omit=dev
run_owner env \
    PATH="$build_path" \
    NARGO_PATH=/usr/local/bin/nargo \
    BB_PATH=/usr/local/bin/bb \
    "$root/scripts/build-zk.sh"
run_owner env PATH="$build_path" /usr/local/bin/cargo \
    build --locked --release -p server --manifest-path "$root/Cargo.toml"

if ! runuser -u noir-poker -- test -x "$root/target/release/server" \
    || ! runuser -u noir-poker -- test -r "$root/aztec/scripts/server.mjs" \
    || ! runuser -u noir-poker -- test -r "$root/aztec/node_modules/@aztec/wallets/package.json" \
    || ! runuser -u noir-poker -- test -r "$root/apps/web/node_modules/@aztec/aztec.js/package.json" \
    || ! runuser -u noir-poker -- test -r "$root/apps/web/lib/aztec/artifacts/PlayChips.ts" \
    || ! runuser -u noir-poker -- test -r "$root/apps/web/lib/aztec/target/play_chips_contract-PlayChips.json"; then
    echo "noir-poker cannot read the built runtime" >&2
    exit 1
fi

if [[ -n "$(git -C "$root" status --short)" ]]; then
    echo "build changed tracked repository files" >&2
    git -C "$root" status --short >&2
    exit 1
fi

install -m 0644 \
    "$root/deploy/oracle/noir-poker.service" \
    /etc/systemd/system/noir-poker.service
systemctl daemon-reload

echo
echo "Oracle dependencies and Noir Poker are built"
echo "The Noir Poker service remains disabled"
echo "Continue with deploy/oracle/README.md"
