"use client";

import type { Wallet } from "@aztec/aztec.js/wallet";
import type { WalletProvider } from "@aztec/wallet-sdk/manager";
import { useEffect, useRef, useState } from "react";

import {
  AZTEC_TESTNET_NODE_URL,
  PLAY_CHIPS_CLAIM_AMOUNT,
  PLAY_CHIPS_CONTRACT_ADDRESS,
} from "@/lib/aztec/config";
import {
  entryIdForSeat,
  fieldHex,
  newEntryNonce,
  nonceHex,
  tableIdForRoom,
} from "@/lib/aztec/ids";
import {
  attachPlayChips,
  claimPlayChips,
  enterPlayChipTable,
  hasClaimedPlayChips,
  playChipBalance,
  playChipEntry,
  type PlayChips,
} from "@/lib/aztec/play-chips";
import {
  approveAztecWallet,
  discoverAztecWallets,
  openAztecWalletChannel,
  type ConnectedAztecWallet,
} from "@/lib/aztec/wallet";

const SEATS = [0, 1, 2, 3, 4, 5] as const;

type PendingChannel = {
  provider: WalletProvider;
  emojis: string;
  confirm: () => Promise<Wallet>;
  cancel: () => void;
};

type EntryReceipt = {
  room: string;
  seat: number;
  amount: string;
  tableId: string;
  entryId: string;
  nonce: string;
  txHash: string;
};

export function AztecPlayChips() {
  const discovery = useRef<ReturnType<typeof discoverAztecWallets>>();
  const [providers, setProviders] = useState<WalletProvider[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [pendingChannel, setPendingChannel] = useState<PendingChannel>();
  const [connection, setConnection] = useState<ConnectedAztecWallet>();
  const [contract, setContract] = useState<PlayChips>();
  const [balance, setBalance] = useState<bigint>();
  const [claimed, setClaimed] = useState(false);
  const [room, setRoom] = useState("");
  const [seat, setSeat] = useState(0);
  const [buyIn, setBuyIn] = useState(1_000);
  const [receipt, setReceipt] = useState<EntryReceipt>();
  const [status, setStatus] = useState("Connect an Aztec testnet wallet to begin");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const configured = /^0x[0-9a-f]{64}$/i.test(PLAY_CHIPS_CONTRACT_ADDRESS);

  useEffect(() => {
    return () => {
      discovery.current?.cancel();
      pendingChannel?.cancel();
    };
  }, [pendingChannel]);

  async function findWallets() {
    discovery.current?.cancel();
    setProviders([]);
    setDiscovering(true);
    setError(undefined);
    setStatus("Looking for Aztec wallet extensions");

    const next = discoverAztecWallets(setProviders);
    discovery.current = next;

    try {
      await next.done;
    } catch (cause) {
      setError(message(cause));
    } finally {
      setDiscovering(false);
      setStatus((current) =>
        current === "Looking for Aztec wallet extensions"
          ? "Choose a discovered wallet"
          : current,
      );
    }
  }

  async function selectWallet(provider: WalletProvider) {
    setBusy(true);
    setError(undefined);
    setStatus("Opening a secure wallet channel");

    try {
      const channel = await openAztecWalletChannel(provider);
      setPendingChannel({ provider, ...channel });
      setStatus("Confirm the emoji code in both windows");
    } catch (cause) {
      setError(message(cause));
      setStatus("Wallet connection failed");
    } finally {
      setBusy(false);
    }
  }

  async function confirmWallet() {
    if (!pendingChannel) {
      return;
    }

    setBusy(true);
    setError(undefined);
    setStatus("Requesting account and transaction permissions");

    try {
      const wallet = await pendingChannel.confirm();
      const connected = await approveAztecWallet(wallet, pendingChannel.provider);
      const attached = await attachPlayChips(wallet);

      setPendingChannel(undefined);
      setConnection(connected);
      setContract(attached);
      wallet.onDisconnect(() => disconnect());
      await refresh(attached, connected);
      setStatus("Aztec wallet connected");
    } catch (cause) {
      setError(message(cause));
      setStatus("Wallet approval failed");
    } finally {
      setBusy(false);
    }
  }

  async function refresh(
    nextContract = contract,
    nextConnection = connection,
  ) {
    if (!nextContract || !nextConnection) {
      return;
    }

    const account = nextConnection.account.item;
    const [nextBalance, nextClaimed] = await Promise.all([
      playChipBalance(nextContract, account),
      hasClaimedPlayChips(nextContract, account),
    ]);

    setBalance(nextBalance);
    setClaimed(nextClaimed);
  }

  async function claim() {
    if (!contract || !connection) {
      return;
    }

    setBusy(true);
    setError(undefined);
    setStatus("Creating private play chips on Aztec");

    try {
      await claimPlayChips(contract, connection.account.item);
      await refresh();
      setStatus("Private play chips claimed");
    } catch (cause) {
      setError(message(cause));
      setStatus("Claim failed");
    } finally {
      setBusy(false);
    }
  }

  async function enterTable() {
    if (!contract || !connection) {
      return;
    }

    setBusy(true);
    setError(undefined);
    setStatus("Locking the private buy-in on Aztec");

    try {
      const tableId = tableIdForRoom(room);
      const nonce = newEntryNonce();
      const entryId = entryIdForSeat(tableId, seat, nonce);
      const transaction = await enterPlayChipTable(
        contract,
        connection.account.item,
        tableId,
        entryId,
        BigInt(buyIn),
      );
      const confirmed = await playChipEntry(
        contract,
        connection.account.item,
        entryId,
      );

      if (
        !confirmed.exists ||
        confirmed.tableId !== tableId ||
        confirmed.amount !== BigInt(buyIn)
      ) {
        throw new Error("Aztec entry record does not match the requested buy-in");
      }

      const nextReceipt: EntryReceipt = {
        room,
        seat,
        amount: String(buyIn),
        tableId: fieldHex(tableId),
        entryId: fieldHex(entryId),
        nonce: nonceHex(nonce),
        txHash: transaction.receipt.txHash.toString(),
      };

      localStorage.setItem(entryKey(room, seat), JSON.stringify(nextReceipt));
      setReceipt(nextReceipt);
      await refresh();
      setStatus("Table entry recorded on Aztec");
    } catch (cause) {
      setError(message(cause));
      setStatus("Table entry failed");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    try {
      await connection?.wallet.disconnect();
    } finally {
      setConnection(undefined);
      setContract(undefined);
      setBalance(undefined);
      setClaimed(false);
      setReceipt(undefined);
      setStatus("Wallet disconnected");
    }
  }

  return (
    <section className="chips-console">
      <header className="chips-intro">
        <p className="eyebrow">Aztec testnet</p>
        <h1>Private play chips</h1>
        <p>
          Claim a private balance, lock a buy-in for a Noir Poker room and receive an
          opaque entry receipt. The chips cannot be transferred, purchased, redeemed or
          bridged.
        </p>
      </header>

      <div className="chips-status" aria-live="polite">
        <span>{status}</span>
        {error && <strong>{error}</strong>}
      </div>

      {!configured && (
        <section className="chips-warning">
          <strong>Contract address required</strong>
          <p>
            Deploy PlayChips and set NEXT_PUBLIC_AZTEC_PLAY_CHIPS_ADDRESS before using
            this page.
          </p>
        </section>
      )}

      <section className="chips-step">
        <div className="chips-step-number">1</div>
        <div>
          <h2>Connect a testnet wallet</h2>
          {!connection && !pendingChannel && (
            <>
              <button
                className="primary-action"
                type="button"
                onClick={() => void findWallets()}
                disabled={busy || discovering}
              >
                {discovering ? "Looking for wallets" : "Find Aztec wallets"}
              </button>
              <div className="wallet-list">
                {providers.map((provider) => (
                  <button
                    type="button"
                    key={provider.id}
                    onClick={() => void selectWallet(provider)}
                    disabled={busy}
                  >
                    {provider.icon && <img src={provider.icon} alt="" />}
                    <span>{provider.name}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          {pendingChannel && (
            <div className="wallet-verification">
              <p>Match this code with the wallet extension before approving.</p>
              <strong>{pendingChannel.emojis}</strong>
              <div>
                <button
                  className="primary-action"
                  type="button"
                  onClick={() => void confirmWallet()}
                  disabled={busy || !configured}
                >
                  Continue with {pendingChannel.provider.name}
                </button>
                <button
                  className="text-action"
                  type="button"
                  onClick={() => {
                    pendingChannel.cancel();
                    setPendingChannel(undefined);
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {connection && (
            <div className="wallet-connected">
              <span>Connected account</span>
              <code>{connection.account.item.toString()}</code>
              <button className="text-action" type="button" onClick={() => void disconnect()}>
                Disconnect
              </button>
            </div>
          )}
        </div>
      </section>

      <section className="chips-step">
        <div className="chips-step-number">2</div>
        <div>
          <h2>Claim the private balance</h2>
          <div className="chip-balance">
            <span>Available</span>
            <strong>{balance === undefined ? "—" : balance.toLocaleString()}</strong>
            <small>play chips</small>
          </div>
          <p className="chips-note">
            Each Aztec account can claim {PLAY_CHIPS_CLAIM_AMOUNT.toLocaleString()} once.
            Only the account wallet can read its balance.
          </p>
          <button
            className="primary-action"
            type="button"
            onClick={() => void claim()}
            disabled={busy || !contract || claimed}
          >
            {claimed ? "Claim used" : "Claim play chips"}
          </button>
        </div>
      </section>

      <section className="chips-step">
        <div className="chips-step-number">3</div>
        <div>
          <h2>Lock a table buy-in</h2>
          <label className="line-input">
            Noir Poker room id
            <input
              type="text"
              value={room}
              onChange={(event) => setRoom(event.target.value.trim())}
              placeholder="00000000-0000-0000-0000-000000000000"
              spellCheck={false}
            />
          </label>

          <fieldset className="seat-selector chips-seats">
            <legend>Seat</legend>
            <div>
              {SEATS.map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={seat === value}
                  onClick={() => setSeat(value)}
                >
                  {value + 1}
                </button>
              ))}
            </div>
          </fieldset>

          <label className="scale-control">
            <span>
              Buy-in
              <strong>{buyIn.toLocaleString()}</strong>
            </span>
            <input
              type="range"
              min="100"
              max="5000"
              step="100"
              value={buyIn}
              onChange={(event) => setBuyIn(Number(event.target.value))}
            />
            <small>
              <span>100</span>
              <span>5,000</span>
            </small>
          </label>

          <button
            className="primary-action"
            type="button"
            onClick={() => void enterTable()}
            disabled={busy || !contract || balance === undefined || balance < BigInt(buyIn)}
          >
            Enter with private chips
          </button>
        </div>
      </section>

      {receipt && (
        <section className="chips-receipt">
          <header>
            <p className="eyebrow">Aztec entry receipt</p>
            <h2>Buy-in confirmed</h2>
          </header>
          <dl>
            <div>
              <dt>Room</dt>
              <dd><code>{receipt.room}</code></dd>
            </div>
            <div>
              <dt>Seat</dt>
              <dd>{receipt.seat + 1}</dd>
            </div>
            <div>
              <dt>Amount</dt>
              <dd>{Number(receipt.amount).toLocaleString()}</dd>
            </div>
            <div>
              <dt>Table id</dt>
              <dd><code>{receipt.tableId}</code></dd>
            </div>
            <div>
              <dt>Entry id</dt>
              <dd><code>{receipt.entryId}</code></dd>
            </div>
            <div>
              <dt>Transaction</dt>
              <dd><code>{receipt.txHash}</code></dd>
            </div>
          </dl>
          <p>
            The public contract records the opaque entry id, table id and amount. It does
            not publish the player address or private balance.
          </p>
        </section>
      )}

      <footer className="chips-network">
        <span>Aztec 5.2.0 testnet</span>
        <code>{AZTEC_TESTNET_NODE_URL}</code>
      </footer>
    </section>
  );
}

function entryKey(room: string, seat: number) {
  return `noir-poker-aztec-entry-${room}-${seat}`;
}

function message(cause: unknown) {
  return cause instanceof Error ? cause.message : "Aztec operation failed";
}
