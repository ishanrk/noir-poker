ALTER TABLE rooms
ADD COLUMN mode TEXT NOT NULL DEFAULT 'multiplayer'
CHECK (mode IN ('single', 'multiplayer', 'aztec'));
