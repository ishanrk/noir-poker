"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import styles from "@/components/crypto.module.css";
import type { ContractView } from "@/components/contract";
import { loadProofHistory, type ProofMeta } from "@/lib/server";

export function PlayProofs({ room, handNo, settled, view }: {
  room: string;
  handNo: number;
  settled: boolean;
  view: ContractView;
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
  }, [handNo, localPublicationVersion, proofVersion, room, settled]);

  const firstHand = Math.max(0, handNo - 4);
  const hands = Array.from({ length: handNo - firstHand + 1 }, (_, index) => firstHand + index);
  const records = useMemo(
    () => new Map(history.map((proof) => [`${proof.seat}:${proof.hand_no}`, proof])),
    [history],
  );

  return (
    <section className={`${styles.strip} ${styles.proofTableStrip}`} aria-label="Challenge proofs">
      <div className={styles.proofTableWrap}>
        <table className={styles.proofTable}>
          <caption>CHALLENGE PROOF HISTORY · LAST FIVE HANDS</caption>
          <thead>
            <tr>
              <th scope="col">PLAYER</th>
              {hands.map((hand) => (
                <th scope="col" key={hand}>
                  <strong>HAND {hand + 1}</strong>
                  <small>
                    <span data-proof-tour="challenge-draw">DRAW PROOF</span>
                    <span aria-hidden="true"> / </span>
                    <span data-proof-tour="challenge-completion">COMPLETION</span>
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
                    checking={settled && hand === handNo}
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

function ProofCell({ room, hand, seat, proof, checking }: {
  room: string;
  hand: number;
  seat: number;
  proof?: ProofMeta;
  checking: boolean;
}) {
  if (!proof) {
    return <td><span className={styles.proofEmpty}>{hand === 0 ? "NO CHALLENGE" : "WAITING"}</span></td>;
  }

  return (
    <td>
      <span className={styles.proofCell}>
        {proof.draw_published ? (
          <Link
            href={`/room/${room}/proofs/${hand}/${seat}/draw`}
            target="_blank"
            rel="noreferrer"
          >
            DRAW PROOF
          </Link>
        ) : (
          <span>DRAW PENDING</span>
        )}
        {proof.completion_published ? (
          <Link
            href={`/room/${room}/proofs/${hand}/${seat}/completion`}
            target="_blank"
            rel="noreferrer"
          >
            COMPLETION PROOF
          </Link>
        ) : (
          <strong>{proof.finished ? checking ? "CHECKING" : "MISSED" : "IN PLAY"}</strong>
        )}
      </span>
    </td>
  );
}
