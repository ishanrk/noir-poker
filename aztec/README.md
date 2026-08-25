# Noir Poker on Aztec

Aztec Poker uses private testnet credits named Tajaderos. Single Player and normal Multiplayer require no wallet and never use this contract.

Tajaderos have no monetary value. One Aztec account may claim 10,000 once. Every Aztec table locks 1,000 per player and uses fixed blinds of 5 and 10.

## Player flow

```text
Choose Aztec Poker
Connect a supported browser wallet
Match the official nine emoji secure channel fingerprint
Approve the requested account and contract capabilities
Claim 10,000 Tajaderos once
Create or join a room
Lock 1,000 Tajaderos
Wait for server entry confirmation
Play the shared authoritative poker game
Receive the final stack automatically after game completion
```

The wallet selector remembers only the preferred wallet provider. The browser keeps retry information and the poker seat capability in session storage. Neither value proves payment to the server.

## Admission boundary

The server reserves an admission before any Aztec transaction. The durable row binds:

```text
room
seat
Aztec account
table id
entry id
1,000 Tajaderos
room configuration
deal entropy
hashed poker seat token
```

The server then authorizes that exact entry through the contract-owner account. The browser calls private `enter_table` from the authorized Aztec account. The contract subtracts 1,000 Tajaderos and records the same table id entry id seat account and amount.

The browser cannot activate the seat by presenting its own receipt. The server queries the Aztec contract through `aztec/scripts/server.mjs` and checks every recorded field. Only a matching onchain entry moves the reserved admission into the normal `rooms` and `seats` records and exposes the room in memory.

An admission expires after 15 minutes while it remains reserved or authorized. The server checks the contract before cleanup. A paid entry is confirmed instead of discarded. An unpaid authorization is cancelled onchain before PostgreSQL marks it failed. Partial unique indexes then release the room seat and account for another reservation.

WebSocket authentication still uses the raw poker seat capability returned after confirmation. PostgreSQL stores only its SHA 256 hash. The Aztec account and entry remain bound to that seat for settlement.

## Contract

`PlayChips` is a narrow private credit contract. It has no user transfer purchase redemption withdrawal bridge price or yield path.

### Claim

`claim_private` creates a private 10,000 Tajadero balance for the caller. A public claimed flag prevents another claim by the same account.

### Entry

The contract owner authorizes one exact account seat amount and opaque entry id for one table. `enter_table` can consume only that authorization. The public entry record lets the server verify the binding without learning the player's remaining private balance.

The table id derives from the room UUID. Each entry id uses fresh server randomness and is unique in PostgreSQL and the contract.

### Settlement

The Rust poker server stages the six recipient slots and final stack payouts when the authoritative game reaches its terminal state. The same PostgreSQL transaction that records the terminal poker change inserts one `aztec_settlements` outbox row.

A background worker submits `settle_private`. The contract accepts only its owner and only one settlement for a table. It also requires total payouts to equal the recorded table pool. Zero-filled recipient slots support tables with fewer than six players.

The contract stores a Poseidon2 commitment over the table id and all six recipient and payout slots. The server helper recomputes that exact commitment before PostgreSQL marks the outbox row confirmed. A settled boolean alone is not enough.

The worker retries pending rows after transient failures and server restarts. It locks the outbox row so concurrent server processes cannot submit the same job. Settlement submission returns its transaction hash after node acceptance and PostgreSQL records it before confirmation polling. Recovery queries that exact transaction and the contract before any retry. The browser reports settlement pending until PostgreSQL records confirmation and then reports Tajaderos returned. No browser tab or manual claim controls settlement.

Aztec payout values are the final conserved poker stacks. Challenge proofs remain available in Aztec rooms but challenge scores never increase Tajadero payouts.

An encrypted deck that loses its live participant secrets cannot be replayed after restart. Startup inserts a refund settlement before room recovery and leaves that room out of memory. The refund returns the latest hand starting stacks and therefore rolls back the unfinished hand. The same settlement outbox and exact commitment checks process result and refund rows.

## Challenges and deck proofs

Aztec rooms reuse the normal human Multiplayer challenge protocol and verification pages. They use the same commitment draw proof completion proof and public history. No Aztec-specific challenge circuit exists.

The encrypted deck protocol also remains shared. Aztec handles private credits and settlement. It does not replace the deck shuffle proofs or make the contract verify poker actions.

## Environment

Node 24 or newer and the complete Aztec 5.2.0 toolchain are required. All Aztec application contract lockfile and generated artifact versions are pinned to `5.2.0`. The challenge circuit uses Noir `1.0.0-beta.26` while its Barretenberg verifier also uses `5.2.0`.

Browser values:

```text
NEXT_PUBLIC_AZTEC_NODE_URL
NEXT_PUBLIC_AZTEC_PLAY_CHIPS_ADDRESS
NEXT_PUBLIC_SERVER_URL
```

Server values:

```text
AZTEC_NODE_URL
AZTEC_PLAY_CHIPS_ADDRESS
AZTEC_SERVER_ACCOUNT
AZTEC_SERVER_WALLET_DIR
AZTEC_SPONSORED_FPC_ADDRESS
AZTEC_SERVER_HELPER optional
AZTEC_SERVER_NODE optional
```

The account named by `AZTEC_SERVER_ACCOUNT` must already exist in the embedded wallet directory and must own the deployed contract. The helper checks both conditions before the Rust listener starts. The server derives the Aztec 5.2.0 Sponsored FPC from the pinned artifact and official salt then requires `AZTEC_SPONSORED_FPC_ADDRESS` to match it. The browser derives the same instance for wallet transactions.

The Rust server also requires its normal `DATABASE_URL` `BB_PATH` and web-origin configuration.

## Build and validation

The normal web development and production builds consume committed generated browser artifacts. They do not compile the Aztec contract or install Aztec.

Regenerate explicitly with Aztec 5.2.0:

```bash
npm --prefix apps/web run aztec:generate
npm --prefix apps/web run aztec:check
```

Build and test the contract:

```bash
cd aztec
npm ci
npm run test:protocol
npm run build
```

Run the local integration against an already running Aztec local network:

```bash
cd aztec
npm run test:local
```

The local integration deploys the real contract with two accounts. It covers one-time claims owner-only authorization idempotent cancellation exact entry binding duplicate-seat rejection pool accounting owner-only settlement exact private balances Poseidon2 payout commitment and one-time settlement.

Deploy once with the pinned toolchain:

```bash
cd aztec
npm run deploy:testnet
```

The deploy script prints the public node URL and contract address required by the web application. The server must use the same node contract and owner wallet.

## Current limits

- The contract proves that an entry locked the configured amount for the authorized account and seat. It does not verify poker rules or final stack calculation onchain.
- The contract owner can withhold settlement or submit another pool-conserving allocation outside this server. The stored Poseidon2 commitment detects a mismatch with the durable server allocation but does not prove the poker rules that produced it.
- A live participant can stop sending encrypted deck messages. The current server has no in-process timeout for forfeit or refund. Restart stages a rollback refund because the private shuffle material cannot be reconstructed.
- A confirmed player waiting for the room to fill has no leave or refund path. Repeated unauthenticated reservations can also hold room seats for 15-minute windows and spend server authorization work.
- The public entry record exposes the Aztec account table seat and locked amount. Remaining balance and returned payout notes stay private.
- Server startup requires the Aztec node and owner wallet when unfinished admissions unsettled Aztec rooms refunds or pending settlements need that boundary. Settled historical rooms alone do not.
- The wallet provider must support the Aztec 5.2.0 secure-channel and capability APIs. A missing or rejected wallet blocks Aztec mode only.
- This repository has protocol and persistence tests. A real public testnet run still depends on external wallet node contract deployment and fee-payer availability.
