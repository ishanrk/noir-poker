# Local polish and reliability handoff

## Source and scope

Prepared locally on repair/polish-reliability in the isolated noir-poker-polish worktree, based on oracle-deploy at `5c3c9c49687b10ed0cf61bc32c95aed5736b90d4`. The original noir-poker worktree on repair/participant-integrity at 58aa155 was preserved. No applicable AGENTS.md was found. The repair is an uncommitted, unstaged working-tree diff plus new public files. Nothing was pushed, merged, published, deployed, or sent through a wallet.

Production identity remains unverified. Similar navigation and encrypted shuffle behavior justified the local source choice but do not prove the public site runs this commit. Local frontend `/api/build` and server `/build` identify the base source, dirty state, protocol, bb version, and four compatible artifact hashes. A reviewed clean release must supply its own exact source identity.

All four generated artifact and key hashes matched the pinned source. No circuit statement, private randomness rule, public-input binding, or verification key was changed. Optional challenge proving remains background work.

The development environment restarted during the task. Journals established a WSL restart and unclean prior shutdown, not its trigger. Saved files survived. This was not evidence of a production poker failure.

## Audit finding status

| Finding | Explicit status and evidence |
| --- | --- |
| Plain first-load proving wait | Fixed and verified. A stable table shell renders before authoritative seats or cards are known; real browser screenshots capture preparation. |
| Previous result looked stuck during next hand | Fixed and verified. Explicit preparation replaces turn instructions and keeps completed receipt links available. Three real hands and repeated transitions passed. |
| Your turn remained after Call | Fixed and verified. Local submission state immediately shows Sending your action without advancing betting state. A held real wager fixture checks disabled controls and server acceptance. |
| Public homepage differs from main | Still open as deployment identity, not a code defect. The coherent encrypted-deck candidate was used locally; actual production release metadata was unavailable. |
| blew threw and 1 bots | Fixed and verified in place. The existing homepage composition and artwork remain. |
| Pickup scheduling deliberately delayed 140 ms | Fixed with the named human acoustic/device gate remaining. Scheduling is immediate, keyboard activation and local rejection are tested, and accepted navigation no longer cuts off the original clip. No audible listening claim is made. |
| Per-job browser prover and verifier initialization | Fixed and verified with bounded resource reuse, serialized access, failure disposal, queued cancellation, three distinct real witnesses, and wrong-hand rejection. Memory tradeoffs are recorded below. |
| Repeated verification of each shuffle in one completed audit | Already resolved in the selected source: inspection found one cryptographic verification per shuffle record in a single audit traversal. Runtime initialization was the repeated cost addressed here. Separate user audits intentionally perform their own verification. |
| Deck protocol waited behind presentation polling | Fixed and verified. The 50 ms notice polling dependency is gone. A bounded connection-owned inbox advances protocol independently of notice playback. |
| Long handlers could use captured old connections | Fixed and verified. Socket/hand/job ownership is rechecked after awaits; reconnect, old worker completion, leaving, and queued cancellation tests pass. |
| Server witness generation before blocking execution | Fixed and verified. Admission occurs before bounded blocking work; witness and native service timing are separate from queue time. A canceled waiter cannot free capacity while native work continues. This was a scheduling risk, not a reproduced production overload. |
| Unfinished encrypted rooms excluded from restoration without an explicit outcome | Fixed and verified. Startup persists a unique interruption, completed receipts remain unchanged after a real local restart, and the browser offers a new room. No seamless recovery or transferable ordinary chip balance is claimed. |
| Completed opening reveals folded cards | Already intentional in the protocol; explanation fixed and verified. Table help, receipts, papers, and motivation now state the final full-deck disclosure. Private challenge objectives are treated separately. |
| Optional challenge work already scheduled in background | Already resolved in source and preserved. Queued mandatory dealing has priority within the tab; running native work is not preempted. |
| Artifact binding, public inputs, nullifiers, and database constraints | Already present and preserved. Actual valid/invalid proof, tampering, duplicate claim, persistence, and retry gates passed. |
| Ignored integrations and absent CI workflow | Fixed with the named remote CI execution gate remaining. All ignored integrations were explicitly run locally. The proposed workflow also invokes real browser and circuit gates; it was not published or run on GitHub. |
| Navbar and hand record intermittently used another font | Fixed and verified. Computed styles and screenshots confirm Block Blueprint on a cold home load, Crypto Papers, return navigation, and the verified hand record. Hashes and values remain monospace. |
| Visible Abort boundary or boundary prose | Fixed and verified in the touched interface. Technical identifiers and selectors were not corrupted to satisfy a prose rule. |

Additional fixes include stable private create/join retry identities, versioned wager and ready messages, authoritative next action sequence, preserved rejection explanations, bounded native admission, two pending optional proofs per socket, authentication timeout, 256 KiB message limits, a 128 live-room admission cap, and persisted 30 minute ordinary-room idle retirement. Retirement excludes Aztec rooms because external accounting needs separate reconciliation.

## Homepage evidence

Screenshots use Chromium 140.0.7339.16, reduced motion, and fixed viewports: desktop 1440 by 1000 and narrow 390 by 844. Full page image dimensions remain 1440 by 1977 and 390 by 2717. Exact pixel comparison changed 0.3082% on desktop and 0.7109% on narrow, confined to text rows: requested navbar font, typo/grammar corrections, and replacing the decorative separator and range punctuation. The narrow heading retains its prior two-line footprint. No hero, controls, colors, artwork, navigation destinations, or page sections were replaced or relocated.

Evidence: `.local/polish/baseline`, `.local/polish/presentation`, and `presentation/pixel-comparison.json`. These are local review evidence, not public assets. The hand record screenshot and computed-style checks also verify the requested font exceptions and narrow layout.

## Measurements and conditions

Measurements were made by the assistant, not attributed to the project owner. Conditions: the same WSL machine, Node 24.12.0, npm 11.6.2, Rust 1.93.0 debug server, PostgreSQL 14 on a private local port, production Next.js build, Chromium 140, Noir beta.26, and bb 5.2.0. Browser and Node microbenchmarks are separate experiments. Three observations are not production percentiles.

| Experiment | Before | After | Interpretation |
| --- | --- | --- | --- |
| Eligible pickup scheduling | One measured baseline about 142.36 ms | Cold and repeated scheduling below 1 ms in the focused final audio check; all tested eligible game activations below 50 ms | Removed the deliberate timer. Browser playing events are recorded separately and are not sound measured at speakers. |
| First playable hand, three-hand browser journey | 8573 ms | 9074 ms | No overall first-hand speed improvement is claimed. The shell and acknowledgement appear before the unavoidable work. |
| Two subsequent hands in that journey | 8897 and 4777 ms | 8743 and 4933 ms | Similar end-to-end latency. Bot pacing, resource warmth, and optional work affect these observations. |
| Cold browser trace, one run each | 7719 ms to legal action; main-thread tasks of 172 and 65 ms; largest frame gap 150 ms | 9436 ms; no observed main-thread tasks over 50 ms; largest frame gap 83 ms | Worker ownership improves renderer responsiveness. Tracing adds overhead and does not establish a duration percentile. |
| Node shuffle job totals, three distinct fresh witnesses | 3675, 3366, 3835 ms | 4214, 3216, 3398 ms with eight threads | No universal proving speedup. The first bounded runtime initialization costs more; warm samples are comparable. |
| Node verification after each proof | 480, 365, 589 ms | 119, 86, 87 ms | Warm verifier runtime reuse materially reduces this measured overhead. |
| 156 canonical card openings | 156584 ms | 12.23 ms | Immutable public lookup cache removes repeated lookup construction. This synthetic microbenchmark is not a whole-hand timing. |
| Node RSS sampled after proof/verify | Approximately 500 to 564 MiB | Approximately 769 to 784 MiB | Runtime reuse retains memory. RSS samples are not a browser heap profile or a measured absolute peak. |

An unrestricted reused runtime approached 969 MiB in the initial experiment. Two- and four-thread trials lowered retained RSS but increased proving duration. Eight is a documented cap and measured compromise, not a claim of optimality for every device. Runtime disposal occurs after 30 seconds idle or when its worker owner ends. No JavaScript witness cache was introduced; Wasm memory zeroization is not promised.

The six-seat bot table reached its first legal action in one observation at 17574 ms and completed a real hand. This included bot turn time and is not a six-human multiplayer benchmark. Two independent friend browser contexts completed a hand and its opening after reconnecting during preparation.

Raw samples include `proof-before.jsonl`, `proof-final-eight.jsonl`, the intermediate thread experiments, `trace-before/samples.json`, `trace-after/samples.json`, `final-bot/results-bot.json`, and `audio/results.json`, all under `.local/polish`. The earlier contended `.local/polish/after` run is retained but excluded from the clean comparison. Server numeric logs distinguish queue, witness, proving, and verification service time. Diagnostics never export cards, witnesses, opening secrets, credentials, or raw sensitive messages.

## Tests actually run

- Baseline frontend lint, type checking, helper tests, production build, and 205 default Rust tests passed. Eight baseline integrations were ignored by default, not silently counted as run.
- Final Rust workspace run explicitly included ignored tests: 215 passed, none failed or ignored. This includes nine database/native integrations, duplicate and conflicting create/join/wager identities, retirement, refund and claim fixtures, artifact checks, and real cryptographic verification.
- The pinned Docker test image built locally and independently passed all 215 Rust tests, including every ignored integration, plus all 15 Noir tests. Its separate test-gates stage includes Node and the locked web dependencies required by two native fixture generators. The production runtime stage does not inherit those test dependencies.
- Noir tests: 14 challenge tests and one shuffle test passed. `cargo fmt --check` and `git diff --check` passed.
- Frontend lint, TypeScript checking, state/queue/audio ownership tests, challenge, deck, legacy deal, receipt, Aztec ID helper tests, and production build passed. Audio helper unit tests use mocks and are labeled accordingly.
- Actual browser journeys passed: three bot hands, the six-seat bot configuration, independent friend contexts, withheld wager acknowledgement, invalid public inputs followed by a fresh proof, active reconnect, slow withheld shuffle with responsive controls and leave/return, ambiguous accepted fold with no wager replay, and a real local restart preserving a completed transcript while retiring the incomplete hand.
- The completed transcript verified in the browser and with a separate clean checkout of the pinned original verifier. The hardened current verifier also accepted it and rejected unsupported format, incomplete data, wrong hand, changed chain head, altered public inputs, and malformed native proof bytes.
- Desktop/narrow screenshots, Block Blueprint computed styles, receipt overflow, focused download control, reduced-motion rendering, and numeric-only trace capture passed. Milestone live regions exclude the ticking timers. A full human screen-reader usability session was not performed.

Test development failures were retained in local logs: strict locator matches, a legacy persistence fixture created with the newer encrypted constructor, native malformed-point classification, a stale restart-harness run, a Playwright context-ownership mistake, and the first Docker test image missing Node for fixture generation. The relevant fixture/implementation was corrected and the named check rerun. They are not relabeled as production incidents. `restart-confirmed/results-restart.json` is the completed restart run; the earlier failed harness result is not its evidence. `docker-final-tests.log` records the successful container gate. `ownership-final/results-bot.json` records the final three-hand regression after the newer-hand ownership safeguard, run concurrently with container compilation and excluded from the timing comparison. The final audio and presentation checks also passed against that build.

## Remaining release gates and owner decisions

Human acoustic checks remain necessary on supported devices: cold first click, rapid legitimate clicks, keyboard activation, local error, slow network, active proving, navigation, mute, and restored mute preference. Headless playing events and mocked play calls cannot verify acoustic output.

The proposed GitHub workflow has not been remotely exercised; its Docker native and circuit gate passed locally. Optional Aztec real contract/testnet settlement was not run; controlled persistence and refund fixtures passed, and no wallet transaction occurred. The pre-existing PostgreSQL 18 compose configuration was not tested; the exercised database and CI service use PostgreSQL 14. Public internet rate limits and actual deployment capacity still need operational review. Dependency advisory reachability and compatible upgrades are a named release gate, documented in provenance.md.

The homepage currently says: “I promise that a rigged server isn't why you blew through your stack (you can check)”. Under the freeze, only its typo was corrected. Proposed substantive replacement for owner approval: “You can check the shuffle after each completed hand. Winning is still your problem.” A shuffle proof does not establish custody, solvency, every payout rule, availability, or one globally shared history.

Cards are private during play under the documented participant and randomness assumptions, not forever. Missing participant secrets can prevent completion. No seamless encrypted-hand recovery, exactly-once network delivery, or transferable ordinary chip refund is claimed. Source licensing and font/sound/illustration provenance require the owner; no license was chosen automatically.

## Private material and review

Study material belongs at `.private/study`, outside public source and asset trees. Git, Docker, and Vercel exclusions protect it separately; no CI workspace archive is uploaded. The primary manifest reconciles tracked files exactly to git ls-files, while a second manifest covers newly prepared public files without staging them. Hashes describe actual working-tree bytes. No private file is tracked or staged, and no existing .private history was found in the inspected local Git refs.

Review all modified and new public files with `git status --short`, `git diff`, and the study file manifest. Keep the original checkout intact. Follow release.md for a clean reviewed revision, compatible frontend/server identities, both additive migrations, backups, validation, and rollback compatibility. Do not revive an interrupted encrypted hand by rolling back the schema. No release action was performed.
