# Noir Poker redesign and fairness patch

Baseline: `340a9be579c2ca26715146b4c79ff0c8f681a1b5`

Branch: `agent/noir-poker-ui-zk-redesign`

Patch SHA-256: `623ce984c5e9378437cc6a07f9915c5799d3caa52113dc9e296e3059a4ac7196`

Source files changed: 41

Insertions: 3246

Deletions: 2245

## Validated

- patch applies cleanly to a second detached worktree at the exact baseline
- source and reapplied patch diffs are byte-for-byte identical
- Rust formatting, workspace tests and Clippy with warnings denied
- TypeScript challenge, deal and receipt binding tests
- ESLint and production Next.js build
- PostgreSQL persistence and restart recovery tests
- pinned Noir 1.0.0-beta.26 artifact rebuild
- pinned Barretenberg 5.2.0 real proof generation and native server verification
- public two-proof bounty receipt path
- no numeric spinner controls
- no dependency-defined shuffle implementation
- no gradients, glass blur or generic pill-card styling

## Security scope

The deal transcript is commit/reveal auditable after settlement. The authoritative server still sees cards during play. This is not mental poker, does not prevent aborts, and assumes at least one non-colluding player supplies unpredictable entropy after the server commitment is durable.
