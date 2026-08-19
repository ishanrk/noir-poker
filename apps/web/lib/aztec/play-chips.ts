import { AztecAddress } from "@aztec/aztec.js/addresses";
import { Fr } from "@aztec/aztec.js/fields";
import type { Wallet } from "@aztec/aztec.js/wallet";

import {
  PlayChipsContract,
  PlayChipsContractArtifact,
} from "./artifacts/PlayChips";
import { requirePlayChipsAddress } from "./config";
import { sponsoredFeePayment } from "./fees";

export type PlayChips = PlayChipsContract;

export async function attachPlayChips(wallet: Wallet) {
  const address = AztecAddress.fromString(requirePlayChipsAddress());
  const metadata = await wallet.getContractMetadata(address);

  if (!metadata.instance) {
    throw new Error("play chips contract is not deployed on the configured Aztec network");
  }

  await wallet.registerContract(metadata.instance, PlayChipsContractArtifact);
  return PlayChipsContract.at(address, wallet);
}

export async function playChipBalance(
  contract: PlayChips,
  account: AztecAddress,
) {
  const { result } = await contract.methods
    .private_balance_of(account)
    .simulate({ from: account });

  return result;
}

export async function hasClaimedPlayChips(
  contract: PlayChips,
  account: AztecAddress,
) {
  const { result } = await contract.methods
    .has_claimed(account)
    .simulate({ from: account });

  return result;
}

export async function claimPlayChips(
  contract: PlayChips,
  account: AztecAddress,
) {
  const paymentMethod = await sponsoredFeePayment();

  return contract.methods.claim_private().send({
    from: account,
    fee: { paymentMethod },
  });
}

export async function enterPlayChipTable(
  contract: PlayChips,
  account: AztecAddress,
  tableId: bigint,
  entryId: bigint,
  amount: bigint,
) {
  if (amount <= 0n || amount > 0xffff_ffff_ffff_ffffn) {
    throw new Error("invalid play chip buy-in");
  }

  const paymentMethod = await sponsoredFeePayment();

  return contract.methods
    .enter_table(new Fr(tableId), new Fr(entryId), amount)
    .send({ from: account, fee: { paymentMethod } });
}

export async function playChipEntry(
  contract: PlayChips,
  account: AztecAddress,
  entryId: bigint,
) {
  const field = new Fr(entryId);
  const [{ result: exists }, { result: tableId }, { result: amount }] =
    await Promise.all([
      contract.methods.entry_exists(field).simulate({ from: account }),
      contract.methods.entry_table_of(field).simulate({ from: account }),
      contract.methods.entry_amount_of(field).simulate({ from: account }),
    ]);

  return {
    exists,
    tableId: tableId.toBigInt(),
    amount,
  };
}
