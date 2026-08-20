"use client";

import type { Wallet } from "@aztec/aztec.js/wallet";
import type { WalletProvider } from "@aztec/wallet-sdk/manager";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  AZTEC_TABLE_STACK,
  AZTEC_WALLET_KEY,
  PLAY_CHIPS_CLAIM_AMOUNT,
  PLAY_CHIPS_CONTRACT_ADDRESS,
} from "@/lib/aztec/config";
import {
  attachPlayChips,
  claimPlayChips,
  hasClaimedPlayChips,
  playChipBalance,
  type PlayChips,
} from "@/lib/aztec/play-chips";
import type { AztecSession } from "@/lib/aztec/session";
import {
  approveAztecWallet,
  discoverAztecWallets,
  openAztecWalletChannel,
  type ConnectedAztecWallet,
} from "@/lib/aztec/wallet";

type Phase =
  | "idle"
  | "discovering"
  | "connecting"
  | "verifying"
  | "connected"
  | "error";

type PendingChannel = {
  provider: WalletProvider;
  emojis: string;
  confirm: () => Promise<Wallet>;
  cancel: () => void;
};

type AztecConnectProps = {
  compact?: boolean;
  onSession?: (session: AztecSession | undefined) => void;
};

export function AztecConnect({ compact = false, onSession }: AztecConnectProps) {
  const discovery = useRef<ReturnType<typeof discoverAztecWallets> | null>(null);
  const pendingRef = useRef<PendingChannel | null>(null);
  // keep one disconnect listener
  const disconnectListener = useRef<(() => void) | null>(null);
  const selected = useRef(false);
  const autoStarted = useRef(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [pending, setPending] = useState<PendingChannel>();
  const [connection, setConnection] = useState<ConnectedAztecWallet>();
  const [contract, setContract] = useState<PlayChips>();
  const [balance, setBalance] = useState<bigint>();
  const [claimed, setClaimed] = useState(false);
  const [providerName, setProviderName] = useState<string>();
  const [error, setError] = useState<string>();
  const configured = /^0x[0-9a-f]{64}$/i.test(PLAY_CHIPS_CONTRACT_ADDRESS);

  const clear = useCallback((forget: boolean) => {
    disconnectListener.current?.();
    disconnectListener.current = null;
    discovery.current?.cancel();
    pendingRef.current?.cancel();
    discovery.current = null;
    pendingRef.current = null;
    selected.current = false;
    setPending(undefined);
    setConnection(undefined);
    setContract(undefined);
    setBalance(undefined);
    setClaimed(false);
    setProviderName(undefined);
    setError(undefined);
    setPhase("idle");

    if (forget) {
      localStorage.removeItem(AZTEC_WALLET_KEY);
    }
  }, []);

  const refresh = useCallback(
    async (
      nextConnection = connection,
      nextContract = contract,
    ) => {
      if (!nextConnection || !nextContract) {
        return;
      }

      const account = nextConnection.account.item;
      const [nextBalance, nextClaimed] = await Promise.all([
        playChipBalance(nextContract, account),
        hasClaimedPlayChips(nextContract, account),
      ]);

      setBalance(nextBalance);
      setClaimed(nextClaimed);
    },
    [connection, contract],
  );

  const selectProvider = useCallback(async (provider: WalletProvider) => {
    if (selected.current) {
      return;
    }

    selected.current = true;
    discovery.current?.cancel();
    setProviderName(provider.name);
    setError(undefined);
    setPhase("connecting");

    try {
      const channel = await openAztecWalletChannel(provider);
      const next = { provider, ...channel };
      pendingRef.current = next;
      setPending(next);
      setPhase("verifying");
    } catch (cause) {
      selected.current = false;
      setError(message(cause));
      setPhase("error");
    }
  }, []);

  const connect = useCallback(
    (automatic = false) => {
      if (!configured) {
        if (!automatic) {
          setError("Aztec mode is not configured on this deployment");
          setPhase("error");
        }
        return;
      }

      const preferred = localStorage.getItem(AZTEC_WALLET_KEY);
      if (automatic && !preferred) {
        return;
      }

      discovery.current?.cancel();
      selected.current = false;
      setError(undefined);
      setProviderName(undefined);
      setPhase("discovering");

      const next = discoverAztecWallets((providers) => {
        const provider = preferred
          ? providers.find((candidate) => candidate.id === preferred)
          : providers[0];

        if (provider) {
          void selectProvider(provider);
        }
      });
      discovery.current = next;

      void next.done
        .then(() => {
          if (!selected.current) {
            if (automatic) {
              setPhase("idle");
            } else {
              setError("No Aztec wallet responded");
              setPhase("error");
            }
          }
        })
        .catch(() => undefined);
    },
    [configured, selectProvider],
  );

  const approve = useCallback(async () => {
    if (!pending) {
      return;
    }

    setError(undefined);
    setPhase("connecting");

    try {
      const wallet = await pending.confirm();
      const connected = await approveAztecWallet(wallet, pending.provider);
      const attached = await attachPlayChips(wallet);

      pendingRef.current = null;
      setPending(undefined);
      setConnection(connected);
      setContract(attached);
      localStorage.setItem(AZTEC_WALLET_KEY, pending.provider.id);
      disconnectListener.current = pending.provider.onDisconnect(() => clear(false));
      await refresh(connected, attached);
      setPhase("connected");
    } catch (cause) {
      pending.cancel();
      pendingRef.current = null;
      selected.current = false;
      setPending(undefined);
      setError(message(cause));
      setPhase("error");
    }
  }, [clear, pending, refresh]);

  const claim = useCallback(async () => {
    if (!connection || !contract) {
      return;
    }

    setError(undefined);
    setPhase("connecting");

    try {
      await claimPlayChips(contract, connection.account.item);
      await refresh(connection, contract);
      setPhase("connected");
    } catch (cause) {
      setError(message(cause));
      setPhase("error");
    }
  }, [connection, contract, refresh]);

  const disconnect = useCallback(async () => {
    try {
      await connection?.provider.disconnect();
    } finally {
      clear(true);
    }
  }, [clear, connection]);

  const session = useMemo<AztecSession | undefined>(() => {
    if (!connection || !contract || balance === undefined) {
      return undefined;
    }

    return {
      connection,
      contract,
      balance,
      claimed,
      ready: claimed && balance > 0n,
      refresh: () => refresh(connection, contract),
    };
  }, [balance, claimed, connection, contract, refresh]);

  useEffect(() => {
    onSession?.(session);
  }, [onSession, session]);

  useEffect(() => {
    if (!autoStarted.current) {
      autoStarted.current = true;
      connect(true);
    }

    return () => {
      disconnectListener.current?.();
      disconnectListener.current = null;
      discovery.current?.cancel();
      pendingRef.current?.cancel();
    };
  }, [connect]);

  const address = connection?.account.item.toString();
  const busy = phase === "discovering" || phase === "connecting";
  const tableReady = claimed && balance !== undefined && balance >= BigInt(AZTEC_TABLE_STACK);

  return (
    <section className={`aztec-connect${compact ? " aztec-connect-compact" : ""}`}>
      <div className="aztec-connect-label">
        <span>Aztec</span>
        <small>Private PLAY</small>
      </div>

      {!connection && phase !== "verifying" && (
        <div className="aztec-connect-action">
          <button
            className="primary-action"
            type="button"
            onClick={() => connect(false)}
            disabled={busy}
          >
            {phase === "discovering" ? "Open your wallet" : "Connect Aztec"}
          </button>
          <p>
            {phase === "discovering"
              ? "Approve Noir Poker in the wallet extension"
              : configured
                ? "Testnet only"
                : "Contract not deployed"}
          </p>
        </div>
      )}

      {phase === "verifying" && pending && (
        <div className="aztec-verify">
          <p>Match this code with {pending.provider.name}</p>
          <strong>{pending.emojis}</strong>
          <div>
            <button className="primary-action" type="button" onClick={() => void approve()}>
              Approve connection
            </button>
            <button
              className="text-action"
              type="button"
              onClick={() => clear(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {connection && balance !== undefined && (
        <div className="aztec-account">
          <div>
            <span>{shortAddress(address ?? "")}</span>
            <strong>{balance.toLocaleString()} PLAY</strong>
          </div>
          <div className="aztec-account-actions">
            {!claimed && (
              <button
                className="primary-action"
                type="button"
                onClick={() => void claim()}
                disabled={busy}
              >
                Claim {PLAY_CHIPS_CLAIM_AMOUNT.toLocaleString()} PLAY
              </button>
            )}
            {tableReady && <span className="aztec-ready">Ready</span>}
            {claimed && !tableReady && <span className="aztec-low">Low balance</span>}
            {compact && <Link href="/chips">Manage</Link>}
            <button className="text-action" type="button" onClick={() => void disconnect()}>
              Disconnect
            </button>
          </div>
        </div>
      )}

      {providerName && busy && !connection && (
        <p className="aztec-connect-status">Connecting {providerName}</p>
      )}
      {error && <p className="aztec-connect-error">{error}</p>}
    </section>
  );
}

function shortAddress(value: string) {
  return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value;
}

function message(cause: unknown) {
  return cause instanceof Error ? cause.message : "Aztec connection failed";
}
