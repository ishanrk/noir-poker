"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import styles from "@/components/crypto.module.css";
import type { ContractView, ProofState } from "@/components/contract";
import { loadProofHistory, type ProofMeta } from "@/lib/server";

export function PlayProofs({
  room,
  rev,
  handNo,
  settled,
  gameOver,
  view,
  viewer,
  drawStates,
  completionStates,
}: {
  room: string;
  rev: number;
  handNo: number;
  settled: boolean;
  gameOver: boolean;
  view: ContractView;
  viewer: number;
  drawStates: Record<number, ProofState>;
  completionStates: Record<number, ProofState>;
}) {
  const [history, setHistory] = useState<ProofMeta[]>([]);
  const [error, setError] = useState<string>();
  const proofVersion = view.proofs
    .map((player) => [
      player.seat,
      player.draw?.handNo,
      player.draw?.published,
      player.completion?.handNo,
      player.completion?.published,
    ].join(":"))
    .join("|");
  const localPublicationVersion = [
    view.assignment.kind === "assigned"
      ? `${view.assignment.handNo}:${view.assignment.drawVerified || view.assignment.drawState === "verified"}`
      : "",
    view.claim
      ? `${view.claim.handNo}:${view.claim.drawVerified || view.claim.drawState === "verified"}:${view.claim.state === "verified"}`
      : "",
    ...Object.entries(drawStates)
      .filter(([, state]) => state === "verified")
      .map(([hand]) => `draw:${hand}`),
    ...Object.entries(completionStates)
      .filter(([, state]) => state === "verified")
      .map(([hand]) => `completion:${hand}`),
  ].join("|");

  useEffect(() => {
    let live = true;
    void loadProofHistory(room)
      .then((proofs) => {
        if (!live) return;
        setHistory(proofs);
        setError(undefined);
      })
      .catch((cause) => {
        if (!live) return;
        setError(cause instanceof Error ? cause.message : "proof history unavailable");
      });
    return () => { live = false; };
  }, [handNo, localPublicationVersion, proofVersion, rev, room, settled]);

  const latestHand = Math.max(
    handNo,
    view.assignment.kind === "available" ? handNo : view.assignment.handNo,
    view.claim?.handNo ?? handNo,
    ...Object.keys(drawStates).map(Number),
    ...Object.keys(completionStates).map(Number),
    ...view.proofs.flatMap((player) => [
      player.draw?.handNo ?? handNo,
      player.completion?.handNo ?? handNo,
    ]),
  );
  const firstHand = Math.max(0, latestHand - 4);
  const hands = Array.from({ length: latestHand - firstHand + 1 }, (_, index) => firstHand + index);
  const records = useMemo(
    () => new Map(history.map((proof) => [`${proof.seat}:${proof.hand_no}`, proof])),
    [history],
  );

  return (
    <section className={`${styles.strip} ${styles.proofTableStrip}`} aria-label="Challenge proofs">
      <div className={styles.proofTableWrap}>
        <table className={styles.proofTable}>
          <caption>
            CHALLENGE PROOFS
            <span>Last five hands</span>
          </caption>
          <thead>
            <tr>
              <th scope="col">PLAYER</th>
              {hands.map((hand) => (
                <th scope="col" key={hand}>
                  <strong>HAND {hand + 1}</strong>
                  <small>
                    <span data-proof-tour={hand === handNo ? "challenge-draw" : undefined}>DRAW</span>
                    <span data-proof-tour={hand === handNo ? "challenge-completion" : undefined}>COMPLETION</span>
                  </small>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.proofs.map((player) => (
              <tr key={player.seat}>
                <th scope="row">{player.name.toUpperCase()}</th>
                {hands.map((hand) => (
                  <ProofCell
                    key={hand}
                    room={room}
                    hand={hand}
                    seat={player.seat}
                    proof={records.get(`${player.seat}:${hand}`)}
                    checking={settled && !gameOver && hand === handNo}
                    drawState={player.seat === viewer ? drawStates[hand] : undefined}
                    completionState={player.seat === viewer ? completionStates[hand] : undefined}
                  />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error && <p className={styles.proofTableError} role="status">{error.toUpperCase()}</p>}
    </section>
  );
}

function unpublishedStatus(state: ProofState | undefined) {
  if (state === "preparing" || state === "proving") return "GENERATING";
  if (state === "verifying") return "VERIFYING";
  if (state === "failed") return "RETRYING";
  if (state === "verified") return "PUBLISHED";
  return undefined;
}

function ProofCell({
  room,
  hand,
  seat,
  proof,
  checking,
  drawState,
  completionState,
}: {
  room: string;
  hand: number;
  seat: number;
  proof?: ProofMeta;
  checking: boolean;
  drawState?: ProofState;
  completionState?: ProofState;
}) {
  const drawStatus = unpublishedStatus(drawState);
  const completionStatus = unpublishedStatus(completionState);

  if (!proof && !drawStatus && !completionStatus) {
    return <td><span className={styles.proofEmpty}>{hand === 0 ? "NO CHALLENGE" : "WAITING"}</span></td>;
  }

  return (
    <td>
      <span className={styles.proofCell}>
        <span className={styles.proofCellLine}>
          <i>DRAW</i>
          {proof?.draw_published ? (
            <Link
              href={`/room/${room}/proofs/${hand}/${seat}/draw`}
              target="_blank"
              rel="noreferrer"
            >
              PUBLISHED
            </Link>
          ) : <b>{drawStatus ?? (proof ? "PENDING" : "WAITING")}</b>}
        </span>
        <span className={styles.proofCellLine}>
          <i>COMPLETE</i>
          {proof?.completion_published ? (
            <Link
              href={`/room/${room}/proofs/${hand}/${seat}/completion`}
              target="_blank"
              rel="noreferrer"
            >
              PUBLISHED
            </Link>
          ) : (
            <b>{completionStatus ?? (proof
              ? proof.finished
                ? checking ? "CHECKING" : "MISSED"
                : "IN PLAY"
              : "WAITING")}</b>
          )}
        </span>
      </span>
    </td>
  );
}
