import type { PlayChips } from "./play-chips";
import type { ConnectedAztecWallet } from "./wallet";

export type AztecSession = {
  connection: ConnectedAztecWallet;
  contract: PlayChips;
  balance: bigint;
  claimed: boolean;
  ready: boolean;
  refresh: () => Promise<void>;
};
