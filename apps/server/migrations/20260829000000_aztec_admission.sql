CREATE TABLE aztec_admissions (
    id UUID PRIMARY KEY,
    room_id UUID NOT NULL,
    seat INTEGER NOT NULL CHECK (seat BETWEEN 0 AND 5),
    token_hash BYTEA NOT NULL CHECK (octet_length(token_hash) = 32),
    account TEXT NOT NULL CHECK (account ~ '^0x[0-9a-fA-F]{64}$'),
    table_id TEXT NOT NULL CHECK (table_id ~ '^0x[0-9a-fA-F]{62,64}$'),
    entry_id TEXT NOT NULL CHECK (entry_id ~ '^0x[0-9a-fA-F]{62,64}$'),
    amount BIGINT NOT NULL CHECK (amount BETWEEN 1 AND 4294967295),
    players INTEGER NOT NULL CHECK (players BETWEEN 2 AND 6),
    stack BIGINT NOT NULL CHECK (stack BETWEEN 1 AND 4294967295),
    small_blind BIGINT NOT NULL CHECK (small_blind BETWEEN 1 AND 4294967295),
    big_blind BIGINT NOT NULL CHECK (big_blind BETWEEN 1 AND 4294967295),
    total_hands INTEGER NOT NULL CHECK (total_hands BETWEEN 1 AND 20),
    entropy BYTEA NOT NULL CHECK (octet_length(entropy) = 32),
    name TEXT NOT NULL CHECK (
        char_length(name) BETWEEN 1 AND 20
        AND name = btrim(name)
    ),
    status TEXT NOT NULL DEFAULT 'reserved'
        CHECK (status IN ('reserved', 'authorized', 'confirmed', 'failed')),
    authorized_tx TEXT,
    confirmed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (room_id, seat),
    UNIQUE (room_id, account),
    UNIQUE (entry_id),
    CHECK (
        (status = 'reserved' AND authorized_tx IS NULL AND confirmed_at IS NULL)
        OR (status = 'authorized' AND authorized_tx IS NOT NULL AND confirmed_at IS NULL)
        OR (status = 'confirmed' AND authorized_tx IS NOT NULL AND confirmed_at IS NOT NULL)
        OR (status = 'failed' AND confirmed_at IS NULL)
    )
);

ALTER TABLE seats
ADD COLUMN aztec_account TEXT,
ADD COLUMN aztec_entry TEXT,
ADD COLUMN aztec_amount BIGINT,
ADD CONSTRAINT seats_aztec_binding CHECK (
    (
        aztec_account IS NULL
        AND aztec_entry IS NULL
        AND aztec_amount IS NULL
    )
    OR (
        aztec_account IS NOT NULL
        AND aztec_entry IS NOT NULL
        AND aztec_amount IS NOT NULL
        AND aztec_account ~ '^0x[0-9a-fA-F]{64}$'
        AND aztec_entry ~ '^0x[0-9a-fA-F]{62,64}$'
        AND aztec_amount BETWEEN 1 AND 4294967295
    )
);

CREATE UNIQUE INDEX seats_aztec_entry_unique
ON seats (aztec_entry)
WHERE aztec_entry IS NOT NULL;

CREATE UNIQUE INDEX seats_room_aztec_account_unique
ON seats (room_id, aztec_account)
WHERE aztec_account IS NOT NULL;

CREATE TABLE aztec_settlements (
    room_id UUID PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
    table_id TEXT NOT NULL UNIQUE CHECK (table_id ~ '^0x[0-9a-fA-F]{62,64}$'),
    recipients TEXT[] NOT NULL CHECK (
        cardinality(recipients) = 6
        AND recipients[1] ~ '^0x[0-9a-fA-F]{64}$'
        AND recipients[2] ~ '^0x[0-9a-fA-F]{64}$'
        AND recipients[3] ~ '^0x[0-9a-fA-F]{64}$'
        AND recipients[4] ~ '^0x[0-9a-fA-F]{64}$'
        AND recipients[5] ~ '^0x[0-9a-fA-F]{64}$'
        AND recipients[6] ~ '^0x[0-9a-fA-F]{64}$'
    ),
    payouts BIGINT[] NOT NULL CHECK (
        cardinality(payouts) = 6
        AND payouts[1] BETWEEN 0 AND 4294967295
        AND payouts[2] BETWEEN 0 AND 4294967295
        AND payouts[3] BETWEEN 0 AND 4294967295
        AND payouts[4] BETWEEN 0 AND 4294967295
        AND payouts[5] BETWEEN 0 AND 4294967295
        AND payouts[6] BETWEEN 0 AND 4294967295
    ),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'submitted', 'confirmed')),
    tx_hash TEXT,
    last_error TEXT,
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    submitted_at TIMESTAMPTZ,
    confirmed_at TIMESTAMPTZ,
    CHECK (
        (status = 'pending' AND tx_hash IS NULL AND submitted_at IS NULL AND confirmed_at IS NULL)
        OR (status = 'submitted' AND tx_hash IS NOT NULL AND confirmed_at IS NULL)
        OR (status = 'confirmed' AND tx_hash IS NOT NULL AND confirmed_at IS NOT NULL)
    )
);
