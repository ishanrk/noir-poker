# What a completed deal check establishes

During play each human browser holds its hand specific opening secret. The server acts as the other cryptographic participant for bots. Keys have proofs of possession. Successive participants permute and rerandomize the previous encrypted deck; these operations cannot run independently.

The pinned deck circuit proves a permutation of 52 inputs and the claimed rerandomization under the aggregate key. Public inputs bind the protocol version, hand number, participant index, transcript context, input deck, output deck, and key. Fresh permutations and masks are private witnesses, not reusable cached proof data.

Unpredictability requires honest secret randomness from at least one relevant participant, secure cryptography, and protection of browser secrets. A valid proof of a permutation alone does not prove randomness quality. In single player, the bot seats share the server's trust domain.

Opening shares let an owner see their cards during play. At completion, all participants release their hand specific opening secrets. Anyone with the completed transcript can reconstruct the entire deck afterward, including folded cards. Private challenge objectives are a separate commitment and proof system. Do not describe this deck protocol as permanent hole card privacy.

The completed audit checks the key proofs, every successive shuffle proof, share proofs, public card reveals, final opening, and transcript hash chain. A receipt becomes verified only after local verification succeeds. Server acceptance and transcript availability are separate facts.

The hash chain binds a supplied history. It does not stop the server showing different chain heads to different people. Neither deck proofs nor the chain guarantee availability, custody, solvency, payout rules, or global consistency. The Full Tilt custody and balance failures are not solved by a shuffle proof. Ordinary chips have no monetary value; the optional Aztec path uses testnet infrastructure.

The reading list links related ideas, not claims that this application implements every named construction. The actual permutation proof is the checked in Noir circuit with UltraHonk, not an implementation of Neff's complete protocol.

## Independent completed transcript verification

Download the completed transcript from Check this deal. This excludes live hand material and intentionally includes completed opening secrets.

The original compatible portable verifier is pinned at source commit `5c3c9c49687b10ed0cf61bc32c95aed5736b90d4`. This task retains its circuit and key. The current verifier also adds structure checks and scheduling.

```sh
git clone https://github.com/ishanrk/noir-poker.git
cd noir-poker
git checkout --detach 5c3c9c49687b10ed0cf61bc32c95aed5736b90d4
cd apps/web
npm ci
npm run deal:verify -- /absolute/path/completed-transcript.json
```

For a reviewed release containing these repairs, check out that release's exact commit instead. Never use an unpinned main branch as evidence of compatible verification.

Pinned deck artifact SHA 256:
`89327e378ed1161825260eb6a5b3bca788d18d88fa8f09d4ee15d073a861b8e5`

Pinned deck verification key SHA 256:
`4e82925a6ff56b94d62d3665899e44c87c9720f8bd47d250273a553d6d68ccc1`

The verifier rejects unknown protocol versions, incomplete records, inconsistent hashes, mismatched public inputs, invalid proofs, and incorrect openings. A rejection establishes a failed check, not the intent of whoever supplied the file. Editing the hand number is a simple safe negative test.
