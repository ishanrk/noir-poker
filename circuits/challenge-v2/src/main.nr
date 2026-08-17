global COMMITMENT_DOMAIN: [u8; 8] = [78, 80, 67, 79, 77, 77, 48, 50];
global SELECTOR_DOMAIN: [u8; 8] = [78, 80, 83, 69, 76, 69, 48, 50];
global FACTS_DOMAIN: [u8; 8] = [78, 80, 70, 65, 67, 84, 48, 50];
global NULLIFIER_DOMAIN: [u8; 8] = [78, 80, 78, 85, 76, 76, 48, 50];
global LEAF_DOMAIN: [u8; 8] = [78, 80, 76, 69, 65, 70, 48, 50];
global NODE_DOMAIN: [u8; 8] = [78, 80, 78, 79, 68, 69, 48, 50];

fn main(
    mode: pub u8,
    hand_tag: pub [u8; 32],
    seat: pub u8,
    commitment: pub [u8; 32],
    nonce: pub [u8; 32],
    facts_hash: pub [u8; 32],
    nullifier: pub [u8; 32],
    catalog_root: pub [u8; 32],
    secret: [u8; 32],
    facts_salt: [u8; 32],
    facts: [u8; 6],
    must_true: [u8; 6],
    must_false: [u8; 6],
    siblings: [[u8; 32]; 3],
) {
    assert(mode < 2);
    assert(seat < 6);

    for i in 0..6 {
        assert(must_true[i] < 2);
        assert(must_false[i] < 2);
        assert(must_true[i] + must_false[i] <= 1);
    }

    assert(literal_count(must_true, must_false) > 0);
    assert(std::hash::blake2s(commitment_input(hand_tag, seat, secret)) == commitment);

    let selector = std::hash::blake2s(selector_input(hand_tag, seat, nonce, secret));
    let index = selector[0] & 7;
    let leaf = std::hash::blake2s(leaf_input(index, must_true, must_false));

    assert(path_root(leaf, index, siblings) == catalog_root);

    if mode == 0 {
        assert(facts_hash == [0u8; 32]);
        assert(nullifier == [0u8; 32]);
    } else {
        for i in 0..6 {
            assert(facts[i] < 2);
        }

        assert(std::hash::blake2s(facts_input(hand_tag, seat, facts_salt, facts)) == facts_hash);
        assert(objective_met(must_true, must_false, facts));
        assert(std::hash::blake2s(nullifier_input(hand_tag, seat, secret)) == nullifier);
    }
}

fn commitment_input(hand_tag: [u8; 32], seat: u8, secret: [u8; 32]) -> [u8; 73] {
    let mut input = [0u8; 73];

    for i in 0..8 {
        input[i] = COMMITMENT_DOMAIN[i];
    }

    for i in 0..32 {
        input[8 + i] = hand_tag[i];
        input[41 + i] = secret[i];
    }

    input[40] = seat;
    input
}

fn selector_input(
    hand_tag: [u8; 32],
    seat: u8,
    nonce: [u8; 32],
    secret: [u8; 32],
) -> [u8; 105] {
    let mut input = [0u8; 105];

    for i in 0..8 {
        input[i] = SELECTOR_DOMAIN[i];
    }

    for i in 0..32 {
        input[8 + i] = hand_tag[i];
        input[41 + i] = nonce[i];
        input[73 + i] = secret[i];
    }

    input[40] = seat;
    input
}

fn facts_input(
    hand_tag: [u8; 32],
    seat: u8,
    facts_salt: [u8; 32],
    facts: [u8; 6],
) -> [u8; 79] {
    let mut input = [0u8; 79];

    for i in 0..8 {
        input[i] = FACTS_DOMAIN[i];
    }

    for i in 0..32 {
        input[8 + i] = hand_tag[i];
        input[41 + i] = facts_salt[i];
    }

    for i in 0..6 {
        input[73 + i] = facts[i];
    }

    input[40] = seat;
    input
}

fn nullifier_input(hand_tag: [u8; 32], seat: u8, secret: [u8; 32]) -> [u8; 73] {
    let mut input = [0u8; 73];

    for i in 0..8 {
        input[i] = NULLIFIER_DOMAIN[i];
    }

    for i in 0..32 {
        input[8 + i] = hand_tag[i];
        input[41 + i] = secret[i];
    }

    input[40] = seat;
    input
}

fn leaf_input(index: u8, must_true: [u8; 6], must_false: [u8; 6]) -> [u8; 21] {
    let mut input = [0u8; 21];

    for i in 0..8 {
        input[i] = LEAF_DOMAIN[i];
    }

    for i in 0..6 {
        input[9 + i] = must_true[i];
        input[15 + i] = must_false[i];
    }

    input[8] = index;
    input
}

fn node_input(left: [u8; 32], right: [u8; 32]) -> [u8; 72] {
    let mut input = [0u8; 72];

    for i in 0..8 {
        input[i] = NODE_DOMAIN[i];
    }

    for i in 0..32 {
        input[8 + i] = left[i];
        input[40 + i] = right[i];
    }

    input
}

fn path_root(leaf: [u8; 32], index: u8, siblings: [[u8; 32]; 3]) -> [u8; 32] {
    let mut hash = leaf;
    let mut position = index;

    for i in 0..3 {
        hash = if (position & 1) == 0 {
            std::hash::blake2s(node_input(hash, siblings[i]))
        } else {
            std::hash::blake2s(node_input(siblings[i], hash))
        };
        position = position >> 1;
    }

    hash
}

fn literal_count(must_true: [u8; 6], must_false: [u8; 6]) -> u8 {
    let mut count = 0u8;

    for i in 0..6 {
        count += must_true[i] + must_false[i];
    }

    count
}

fn objective_met(must_true: [u8; 6], must_false: [u8; 6], facts: [u8; 6]) -> bool {
    let mut met = true;

    for i in 0..6 {
        met = met & ((must_true[i] * (1 - facts[i])) == 0);
        met = met & ((must_false[i] * facts[i]) == 0);
    }

    met
}

fn canonical_true(index: u8) -> [u8; 6] {
    if index == 0 {
        [1, 0, 0, 0, 0, 0]
    } else if index == 1 {
        [0, 1, 0, 0, 0, 0]
    } else if index == 2 {
        [0, 0, 1, 0, 0, 0]
    } else if index == 3 {
        [0, 0, 0, 1, 0, 0]
    } else if index == 4 {
        [0, 0, 0, 0, 1, 0]
    } else if index == 5 {
        [0, 0, 0, 0, 0, 1]
    } else if index == 6 {
        [0, 1, 0, 0, 0, 1]
    } else {
        [0, 0, 0, 0, 1, 1]
    }
}

fn canonical_false(index: u8) -> [u8; 6] {
    if index == 7 {
        [0, 1, 0, 0, 0, 0]
    } else {
        [0; 6]
    }
}

fn catalog_leaves() -> [[u8; 32]; 8] {
    let mut leaves = [[0u8; 32]; 8];

    for i in 0..8 {
        let index = i as u8;
        leaves[i] = std::hash::blake2s(leaf_input(
            index,
            canonical_true(index),
            canonical_false(index),
        ));
    }

    leaves
}

fn catalog_path(index: u8) -> [[u8; 32]; 3] {
    let leaves = catalog_leaves();
    let mut level = [[0u8; 32]; 4];

    for i in 0..4 {
        level[i] = std::hash::blake2s(node_input(leaves[i * 2], leaves[i * 2 + 1]));
    }

    let next = [
        std::hash::blake2s(node_input(level[0], level[1])),
        std::hash::blake2s(node_input(level[2], level[3])),
    ];
    [leaves[(index ^ 1) as u32], level[((index >> 1) ^ 1) as u32], next[((index >> 2) ^ 1) as u32]]
}

fn catalog_root() -> [u8; 32] {
    let leaves = catalog_leaves();
    let left = std::hash::blake2s(node_input(
        std::hash::blake2s(node_input(leaves[0], leaves[1])),
        std::hash::blake2s(node_input(leaves[2], leaves[3])),
    ));
    let right = std::hash::blake2s(node_input(
        std::hash::blake2s(node_input(leaves[4], leaves[5])),
        std::hash::blake2s(node_input(leaves[6], leaves[7])),
    ));
    std::hash::blake2s(node_input(left, right))
}

fn prove(
    mode: u8,
    nonce_byte: u8,
    facts: [u8; 6],
    commitment_delta: u8,
    hash_delta: u8,
    nullifier_delta: u8,
    salt_byte: u8,
    mask_delta: u8,
    sibling_delta: u8,
) {
    let hand_tag = [17u8; 32];
    let seat = 2u8;
    let secret = [34u8; 32];
    let nonce = [nonce_byte; 32];
    let hash_salt = [68u8; 32];
    let facts_salt = [salt_byte; 32];
    let selector = std::hash::blake2s(selector_input(hand_tag, seat, nonce, secret));
    let index = selector[0] & 7;
    let mut commitment = std::hash::blake2s(commitment_input(hand_tag, seat, secret));
    let mut facts_hash = [0u8; 32];
    let mut nullifier = [0u8; 32];
    let mut must_true = canonical_true(index);
    let must_false = canonical_false(index);
    let mut siblings = catalog_path(index);

    if mode == 1 {
        facts_hash = std::hash::blake2s(facts_input(hand_tag, seat, hash_salt, facts));
        nullifier = std::hash::blake2s(nullifier_input(hand_tag, seat, secret));
    }

    commitment[0] += commitment_delta;
    facts_hash[0] += hash_delta;
    nullifier[0] += nullifier_delta;
    must_true[0] += mask_delta;
    siblings[0][0] += sibling_delta;
    main(
        mode,
        hand_tag,
        seat,
        commitment,
        nonce,
        facts_hash,
        nullifier,
        catalog_root(),
        secret,
        facts_salt,
        facts,
        must_true,
        must_false,
        siblings,
    );
}

#[test]
fn draw() {
    prove(0, 51, [0u8; 6], 0, 0, 0, 68, 0, 0);
}

#[test]
fn completion() {
    prove(1, 51, [1u8; 6], 0, 0, 0, 68, 0, 0);
}

#[test]
fn completion_false_literal() {
    prove(1, 3, [0, 0, 0, 0, 1, 1], 0, 0, 0, 68, 0, 0);
}

#[test(should_fail)]
fn wrong_commitment() {
    prove(0, 51, [0u8; 6], 1, 0, 0, 68, 0, 0);
}

#[test(should_fail)]
fn wrong_sibling() {
    prove(0, 51, [0u8; 6], 0, 0, 0, 68, 0, 1);
}

#[test(should_fail)]
fn wrong_masks() {
    prove(0, 51, [0u8; 6], 0, 0, 0, 68, 1, 0);
}

#[test(should_fail)]
fn draw_facts_hash() {
    prove(0, 51, [0u8; 6], 0, 1, 0, 68, 0, 0);
}

#[test(should_fail)]
fn draw_nullifier() {
    prove(0, 51, [0u8; 6], 0, 0, 1, 68, 0, 0);
}

#[test(should_fail)]
fn invalid_mode() {
    prove(2, 51, [0u8; 6], 0, 0, 0, 68, 0, 0);
}

#[test(should_fail)]
fn wrong_facts_salt() {
    prove(1, 51, [1u8; 6], 0, 0, 0, 69, 0, 0);
}

#[test(should_fail)]
fn wrong_facts_hash() {
    prove(1, 51, [1u8; 6], 0, 1, 0, 68, 0, 0);
}

#[test(should_fail)]
fn wrong_nullifier() {
    prove(1, 51, [1u8; 6], 0, 0, 1, 68, 0, 0);
}

#[test(should_fail)]
fn wrong_completion_path() {
    prove(1, 51, [1u8; 6], 0, 0, 0, 68, 0, 1);
}

#[test(should_fail)]
fn unmet_objective() {
    prove(1, 51, [0u8; 6], 0, 0, 0, 68, 0, 0);
}
