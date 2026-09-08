"use client";
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { SoundToggle } from './ui-sounds';

export function stageMessage(stage?: string) {
  switch (stage) {
    case 'collecting keys': return 'Waiting for participant keys';
    case 'verifying shuffles': return 'Waiting for the next shuffle to be checked';
    case 'server shuffle': return 'The server is preparing its shuffle';
    case 'waiting for another participant': return 'Waiting for another player to finish their shuffle';
    case 'loading resources': return 'Loading proof resources';
    case 'preparing local shuffle': return 'Your browser is preparing its shuffle';
    case 'building witness': return 'Your browser is preparing the shuffle witness';
    case 'proving shuffle': case 'proving private shuffle': return 'Your browser is proving its shuffle';
    case 'server verification': return 'Waiting for the server to check your proof';
    case 'creating private key': return 'Your browser is preparing its key';
    case 'opening dealt cards': case 'decrypting your cards': case 'dealing private cards': return 'Opening the dealt cards';
    case 'publishing final opening': return 'Publishing the completed deck';
    default: return stage ?? 'Connecting to the table';
  }
}

export function Preparation({ stage, hand, error, reconnect, shell = false }: {
  stage?: string; hand?: number; error?: string; reconnect?: () => void; shell?: boolean;
}) {
  const [clock, setClock] = useState(() => ({ start: Date.now(), stageStart: Date.now(), now: Date.now(), hand, stage }));
  useEffect(() => {
    const tick = () => setClock(old => {
      const now = Date.now();
      return { start: old.hand === hand ? old.start : now, stageStart: old.stage === stage ? old.stageStart : now, now, hand, stage };
    });
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [hand, stage]);
  const slow = clock.now - clock.start >= 20000;
  return <section className={`preparation${shell ? ' preparation-shell' : ''}`} aria-label="Hand preparation">
    {shell && <div className="table-stage" aria-hidden="true"><div className="table-surface"><div className="table-watermark">NP</div><div className="board-area"><span>Cards appear when the deal is ready</span></div></div></div>}
    <div className="preparation-copy">
      <div role="status"><h2>{error ? 'Preparation stopped' : hand === undefined ? 'Preparing your table' : `Preparing hand ${hand + 1}`}</h2><p>{error ?? stageMessage(stage)}</p></div>
      <p aria-live="off">{Math.floor((clock.now - clock.start) / 1000)} seconds elapsed</p>
      {slow && <p>Preparation is still running. Proof work can take time on this device. Keep this tab open. If the connection is lost, reconnect to recover the server state.</p>}
      <details><summary>Proof details</summary><p>{stageMessage(stage)}</p><p aria-live="off">{Math.floor((clock.now - clock.stageStart) / 1000)} seconds in this stage</p><p>Cards stay private during play. The completed deck opening reveals every card afterward, including folded cards.</p></details>
      {reconnect && <button type="button" onClick={reconnect}>Reconnect</button>}
      <Link href="/">Return to lobby</Link><SoundToggle />
    </div>
  </section>;
}
