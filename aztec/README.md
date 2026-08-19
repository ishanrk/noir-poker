# Aztec PLAY

This branch adds an optional Aztec mode without changing normal Noir Poker.

Normal mode uses the existing in-game chips and requires no wallet. Aztec mode uses private testnet PLAY held by the player's Aztec account.

## Player flow

```text
Choose Aztec
Connect Aztec
Approve the wallet connection
Claim 10,000 PLAY once
Create or join a table
Lock 1,000 PLAY
Play the existing poker game
```

The first connection includes Aztec's secure-channel and emoji checks. The selected wallet is remembered locally, so later visits can reconnect with less interaction. All ordinary testnet transactions use the Sponsored FPC.

No CLI, secret key or deployment setting is exposed to players.

## PLAY contract

`PlayChips` is a custom game-credit contract rather than a general token.

Each account may claim one private balance of 10,000 PLAY. PLAY can leave an account only through `enter_table`. PLAY can return only through owner-authorized settlement. The contract has no user transfer, purchase, redemption, withdrawal or bridge function.

### Claim

1. The wallet grants Noir Poker access to one account.
2. `claim_private` enqueues a public one-time claim record.
3. The private function creates a 10,000 PLAY note owned by that account.

The private balance is visible to the account wallet. The public claim flag prevents repeat claims.

### Table entry

The browser derives:

```text
table_id = SHA256("NOIR_POKER_TABLE_V1" || room_uuid)[0..31]
entry_id = SHA256("NOIR_POKER_ENTRY_V1" || table_id || seat || nonce)[0..31]
```

`enter_table` subtracts the buy-in from the player's private balance. A self-enqueued public call records only the opaque entry id, table id and amount.

The default Aztec table uses:

```text
buy-in  1,000 PLAY
blinds  5 / 10
```

### Settlement

The Rust engine computes final stacks. The contract owner may submit up to six recipients and payouts. Settlement succeeds only when:

- the caller is the contract owner;
- the table has not already settled;
- total payouts equal the recorded table pool.

The contract then creates private payout notes.

## Local validation

Install Node 24 and Aztec 5.1.0:

```bash
VERSION=5.1.0 bash -i <(curl -fsSL https://install.aztec.network/5.1.0)
```

Compile and test the contract:

```bash
cd aztec
npm install
npm run test:protocol
npm run build
```

Start a local Aztec network in another terminal:

```bash
aztec start --local-network
```

Then run:

```bash
cd aztec
npm run test:local
```

The integration test deploys `PlayChips`, connects two local accounts, claims private balances, records two buy-ins, rejects repeat claims and unauthorized settlement, settles the exact pool and checks final private balances.

## Testnet deployment

Deploy once with sponsored fees:

```bash
cd aztec
npm run deploy:testnet
```

The script prints:

```text
NEXT_PUBLIC_AZTEC_NODE_URL
NEXT_PUBLIC_AZTEC_PLAY_CHIPS_ADDRESS
```

Add both values to the Vercel environment for this branch and redeploy. The deployer account remains in the local `aztec-wallet` keystore.

## Current trust boundary

The private account, balance, faucet and table-entry transaction are real Aztec operations. The current browser verifies the recorded entry before opening the table.

The Rust server does not yet query Aztec independently before accepting the seat, and it does not yet submit settlement automatically when a table closes. A complete production Aztec mode still requires those two server integrations. Until then, this branch is a working wallet and contract vertical slice rather than fully enforced Aztec poker settlement.
