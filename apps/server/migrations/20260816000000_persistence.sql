CREATE TABLE rooms (
    id UUID PRIMARY KEY,
    players INTEGER NOT NULL CHECK (players BETWEEN 2 AND 6),
    stack BIGINT NOT NULL CHECK (stack BETWEEN 0 AND 4294967295),
    small_blind BIGINT NOT NULL CHECK (small_blind BETWEEN 1 AND 4294967295),
    big_blind BIGINT NOT NULL CHECK (big_blind BETWEEN 1 AND 4294967295),
    rev BIGINT NOT NULL CHECK (rev >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE seats (
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    seat INTEGER NOT NULL CHECK (seat BETWEEN 0 AND 5),
    token_hash BYTEA NOT NULL CHECK (octet_length(token_hash) = 32),
    PRIMARY KEY (room_id, seat)
);

CREATE TABLE hands (
    id UUID PRIMARY KEY,
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    hand_no BIGINT NOT NULL CHECK (hand_no >= 0),
    seed BYTEA NOT NULL CHECK (octet_length(seed) = 32),
    dealer INTEGER NOT NULL CHECK (dealer BETWEEN 0 AND 5),
    starting_stacks BIGINT[] NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (room_id, hand_no)
);

CREATE TABLE hand_actions (
    hand_id UUID NOT NULL REFERENCES hands(id) ON DELETE CASCADE,
    seq BIGINT NOT NULL CHECK (seq >= 0),
    player INTEGER NOT NULL CHECK (player BETWEEN 0 AND 5),
    action TEXT NOT NULL CHECK (action IN ('fold', 'check', 'call', 'raise_to')),
    raise_to BIGINT,
    PRIMARY KEY (hand_id, seq),
    CHECK (
        (action = 'raise_to' AND raise_to IS NOT NULL)
        OR (action <> 'raise_to' AND raise_to IS NULL)
    ),
    CHECK (raise_to IS NULL OR raise_to BETWEEN 0 AND 4294967295)
);
