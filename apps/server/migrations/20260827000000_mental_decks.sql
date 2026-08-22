CREATE TABLE deck_transcripts (
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    hand_no BIGINT NOT NULL CHECK (hand_no >= 0),
    hand_id UUID NOT NULL REFERENCES hands(id) ON DELETE CASCADE,
    transcript BYTEA,
    final_deck BYTEA,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (room_id, hand_no),
    UNIQUE (hand_id),
    CHECK (
        (transcript IS NULL AND final_deck IS NULL AND completed_at IS NULL)
        OR
        (transcript IS NOT NULL AND final_deck IS NOT NULL AND octet_length(final_deck) = 52 AND completed_at IS NOT NULL)
    )
);
