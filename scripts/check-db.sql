\set ON_ERROR_STOP on
BEGIN;

DO $$
DECLARE
    room_a UUID := '00000000-0000-0000-0000-0000000000a1';
    room_b UUID := '00000000-0000-0000-0000-0000000000b1';
    hand_b UUID := '00000000-0000-0000-0000-0000000000b2';
BEGIN
    INSERT INTO rooms (id, players, stack, small_blind, big_blind, rev)
    VALUES
        (room_a, 2, 100, 5, 10, 0),
        (room_b, 2, 100, 5, 10, 0);

    INSERT INTO seats (room_id, seat, token_hash)
    VALUES (room_a, 0, decode(repeat('11', 32), 'hex'));

    INSERT INTO hands (id, room_id, hand_no, seed, dealer, starting_stacks)
    VALUES (
        hand_b,
        room_b,
        0,
        decode(repeat('22', 32), 'hex'),
        0,
        ARRAY[100::BIGINT, 100::BIGINT]
    );

    BEGIN
        UPDATE seats
        SET ready_hand = hand_b
        WHERE room_id = room_a AND seat = 0;
        RAISE EXCEPTION 'cross room ready hand accepted';
    EXCEPTION
        WHEN foreign_key_violation THEN NULL;
    END;

    INSERT INTO hand_ceremonies (
        room_id,
        hand_no,
        version,
        server_secret,
        commitment
    )
    VALUES (
        room_a,
        0,
        1,
        decode(repeat('33', 32), 'hex'),
        decode(repeat('44', 32), 'hex')
    );

    BEGIN
        UPDATE hand_ceremonies
        SET revealed_at = now()
        WHERE room_id = room_a AND hand_no = 0;
        RAISE EXCEPTION 'early deal reveal accepted';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    INSERT INTO challenge_assignments (
        room_id,
        hand_no,
        seat,
        version,
        hand_tag,
        commitment
    )
    VALUES (
        room_a,
        1,
        0,
        2,
        decode(repeat('66', 32), 'hex'),
        decode(repeat('77', 32), 'hex')
    );

    BEGIN
        UPDATE challenge_assignments
        SET draw_proof = decode('aa', 'hex')
        WHERE room_id = room_a AND hand_no = 1 AND seat = 0;
        RAISE EXCEPTION 'partial draw state accepted';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        UPDATE challenge_assignments
        SET nullifier = decode(repeat('88', 32), 'hex')
        WHERE room_id = room_a AND hand_no = 1 AND seat = 0;
        RAISE EXCEPTION 'partial completion state accepted';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;
END
$$;

ROLLBACK;
