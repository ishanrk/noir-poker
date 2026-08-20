# Noir Poker validated redesign

Baseline: `340a9be579c2ca26715146b4c79ff0c8f681a1b5`

Patch SHA-256: `b629d18bf102601d5315c2365a0008e0b3f1f325898cdeeb72feea300db016eb`

## Validation

- Rust format, workspace tests and Clippy with warnings denied
- challenge, deal and receipt binding tests
- ESLint and production Next.js build
- pinned Noir 1.0.0-beta.26 artifact rebuild
- pinned Barretenberg 5.2.0 real proof verification
- PostgreSQL persistence/restart and real bounty claim tests
- full patch applied to a detached checkout at the exact baseline
- complete suite executed against the reapplied patch
- reapplied source diff byte-for-byte identical to the stored patch
- no numeric spinners, gradients, glass blur, dot-separated product copy or hosted localhost fallback

## Deployment

Hosted web builds require `NEXT_PUBLIC_SERVER_URL`. The Rust server accepts comma-separated `WEB_ORIGINS` and remains compatible with a single `WEB_ORIGIN`. SQLx migrations run automatically during server startup.

## Security scope

Settled deals are independently auditable. The authoritative server still sees cards and can abort. The completed-seed selection guarantee requires at least one unpredictable non-colluding player entropy share.
