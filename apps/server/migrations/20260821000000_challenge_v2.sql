TRUNCATE TABLE rooms CASCADE;

DROP TABLE challenge_assignments;

CREATE TABLE challenge_assignments (
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    hand_no BIGINT NOT NULL CHECK (hand_no > 0),
    seat INTEGER NOT NULL CHECK (seat BETWEEN 0 AND 5),
    version INTEGER NOT NULL CHECK (version = 2),
    hand_tag BYTEA NOT NULL CHECK (octet_length(hand_tag) = 32),
    commitment BYTEA NOT NULL CHECK (octet_length(commitment) = 32),
    nonce BYTEA CHECK (nonce IS NULL OR octet_length(nonce) = 32),
    catalog_root BYTEA CHECK (catalog_root IS NULL OR octet_length(catalog_root) = 32),
    draw_proof BYTEA,
    draw_public_inputs BYTEA,
    draw_verified_at TIMESTAMPTZ,
    facts_salt BYTEA CHECK (facts_salt IS NULL OR octet_length(facts_salt) = 32),
    facts_hash BYTEA CHECK (facts_hash IS NULL OR octet_length(facts_hash) = 32),
    nullifier BYTEA CHECK (nullifier IS NULL OR octet_length(nullifier) = 32),
    points BIGINT CHECK (points = 20),
    completion_proof BYTEA,
    completion_public_inputs BYTEA,
    claimed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (room_id, hand_no, seat),
    CHECK (
        (nonce IS NULL AND catalog_root IS NULL)
        OR (nonce IS NOT NULL AND catalog_root IS NOT NULL)
    ),
    CHECK (
        (draw_proof IS NULL AND draw_public_inputs IS NULL AND draw_verified_at IS NULL)
        OR (
            nonce IS NOT NULL
            AND catalog_root IS NOT NULL
            AND
            octet_length(draw_proof) BETWEEN 1 AND 65536
            AND octet_length(draw_public_inputs) = 6208
            AND draw_verified_at IS NOT NULL
        )
    ),
    CHECK (
        (facts_salt IS NULL AND facts_hash IS NULL)
        OR (facts_salt IS NOT NULL AND facts_hash IS NOT NULL)
    ),
    CHECK (
        (
            nullifier IS NULL
            AND points IS NULL
            AND completion_proof IS NULL
            AND completion_public_inputs IS NULL
            AND claimed_at IS NULL
        )
        OR (
            nullifier IS NOT NULL
            AND points = 20
            AND octet_length(completion_proof) BETWEEN 1 AND 65536
            AND octet_length(completion_public_inputs) = 6208
            AND claimed_at IS NOT NULL
            AND draw_verified_at IS NOT NULL
            AND facts_hash IS NOT NULL
        )
    )
);

CREATE UNIQUE INDEX challenge_nullifier_v2_unique
ON challenge_assignments (nullifier)
WHERE nullifier IS NOT NULL;
