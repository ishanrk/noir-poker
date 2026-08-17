ALTER TABLE challenge_assignments
ADD COLUMN catalog_root BYTEA;

UPDATE challenge_assignments
SET catalog_root = decode('b832b47c67eaa2f5b74be82cfad9fd77636f75d866cf1b8437358a7a8406e067', 'hex');

ALTER TABLE challenge_assignments
ALTER COLUMN catalog_root SET NOT NULL;

ALTER TABLE challenge_assignments
ADD CONSTRAINT challenge_catalog_root_size CHECK (octet_length(catalog_root) = 32);
