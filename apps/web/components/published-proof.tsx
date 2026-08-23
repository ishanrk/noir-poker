"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import styles from "@/components/crypto.module.css";
import { SiteHeader } from "@/components/site-header";
import { verifyPublishedProof } from "@/lib/receipt";
import { loadPublishedProof, type ProofKind, type PublishedProof } from "@/lib/server";

type VerifyState = "loading" | "ready" | "verifying" | "verified" | "failed";

const REPO = "https://github.com/ishanrk/noir-poker/blob/main";

const meaning = {
  mode: "selects fair draw mode 0 or completion mode 1",
  hand: "binds the proof to one room and hand",
  seat: "binds the proof to one player seat",
  commitment: "binds the hidden browser secret before the server nonce exists",
  nonce: "adds fresh public server input after the secret commitment",
  facts: "commits six salted hand facts without publishing them",
  nullifier: "identifies one completion claim without revealing the secret",
  catalog: "pins the fixed eight challenge definitions",
} as const;

export function PublishedProofPage({ room, hand, seat, kind }: {
  room: string;
  hand: number;
  seat: number;
  kind: ProofKind;
}) {
  const [proof, setProof] = useState<PublishedProof>();
  const proofRef = useRef<PublishedProof | undefined>(undefined);
  const routeRef = useRef("");
  const [state, setState] = useState<VerifyState>("loading");
  const [error, setError] = useState<string>();
  const route = `${room}:${hand}:${seat}:${kind}`;

  const verify = useCallback(async () => {
    if (!proofRef.current) return;
    const current = route;
    setState("verifying");
    setError(undefined);
    try {
      await verifyPublishedProof(proofRef.current);
      if (routeRef.current !== current) return;
      setState("verified");
    } catch (cause) {
      if (routeRef.current !== current) return;
      setState("failed");
      setError(cause instanceof Error ? cause.message : "proof verification failed");
    }
  }, [route]);

  useEffect(() => {
    let live = true;
    routeRef.current = route;
    proofRef.current = undefined;
    queueMicrotask(() => {
      if (!live) return;
      setProof(undefined);
      setError(undefined);
      setState("loading");
    });
    void loadPublishedProof(room, hand, seat, kind)
      .then((value) => {
        if (!live || routeRef.current !== route) return;
        proofRef.current = value;
        setProof(value);
        setState("ready");
      })
      .catch((cause) => {
        if (!live || routeRef.current !== route) return;
        setState("failed");
        setError(cause instanceof Error ? cause.message : "proof unavailable");
      });
    return () => { live = false; };
  }, [hand, kind, room, route, seat]);

  function download() {
    if (!proof) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(proof, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `noir-poker-${kind}-${proof.hand_no}-${proof.seat}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const draw = kind === "draw";
  const proofBytes = proof ? encodedBytes(proof.proof) : undefined;
  const publicBytes = proof ? encodedBytes(proof.public_inputs) : undefined;

  return (
    <main className="site-shell">
      <SiteHeader compact />
      <div className={styles.page}>
        <header className={styles.hero}>
          <p className={styles.label}>HAND {hand + 1}&nbsp;&nbsp;&nbsp;PLAYER {seat + 1}</p>
          <h1>{draw ? "DRAW PROOF" : "COMPLETION PROOF"}</h1>
        </header>
        <div className={styles.verifyState} data-state={state} aria-live="polite">
          {state === "loading"
            ? "LOADING PROOF"
            : state === "ready"
              ? "READY TO VERIFY"
              : state === "verifying"
                ? "VERIFYING LOCALLY"
                : state === "verified"
                  ? "VERIFIED LOCALLY"
                  : "VERIFICATION FAILED"}
        </div>
        {error && <p className={styles.error}>{error}</p>}

        <div className={styles.detailGrid}>
          <section>
            <h2>PUBLIC STATEMENT</h2>
            <p>{draw
              ? `Player ${seat + 1} selected one hidden challenge from the fixed catalog using a committed secret and the server nonce`
              : `Player ${seat + 1} selected one hidden catalog challenge and satisfied it against the committed hand facts`}</p>
          </section>
          <section>
            <h2>PRIVATE WITNESS</h2>
            <p>{draw
              ? "Challenge browser secret selected index and Merkle path"
              : "Challenge browser secret selected index Merkle path private fact witness and fact salt"}</p>
          </section>
        </div>

        {proof && (
          <>
            <section className={styles.proofSteps} aria-label="Proof explanation">
              <ProofStep index="01" title="ACCEPTED EVIDENCE">
                <p>
                  The server published the exact UltraHonk proof it accepted with the exact public
                  inputs checked beside it
                </p>
                <dl className={styles.byteCounts}>
                  <div><dt>proof bytes</dt><dd>{proofBytes?.toLocaleString()}</dd></div>
                  <div><dt>public input bytes</dt><dd>{publicBytes?.toLocaleString()}</dd></div>
                  <div><dt>public fields</dt><dd>194</dd></div>
                </dl>
              </ProofStep>
              <ProofStep index="02" title="HAND AND PLAYER">
                <p>The hand tag binds this statement to one room and hand while the seat binds one player</p>
                <Binding label="hand tag" value={proof.hand_tag} />
                <Binding label="seat" value={String(proof.seat)} />
              </ProofStep>
              <ProofStep index="03" title="PRIVATE SELECTION">
                <p>
                  The server records the hidden secret commitment before creating its nonce The
                  catalog root proves the hidden result belongs to the fixed challenge set
                </p>
                <Binding label="commitment" value={proof.commitment} />
                <Binding label="server nonce" value={proof.nonce} />
                <Binding label="catalog root" value={proof.catalog_root} />
                <p className={styles.proofNote}>
                  The public values reveal no selected objective index rule masks or Merkle path
                </p>
              </ProofStep>
              {!draw && (
                <ProofStep index="04" title="PRIVATE COMPLETION">
                  <p>
                    The facts hash commits to six salted facts derived by the server The proof checks
                    the hidden objective against that commitment The circuit derives the nullifier
                    so the same completion cannot count twice
                  </p>
                  <Binding label="facts hash" value={proof.facts_hash ?? ""} />
                  <Binding label="nullifier" value={proof.nullifier ?? ""} />
                  <p className={styles.proofNote}>
                    Mode 1 independently proves the private selection and completion in one proof
                    It does not depend on a previous fair draw proof
                  </p>
                  <p className={styles.proofNote}>
                    The circuit does not replay poker actions It proves against the fact commitment
                    published by the server
                  </p>
                </ProofStep>
              )}
              <ProofStep index={draw ? "04" : "05"} title="PINNED VERIFIER">
                <p>
                  The artifact hash pins the compiled Noir circuit The verification key hash pins the
                  UltraHonk key used by this browser and the server
                </p>
                <Binding label="artifact sha256" value={proof.artifact_sha256} />
                <Binding label="vk sha256" value={proof.vk_sha256} />
                <dl className={styles.byteCounts}>
                  <div><dt>circuit</dt><dd>{proof.circuit_id}</dd></div>
                  <div><dt>proof system</dt><dd>{proof.proof_system}</dd></div>
                  <div><dt>barretenberg</dt><dd>{proof.bb_version}</dd></div>
                </dl>
              </ProofStep>
            </section>

            <section className={styles.public}>
              <h2>PUBLIC INPUTS</h2>
              <p className={styles.proofNote}>
                Public inputs bind the proof to this published statement They contain no objective
                secret Merkle path fact salt or private fact witness
              </p>
              <dl>
                <PublicInput label="mode" value={draw ? "0" : "1"} note={meaning.mode} />
                <PublicInput label="hand tag" value={proof.hand_tag} note={meaning.hand} />
                <PublicInput label="seat" value={String(proof.seat)} note={meaning.seat} />
                <PublicInput label="commitment" value={proof.commitment} note={meaning.commitment} />
                <PublicInput label="server nonce" value={proof.nonce} note={meaning.nonce} />
                {!draw && <PublicInput label="facts hash" value={proof.facts_hash ?? ""} note={meaning.facts} />}
                {!draw && <PublicInput label="nullifier" value={proof.nullifier ?? ""} note={meaning.nullifier} />}
                <PublicInput label="catalog root" value={proof.catalog_root} note={meaning.catalog} />
              </dl>
            </section>
          </>
        )}

        <div className={styles.actions}>
          <button type="button" onClick={() => void verify()} disabled={!proof || state === "verifying"}>
            {state === "verified" || state === "failed" ? "RUN AGAIN" : "VERIFY"}
          </button>
          <button type="button" onClick={download} disabled={!proof}>DOWNLOAD JSON</button>
          <Link href={`/room/${room}/proofs`} target="_blank" rel="noreferrer">PROOF HISTORY</Link>
        </div>
        <section className={styles.public}>
          <h2>VERIFY YOURSELF</h2>
          <p><code>npm --prefix apps/web run proof:verify -- proof.json</code></p>
          <p>
            <Link href={`${REPO}/circuits/challenge-v2/src/main.nr`} target="_blank" rel="noreferrer">CIRCUIT SOURCE</Link>
            {"  "}
            <Link href={`${REPO}/apps/web/lib/receipt.ts`} target="_blank" rel="noreferrer">BROWSER VERIFIER</Link>
            {"  "}
            <Link href={`${REPO}/apps/web/lib/challenge-proof.ts`} target="_blank" rel="noreferrer">BROWSER PROVER</Link>
            {"  "}
            <Link href={`${REPO}/apps/server/src/proof.rs`} target="_blank" rel="noreferrer">RUST VERIFIER</Link>
            {"  "}
            <Link href={`${REPO}/apps/web/scripts/verify-receipt.mjs`} target="_blank" rel="noreferrer">NODE VERIFIER</Link>
            {"  "}
            <Link href="/protocol#challenge-proofs" target="_blank" rel="noreferrer">PROTOCOL AND REFERENCES</Link>
          </p>
        </section>
      </div>
    </main>
  );
}

function ProofStep({ index, title, children }: {
  index: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className={styles.proofStep}>
      <span>{index}</span>
      <div>
        <h2>{title}</h2>
        {children}
      </div>
    </section>
  );
}

function Binding({ label, value }: { label: string; value: string }) {
  return (
    <dl className={styles.binding}>
      <div><dt>{label}</dt><dd>{value}</dd></div>
    </dl>
  );
}

function PublicInput({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        {value}
        <small>{note}</small>
      </dd>
    </div>
  );
}

function encodedBytes(value: string) {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return value.length * 3 / 4 - padding;
}
