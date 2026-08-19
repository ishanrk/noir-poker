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

await contract.methods.enter_table(tableId, aliceEntry, 1_000n).send({ from: alice });
await contract.methods.enter_table(tableId, bobEntry, 1_000n).send({ from: bob });

assert.equal(await balanceOf(alice), 9_000n);
assert.equal(await balanceOf(bob), 9_000n);

for (const [entryId, amount] of [
  [aliceEntry, 1_000n],
  [bobEntry, 1_000n],
] as const) {
  const { result: exists } = await contract.methods.entry_exists(entryId).simulate({ from: alice });
  const { result: entryTable } = await contract.methods.entry_table_of(entryId).simulate({ from: alice });
  const { result: entryAmount } = await contract.methods.entry_amount_of(entryId).simulate({ from: alice });

  assert.equal(exists, true);
  assert.equal(entryTable.toString(), tableId.toString());
  assert.equal(entryAmount, amount);
}

const { result: pool } = await contract.methods.table_pool_of(tableId).simulate({ from: alice });
assert.equal(pool, 2_000n);

const recipients = [alice, bob, alice, alice, alice, alice] as const;
const payouts = [1_500n, 500n, 0n, 0n, 0n, 0n] as const;

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
  contract.methods.enter_table(tableId, new Fr(7103n), 100n).simulate({ from: alice }),
);

console.log("play chips local integration passed");
