export const AZTEC_VERSION = "5.2.0";
export const AZTEC_TESTNET_NODE_URL =
  process.env.NEXT_PUBLIC_AZTEC_NODE_URL ?? "https://v5.testnet.rpc.aztec-labs.com";
export const AZTEC_TESTNET_CHAIN_ID = 11_155_111n;
export const AZTEC_TESTNET_ROLLUP_VERSION = 1_821_665_230n;
export const PLAY_CHIPS_CLAIM_AMOUNT = 10_000n;
export const PLAY_CHIPS_CONTRACT_ADDRESS =
  process.env.NEXT_PUBLIC_AZTEC_PLAY_CHIPS_ADDRESS?.trim() ?? "";

export function requirePlayChipsAddress() {
  if (!/^0x[0-9a-f]{64}$/i.test(PLAY_CHIPS_CONTRACT_ADDRESS)) {
    throw new Error("play chips contract is not configured");
  }

  return PLAY_CHIPS_CONTRACT_ADDRESS;
}
