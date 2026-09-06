ALTER TABLE hand_ceremonies DROP CONSTRAINT hand_ceremonies_version_check;
ALTER TABLE hand_ceremonies ADD CONSTRAINT hand_ceremonies_version_check
    CHECK (version IN (1, 2));
