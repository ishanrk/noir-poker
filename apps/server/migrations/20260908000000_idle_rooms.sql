ALTER TABLE room_interruptions DROP CONSTRAINT room_interruptions_reason_check;
ALTER TABLE room_interruptions ADD CONSTRAINT room_interruptions_reason_check
    CHECK (reason IN ('server_restart', 'idle_timeout'));
ALTER TABLE room_interruptions ADD COLUMN last_completed_hand BIGINT
    CHECK (last_completed_hand >= 0);
