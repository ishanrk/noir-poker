global COMMITMENT_DOMAIN: [u8; 8] = [78, 80, 67, 79, 77, 77, 48, 49];
global SELECTOR_DOMAIN: [u8; 8] = [78, 80, 83, 69, 76, 69, 48, 49];
global FACTS_DOMAIN: [u8; 8] = [78, 80, 70, 65, 67, 84, 48, 49];
global NULLIFIER_DOMAIN: [u8; 8] = [78, 80, 78, 85, 76, 76, 48, 49];
global LEAF_DOMAIN: [u8; 8] = [78, 80, 76, 69, 65, 70, 48, 49];
global NODE_DOMAIN: [u8; 8] = [78, 80, 78, 79, 68, 69, 48, 49];

fn main(
    hand_tag: pub [u8; 32],
    seat: pub u8,
    tier: pub u8,
    commitment: pub [u8; 32],
    nonce: pub [u8; 32],
    facts_hash: pub [u8; 32],
    nullifier: pub [u8; 32],
    catalog_root: pub [u8; 32],
    secret: [u8; 32],
    facts: [u8; 6],
    must_true: [u8; 6],
    must_false: [u8; 6],
    siblings: [[u8; 32]; 3],
) {
    assert(seat < 6);
    assert(tier < 2);

    for i in 0..6 {
        assert(facts[i] < 2);
        assert(must_true[i] < 2);
        assert(must_false[i] < 2);
        assert(must_true[i] + must_false[i] <= 1);
    }

    assert(literal_count(must_true, must_false) > 0);
    assert(std::hash::blake2s(commitment_input(hand_tag, seat, tier, secret)) == commitment);

    let selector = std::hash::blake2s(selector_input(hand_tag, seat, tier, nonce, secret));
    let slot = selector[0] & 3;
    let index = tier * 4 + slot;
    let leaf = std::hash::blake2s(leaf_input(tier, slot, must_true, must_false));

    assert(path_root(leaf, index, siblings) == catalog_root);
    assert(std::hash::blake2s(facts_input(hand_tag, seat, facts)) == facts_hash);
    assert(objective_met(must_true, must_false, facts));
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

fn leaf_input(tier: u8, slot: u8, must_true: [u8; 6], must_false: [u8; 6]) -> [u8; 22] {
    let mut input = [0u8; 22];

    for i in 0..8 {
        input[i] = LEAF_DOMAIN[i];
    }

    for i in 0..6 {
        input[10 + i] = must_true[i];
        input[16 + i] = must_false[i];
    }

    input[8] = tier;
    input[9] = slot;
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

// test catalog witness
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
        let tier = index / 4;
        let slot = index & 3;
        leaves[i] = std::hash::blake2s(leaf_input(
            tier,
            slot,
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
    seat: u8,
    tier: u8,
    nonce_byte: u8,
    facts: [u8; 6],
    must_true: [u8; 6],
    must_false: [u8; 6],
    siblings: [[u8; 32]; 3],
    root: [u8; 32],
    commitment_delta: u8,
    facts_delta: u8,
    nullifier_delta: u8,
) {
    let hand_tag = [17u8; 32];
    let secret = [34u8; 32];
    let nonce = [nonce_byte; 32];
    let mut commitment = std::hash::blake2s(commitment_input(hand_tag, seat, tier, secret));
    let mut facts_hash = std::hash::blake2s(facts_input(hand_tag, seat, facts));
    let mut nullifier = std::hash::blake2s(nullifier_input(hand_tag, seat, tier, secret));

    commitment[0] += commitment_delta;
    facts_hash[0] += facts_delta;
    nullifier[0] += nullifier_delta;
    main(
        hand_tag,
        seat,
        tier,
        commitment,
        nonce,
        facts_hash,
        nullifier,
        root,
        secret,
        facts,
        must_true,
        must_false,
        siblings,
    );
}

fn run(tier: u8, nonce_byte: u8, facts: [u8; 6], expected_slot: u8) {
    let hand_tag = [17u8; 32];
    let seat = 2u8;
    let secret = [34u8; 32];
    let nonce = [nonce_byte; 32];
    let selector = std::hash::blake2s(selector_input(hand_tag, seat, tier, nonce, secret));
    let index = tier * 4 + expected_slot;

    assert((selector[0] & 3) == expected_slot);
    prove(
        seat,
        tier,
        nonce_byte,
        facts,
        canonical_true(index),
        canonical_false(index),
        catalog_path(index),
        catalog_root(),
        0,
        0,
        0,
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
    let must_true = [0, 0, 1, 0, 0, 0];
    let must_false = [0u8; 6];
    let siblings = [
        [
            4, 53, 218, 145, 163, 212, 199, 233, 156, 19, 176, 188, 240, 75, 129, 113, 195, 94, 98,
            53, 107, 153, 183, 109, 101, 252, 75, 17, 27, 126, 157, 196,
        ],
        [
            200, 179, 187, 154, 66, 10, 18, 165, 93, 93, 6, 244, 116, 189, 183, 25, 209, 86, 67,
            228, 28, 137, 212, 3, 173, 247, 8, 213, 129, 42, 83, 181,
        ],
        [
            67, 191, 58, 164, 29, 239, 84, 78, 131, 204, 185, 240, 36, 23, 241, 41, 169, 88, 11, 64,
            16, 70, 107, 183, 21, 127, 154, 229, 244, 115, 84, 16,
        ],
    ];
    let root = [
        184, 50, 180, 124, 103, 234, 162, 245, 183, 75, 232, 44, 250, 217, 253, 119, 99, 111, 117,
        216, 102, 207, 27, 132, 55, 53, 138, 122, 132, 6, 224, 103,
    ];
    let selector = std::hash::blake2s(selector_input(hand_tag, seat, tier, nonce, secret));
    let leaf = std::hash::blake2s(leaf_input(tier, 2, must_true, must_false));

    assert(selector == expected_selector);
    assert(root == catalog_root());
    assert(siblings == catalog_path(2));
    assert(
        leaf
            == [
                189, 111, 195, 138, 188, 159, 107, 127, 66, 106, 56, 237, 40, 188, 216, 37, 148, 41,
                254, 136, 23, 211, 124, 43, 23, 61, 237, 68, 119, 115, 4, 54,
            ],
    );
    main(
        hand_tag,
        seat,
        tier,
        commitment,
        nonce,
        facts_hash,
        nullifier,
        root,
        secret,
        facts,
        must_true,
        must_false,
        siblings,
    );
}

#[test(should_fail)]
fn wrong_catalog_root() {
    let mut root = catalog_root();
    root[0] += 1;
    prove(
        2,
        0,
        0,
        [1u8; 6],
        canonical_true(2),
        canonical_false(2),
        catalog_path(2),
        root,
        0,
        0,
        0,
    );
}

#[test(should_fail)]
fn wrong_sibling() {
    let mut path = catalog_path(2);
    path[0][0] += 1;
    prove(
        2,
        0,
        0,
        [1u8; 6],
        canonical_true(2),
        canonical_false(2),
        path,
        catalog_root(),
        0,
        0,
        0,
    );
}

#[test(should_fail)]
fn easier_predicate_attack() {
    prove(
        2,
        0,
        0,
        [1, 0, 0, 0, 0, 0],
        canonical_true(0),
        canonical_false(0),
        catalog_path(2),
        catalog_root(),
        0,
        0,
        0,
    );
}

#[test(should_fail)]
fn wrong_tier() {
    prove(
        2,
        2,
        0,
        [1u8; 6],
        canonical_true(2),
        canonical_false(2),
        catalog_path(2),
        catalog_root(),
        0,
        0,
        0,
    );
}

#[test(should_fail)]
fn wrong_commitment() {
    prove(
        2,
        0,
        0,
        [1u8; 6],
        canonical_true(2),
        canonical_false(2),
        catalog_path(2),
        catalog_root(),
        1,
        0,
        0,
    );
}

#[test(should_fail)]
fn wrong_nonce_slot() {
    prove(
        2,
        0,
        4,
        [1u8; 6],
        canonical_true(0),
        canonical_false(0),
        catalog_path(0),
        catalog_root(),
        0,
        0,
        0,
    );
}

#[test(should_fail)]
fn wrong_facts_hash() {
    prove(
        2,
        0,
        0,
        [1u8; 6],
        canonical_true(2),
        canonical_false(2),
        catalog_path(2),
        catalog_root(),
        0,
        1,
        0,
    );
}

#[test(should_fail)]
fn wrong_nullifier() {
    prove(
        2,
        0,
        0,
        [1u8; 6],
        canonical_true(2),
        canonical_false(2),
        catalog_path(2),
        catalog_root(),
        0,
        0,
        1,
    );
}

#[test(should_fail)]
fn unmet_objective() {
    run(0, 0, [0u8; 6], 2);
}

#[test(should_fail)]
fn contradictory_masks() {
    prove(
        2,
        0,
        0,
        [1u8; 6],
        [0, 0, 1, 0, 0, 0],
        [0, 0, 1, 0, 0, 0],
        catalog_path(2),
        catalog_root(),
        0,
        0,
        0,
    );
}

#[test(should_fail)]
fn empty_objective() {
    prove(
        2,
        0,
        0,
        [1u8; 6],
        [0u8; 6],
        [0u8; 6],
        catalog_path(2),
        catalog_root(),
        0,
        0,
        0,
    );
}

#[test(should_fail)]
fn invalid_fact() {
    run(0, 0, [2, 1, 1, 1, 1, 1], 2);
}

#[test(should_fail)]
fn invalid_seat() {
    prove(
        6,
        0,
        0,
        [1u8; 6],
        canonical_true(2),
        canonical_false(2),
        catalog_path(2),
        catalog_root(),
        0,
        0,
        0,
    );
}
