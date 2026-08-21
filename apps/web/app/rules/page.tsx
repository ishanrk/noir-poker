import Image from "next/image";
import Link from "next/link";

import { Card } from "@/components/card";
import { Keycap } from "@/components/keycap";
import { SiteHeader } from "@/components/site-header";

import challengeStyles from "./challenge.module.css";
import styles from "./rules.module.css";

const WSOP_RULES =
  "https://assets.wsopcdn.com/wsop/853ee602-e1e9-4019-a0cf-381419d805c6.pdf";
const BOT_PAPER =
  "https://www.cs.mun.ca/~lourdes/public/publication/billings-pss-99/";
const BOT_SOURCE =
  "https://github.com/ishanrk/noir-poker/blob/multiplayer/apps/server/src/bot.rs";
const AZTEC = "https://aztec.network/";
const VERIFY_SCRIPT =
  "https://github.com/ishanrk/noir-poker/blob/multiplayer/apps/web/scripts/verify-receipt.mjs";

type ExampleState = "draw" | "complete" | "verify";

function ExampleTable({ state }: { state: ExampleState }) {
  const opponent = state === "verify";
  const played = state !== "draw";
  const board = ["A♠", "K♦", "9♣", "4♥", undefined] as const;

  return (
    <div className={styles.tableWrap} data-state={state}>
      <div className={`${styles.seat} ${styles.topSeat}`}>
        <span>{opponent ? "Player 1" : "Opponent"}</span>
        <strong>{state === "complete" ? "folded" : "1,000"}</strong>
        <div className={styles.hole}>
          <Card hidden />
          <Card hidden />
        </div>
      </div>

      <div className={styles.table}>
        <div className={styles.pot}>
          <span>Pot</span>
          <strong>{played ? "180" : "30"}</strong>
        </div>
        <div className={styles.board} aria-label="Example community cards">
          {board.map((value, index) => (
            <Card key={index} value={played ? value : undefined} />
          ))}
        </div>
        {state === "complete" && <div className={styles.action}>Opponent folds · pot won</div>}
      </div>

      <div className={`${styles.seat} ${styles.bottomSeat}`}>
        <div className={styles.hole}>
          {state === "complete" ? (
            <>
              <Card value="7♣" />
              <Card value="2♦" />
            </>
          ) : (
            <>
              <Card hidden />
              <Card hidden />
            </>
          )}
        </div>
        <span>{opponent ? "You · Player 2" : "You"}</span>
        <strong>{state === "complete" ? "1,180" : "1,000"}</strong>
      </div>
    </div>
  );
}

function ChallengeExample() {
  return (
    <div className={styles.demo}>
      <input className={`${styles.stepInput} ${styles.stepOne}`} type="radio" name="challenge-step" id="challenge-step-one" defaultChecked />
      <input className={`${styles.stepInput} ${styles.stepTwo}`} type="radio" name="challenge-step" id="challenge-step-two" />
      <input className={`${styles.stepInput} ${styles.stepThree}`} type="radio" name="challenge-step" id="challenge-step-three" />

      <div className={styles.steps}>
        <label className={styles.tabOne} htmlFor="challenge-step-one">
          <span>Step 1</span>
          <strong>Draw challenge</strong>
        </label>
        <label className={styles.tabTwo} htmlFor="challenge-step-two">
          <span>Step 2</span>
          <strong>Complete it</strong>
        </label>
        <label className={styles.tabThree} htmlFor="challenge-step-three">
          <span>Step 3</span>
          <strong>Opponent verifies</strong>
        </label>
      </div>

      <div className={styles.panels}>
        <section className={`${styles.walkPanel} ${styles.panelOne}`}>
          <div className={`${styles.pov} ${challengeStyles.pov}`}>
            <span>Player POV</span>
            <strong>The challenge appears before the next hand</strong>
          </div>
          <ExampleTable state="draw" />
          <div className={styles.privateChallenge}>
            <header>
              <div>
                <span>Private challenge</span>
                <strong>Draw your next challenge</strong>
              </div>
            </header>
            <label className={`key-choice ${styles.demoKey}`} htmlFor="challenge-step-two">
              <Keycap wide>Draw Challenge</Keycap>
            </label>
            <small>Only you will see it</small>
          </div>
        </section>

        <section className={`${styles.walkPanel} ${styles.panelTwo}`}>
          <div className={`${styles.pov} ${challengeStyles.pov}`}>
            <span>Player POV</span>
            <strong>Seven-deuce gets through and the bluff wins</strong>
          </div>
          <ExampleTable state="complete" />
          <div className={styles.privateChallenge}>
            <header>
              <div>
                <span>Private challenge</span>
                <strong>Seven-deuce bluff</strong>
              </div>
              <b>+20</b>
            </header>
            <div className={styles.completion}>
              <span>Completion</span>
              <strong>Challenge complete</strong>
              <label className={`key-choice ${styles.demoKeyWide}`} htmlFor="challenge-step-three">
                <Keycap wide>Generate Completion Proof</Keycap>
              </label>
            </div>
          </div>
        </section>

        <section className={`${styles.walkPanel} ${styles.panelThree}`}>
          <div className={`${styles.pov} ${challengeStyles.pov}`}>
            <span>Opponent POV</span>
            <strong>You are Player 2. Player 1 published a completion proof.</strong>
          </div>
          <ExampleTable state="verify" />
          <div className={challengeStyles.publicProof}>
            <input className={challengeStyles.verifyInput} id="challenge-proof-check" type="checkbox" />
            <div className={challengeStyles.verifierIntro}>
              <div className={challengeStyles.playerBadge}>P1</div>
              <div>
                <strong>Player 1 published a completion proof</strong>
                <p>
                  Your browser can independently verify it. You never receive Player 1&apos;s
                  challenge.
                </p>
              </div>
              <span className={challengeStyles.publishedBadge}>Published</span>
            </div>
            <div className={challengeStyles.verifyAction}>
              <div>
                <strong>Verify Player 1&apos;s proof</strong>
                <p>Check that the challenge was random and that Player 1 completed it.</p>
              </div>
              <label className={`key-choice ${challengeStyles.verifyKey}`} htmlFor="challenge-proof-check">
                <Keycap wide>Verify Player 1</Keycap>
              </label>
              <strong className={challengeStyles.verifyDone}>✓ Proof verified in your browser</strong>
            </div>
            <div className={challengeStyles.proofTools}>
              <div>
                <strong>Published proof artifacts</strong>
                <p>Everything needed for an independent check is public.</p>
              </div>
              <nav aria-label="Published proof artifacts">
                <Link href="/protocol">Download proof JSON</Link>
                <a href={VERIFY_SCRIPT} target="_blank" rel="noreferrer">
                  Verifier script
                </a>
                <Link href="/protocol">Proof details</Link>
              </nav>
              <code>npm --prefix apps/web run proof:verify -- receipt.json</code>
            </div>
            <div className={challengeStyles.proofMeaning}>
              <article>
                <span>✓</span>
                <strong>Random challenge</strong>
                <b>Verified</b>
              </article>
              <article>
                <span>✓</span>
                <strong>Challenge completed</strong>
                <b>Verified</b>
              </article>
              <article>
                <span>?</span>
                <strong>Challenge itself</strong>
                <b>Still private</b>
              </article>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

export default function RulesPage() {
  return (
    <main className={`site-shell story-page ${styles.page}`}>
      <SiteHeader compact />

      <header className={styles.hero}>
        <div>
          <h1>Rulebook</h1>
          <p>
            Standard WSOP Poker rules with secret cryptographically verifiable challenges between
            hands.
          </p>
        </div>
        <a className="story-source-card" href={WSOP_RULES} target="_blank" rel="noreferrer">
          <span>Poker rules</span>
          <strong>WSOP rulebook</strong>
          <small>Open rulebook</small>
        </a>
      </header>

      <section className={styles.section} aria-labelledby="modes-title">
        <header className={styles.sectionHead}>
          <h2 id="modes-title">Choose your gamemode</h2>
        </header>

        <div className={styles.modes}>
          <article className={`${styles.mode} ${styles.single}`}>
            <div className={styles.botVisual} aria-hidden="true">
              <div className={styles.botCards}>
                <Card value="A♠" />
                <Card value="Q♦" />
              </div>
              <span>BOTS</span>
            </div>
            <h3>
              Play against <strong>BOTS</strong>
            </h3>
            <p>Play against bots based on a strategy from the paper below.</p>
            <a className={styles.citation} href={BOT_PAPER} target="_blank" rel="noreferrer">
              <span>Billings et al. 1999</span>
              <cite>Using Probabilistic Knowledge and Simulation to Play Poker</cite>
            </a>
            <a href={BOT_SOURCE} target="_blank" rel="noreferrer">
              Bot source code
            </a>
          </article>

          <article className={`${styles.mode} ${styles.multi}`}>
            <div className={styles.roomVisual} aria-hidden="true">
              <span>ROOM ID</span>
              <strong>7K2P</strong>
              <div>
                <i>YOU</i>
                <i>FRIEND</i>
              </div>
            </div>
            <h3>
              Play against other <strong>PEOPLE</strong>
            </h3>
            <p>Play with friends using just a Room ID and verifiable proofs for hidden challenges.</p>
          </article>

          <article className={`${styles.mode} ${styles.aztec}`}>
            <div className={styles.aztecVisual} aria-hidden="true">
              <span>AZTEC</span>
              <i />
            </div>
            <h3>
              Play with people on the <strong>AZTEC NETWORK</strong>
            </h3>
            <p>Play with people using private Tajadero buy-ins on Aztec.</p>
            <a href={AZTEC} target="_blank" rel="noreferrer">
              Aztec Network
            </a>
          </article>
        </div>
      </section>

      <section className={`${styles.section} ${challengeStyles.challengeIntro}`} aria-labelledby="challenge-title">
        <div className={challengeStyles.challengeLayout}>
          <div className={challengeStyles.challengeCopy}>
            <h2 id="challenge-title">What is a challenge</h2>
            <div className={challengeStyles.challengePoints}>
              <article>
                <span className={challengeStyles.challengeNumber}>1</span>
                <div>
                  <strong>A challenge shows up before the next hand starts.</strong>
                  <p>Some challenges are easy and some are hard.</p>
                </div>
              </article>
              <article>
                <span className={challengeStyles.challengeNumber}>2</span>
                <div>
                  <strong>You need to complete the challenge before the next hand to get a reward.</strong>
                </div>
              </article>
              <article>
                <span className={challengeStyles.challengeNumber}>3</span>
                <div>
                  <strong>Your challenge is private to you.</strong>
                  <p>
                    When you complete a challenge, a cryptographic proof of completion can be
                    generated and verified by other players. They can see that you had a random
                    challenge and that you completed it without ever seeing what the challenge was,
                    when you completed it, or how you completed it.
                  </p>
                </div>
              </article>
            </div>
            <strong className={styles.noCheating}>No server side cheating</strong>
          </div>

          <aside className={challengeStyles.challengeExamples} aria-label="Challenge examples">
            <h3>Challenge examples</h3>
            <div className={challengeStyles.examplePyramid}>
              <article className={`${challengeStyles.challengeExample} ${challengeStyles.exampleTop}`}>
                <div className={challengeStyles.exampleCards} aria-hidden="true">
                  <Card value="A♠" />
                  <Card value="K♦" />
                  <Card value="9♣" />
                </div>
                <strong>See the flop</strong>
              </article>
              <article className={`${challengeStyles.challengeExample} ${challengeStyles.exampleLeft}`}>
                <div className={challengeStyles.exampleCards} aria-hidden="true">
                  <Card value="Q♠" />
                  <Card value="J♥" />
                </div>
                <strong>Reach showdown</strong>
              </article>
              <article className={`${challengeStyles.challengeExample} ${challengeStyles.exampleRight}`}>
                <div className={challengeStyles.exampleCards} aria-hidden="true">
                  <Card value="A♥" />
                  <Card value="5♣" />
                </div>
                <span className={challengeStyles.tajaderoMark} aria-hidden="true">
                  <Image src="/assets/poker-chip.svg" alt="" width={56} height={56} />
                  <b>T</b>
                </span>
                <strong>Raise before the flop and finish ahead</strong>
              </article>
            </div>
          </aside>
        </div>
      </section>

      <section className={`${styles.section} ${styles.example}`} aria-labelledby="example-title">
        <header className={styles.exampleHead}>
          <div>
            <span>Example challenge</span>
            <h2 id="example-title">Seven-deuce bluff</h2>
          </div>
          <p>See the same challenge from the player view and the opponent view.</p>
        </header>
        <ChallengeExample />
      </section>

      <section className="story-section story-next">
        <div>
          <h2>Verify a deal or challenge</h2>
          <p>The protocol page gives the browser path, exported artifact and command-line check.</p>
        </div>
        <Link className="story-link" href="/protocol">
          Open the protocol
        </Link>
      </section>
    </main>
  );
}
