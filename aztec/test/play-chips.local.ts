import assert from "node:assert/strict";

import { getInitialTestAccountsData } from "@aztec/accounts/testing";
import { Fr } from "@aztec/aztec.js/fields";
import { createAztecNodeClient, waitForNode } from "@aztec/aztec.js/node";
import { EmbeddedWallet } from "@aztec/wallets/embedded";

import { PlayChipsContract } from "../artifacts/PlayChips.js";

const nodeUrl = process.env.AZTEC_NODE_URL ?? "http://127.0.0.1:8080";
const node = createAztecNodeClient(nodeUrl);

await waitForNode(node);

const wallet = await EmbeddedWallet.create(node, { ephemeral: true });
const accounts = await getInitialTestAccountsData();
const [alice, bob] = await Promise.all(
  accounts.slice(0, 2).map(async (account) => {
    return (
      await wallet.createSchnorrInitializerlessAccount(
        account.secret,
        account.salt,
        account.signingKey,
      )
    ).address;
  }),
);

const { contract } = await PlayChipsContract.deploy(wallet).send({ from: alice });

const { result: owner } = await contract.methods.contract_owner().simulate({ from: alice });
assert.equal(owner.toString(), alice.toString());

const { result: faucetAmount } = await contract.methods.faucet_amount().simulate({ from: alice });
assert.equal(faucetAmount, 10_000n);

await contract.methods.claim_private().send({ from: alice });
await contract.methods.claim_private().send({ from: bob });

const balanceOf = async (account: typeof alice) => {
  const { result } = await contract.methods.private_balance_of(account).simulate({ from: account });
  return result;
};

assert.equal(await balanceOf(alice), 10_000n);
assert.equal(await balanceOf(bob), 10_000n);

await assert.rejects(contract.methods.claim_private().simulate({ from: alice }));

const tableId = new Fr(7001n);
const aliceEntry = new Fr(7101n);
const bobEntry = new Fr(7102n);
const extraEntry = new Fr(7103n);
const sameSeatEntry = new Fr(7104n);

await assert.rejects(
  contract.methods.authorize_entry(tableId, aliceEntry, 0, alice, 1_000n).simulate({ from: bob }),
);
await contract.methods.authorize_entry(tableId, aliceEntry, 0, alice, 1_000n).send({ from: alice });
await contract.methods.authorize_entry(tableId, bobEntry, 1, bob, 1_000n).send({ from: alice });

await assert.rejects(
  contract.methods.authorize_entry(tableId, sameSeatEntry, 0, bob, 1_000n).simulate({ from: alice }),
);
await assert.rejects(
  contract.methods.authorize_entry(tableId, aliceEntry, 0, alice, 1_000n).simulate({ from: alice }),
);
await assert.rejects(
  contract.methods.enter_table(tableId, extraEntry, 2, 1_000n).simulate({ from: alice }),
);
await assert.rejects(
  contract.methods.enter_table(tableId, aliceEntry, 0, 1_000n).simulate({ from: bob }),
);
await assert.rejects(
  contract.methods.enter_table(tableId, aliceEntry, 1, 1_000n).simulate({ from: alice }),
);
await assert.rejects(
  contract.methods.enter_table(tableId, aliceEntry, 0, 900n).simulate({ from: alice }),
);
await assert.rejects(
  contract.methods.enter_table(new Fr(7002n), aliceEntry, 0, 1_000n).simulate({ from: alice }),
);

await contract.methods.enter_table(tableId, aliceEntry, 0, 1_000n).send({ from: alice });
await contract.methods.enter_table(tableId, bobEntry, 1, 1_000n).send({ from: bob });

await assert.rejects(
  contract.methods.enter_table(tableId, aliceEntry, 0, 1_000n).simulate({ from: alice }),
);

assert.equal(await balanceOf(alice), 9_000n);
assert.equal(await balanceOf(bob), 9_000n);

for (const [entryId, account, seat] of [
  [aliceEntry, alice, 0],
  [bobEntry, bob, 1],
] as const) {
  const { result: exists } = await contract.methods.entry_exists(entryId).simulate({ from: alice });
  const { result: entryTable } = await contract.methods.entry_table_of(entryId).simulate({ from: alice });
  const { result: entryAccount } = await contract.methods.entry_account_of(entryId).simulate({ from: alice });
  const { result: entrySeat } = await contract.methods.entry_seat_of(entryId).simulate({ from: alice });
  const { result: entryAmount } = await contract.methods.entry_amount_of(entryId).simulate({ from: alice });

  assert.equal(exists, true);
  assert.equal(String(entryTable), tableId.toBigInt().toString());
  assert.equal(entryAccount.toString(), account.toString());
  assert.equal(entrySeat, seat);
  assert.equal(entryAmount, 1_000n);
}

const { result: pool } = await contract.methods.table_pool_of(tableId).simulate({ from: alice });
assert.equal(pool, 2_000n);
await assert.rejects(
  contract.methods.enter_table(tableId, extraEntry, 2, 100n).simulate({ from: alice }),
);
const { result: unchangedPool } = await contract.methods.table_pool_of(tableId).simulate({ from: alice });
assert.equal(unchangedPool, 2_000n);

const recipients = [alice, bob, alice, alice, alice, alice];
const payouts = [1_500n, 500n, 0n, 0n, 0n, 0n];

await assert.rejects(
  contract.methods.settle_private(tableId, recipients, payouts).simulate({ from: bob }),
);

await contract.methods.settle_private(tableId, recipients, payouts).send({ from: alice });

assert.equal(await balanceOf(alice), 10_500n);
assert.equal(await balanceOf(bob), 9_500n);

const { result: settled } = await contract.methods.table_is_settled(tableId).simulate({ from: alice });
assert.equal(settled, true);

await assert.rejects(
  contract.methods.settle_private(tableId, recipients, payouts).simulate({ from: alice }),
);
await assert.rejects(
  contract.methods.authorize_entry(tableId, extraEntry, 2, alice, 100n).simulate({ from: alice }),
);

console.log("play chips local integration passed");
