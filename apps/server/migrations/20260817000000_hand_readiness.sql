ALTER TABLE seats
ADD COLUMN ready_hand UUID REFERENCES hands(id);
