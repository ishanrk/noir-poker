global COMMITMENT_DOMAIN: [u8; 8] = [78, 80, 67, 79, 77, 77, 48, 49];
global SELECTOR_DOMAIN: [u8; 8] = [78, 80, 83, 69, 76, 69, 48, 49];
global FACTS_DOMAIN: [u8; 8] = [78, 80, 70, 65, 67, 84, 48, 49];
global NULLIFIER_DOMAIN: [u8; 8] = [78, 80, 78, 85, 76, 76, 48, 49];

fn main(
    hand_tag: pub [u8; 32],
    seat: pub u8,
    tier: pub u8,
    commitment: pub [u8; 32],
    nonce: pub [u8; 32],
    facts_hash: pub [u8; 32],
    nullifier: pub [u8; 32],
    secret: [u8; 32],
    facts: [u8; 6],
) {
    assert(seat < 6);
    assert(tier < 2);

    for i in 0..6 {
        assert(facts[i] < 2);
    }

    assert(std::hash::blake2s(commitment_input(hand_tag, seat, tier, secret)) == commitment);

    let selector = std::hash::blake2s(selector_input(hand_tag, seat, tier, nonce, secret));
    let index = selector[0] & 3;

    assert(std::hash::blake2s(facts_input(hand_tag, seat, facts)) == facts_hash);
    assert(objective_met(tier, index, facts));
    assert(std::hash::blake2s(nullifier_input(hand_tag, seat, tier, secret)) == nullifier);
}

fn commitment_input(hand_tag: [u8; 32], seat: u8, tier: u8, secret: [u8; 32]) -> [u8; 74] {
    let mut input = [0u8; 74];

    for i in 0..8 {
        input[i] = COMMITMENT_DOMAIN[i];
    }

    for i in 0..32 {
        input[8 + i] = hand_tag[i];
        input[42 + i] = secret[i];
    }

    input[40] = seat;
    input[41] = tier;
    input
}

fn selector_input(
    hand_tag: [u8; 32],
    seat: u8,
    tier: u8,
    nonce: [u8; 32],
    secret: [u8; 32],
) -> [u8; 106] {
    let mut input = [0u8; 106];

    for i in 0..8 {
        input[i] = SELECTOR_DOMAIN[i];
    }

    for i in 0..32 {
        input[8 + i] = hand_tag[i];
        input[42 + i] = nonce[i];
        input[74 + i] = secret[i];
    }

    input[40] = seat;
    input[41] = tier;
    input
}

fn facts_input(hand_tag: [u8; 32], seat: u8, facts: [u8; 6]) -> [u8; 47] {
    let mut input = [0u8; 47];

    for i in 0..8 {
        input[i] = FACTS_DOMAIN[i];
    }

    for i in 0..32 {
        input[8 + i] = hand_tag[i];
    }

    for i in 0..6 {
        input[41 + i] = facts[i];
    }

    input[40] = seat;
    input
}

fn nullifier_input(hand_tag: [u8; 32], seat: u8, tier: u8, secret: [u8; 32]) -> [u8; 74] {
    let mut input = [0u8; 74];

    for i in 0..8 {
        input[i] = NULLIFIER_DOMAIN[i];
    }

    for i in 0..32 {
        input[8 + i] = hand_tag[i];
        input[42 + i] = secret[i];
    }

    input[40] = seat;
    input[41] = tier;
    input
}

fn objective_met(tier: u8, index: u8, facts: [u8; 6]) -> bool {
    if tier == 0 {
        if index == 0 {
            facts[0] == 1
        } else if index == 1 {
            facts[1] == 1
        } else if index == 2 {
            facts[2] == 1
        } else {
            facts[3] == 1
        }
    } else if index == 0 {
        facts[4] == 1
    } else if index == 1 {
        facts[5] == 1
    } else if index == 2 {
        (facts[1] == 1) & (facts[5] == 1)
    } else {
        (facts[1] == 0) & (facts[4] == 1) & (facts[5] == 1)
    }
}

fn run(tier: u8, nonce_byte: u8, facts: [u8; 6], expected_index: u8) {
    let hand_tag = [17u8; 32];
    let seat = 2u8;
    let secret = [34u8; 32];
    let nonce = [nonce_byte; 32];
    let commitment = std::hash::blake2s(commitment_input(hand_tag, seat, tier, secret));
    let selector = std::hash::blake2s(selector_input(hand_tag, seat, tier, nonce, secret));
    let facts_hash = std::hash::blake2s(facts_input(hand_tag, seat, facts));
    let nullifier = std::hash::blake2s(nullifier_input(hand_tag, seat, tier, secret));

    assert((selector[0] & 3) == expected_index);
    main(
        hand_tag,
        seat,
        tier,
        commitment,
        nonce,
        facts_hash,
        nullifier,
        secret,
        facts,
    );
}

#[test]
fn easy_objectives() {
    run(0, 3, [1, 0, 0, 0, 0, 0], 0);
    run(0, 4, [0, 1, 0, 0, 0, 0], 1);
    run(0, 0, [0, 0, 1, 0, 0, 0], 2);
    run(0, 11, [0, 0, 0, 1, 0, 0], 3);
}

#[test]
fn hard_objectives() {
    run(1, 4, [0, 0, 0, 0, 1, 0], 0);
    run(1, 0, [0, 0, 0, 0, 0, 1], 1);
    run(1, 1, [0, 1, 0, 0, 0, 1], 2);
    run(1, 2, [0, 0, 0, 0, 1, 1], 3);
}

#[test]
fn fixture() {
    let hand_tag = [17u8; 32];
    let seat = 2u8;
    let tier = 0u8;
    let secret = [34u8; 32];
    let nonce = [51u8; 32];
    let facts = [1u8; 6];
    let commitment = [
        141, 179, 120, 2, 54, 245, 4, 137, 222, 60, 22, 242, 167, 160, 105, 150, 245, 35, 159, 254,
        244, 87, 42, 189, 240, 35, 78, 137, 174, 253, 166, 116,
    ];
    let expected_selector = [
        106, 28, 115, 175, 107, 138, 137, 123, 235, 158, 44, 29, 51, 139, 148, 206, 122, 105, 47,
        63, 125, 132, 122, 115, 32, 31, 87, 105, 20, 142, 25, 129,
    ];
    let facts_hash = [
        205, 196, 173, 13, 4, 79, 66, 167, 34, 172, 168, 7, 107, 211, 216, 205, 202, 202, 227, 196,
        157, 243, 77, 132, 244, 95, 72, 22, 131, 89, 42, 35,
    ];
    let nullifier = [
        67, 120, 149, 97, 120, 184, 175, 115, 194, 103, 0, 44, 216, 9, 213, 239, 44, 66, 189, 21,
        42, 99, 244, 110, 244, 131, 22, 190, 150, 194, 68, 17,
    ];
    let selector = std::hash::blake2s(selector_input(hand_tag, seat, tier, nonce, secret));

    assert(selector == expected_selector);
    assert((selector[0] & 3) == 2);
    main(
        hand_tag,
        seat,
        tier,
        commitment,
        nonce,
        facts_hash,
        nullifier,
        secret,
        facts,
    );
}

#[test(should_fail)]
fn commitment_mismatch() {
    let hand_tag = [17u8; 32];
    let seat = 2u8;
    let tier = 0u8;
    let secret = [34u8; 32];
    let nonce = [0u8; 32];
    let facts = [1u8; 6];
    let mut commitment = std::hash::blake2s(commitment_input(hand_tag, seat, tier, secret));
    let facts_hash = std::hash::blake2s(facts_input(hand_tag, seat, facts));
    let nullifier = std::hash::blake2s(nullifier_input(hand_tag, seat, tier, secret));

    commitment[0] += 1;
    main(
        hand_tag,
        seat,
        tier,
        commitment,
        nonce,
        facts_hash,
        nullifier,
        secret,
        facts,
    );
}

#[test(should_fail)]
fn nonce_mismatch() {
    let hand_tag = [17u8; 32];
    let seat = 2u8;
    let tier = 0u8;
    let secret = [34u8; 32];
    let nonce = [4u8; 32];
    let facts = [1u8, 0, 0, 0, 0, 0];
    let commitment = std::hash::blake2s(commitment_input(hand_tag, seat, tier, secret));
    let facts_hash = std::hash::blake2s(facts_input(hand_tag, seat, facts));
    let nullifier = std::hash::blake2s(nullifier_input(hand_tag, seat, tier, secret));

    main(
        hand_tag,
        seat,
        tier,
        commitment,
        nonce,
        facts_hash,
        nullifier,
        secret,
        facts,
    );
}

#[test(should_fail)]
fn facts_hash_mismatch() {
    let hand_tag = [17u8; 32];
    let seat = 2u8;
    let tier = 0u8;
    let secret = [34u8; 32];
    let nonce = [0u8; 32];
    let facts = [1u8; 6];
    let commitment = std::hash::blake2s(commitment_input(hand_tag, seat, tier, secret));
    let mut facts_hash = std::hash::blake2s(facts_input(hand_tag, seat, facts));
    let nullifier = std::hash::blake2s(nullifier_input(hand_tag, seat, tier, secret));

    facts_hash[0] += 1;
    main(
        hand_tag,
        seat,
        tier,
        commitment,
        nonce,
        facts_hash,
        nullifier,
        secret,
        facts,
    );
}

#[test(should_fail)]
fn nullifier_mismatch() {
    let hand_tag = [17u8; 32];
    let seat = 2u8;
    let tier = 0u8;
    let secret = [34u8; 32];
    let nonce = [0u8; 32];
    let facts = [1u8; 6];
    let commitment = std::hash::blake2s(commitment_input(hand_tag, seat, tier, secret));
    let facts_hash = std::hash::blake2s(facts_input(hand_tag, seat, facts));
    let mut nullifier = std::hash::blake2s(nullifier_input(hand_tag, seat, tier, secret));

    nullifier[0] += 1;
    main(
        hand_tag,
        seat,
        tier,
        commitment,
        nonce,
        facts_hash,
        nullifier,
        secret,
        facts,
    );
}

#[test(should_fail)]
fn invalid_seat() {
    let hand_tag = [17u8; 32];
    let seat = 6u8;
    let tier = 0u8;
    let secret = [34u8; 32];
    let nonce = [0u8; 32];
    let facts = [1u8; 6];
    let commitment = std::hash::blake2s(commitment_input(hand_tag, seat, tier, secret));
    let facts_hash = std::hash::blake2s(facts_input(hand_tag, seat, facts));
    let nullifier = std::hash::blake2s(nullifier_input(hand_tag, seat, tier, secret));

    main(
        hand_tag,
        seat,
        tier,
        commitment,
        nonce,
        facts_hash,
        nullifier,
        secret,
        facts,
    );
}

#[test(should_fail)]
fn invalid_tier() {
    let hand_tag = [17u8; 32];
    let seat = 2u8;
    let tier = 2u8;
    let secret = [34u8; 32];
    let nonce = [0u8; 32];
    let facts = [1u8; 6];
    let commitment = std::hash::blake2s(commitment_input(hand_tag, seat, tier, secret));
    let facts_hash = std::hash::blake2s(facts_input(hand_tag, seat, facts));
    let nullifier = std::hash::blake2s(nullifier_input(hand_tag, seat, tier, secret));

    main(
        hand_tag,
        seat,
        tier,
        commitment,
        nonce,
        facts_hash,
        nullifier,
        secret,
        facts,
    );
}

#[test(should_fail)]
fn invalid_fact() {
    let hand_tag = [17u8; 32];
    let seat = 2u8;
    let tier = 0u8;
    let secret = [34u8; 32];
    let nonce = [0u8; 32];
    let facts = [2u8, 1, 1, 1, 1, 1];
    let commitment = std::hash::blake2s(commitment_input(hand_tag, seat, tier, secret));
    let facts_hash = std::hash::blake2s(facts_input(hand_tag, seat, facts));
    let nullifier = std::hash::blake2s(nullifier_input(hand_tag, seat, tier, secret));

    main(
        hand_tag,
        seat,
        tier,
        commitment,
        nonce,
        facts_hash,
        nullifier,
        secret,
        facts,
    );
}

#[test(should_fail)]
fn objective_missing() {
    run(0, 3, [0u8; 6], 0);
}
