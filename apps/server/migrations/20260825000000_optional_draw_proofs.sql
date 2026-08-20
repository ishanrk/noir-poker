DO $$
DECLARE
    name TEXT;
BEGIN
    FOR name IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'challenge_assignments'::regclass
        AND contype = 'c'
        AND pg_get_constraintdef(oid) LIKE '%completion_proof%'
    LOOP
        EXECUTE format('ALTER TABLE challenge_assignments DROP CONSTRAINT %I', name);
    END LOOP;
END $$;

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
        AND facts_salt IS NOT NULL
        AND facts_hash IS NOT NULL
        AND octet_length(completion_proof) BETWEEN 1 AND 65536
        AND octet_length(completion_public_inputs) = 6208
    )
);
