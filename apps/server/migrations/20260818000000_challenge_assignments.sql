CREATE TABLE challenge_assignments (
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    hand_no BIGINT NOT NULL CHECK (hand_no > 0),
    seat INTEGER NOT NULL CHECK (seat BETWEEN 0 AND 5),
    version INTEGER NOT NULL CHECK (version = 1),
    tier INTEGER NOT NULL CHECK (tier IN (0, 1)),
    hand_tag BYTEA NOT NULL CHECK (octet_length(hand_tag) = 32),
    commitment BYTEA NOT NULL CHECK (octet_length(commitment) = 32),
    nonce BYTEA NOT NULL CHECK (octet_length(nonce) = 32),
    facts_hash BYTEA CHECK (facts_hash IS NULL OR octet_length(facts_hash) = 32),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (room_id, hand_no, seat)
);
