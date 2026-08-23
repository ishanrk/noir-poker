ALTER TABLE rooms
ADD COLUMN challenge_awarded BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE seats
ADD COLUMN name TEXT;

UPDATE seats
SET name = 'Player ' || (seat + 1);

ALTER TABLE seats
ALTER COLUMN name SET NOT NULL;

ALTER TABLE seats
ADD CONSTRAINT seat_name_size CHECK (
    char_length(name) BETWEEN 1 AND 20
    AND name = btrim(name)
);

CREATE UNIQUE INDEX seats_room_name_unique
ON seats (room_id, lower(name));

ALTER TABLE seats
ADD COLUMN challenge_bonus BIGINT NOT NULL DEFAULT 0
CHECK (challenge_bonus BETWEEN 0 AND 4294967295);
