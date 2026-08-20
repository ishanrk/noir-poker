import type {
  AppCapabilities,
  GrantedAccountsCapability,
  Wallet,
} from "@aztec/aztec.js/wallet";
import { Fr } from "@aztec/aztec.js/fields";
import { hashToEmoji } from "@aztec/wallet-sdk/crypto";
import {
  WalletManager,
  type WalletProvider,
} from "@aztec/wallet-sdk/manager";

import {
  AZTEC_TESTNET_CHAIN_ID,
  AZTEC_TESTNET_ROLLUP_VERSION,
} from "./config";

export const AZTEC_APP_ID = "noir-poker";

export type ConnectedAztecWallet = {
  wallet: Wallet;
  account: GrantedAccountsCapability["accounts"][number];
  provider: WalletProvider;
};

export function discoverAztecWallets(onUpdate: (providers: WalletProvider[]) => void) {
  const manager = WalletManager.configure({ extensions: { enabled: true } });
  const providers: WalletProvider[] = [];
  const discovery = manager.getAvailableWallets({
    chainInfo: {
      chainId: new Fr(AZTEC_TESTNET_CHAIN_ID),
      version: new Fr(AZTEC_TESTNET_ROLLUP_VERSION),
    },
    appId: AZTEC_APP_ID,
    onWalletDiscovered(provider) {
      if (providers.some((known) => known.id === provider.id)) {
        return;
      }

      providers.push(provider);
      onUpdate([...providers]);
    },
  });

  return {
    cancel: () => discovery.cancel(),
    done: discovery.done,
  };
}

export async function openAztecWalletChannel(provider: WalletProvider) {
  const pending = await provider.establishSecureChannel(AZTEC_APP_ID);

  return {
    emojis: hashToEmoji(pending.verificationHash),
    confirm: () => pending.confirm(),
    cancel: () => pending.cancel(),
  };
}

export function playChipsCapabilities(): AppCapabilities {
  return {
    version: "1.0",
    metadata: {
      name: "Noir Poker",
      version: "0.1.0",
      description: "Private nontransferable play chips for Noir Poker",
      url: window.location.origin,
    },
    capabilities: [
      { type: "accounts", canGet: true },
      {
        type: "contracts",
        contracts: "*",
        canRegister: true,
        canGetMetadata: true,
      },
      {
        type: "simulation",
        transactions: { scope: "*" },
        utilities: { scope: "*" },
      },
      { type: "transaction", scope: "*" },
    ],
  };
}

export async function approveAztecWallet(
  wallet: Wallet,
  provider: WalletProvider,
): Promise<ConnectedAztecWallet> {
  const capabilities = await wallet.requestCapabilities(playChipsCapabilities());
  const accounts = capabilities.granted.find(
    (capability): capability is GrantedAccountsCapability => capability.type === "accounts",
  );
  const account = accounts?.accounts[0];

  if (!account) {
    throw new Error("wallet did not grant an account");
  }

  return { wallet, account, provider };
}
