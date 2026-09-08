# Local review and release gates

No deployment, push, merge, package publication, infrastructure edit, or wallet transaction is part of this repair task.

Before a release:

1. Review the diff against the selected encrypted deck source, not unrelated similarly named repair branches.
2. Run artifact generation and all validation, including the explicitly ignored integrations on a disposable database.
3. Run real browser single player and independent friend contexts, audio listening checks, a completed transcript check, a tampered transcript check, and restart tests.
4. Review the known limitations in reliability.md, dependency advisories, and the owner's license and media provenance decisions. Check actual audible behavior on supported devices. Optional Aztec settlement still needs its supported local contract or testnet integration gate; the fixtures do not replace that gate.
5. Require a clean reviewed source revision. Set `NOIR_SOURCE_COMMIT` to that exact 40 digit Git commit and `NOIR_SOURCE_DIRTY=false` for both frontend and server builds. Docker excludes .git, so explicit build arguments are necessary.
6. Preserve the old binary, web bundle, corresponding keys and artifacts, and a tested database backup. Build the new server and frontend together. Compare frontend /api/build with server /build and the intended release revision.

Migrations 20260907000000_interrupted_rooms and 20260908000000_idle_rooms are additive. The latter extends retirement reasons and records the last completed hand. Old binaries do not consult that outcome table. Rolling an old binary back against the migrated schema also requires considering SQLx's validation of newer applied migrations; do not assume it will start. Use a tested database backup or a compatibility build which recognizes both migrations. Do not delete completed transcripts, silently revive interrupted rooms, or drop refund records to make a rollback start.

Schema rollback cannot restore lost in memory opening secrets. Maintenance should stop new rooms and allow active hands to complete before restart where possible. If that is impossible, use the documented interruption outcome and testnet reconciliation policy.

The runtime and proof keys have not changed. No circuit migration is needed for completed encrypted deck v1 transcripts. The versioned wager and ready forms are additive, so the older wire forms remain accepted. Coordinate future removal of legacy clients separately.

The workflow uploads no workspace archive. Docker and Vercel exclude .private and .local. Keep those exclusions intact and inspect any new packaging or deployment path before use.
