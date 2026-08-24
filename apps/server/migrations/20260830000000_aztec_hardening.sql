ALTER TABLE aztec_admissions
ADD COLUMN expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '15 minutes');

ALTER TABLE aztec_admissions
DROP CONSTRAINT aztec_admissions_room_id_seat_key;

ALTER TABLE aztec_admissions
DROP CONSTRAINT aztec_admissions_room_id_account_key;

CREATE UNIQUE INDEX aztec_admissions_live_seat
ON aztec_admissions (room_id, seat)
WHERE status != 'failed';

CREATE UNIQUE INDEX aztec_admissions_live_account
ON aztec_admissions (room_id, account)
WHERE status != 'failed';

ALTER TABLE aztec_settlements
ADD COLUMN kind TEXT NOT NULL DEFAULT 'result'
CHECK (kind IN ('result', 'refund'));
