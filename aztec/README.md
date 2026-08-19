# Aztec play chips

This directory contains the first Aztec integration for Noir Poker.

`PlayChips` is a custom game-credit contract, not a general token. Each Aztec account can claim one private balance of 10,000 chips. Chips can leave an account only through `enter_table`; they can return only through owner-authorized table settlement. The contract contains no user transfer, purchase, redemption, withdrawal or bridge function.

## Protocol

### Claim

1. The player connects an Aztec wallet through the wallet-extension protocol.
2. The wallet approves account, contract, simulation and transaction capabilities.
3. `claim_private` records the account's one-time public claim flag.
4. The contract creates a private 10,000-chip balance note owned by that account.

The public state reveals that an address used its claim. It does not reveal the private balance note.

### Table entry

1. Noir Poker derives `table_id = SHA256("NOIR_POKER_TABLE_V1" || room_uuid)[0..31]`.
2. The browser creates a fresh 32-byte nonce.
3. It derives `entry_id = SHA256("NOIR_POKER_ENTRY_V1" || table_id || seat || nonce)[0..31]`.
4. `enter_table` privately subtracts the buy-in from the player's balance.
5. A self-enqueued public call records only `entry_id`, `table_id` and `amount`.

The entry id is an opaque receipt. It does not publish the player's address or remaining balance. A future Rust admission adapter can accept the entry id and independently query the public contract record before seating the player.

### Settlement

1. The Rust game computes final stacks using the existing poker engine.
2. The contract owner submits up to six recipient addresses and payouts.
3. The public settlement call checks that the caller is the owner, that the table has not settled and that payouts exactly equal the recorded pool.
4. The private call creates payout notes for the recipients.

The contract cannot create extra chips during settlement and cannot settle a table twice.

## Local validation

Install Node 24 and Aztec 5.2.0, then run:

```bash
cd aztec
npm install
npm run test:protocol
npm run build
```

Start a local network in another terminal:

```bash
aztec start --local-network
```

Then run:

```bash
cd aztec
npm run test:local
```

The integration test deploys the contract, imports two prefunded local accounts, claims private balances, enters a table, rejects duplicate claims and unauthorized settlement, settles the exact pool, and checks final private balances.

## Testnet deployment

Install the matching toolchain:

```bash
VERSION=5.2.0 bash -i <(curl -fsSL https://install.aztec.network/5.2.0)
```

Deploy with sponsored testnet fees:

```bash
cd aztec
npm run deploy:testnet
```

The script registers the canonical Sponsored FPC, creates a testnet account when the configured alias does not exist, deploys `PlayChips`, and prints the two Vercel variables:

```text
NEXT_PUBLIC_AZTEC_NODE_URL
NEXT_PUBLIC_AZTEC_PLAY_CHIPS_ADDRESS
```

The account secret and salt remain in the local `aztec-wallet` keystore. They are never placed in the repository or frontend environment.

## Current boundary

This branch implements the complete Aztec contract, wallet connection, private faucet, table-entry receipt and owner-settlement protocol. It deliberately does not let the Rust server trust a browser-supplied receipt. Enforcing Aztec buy-ins in public multiplayer requires a read-only admission adapter that queries `entry_exists`, `entry_table_of` and `entry_amount_of` from the network before accepting the seat. That adapter is the next isolated integration step.
