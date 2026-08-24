import { AztecAddress } from "@aztec/aztec.js/addresses";
import { NO_WAIT } from "@aztec/aztec.js/contracts";
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee";
import { Fr } from "@aztec/aztec.js/fields";
import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { TxHash } from "@aztec/aztec.js/tx";
import { EmbeddedWallet } from "@aztec/wallets/embedded";
import { poseidon2HashWithSeparator } from "@aztec/foundation/crypto/poseidon";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  PlayChipsContract,
  PlayChipsContractArtifact,
} from "../../apps/web/lib/aztec/artifacts/PlayChips.ts";

const FIELD = /^0x[0-9a-fA-F]{62,64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{64}$/;
const U64_MAX = 0xffff_ffff_ffff_ffffn;
const SETTLEMENT_DOMAIN = 17_731;

function env(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} missing`);
  }

  return value;
}

function text(value, name, pattern) {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new Error(`invalid ${name}`);
  }

  return value;
}

function field(value, name) {
  return Fr.fromString(text(value, name, FIELD));
}

async function address(value, name, zero = false) {
  const raw = text(value, name, ADDRESS);
  const result = AztecAddress.fromStringUnsafe(raw);
  if ((!zero || BigInt(raw) !== 0n) && !(await result.isValid())) {
    throw new Error(`invalid ${name}`);
  }
  return result;
}

function amount(value, name, zero = false) {
  if (typeof value !== "string" || !/^[0-9]+$/.test(value)) {
    throw new Error(`invalid ${name}`);
  }

  const result = BigInt(value);
  if (result > U64_MAX || (!zero && result === 0n)) {
    throw new Error(`invalid ${name}`);
  }

  return result;
}

function seat(value) {
  if (!Number.isInteger(value) || value < 0 || value > 5) {
    throw new Error("invalid seat");
  }

  return value;
}

function fieldText(value) {
  const raw = BigInt(String(value));
  return `0x${raw.toString(16).padStart(64, "0")}`;
}

async function sendOptions(owner) {
  const fpc = process.env.AZTEC_SPONSORED_FPC_ADDRESS;

  if (!fpc) {
    return { from: owner };
  }

  return {
    from: owner,
    fee: { paymentMethod: new SponsoredFeePaymentMethod(await address(fpc, "fee contract")) },
  };
}

async function connect() {
  const node = env("AZTEC_NODE_URL");
  const contractAddress = await address(env("AZTEC_PLAY_CHIPS_ADDRESS"), "contract address");
  const owner = await address(env("AZTEC_SERVER_ACCOUNT"), "server account");
  const dataDirectory = process.env.AZTEC_SERVER_WALLET_DIR ?? join(homedir(), ".aztec", "wallet");
  const wallet = await EmbeddedWallet.create(node, { pxe: { dataDirectory } });
  const accounts = await wallet.getAccounts();

  if (!accounts.some(({ item }) => item.equals(owner))) {
    await wallet.stop();
    throw new Error("server account missing from wallet");
  }

  const metadata = await wallet.getContractMetadata(contractAddress);
  if (!metadata.instance) {
    await wallet.stop();
    throw new Error("play chips contract missing");
  }

  await wallet.registerContract(metadata.instance, PlayChipsContractArtifact);
  const contract = PlayChipsContract.at(contractAddress, wallet);
  const { result: contractOwner } = await contract.methods.contract_owner().simulate({ from: owner });

  if (!contractOwner.equals(owner)) {
    await wallet.stop();
    throw new Error("server account not contract owner");
  }

  return { wallet, contract, owner };
}

async function entry(contract, owner, request) {
  const entryId = field(request.entry_id, "entry id");
  const expectedTable = field(request.table_id, "table id");
  const expectedAccount = await address(request.account, "account");
  const expectedSeat = seat(request.seat);
  const expectedAmount = amount(request.amount, "amount");
  const [exists, allowed, tableId, accountId, seatId, entryAmount] = await Promise.all([
    contract.methods.entry_exists(entryId).simulate({ from: owner }),
    contract.methods.entry_is_authorized(entryId).simulate({ from: owner }),
    contract.methods.entry_table_of(entryId).simulate({ from: owner }),
    contract.methods.entry_account_of(entryId).simulate({ from: owner }),
    contract.methods.entry_seat_of(entryId).simulate({ from: owner }),
    contract.methods.entry_amount_of(entryId).simulate({ from: owner }),
  ]);
  const found = {
    exists: exists.result,
    table_id: fieldText(tableId.result),
    account: accountId.result.toString(),
    seat: Number(seatId.result),
    amount: entryAmount.result.toString(),
  };

  const matches =
    BigInt(found.table_id) === expectedTable.toBigInt() &&
    found.account.toLowerCase() === expectedAccount.toString().toLowerCase() &&
    found.seat === expectedSeat &&
    BigInt(found.amount) === expectedAmount;

  return {
    ...found,
    authorized: allowed.result && matches,
    matches: found.exists && matches,
  };
}

async function authorized(contract, owner, request) {
  const entryId = field(request.entry_id, "entry id");
  const expectedTable = field(request.table_id, "table id");
  const expectedAccount = await address(request.account, "account");
  const expectedSeat = seat(request.seat);
  const expectedAmount = amount(request.amount, "amount");
  const [allowed, tableId, accountId, seatId, entryAmount] = await Promise.all([
    contract.methods.entry_is_authorized(entryId).simulate({ from: owner }),
    contract.methods.entry_table_of(entryId).simulate({ from: owner }),
    contract.methods.entry_account_of(entryId).simulate({ from: owner }),
    contract.methods.entry_seat_of(entryId).simulate({ from: owner }),
    contract.methods.entry_amount_of(entryId).simulate({ from: owner }),
  ]);

  if (!allowed.result) {
    return false;
  }

  const matches =
    BigInt(String(tableId.result)) === expectedTable.toBigInt() &&
    accountId.result.toString().toLowerCase() === expectedAccount.toString().toLowerCase() &&
    Number(seatId.result) === expectedSeat &&
    entryAmount.result === expectedAmount;

  if (!matches) {
    throw new Error("entry authorization mismatch");
  }

  return true;
}

async function run(request, contract, owner) {
  switch (request.op) {
    case "check":
      return { owner: owner.toString() };
    case "authorize": {
      if (await authorized(contract, owner, request)) {
        return { existing: true, tx: null };
      }

      const result = await contract.methods
        .authorize_entry(
          field(request.table_id, "table id"),
          field(request.entry_id, "entry id"),
          seat(request.seat),
          await address(request.account, "account"),
          amount(request.amount, "amount"),
        )
        .send(await sendOptions(owner));

      return { existing: false, tx: result.receipt.txHash.toString() };
    }
    case "authorized":
      return { authorized: await authorized(contract, owner, request) };
    case "cancel": {
      const result = await contract.methods
        .cancel_entry(field(request.entry_id, "entry id"))
        .send(await sendOptions(owner));
      return { tx: result.receipt.txHash.toString() };
    }
    case "entry":
      return entry(contract, owner, request);
    case "settle": {
      if (!Array.isArray(request.recipients) || request.recipients.length !== 6) {
        throw new Error("invalid recipients");
      }
      if (!Array.isArray(request.payouts) || request.payouts.length !== 6) {
        throw new Error("invalid payouts");
      }

      const payouts = request.payouts.map((value) => amount(value, "payout", true));
      const recipients = await Promise.all(
        request.recipients.map((value, index) =>
          address(value, "recipient", payouts[index] === 0n),
        ),
      );
      const result = await contract.methods
        .settle_private(
          field(request.table_id, "table id"),
          recipients,
          payouts,
        )
        .send({ ...(await sendOptions(owner)), wait: NO_WAIT });

      return { tx: result.toString() };
    }
    case "settlement": {
      if (!Array.isArray(request.recipients) || request.recipients.length !== 6) {
        throw new Error("invalid recipients");
      }
      if (!Array.isArray(request.payouts) || request.payouts.length !== 6) {
        throw new Error("invalid payouts");
      }

      const tableId = field(request.table_id, "table id");
      const payouts = request.payouts.map((value) => amount(value, "payout", true));
      const recipients = await Promise.all(
        request.recipients.map((value, index) =>
          address(value, "recipient", payouts[index] === 0n),
        ),
      );
      const [{ result: settled }, { result: recorded }] = await Promise.all([
        contract.methods.table_is_settled(tableId).simulate({ from: owner }),
        contract.methods.table_settlement_of(tableId).simulate({ from: owner }),
      ]);
      const expected = await poseidon2HashWithSeparator(
        [tableId, ...recipients, ...payouts],
        SETTLEMENT_DOMAIN,
      );
      if (settled && BigInt(String(recorded)) !== expected.toBigInt()) {
        throw new Error("settlement does not match durable payouts");
      }

      let retry = false;
      if (!settled && request.tx_hash !== null && request.tx_hash !== undefined) {
        const txHash = TxHash.fromString(text(request.tx_hash, "transaction hash", FIELD));
        const receipt = await createAztecNodeClient(env("AZTEC_NODE_URL")).getTxReceipt(txHash);
        retry = receipt.isDropped() || receipt.hasExecutionReverted();
      }

      return { settled, commitment: fieldText(recorded), retry };
    }
    default:
      throw new Error("invalid aztec operation");
  }
}

let wallet;

try {
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
  }

  const request = JSON.parse(input);
  const connected = await connect();
  wallet = connected.wallet;
  const result = await run(request, connected.contract, connected.owner);
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(error instanceof Error ? error.message : "aztec helper failed");
  process.exitCode = 1;
} finally {
  await wallet?.stop();
}
