import { getContractInstanceFromInstantiationParams } from "@aztec/aztec.js/contracts";
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee";
import { Fr } from "@aztec/aztec.js/fields";
import { SPONSORED_FPC_SALT } from "@aztec/constants";

export async function sponsoredFeePayment() {
  const { SponsoredFPCContractArtifact } = await import(
    "@aztec/noir-contracts.js/SponsoredFPC"
  );
  const instance = await getContractInstanceFromInstantiationParams(
    SponsoredFPCContractArtifact,
    { salt: new Fr(SPONSORED_FPC_SALT) },
  );

  return new SponsoredFeePaymentMethod(instance.address);
}
