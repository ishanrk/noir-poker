import { NO_FROM } from "@aztec/aztec.js/account";
import {
  getContractClassFromArtifact,
} from "@aztec/aztec.js/contracts";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import { Fr, GrumpkinScalar } from "@aztec/aztec.js/fields";
import { createAztecNodeClient, waitForNode } from "@aztec/aztec.js/node";
import { ContractInitializationStatus } from "@aztec/aztec.js/wallet";
import { EmbeddedWallet } from "@aztec/wallets/embedded";

import {
  PlayChipsContract,
  PlayChipsContractArtifact,
} from "../../apps/web/lib/aztec/artifacts/PlayChips.ts";
import { registerSponsoredFpc } from "./fpc.mjs";

const ADDRESS = /^0x[0-9a-fA-F]{64}$/;

function env(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} missing`);
  }

  return value;
}

function optionalAddress(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    return undefined;
  }
  if (!ADDRESS.test(value)) {
    throw new Error(`invalid ${name}`);
  }

  return AztecAddress.fromStringUnsafe(value);
}

async function storedManager(wallet, account) {
  const saved = await wallet.walletDB.retrieveAccount(account);

  if (saved.type !== "schnorr") {
    throw new Error("server account must use schnorr");
  }

  return wallet.createAccountInternal(
    saved.type,
    saved.secretKey,
    saved.salt,
    saved.signingKey,
  );
}

async function accountInitialized(wallet, account) {
  const metadata = await wallet.getContractMetadata(account);
  return metadata.initializationStatus === ContractInitializationStatus.INITIALIZED;
}

async function requirePlayChips(node, wallet, address, owner) {
  const live = await node.getContract(address);

  if (!live) {
    return undefined;
  }

  const expected = await getContractClassFromArtifact(PlayChipsContractArtifact);
  if (!live.currentContractClassId.equals(expected.id)) {
    throw new Error("configured contract does not match PlayChips");
  }

  await wallet.registerContract(live, PlayChipsContractArtifact);
  const contract = PlayChipsContract.at(address, wallet);
  const { result: contractOwner } = await contract.methods
    .contract_owner()
    .simulate({ from: owner });

  if (!contractOwner.equals(owner)) {
    throw new Error("PlayChips owner does not match server account");
  }

  return contract;
}

const nodeUrl = env("AZTEC_NODE_URL");
const dataDirectory = env("AZTEC_SERVER_WALLET_DIR");
const configuredFpc = env("AZTEC_SPONSORED_FPC_ADDRESS");
const configuredAccount = optionalAddress("AZTEC_SERVER_ACCOUNT");
const configuredContract = optionalAddress("AZTEC_PLAY_CHIPS_ADDRESS");
const node = createAztecNodeClient(nodeUrl);
let wallet;

try {
  await waitForNode(node);
  wallet = await EmbeddedWallet.create(node, { pxe: { dataDirectory } });

  const fpc = await registerSponsoredFpc(wallet, node, configuredFpc);
  const accounts = await wallet.getAccounts();

  if (accounts.length > 1) {
    throw new Error("persistent wallet contains multiple accounts");
  }

  let manager;
  let owner;
  if (accounts.length === 0) {
    manager = await wallet.createSchnorrAccount(
      Fr.random(),
      Fr.random(),
      GrumpkinScalar.random(),
      "noir-poker-server",
    );
    owner = manager.address;
  } else {
    owner = accounts[0].item;
  }

  if (configuredAccount && !configuredAccount.equals(owner)) {
    throw new Error("configured server account does not match persistent wallet");
  }

  if (!(await accountInitialized(wallet, owner))) {
    manager ??= await storedManager(wallet, owner);
    const deployment = await manager.getDeployMethod();
    await deployment.send({
      from: NO_FROM,
      fee: { paymentMethod: fpc.paymentMethod },
    });

    if (!(await accountInitialized(wallet, owner))) {
      throw new Error("server account deployment failed");
    }
  }

  let contract;
  if (configuredContract) {
    contract = await requirePlayChips(
      node,
      wallet,
      configuredContract,
      owner,
    );
    if (!contract) {
      throw new Error("configured PlayChips contract missing from network");
    }
  } else {
    const deployment = PlayChipsContract.deployWithOpts({
      wallet,
      method: "setup",
      instantiation: { salt: Fr.ZERO, deployer: owner },
    });
    const instance = await deployment.getInstance();
    contract = await requirePlayChips(node, wallet, instance.address, owner);

    if (!contract) {
      const deployed = await deployment.send({
        from: owner,
        fee: { paymentMethod: fpc.paymentMethod },
      });
      contract = deployed.contract;
    }
  }

  const { result: contractOwner } = await contract.methods
    .contract_owner()
    .simulate({ from: owner });
  if (!contractOwner.equals(owner)) {
    throw new Error("PlayChips owner verification failed");
  }

  console.log(`AZTEC_NODE_URL=${nodeUrl}`);
  console.log(`AZTEC_PLAY_CHIPS_ADDRESS=${contract.address.toString()}`);
  console.log(`AZTEC_SERVER_ACCOUNT=${owner.toString()}`);
  console.log(`AZTEC_SERVER_WALLET_DIR=${dataDirectory}`);
  console.log(`AZTEC_SPONSORED_FPC_ADDRESS=${fpc.address.toString()}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Aztec initialization failed");
  process.exitCode = 1;
} finally {
  await wallet?.stop();
}
