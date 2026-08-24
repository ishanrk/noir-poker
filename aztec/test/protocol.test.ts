import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../play_chips_contract/src/main.nr", import.meta.url),
  "utf8",
);
const manifest = await readFile(
  new URL("../play_chips_contract/Nargo.toml", import.meta.url),
  "utf8",
);
const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
) as { dependencies: Record<string, string> };

test("play chips expose no user transfer or redemption path", () => {
  for (const forbidden of [
    "transfer_private",
    "transfer_public",
    "private_to_public",
    "public_to_private",
    "redeem",
    "withdraw",
    "bridge",
  ]) {
    assert.equal(source.includes(`fn ${forbidden}`), false, forbidden);
  }

  assert.equal(source.includes("public_balances"), false);
});

test("play chips are limited to faucet table entry and settlement", () => {
  for (const required of [
    "fn claim_private()",
    "fn authorize_entry(",
    "fn cancel_entry(entry_id: Field)",
    "fn enter_table(table_id: Field, entry_id: Field, seat: u32, amount: u64)",
    "fn settle_private(",
    "fn entry_is_authorized(entry_id: Field)",
    "fn entry_table_of(entry_id: Field)",
    "fn entry_account_of(entry_id: Field)",
    "fn entry_seat_of(entry_id: Field)",
    "fn entry_amount_of(entry_id: Field)",
    "fn table_pool_of(table_id: Field)",
    "fn table_is_settled(table_id: Field)",
    "fn table_settlement_of(table_id: Field)",
  ]) {
    assert.equal(source.includes(required), true, required);
  }

  assert.match(source, /assert_eq\(total, self\.storage\.table_pool\.at\(table_id\)\.read\(\)/);
  assert.match(source, /assert_eq\(caller, self\.storage\.owner\.read\(\)/);
  assert.match(source, /assert_eq\(self\.msg_sender\(\), self\.storage\.owner\.read\(\)/);
  assert.match(source, /assert\(\(seats & seat_bit\) == 0, "Seat already entered"\)/);
  assert.match(source, /assert\(self\.storage\.entry_authorized\.at\(entry_id\)\.read\(\)/);
  assert.match(source, /assert_eq\(table_id, self\.storage\.entry_tables\.at\(entry_id\)\.read\(\)/);
  assert.match(source, /assert_eq\(account, self\.storage\.entry_accounts\.at\(entry_id\)\.read\(\)/);
  assert.match(source, /assert_eq\(seat, self\.storage\.entry_seats\.at\(entry_id\)\.read\(\)/);
  assert.match(source, /assert_eq\(amount, self\.storage\.entry_amounts\.at\(entry_id\)\.read\(\)/);
  assert.match(source, /assert\(!self\.storage\.entries\.at\(entry_id\)\.read\(\)/);
  assert.match(source, /assert\(!self\.storage\.table_settled\.at\(table_id\)\.read\(\)/);
  assert.match(source, /poseidon2_hash_with_separator\(values, SETTLEMENT_DOMAIN\)/);
  assert.match(source, /self\.storage\.table_settlements\.at\(table_id\)\.write\(settlement\)/);
});

test("contract and client tooling match the live testnet release", () => {
  assert.match(manifest, /tag = "v5\.2\.0"/);
  assert.equal(packageJson.dependencies["@aztec/accounts"], "5.2.0");
  assert.equal(packageJson.dependencies["@aztec/aztec.js"], "5.2.0");
  assert.equal(packageJson.dependencies["@aztec/foundation"], "5.2.0");
  assert.equal(packageJson.dependencies["@aztec/wallets"], "5.2.0");
});
