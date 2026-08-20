ALTER TABLE hands
ADD CONSTRAINT hands_id_room_unique UNIQUE (id, room_id);

ALTER TABLE seats
DROP CONSTRAINT IF EXISTS seats_ready_hand_fkey;

ALTER TABLE seats
ADD CONSTRAINT seats_ready_hand_room_fkey
FOREIGN KEY (ready_hand, room_id)
REFERENCES hands (id, room_id);

ALTER TABLE challenge_assignments
ADD CONSTRAINT challenge_draw_state_strict CHECK (
    (
        draw_proof IS NULL
        AND draw_public_inputs IS NULL
        AND draw_verified_at IS NULL
    )
    OR (
        draw_proof IS NOT NULL
        AND draw_public_inputs IS NOT NULL
        AND draw_verified_at IS NOT NULL
        AND nonce IS NOT NULL
        AND catalog_root IS NOT NULL
        AND octet_length(draw_proof) BETWEEN 1 AND 65536
        AND octet_length(draw_public_inputs) = 6208
    )
);

ALTER TABLE challenge_assignments
ADD CONSTRAINT challenge_completion_state_strict CHECK (
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
        AND completion_proof IS NOT NULL
        AND completion_public_inputs IS NOT NULL
        AND claimed_at IS NOT NULL
        AND draw_verified_at IS NOT NULL
        AND facts_salt IS NOT NULL
        AND facts_hash IS NOT NULL
        AND octet_length(completion_proof) BETWEEN 1 AND 65536
        AND octet_length(completion_public_inputs) = 6208
    )
);

CREATE INDEX challenge_pending_nonce_index
ON challenge_assignments (room_id, hand_no, seat)
WHERE nonce IS NULL;
