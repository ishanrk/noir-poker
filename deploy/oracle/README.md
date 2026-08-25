# Oracle ARM64 deployment

This deploys the existing Noir Poker backend directly on one Oracle Ubuntu VM.

```text
internet
   |
 Caddy :443
   |
 Rust :3001
   |
 Neon PostgreSQL

Rust
   |
 Node 24
   |
 aztec/scripts/server.mjs
   |
 Aztec 5.2.0 testnet
```

Use one server instance. Live rooms and WebSockets stay in memory and the embedded Aztec wallet expects one writer.

## 1 Create the VM

In Oracle Cloud create a compute instance with:

- Ubuntu 24.04 ARM64
- an Ampere A1 shape
- a public IPv4 address
- your SSH public key
- enough boot disk space for source builds and the Aztec wallet

Keep the boot volume when rebooting or stopping the instance.

## 2 Open only public service ports

In the OCI subnet security list or network security group allow inbound TCP:

```text
22
80
443
```

Do not add public rules for PostgreSQL port 5432 or Rust port 3001. OCI networking and the Ubuntu firewall are separate controls.

Connect:

```bash
ssh ubuntu@PUBLIC_IP
```

## 3 Clone the deployment branch

The `oracle-deploy` branch must first exist on GitHub.

```bash
sudo install -d -m 0755 -o "$USER" -g "$USER" /opt/noir-poker
git clone --branch oracle-deploy https://github.com/ishanrk/noir-poker.git /opt/noir-poker
cd /opt/noir-poker
git status --short
git rev-parse HEAD
```

The status output must be empty.

## 4 Install and build

```bash
cd /opt/noir-poker
sudo ./deploy/oracle/install.sh
```

The installer requires Ubuntu 24.04 ARM64. It installs and verifies:

```text
Node 24.12.0
Rust 1.93.0
Nargo 1.0.0-beta.26
Barretenberg 5.2.0
PostgreSQL client tools
Caddy
```

It installs pinned repository npm dependencies then runs:

```bash
./scripts/build-zk.sh
cargo build --locked --release -p server
```

It creates `/var/lib/noir-poker/aztec-wallet` without deleting existing contents. It installs the systemd unit but does not enable Noir Poker.

Configure the Ubuntu firewall after the installer has added UFW. The SSH allow rule must precede enabling it:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw deny 3001/tcp
sudo ufw deny 5432/tcp
sudo ufw enable
sudo ufw status
```

Verify the tools:

```bash
node --version
npm --version
nargo --version
bb --version
rustc --version
```

Expected versions are Node `v24.12.0`, Nargo `1.0.0-beta.26`, BB `5.2.0`, and Rust `1.93.0`.

Aztec 5.2.0 bundles Nargo beta.25 for its own CLI. The application ZK build deliberately uses the separate beta.26 `/usr/local/bin/nargo` installed above.

## 5 Verify and back up Neon

Production uses the existing Neon database URL in `/etc/noir-poker/server.env`. Do not replace it with a local PostgreSQL database and do not print it.

Test the connection and inspect migration history as the service user:

```bash
sudo -u noir-poker bash -c '
  set -a
  source /etc/noir-poker/server.env
  set +a
  psql "$DATABASE_URL" -c "select 1"
  psql "$DATABASE_URL" -c \
    "select version, description, installed_on from _sqlx_migrations order by version"
'
```

Take a private backup before the first application startup:

```bash
sudo install -d -m 0700 -o root -g root /var/backups/noir-poker
sudo bash -c '
  set -euo pipefail
  umask 077
  set -a
  source /etc/noir-poker/server.env
  set +a
  /usr/lib/postgresql/18/bin/pg_dump --format=custom "$DATABASE_URL" \
    > /var/backups/noir-poker/neon-before-deploy.dump
  /usr/lib/postgresql/18/bin/pg_restore --list \
    /var/backups/noir-poker/neon-before-deploy.dump >/dev/null
'
```

Migration `20260821000000_challenge_v2.sql` truncates old room data. A fresh database is unaffected. Never upgrade an older database across that migration without a verified backup.

## 6 Initialize Aztec once

The runtime uses a persistent EmbeddedWallet at:

```text
/var/lib/noir-poker/aztec-wallet
```

The directory must contain the configured server account and survive every update and reboot.

### Case A No server wallet or PlayChips deployment exists

Run the repository-pinned one-process initializer as the service user. The same EmbeddedWallet registers the canonical Aztec 5.2.0 Sponsored FPC then creates and deploys one Schnorr account and one PlayChips contract. A fixed deployment salt prevents an interrupted rerun from creating another PlayChips contract for the same account.

```bash
cd /opt/noir-poker
sudo systemctl stop noir-poker 2>/dev/null || true
sudo chown -R noir-poker:noir-poker /var/lib/noir-poker
sudo chmod 0750 /var/lib/noir-poker
sudo chmod 0700 /var/lib/noir-poker/aztec-wallet
sudo -u noir-poker env \
  AZTEC_NODE_URL=https://v5.testnet.rpc.aztec-labs.com \
  AZTEC_SERVER_WALLET_DIR=/var/lib/noir-poker/aztec-wallet \
  AZTEC_SPONSORED_FPC_ADDRESS=0x2ece607a8dba690c9aa4ee1d53a55286fa815543a27f9364bbaf65eb68e7315b \
  /usr/local/bin/npm --prefix /opt/noir-poker/aztec run deploy:testnet
git status --short
```

Copy the five public configuration values printed by the script. A rerun reuses the sole stored account. If `AZTEC_PLAY_CHIPS_ADDRESS` and `AZTEC_SERVER_ACCOUNT` are supplied it verifies and reuses them rather than deploying replacements.

The Git status output should remain empty. If exact-version code generation changes a committed artifact stop and inspect it rather than discarding or committing it on the server.

The server needs:

```text
AZTEC_NODE_URL
AZTEC_PLAY_CHIPS_ADDRESS
AZTEC_SERVER_ACCOUNT
AZTEC_SERVER_WALLET_DIR
AZTEC_SPONSORED_FPC_ADDRESS
```

Vercel later needs:

```text
NEXT_PUBLIC_AZTEC_NODE_URL
NEXT_PUBLIC_AZTEC_PLAY_CHIPS_ADDRESS
```

### Case B A server wallet and PlayChips deployment already exist

Do not run the initializer without supplying the existing account and contract values. Do not deploy another contract.

Stop Noir Poker. Transfer the complete existing wallet directory over SSH using an encrypted connection. Keep the original untouched until Oracle passes preflight. Do not merge two wallet directories or copy only selected files.

Stop the source Noir Poker service so the wallet database cannot change during the copy. On the existing machine replace `/CURRENT/WALLET/PATH` and `PUBLIC_IP`:

```bash
sudo systemctl stop noir-poker
(
  umask 077
  sudo tar -C /CURRENT/WALLET/PATH -czf - . \
    > "$HOME/noir-poker-wallet-transfer.tar.gz"
)
sha256sum "$HOME/noir-poker-wallet-transfer.tar.gz"
scp "$HOME/noir-poker-wallet-transfer.tar.gz" ubuntu@PUBLIC_IP:
```

Keep the source service stopped during the migration. Never run two servers against copies of the same embedded wallet.

On Oracle compare the SHA-256 value then stage the complete archive outside the repository:

```bash
sha256sum "$HOME/noir-poker-wallet-transfer.tar.gz"
install -d -m 0700 "$HOME/noir-poker-wallet-import"
tar -xzf "$HOME/noir-poker-wallet-transfer.tar.gz" \
  -C "$HOME/noir-poker-wallet-import"
sudo systemctl stop noir-poker 2>/dev/null || true
sudo find /var/lib/noir-poker/aztec-wallet -mindepth 1 -print -quit
```

The final command must print nothing. If it prints a path stop rather than merging wallet state. Copy the staged directory only when the target is empty:

```bash
sudo cp -a "$HOME/noir-poker-wallet-import/." \
  /var/lib/noir-poker/aztec-wallet/
```

Place the transferred directory at:

```text
/var/lib/noir-poker/aztec-wallet
```

Then set ownership and permissions:

```bash
sudo chown -R noir-poker:noir-poker /var/lib/noir-poker/aztec-wallet
sudo chmod -R go-rwx /var/lib/noir-poker/aztec-wallet
```

Use the same Aztec 5.2.0 node URL, PlayChips address, sponsored FPC, and server account as the source deployment. The complete wallet directory is application data rather than an executable. Its acceptance test is the production helper check in the next section. Keep the old copy until that check returns the expected owner on ARM64.

## 7 Configure the server environment

Preserve an existing `/etc/noir-poker/server.env`, especially its Neon `DATABASE_URL`. Install the placeholder template only when the file does not exist:

```bash
if ! sudo test -f /etc/noir-poker/server.env; then
  sudo install -m 0640 -o root -g noir-poker \
    /opt/noir-poker/deploy/oracle/server.env.example \
    /etc/noir-poker/server.env
fi
sudoedit /etc/noir-poker/server.env
```

Replace every remaining `CHANGE_ME` and `YOUR_...` value. Set `WEB_ORIGINS` to the exact HTTPS Vercel and custom frontend origins separated by commas. Do not put a trailing slash on an origin.

Example shape:

```text
DATABASE_URL=the existing Neon URL
PORT=3001
WEB_ORIGINS=https://project.vercel.app,https://www.example.com
```

Keep the committed helper and tool paths unchanged:

```text
BB_PATH=/usr/local/bin/bb
CHALLENGE_VK_PATH=/opt/noir-poker/apps/server/zk/challenge_v2.vk
AZTEC_SERVER_WALLET_DIR=/var/lib/noir-poker/aztec-wallet
AZTEC_SERVER_HELPER=/opt/noir-poker/aztec/scripts/server.mjs
AZTEC_SERVER_NODE=/usr/local/bin/node
```

Check permissions and confirm no placeholder remains:

```bash
sudo chown root:noir-poker /etc/noir-poker/server.env
sudo chmod 0640 /etc/noir-poker/server.env
sudo grep -nE 'CHANGE_ME|YOUR_' /etc/noir-poker/server.env
```

The final grep must print nothing.

## 8 Run preflight

Test the database using the same environment and service user:

```bash
sudo -u noir-poker bash -c '
  set -a
  source /etc/noir-poker/server.env
  set +a
  psql "$DATABASE_URL" -c "select 1"
'
```

Run the production Node helper check:

```bash
sudo -u noir-poker bash -c '
  set -a
  source /etc/noir-poker/server.env
  set +a
  printf "%s\n" "{\"op\":\"check\"}" |
    "$AZTEC_SERVER_NODE" "$AZTEC_SERVER_HELPER"
'
```

Expected output is one JSON object containing the configured owner:

```json
{"owner":"0x..."}
```

This helper operation verifies the production boundaries used at startup:

1. The Aztec RPC responds.
2. The canonical Sponsored FPC matches the pinned artifact and registers in the same wallet.
3. The configured server account exists in the persistent wallet.
4. The PlayChips contract exists at the configured address.
5. The server account equals the contract owner.

Do not start the service if this check fails.

## 9 Start Noir Poker locally

```bash
sudo systemctl enable --now noir-poker
sudo systemctl status noir-poker --no-pager
curl --fail http://127.0.0.1:3001/health
sudo journalctl -u noir-poker -n 100 --no-pager
```

The health response is `ok`. Startup connects to PostgreSQL, applies migrations, restores durable rooms, loads proof verifiers, and checks Aztec before binding the port. A failure in any of those steps prevents public traffic.

Confirm the internal server port has no OCI or UFW public allow rule:

```bash
sudo ss -ltnp | grep -E ':3001[[:space:]]'
```

The Rust server binds port 3001 on all VM interfaces. The OCI ingress rules and explicit UFW deny rule must keep it private while Caddy reaches it over loopback.

## 10 Configure DNS and Caddy

Create an `A` record for the chosen API hostname pointing at the Oracle public IPv4 address. Add an `AAAA` record only if the VM has working public IPv6. Wait for DNS:

```bash
dig +short api.example.com
```

Install the template then replace `api.example.com` with the real API hostname:

```bash
sudo install -m 0644 \
  /opt/noir-poker/deploy/oracle/Caddyfile.example \
  /etc/caddy/Caddyfile
sudoedit /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl enable --now caddy
sudo systemctl reload caddy
sudo systemctl status caddy --no-pager
```

Caddy obtains and renews TLS certificates and proxies WebSockets without custom upgrade headers.

Verify public HTTPS:

```bash
curl --fail https://api.example.com/health
```

Expected response:

```text
ok
```

## 11 Configure Vercel

Do not deploy Vercel from the Oracle VM. In the existing Vercel project set:

```text
NEXT_PUBLIC_SERVER_URL=https://api.example.com
NEXT_PUBLIC_AZTEC_NODE_URL=https://v5.testnet.rpc.aztec-labs.com
NEXT_PUBLIC_AZTEC_PLAY_CHIPS_ADDRESS=0xYOUR_PLAY_CHIPS_ADDRESS
```

These are public build-time values. Redeploy the existing frontend manually after setting them. No WebSocket variable is needed. The browser derives `wss://api.example.com/rooms/<room>/ws` from the HTTPS server origin.

To verify WSS use the existing website to create a room and inspect the table connection in browser developer tools under Network then WS. A valid room and seat token are required; there is no anonymous WebSocket health route.

## 12 Back up persistent state

Neon stores PostgreSQL data remotely. The Aztec wallet lives under `/var/lib/noir-poker/aztec-wallet`.

Before an OS or application migration:

```bash
sudo systemctl stop noir-poker
sudo install -d -m 0700 -o root -g root /var/backups/noir-poker
sudo bash -c '
  set -euo pipefail
  umask 077
  set -a
  source /etc/noir-poker/server.env
  set +a
  /usr/lib/postgresql/18/bin/pg_dump --format=custom "$DATABASE_URL" \
    > /var/backups/noir-poker/neon.dump
  tar -C /var/lib/noir-poker -czf - aztec-wallet \
    > /var/backups/noir-poker/aztec-wallet.tar.gz
'
sudo chmod 0600 /var/backups/noir-poker/neon.dump \
  /var/backups/noir-poker/aztec-wallet.tar.gz
sudo /usr/lib/postgresql/18/bin/pg_restore --list \
  /var/backups/noir-poker/neon.dump >/dev/null
sudo tar -tzf /var/backups/noir-poker/aztec-wallet.tar.gz >/dev/null
sudo systemctl start noir-poker
```

Store both archives outside the VM with restricted access. The wallet archive contains account secrets. Never commit it.

## 13 Update the application

Schedule updates when no game is active. Restarting during an unfinished encrypted hand follows the existing rollback-refund behavior and excludes that hand from recovery.

```bash
cd /opt/noir-poker
git status --short
./deploy/oracle/update.sh
```

The update script only fast-forwards `oracle-deploy`. It stops the service before changing the live Node dependencies or helper. It rebuilds pinned npm dependencies, ZK artifacts, and the Rust server then starts the service and checks health. It never changes PostgreSQL data, `/etc/noir-poker/server.env`, Caddy, PlayChips, or the Aztec wallet.

If a build fails the service stays stopped and the script prints the prior commit. Inspect the failure before choosing a manual rollback. The script never resets or overwrites operator work.

To restore the prior source after an update failure replace `OLD_SHA` with that printed commit. First inspect `git status`. Continue only when it is empty:

```bash
cd /opt/noir-poker
git status --short
git switch --detach OLD_SHA
npm --prefix aztec ci --omit=dev
npm --prefix apps/web ci --omit=dev
NARGO_PATH=/usr/local/bin/nargo BB_PATH=/usr/local/bin/bb ./scripts/build-zk.sh
cargo build --locked --release -p server
sudo systemctl start noir-poker
curl --fail http://127.0.0.1:3001/health
```

This recovery does not move or delete the deployment branch. Switch back to `oracle-deploy` only after the failed update has been corrected.

If fetched code changes `apps/server/migrations`, the script stops before merging. Back up PostgreSQL, inspect every new migration, fast-forward manually, build, then restart. The Rust server applies accepted migrations at startup.

## 14 Production test checklist

### Server

- `systemctl is-active noir-poker` reports `active`
- `systemctl restart noir-poker` succeeds
- the VM reboots and Noir Poker returns
- the Node helper check returns the same owner
- `bb --version` returns `5.2.0`
- the service connects to Neon PostgreSQL

### Persistence

- create a test room
- restart Noir Poker
- confirm a waiting room and a completed hand recover after reconnect
- restart during an unfinished encrypted hand and confirm the existing rollback refund is staged while that room is excluded from recovery
- confirm `/var/lib/noir-poker/aztec-wallet` remains populated
- confirm the server account remains unchanged
- confirm the PlayChips address remains unchanged

### HTTP and WebSocket

- `https://api.example.com/health` returns `ok`
- the browser reports no mixed-content error
- the Caddy certificate is valid
- a room connects through WSS
- the connection survives normal play
- two independent browsers can play together

### Aztec

- connect a browser wallet
- claim testnet Tajaderos
- create an Aztec room
- lock exactly 1,000 Tajaderos
- join with a second player
- confirm the server independently accepts both entries
- play legal poker actions
- finish the game
- confirm settlement submission
- confirm both final Tajadero balances
- confirm no second settlement occurs after restart

### Normal modes

- play Single Player
- play normal Multiplayer in two browsers
- confirm both modes look and behave exactly as before deployment

Do not call the deployment complete until the real Oracle ARM64 VM has passed this checklist.

## Troubleshooting

```bash
sudo systemctl status noir-poker --no-pager
sudo journalctl -u noir-poker -f
sudo systemctl status caddy --no-pager
sudo journalctl -u caddy -n 100 --no-pager
sudo -u noir-poker bash -c '
  set -a
  source /etc/noir-poker/server.env
  set +a
  psql "$DATABASE_URL" -c "select 1"
'
curl -v http://127.0.0.1:3001/health
curl -v https://api.example.com/health
```

An Aztec helper call has a 45 second server timeout. Check RPC reachability and the helper preflight before changing application code.
