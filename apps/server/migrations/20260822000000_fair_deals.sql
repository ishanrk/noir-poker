CREATE TABLE hand_ceremonies (
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    hand_no BIGINT NOT NULL CHECK (hand_no >= 0),
    version INTEGER NOT NULL CHECK (version = 1),
    server_secret BYTEA NOT NULL CHECK (octet_length(server_secret) = 32),
    commitment BYTEA NOT NULL CHECK (octet_length(commitment) = 32),
    final_seed BYTEA CHECK (final_seed IS NULL OR octet_length(final_seed) = 32),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revealed_at TIMESTAMPTZ,
    PRIMARY KEY (room_id, hand_no),
    CHECK ((final_seed IS NULL AND revealed_at IS NULL) OR (final_seed IS NOT NULL))
);

CREATE TABLE hand_entropy (
    room_id UUID NOT NULL,
    hand_no BIGINT NOT NULL,
    seat INTEGER NOT NULL CHECK (seat BETWEEN 0 AND 5),
    share BYTEA NOT NULL CHECK (octet_length(share) = 32),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (room_id, hand_no, seat),
    FOREIGN KEY (room_id, hand_no)
        REFERENCES hand_ceremonies(room_id, hand_no)
        ON DELETE CASCADE
);

CREATE UNIQUE INDEX hand_ceremony_commitment_unique
ON hand_ceremonies(commitment);
