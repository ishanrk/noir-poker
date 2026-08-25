import { getContractInstanceFromInstantiationParams } from "@aztec/aztec.js/contracts";
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee";
import { Fr } from "@aztec/aztec.js/fields";
import type { Wallet } from "@aztec/aztec.js/wallet";
import { SPONSORED_FPC_SALT } from "@aztec/constants";

async function sponsoredFpc() {
  const { SponsoredFPCContractArtifact } = await import(
    "@aztec/noir-contracts.js/SponsoredFPC"
  );
  const instance = await getContractInstanceFromInstantiationParams(
    SponsoredFPCContractArtifact,
    { salt: new Fr(SPONSORED_FPC_SALT) },
  );

  return { artifact: SponsoredFPCContractArtifact, instance };
}

export async function registerSponsoredFpc(wallet: Wallet) {
  const fpc = await sponsoredFpc();
  await wallet.registerContract(fpc.instance, fpc.artifact);
}

export async function sponsoredFeePayment() {
  const fpc = await sponsoredFpc();
  return new SponsoredFeePaymentMethod(fpc.instance.address);
}
