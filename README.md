# Noir Poker

Local Texas Hold'em, encrypted deck shuffles, and optional private challenge proofs. Ordinary chips have no monetary value. Aztec features are optional testnet features, not a production payment system.

## Supported local setup

The tested source is based on `oracle-deploy` at `5c3c9c49687b10ed0cf61bc32c95aed5736b90d4`, not the older plaintext deployment on main. Similarity to the public website does not establish production identity.

Tested tools: Node 24.12.0, npm 11.6.2, Rust 1.93.0, PostgreSQL 14, nargo 1.0.0-beta.26, and bb 5.2.0. Dependency versions are pinned in Cargo.lock and apps/web/package-lock.json. Dockerfile contains the supported Linux compiler downloads and SHA 256 checksums. The project does not silently install these tools during validation.

1. Install the tools. For the web dependencies run `npm ci --prefix apps/web`.
2. Create a dedicated local PostgreSQL database. Never point tests at a database you care about. Several integration fixtures truncate their tables.
3. Set `DATABASE_URL`, `BB_PATH`, and `WEB_ORIGINS` for the server. The default web origin is `http://localhost:3000`; the server port defaults to 3001 and is changed with `PORT`. `CHALLENGE_VK_PATH` optionally overrides the challenge verification key path.
4. Generate artifacts with `bash scripts/build-zk.sh`. This compiles both circuits, generates both verification keys, normalizes debug paths, and copies runtime resources. It generates files but does not install tools. It rejects incompatible nargo and bb versions.
5. Run `cargo run --locked -p server`. Database migrations run at startup. Required proof backends and artifact identities are checked before listening.
6. In apps/web, set `NEXT_PUBLIC_SERVER_URL` to the local server origin and run `npm run dev`. For production mode locally, set it while running `npm run build`, then use `npm start`.

Optional Aztec setup, bindings, and environment names are documented in [aztec/README.md](aztec/README.md). No wallet transactions are needed for the normal game or validation below.

With an existing local PostgreSQL 14 role, `createdb noir_poker_local` and `createdb noir_poker_tests` create separate application and destructive-test databases. Set the corresponding connection URLs locally. The pre-existing compose.yaml uses PostgreSQL 18; it was not the database configuration exercised in this pass. Do not repoint that persistent volume at another PostgreSQL major version.

## Validation

`bash scripts/validate-local.sh` only validates existing dependencies and generated artifacts. It runs the Rust tests, frontend state and cryptographic helper tests, lint, type checking, and production build.

For the real proof and database gate, set `TEST_DATABASE_URL` to a disposable database and `BB_PATH`, then run:

```sh
cargo test --workspace --locked -- --include-ignored --test-threads=1
```

This explicitly includes the otherwise ignored native proof, persistence, retry, refund fixture, and challenge claim tests. It does not execute a real Aztec transaction. The GitHub workflow separates frontend checks from the native proof and database job.

The Docker `test-gates` target includes the pinned Node runtime and installed web dependencies because two native integration tests create real challenge fixtures through Node. The production `runtime` image does not acquire those test dependencies. Building a test image performs setup; running its test commands is validation.

Local browser journeys, after starting the app:

```sh
cd apps/web
BASE_URL=http://localhost:3000 POLISH_OUT=../../.local/journey node scripts/polish-journey.mjs
npm run state:test
```

The journey uses actual encrypted dealing and stores screenshots and numeric timing samples locally. A mocked audio scheduling test is not listening verification.

The extended journey defaults to frontend port 3140 and server port 3141. Set `BASE_URL` and `SERVER_URL` to override both. Run `node scripts/reliability-journey.mjs` for bot, six seat, friend, and invalid proof cases. `JOURNEY=slow` withholds an outgoing shuffle in the local test harness. `JOURNEY=restart` pauses after writing `.local/polish/reliability/restart-ready.json`; restart only your local server then let the test check the preserved receipt and interrupted hand. `node scripts/presentation-check.mjs` uses the completed receipt from the extended journey. `node --experimental-strip-types scripts/receipt-negative.mjs PATH_TO_COMPLETED_TRANSCRIPT` exercises real verification and tampering. Browser tracing with `scripts/responsiveness-check.mjs` stores only numeric timing events, not raw trace arguments.

`JOURNEY=ambiguous` disconnects after a fold was accepted but before the completed opening reaches the client, then reconciles without resending the wager. `node scripts/audio-check.mjs` checks scheduling, keyboard activation, local rejection, slow response feedback, and clip completion across real navigation. It cannot measure sound at the user's speakers.

## Protocol and operations

Read [docs/protocol.md](docs/protocol.md), [docs/reliability.md](docs/reliability.md), and [docs/release.md](docs/release.md). Public build identities are available at frontend `/api/build` and server `/build`. `/health` is process liveness; `/ready` checks database responsiveness after successful startup validation without generating a proof.

For local numeric diagnostics set `sessionStorage.setItem('noir-diagnostics', '1')` in browser developer tools. `window.noirDiagnosticSamples()` returns the last 500 samples after an instrumented event. Server timings require `NOIR_DIAGNOSTICS=1`. Neither mode records message bodies, credentials, cards, secrets, or witnesses.

## Licensing and private material

No source license has been selected in this task. This needs an owner decision before redistribution. Preserve [the Tabler asset notice](apps/web/public/assets/TABLER-LICENSE.txt). The font, sound, and illustration provenance still needs owner confirmation; see [docs/provenance.md](docs/provenance.md).

Private study material belongs only in `.private/study`. It is excluded by Git, Docker, and Vercel rules. Do not force add it, copy it into public assets, or upload the workspace as a CI artifact.
