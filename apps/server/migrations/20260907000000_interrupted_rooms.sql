-- Browser held opening secrets cannot be reconstructed after server restart.
-- Completed transcripts and actions are retained. No synthetic deck is created.
CREATE TABLE room_interruptions (
    room_id UUID PRIMARY KEY REFERENCES rooms(id),
    hand_no BIGINT NOT NULL CHECK (hand_no >= 0),
    reason TEXT NOT NULL CHECK (reason = 'server_restart'),
    interrupted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
