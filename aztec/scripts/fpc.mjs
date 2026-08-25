import {
  getContractInstanceFromInstantiationParams,
} from "@aztec/aztec.js/contracts";
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee";
import { Fr } from "@aztec/aztec.js/fields";
import { SPONSORED_FPC_SALT } from "@aztec/constants";
import { SponsoredFPCContractArtifact } from "@aztec/noir-contracts.js/SponsoredFPC";

const ADDRESS = /^0x[0-9a-fA-F]{64}$/;
const INSTANCE_FIELDS = [
  "version",
  "salt",
  "deployer",
  "originalContractClassId",
  "initializationHash",
  "immutablesHash",
  "publicKeys",
];

export async function deriveSponsoredFpc(configured) {
  if (typeof configured !== "string" || !ADDRESS.test(configured)) {
    throw new Error("invalid sponsored fpc address");
  }

  const instance = await getContractInstanceFromInstantiationParams(
    SponsoredFPCContractArtifact,
    { salt: new Fr(SPONSORED_FPC_SALT) },
  );

  if (instance.address.toString().toLowerCase() !== configured.toLowerCase()) {
    throw new Error(
      `sponsored fpc mismatch expected ${instance.address.toString()} got ${configured}`,
    );
  }

  return instance;
}

export async function registerSponsoredFpc(wallet, node, configured) {
  const instance = await deriveSponsoredFpc(configured);
  const live = await node.getContract(instance.address);

  if (!live) {
    throw new Error("sponsored fpc missing from network");
  }

  if (
    !live.currentContractClassId.equals(instance.currentContractClassId) ||
    INSTANCE_FIELDS.some((name) => String(live[name]) !== String(instance[name]))
  ) {
    throw new Error("sponsored fpc does not match pinned artifact");
  }

  await wallet.registerContract(instance, SponsoredFPCContractArtifact);

  return {
    address: instance.address,
    paymentMethod: new SponsoredFeePaymentMethod(instance.address),
  };
}
