ALTER TABLE seats
ADD COLUMN proof_points BIGINT NOT NULL DEFAULT 0 CHECK (proof_points >= 0);

ALTER TABLE challenge_assignments
ADD COLUMN nullifier BYTEA CHECK (nullifier IS NULL OR octet_length(nullifier) = 32),
ADD COLUMN points BIGINT CHECK (points IN (10, 25)),
ADD COLUMN claimed_at TIMESTAMPTZ,
ADD CONSTRAINT challenge_claim_complete CHECK (
    (nullifier IS NULL AND points IS NULL AND claimed_at IS NULL)
    OR (nullifier IS NOT NULL AND points IS NOT NULL AND claimed_at IS NOT NULL)
);

CREATE UNIQUE INDEX challenge_nullifier_unique
ON challenge_assignments (nullifier)
WHERE nullifier IS NOT NULL;
