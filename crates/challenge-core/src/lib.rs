use blake2::{Blake2s256, Digest};

pub const PROTOCOL_VERSION: u8 = 1;
pub const TIER_EASY: u8 = 0;
pub const TIER_HARD: u8 = 1;
pub const EASY_POINTS: u8 = 10;
pub const HARD_POINTS: u8 = 25;
pub const FACT_COUNT: usize = 6;
pub const OBJECTIVES_PER_TIER: u8 = 4;
pub const CATALOG_SIZE: usize = 8;
pub const TREE_DEPTH: usize = 3;

const COMMITMENT_DOMAIN: [u8; 8] = *b"NPCOMM01";
const SELECTOR_DOMAIN: [u8; 8] = *b"NPSELE01";
const FACTS_DOMAIN: [u8; 8] = *b"NPFACT01";
const NULLIFIER_DOMAIN: [u8; 8] = *b"NPNULL01";
const HAND_DOMAIN: [u8; 8] = *b"NPHAND01";
const LEAF_DOMAIN: [u8; 8] = *b"NPLEAF01";
const NODE_DOMAIN: [u8; 8] = *b"NPNODE01";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Objective {
    pub tier: u8,
    pub slot: u8,
    pub must_true: [u8; FACT_COUNT],
    pub must_false: [u8; FACT_COUNT],
}

pub const CATALOG: [Objective; CATALOG_SIZE] = [
    Objective {
        tier: 0,
        slot: 0,
        must_true: [1, 0, 0, 0, 0, 0],
        must_false: [0; FACT_COUNT],
    },
    Objective {
        tier: 0,
        slot: 1,
        must_true: [0, 1, 0, 0, 0, 0],
        must_false: [0; FACT_COUNT],
    },
    Objective {
        tier: 0,
        slot: 2,
        must_true: [0, 0, 1, 0, 0, 0],
        must_false: [0; FACT_COUNT],
    },
    Objective {
        tier: 0,
        slot: 3,
        must_true: [0, 0, 0, 1, 0, 0],
        must_false: [0; FACT_COUNT],
    },
    Objective {
        tier: 1,
        slot: 0,
        must_true: [0, 0, 0, 0, 1, 0],
        must_false: [0; FACT_COUNT],
    },
    Objective {
        tier: 1,
        slot: 1,
        must_true: [0, 0, 0, 0, 0, 1],
        must_false: [0; FACT_COUNT],
    },
    Objective {
        tier: 1,
        slot: 2,
        must_true: [0, 1, 0, 0, 0, 1],
        must_false: [0; FACT_COUNT],
    },
    Objective {
        tier: 1,
        slot: 3,
        must_true: [0, 0, 0, 0, 1, 1],
        must_false: [0, 1, 0, 0, 0, 0],
    },
];

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Facts {
    pub saw_flop: bool,
    pub raised_preflop: bool,
    pub called_preflop: bool,
    pub checked_flop: bool,
    pub reached_showdown: bool,
    pub net_profit: bool,
}

impl Facts {
    pub const fn bytes(self) -> [u8; FACT_COUNT] {
        [
            self.saw_flop as u8,
            self.raised_preflop as u8,
            self.called_preflop as u8,
            self.checked_flop as u8,
            self.reached_showdown as u8,
            self.net_profit as u8,
        ]
    }
}

pub fn hand_tag(room: [u8; 16], hand_no: u64) -> [u8; 32] {
    let mut input = [0u8; 32];

    input[..8].copy_from_slice(&HAND_DOMAIN);
    input[8..24].copy_from_slice(&room);
    input[24..].copy_from_slice(&hand_no.to_be_bytes());

    Blake2s256::digest(input).into()
}

pub fn commitment(hand_tag: [u8; 32], seat: u8, tier: u8, secret: [u8; 32]) -> [u8; 32] {
    let mut input = [0u8; 74];

    input[..8].copy_from_slice(&COMMITMENT_DOMAIN);
    input[8..40].copy_from_slice(&hand_tag);
    input[40] = seat;
    input[41] = tier;
    input[42..].copy_from_slice(&secret);

    Blake2s256::digest(input).into()
}

pub fn objective_index(
    hand_tag: [u8; 32],
    seat: u8,
    tier: u8,
    nonce: [u8; 32],
    secret: [u8; 32],
) -> u8 {
    selector(hand_tag, seat, tier, nonce, secret)[0] & 3
}

pub fn facts_hash(hand_tag: [u8; 32], seat: u8, facts: Facts) -> [u8; 32] {
    let mut input = [0u8; 47];

    input[..8].copy_from_slice(&FACTS_DOMAIN);
    input[8..40].copy_from_slice(&hand_tag);
    input[40] = seat;
    input[41..].copy_from_slice(&facts.bytes());

    Blake2s256::digest(input).into()
}

pub fn nullifier(hand_tag: [u8; 32], seat: u8, tier: u8, secret: [u8; 32]) -> [u8; 32] {
    let mut input = [0u8; 74];

    input[..8].copy_from_slice(&NULLIFIER_DOMAIN);
    input[8..40].copy_from_slice(&hand_tag);
    input[40] = seat;
    input[41] = tier;
    input[42..].copy_from_slice(&secret);

    Blake2s256::digest(input).into()
}

pub const fn objective(tier: u8, slot: u8) -> Option<Objective> {
    if tier < 2 && slot < OBJECTIVES_PER_TIER {
        Some(CATALOG[(tier * OBJECTIVES_PER_TIER + slot) as usize])
    } else {
        None
    }
}

pub fn objective_leaf(objective: Objective) -> [u8; 32] {
    let mut input = [0u8; 22];

    input[..8].copy_from_slice(&LEAF_DOMAIN);
    input[8] = objective.tier;
    input[9] = objective.slot;
    input[10..16].copy_from_slice(&objective.must_true);
    input[16..].copy_from_slice(&objective.must_false);

    Blake2s256::digest(input).into()
}

pub fn node_hash(left: [u8; 32], right: [u8; 32]) -> [u8; 32] {
    let mut input = [0u8; 72];

    input[..8].copy_from_slice(&NODE_DOMAIN);
    input[8..40].copy_from_slice(&left);
    input[40..].copy_from_slice(&right);

    Blake2s256::digest(input).into()
}

pub fn catalog_root() -> [u8; 32] {
    let leaves = catalog_leaves();
    let mut level = [[0u8; 32]; 4];

    for i in 0..4 {
        level[i] = node_hash(leaves[i * 2], leaves[i * 2 + 1]);
    }

    let left = node_hash(level[0], level[1]);
    let right = node_hash(level[2], level[3]);
    node_hash(left, right)
}

pub fn objective_path(index: usize) -> Option<[[u8; 32]; TREE_DEPTH]> {
    if index >= CATALOG_SIZE {
        return None;
    }

    let leaves = catalog_leaves();
    let mut level = [[0u8; 32]; 4];

    for i in 0..4 {
        level[i] = node_hash(leaves[i * 2], leaves[i * 2 + 1]);
    }

    let next = [node_hash(level[0], level[1]), node_hash(level[2], level[3])];

    Some([
        leaves[index ^ 1],
        level[(index / 2) ^ 1],
        next[(index / 4) ^ 1],
    ])
}

pub fn path_root(
    mut hash: [u8; 32],
    mut index: usize,
    siblings: [[u8; 32]; TREE_DEPTH],
) -> Option<[u8; 32]> {
    if index >= CATALOG_SIZE {
        return None;
    }

    for sibling in siblings {
        hash = if index & 1 == 0 {
            node_hash(hash, sibling)
        } else {
            node_hash(sibling, hash)
        };
        index /= 2;
    }

    Some(hash)
}

pub const fn objective_met(objective: Objective, facts: Facts) -> bool {
    let values = facts.bytes();
    let mut literals = 0;
    let mut i = 0;

    while i < FACT_COUNT {
        let yes = objective.must_true[i];
        let no = objective.must_false[i];

        if yes > 1 || no > 1 || yes + no > 1 {
            return false;
        }

        literals += yes + no;

        if (yes == 1 && values[i] != 1) || (no == 1 && values[i] != 0) {
            return false;
        }

        i += 1;
    }

    literals > 0
}

fn catalog_leaves() -> [[u8; 32]; CATALOG_SIZE] {
    let mut leaves = [[0u8; 32]; CATALOG_SIZE];

    for (leaf, objective) in leaves.iter_mut().zip(CATALOG) {
        *leaf = objective_leaf(objective);
    }

    leaves
}

fn selector(hand_tag: [u8; 32], seat: u8, tier: u8, nonce: [u8; 32], secret: [u8; 32]) -> [u8; 32] {
    let mut input = [0u8; 106];

    input[..8].copy_from_slice(&SELECTOR_DOMAIN);
    input[8..40].copy_from_slice(&hand_tag);
    input[40] = seat;
    input[41] = tier;
    input[42..74].copy_from_slice(&nonce);
    input[74..].copy_from_slice(&secret);

    Blake2s256::digest(input).into()
}

#[cfg(test)]
mod tests {
    use super::*;

    const HAND: [u8; 32] = [0x11; 32];
    const SECRET: [u8; 32] = [0x22; 32];
    const NONCE: [u8; 32] = [0x33; 32];

    const ALL: Facts = Facts {
        saw_flop: true,
        raised_preflop: true,
        called_preflop: true,
        checked_flop: true,
        reached_showdown: true,
        net_profit: true,
    };

    const NONE: Facts = Facts {
        saw_flop: false,
        raised_preflop: false,
        called_preflop: false,
        checked_flop: false,
        reached_showdown: false,
        net_profit: false,
    };

    #[test]
    fn domains() {
        assert_eq!(COMMITMENT_DOMAIN.len(), 8);
        assert_eq!(SELECTOR_DOMAIN.len(), 8);
        assert_eq!(FACTS_DOMAIN.len(), 8);
        assert_eq!(NULLIFIER_DOMAIN.len(), 8);
        assert_eq!(HAND_DOMAIN.len(), 8);
        assert_eq!(LEAF_DOMAIN.len(), 8);
        assert_eq!(NODE_DOMAIN.len(), 8);
    }

    #[test]
    fn hand_tags() {
        let room = [0x44; 16];
        let tag = hand_tag(room, 1);

        assert_eq!(tag, hand_tag(room, 1));
        assert_ne!(tag, hand_tag(room, 2));
        assert_ne!(tag, hand_tag([0x45; 16], 1));
    }

    #[test]
    fn commitment_values() {
        assert_eq!(
            commitment(HAND, 2, TIER_EASY, SECRET),
            commitment(HAND, 2, TIER_EASY, SECRET)
        );
        assert_ne!(
            commitment(HAND, 2, TIER_EASY, SECRET),
            commitment([0x12; 32], 2, TIER_EASY, SECRET)
        );
        assert_ne!(
            commitment(HAND, 2, TIER_EASY, SECRET),
            commitment(HAND, 3, TIER_EASY, SECRET)
        );
        assert_ne!(
            commitment(HAND, 2, TIER_EASY, SECRET),
            commitment(HAND, 2, TIER_HARD, SECRET)
        );
        assert_ne!(
            commitment(HAND, 2, TIER_EASY, SECRET),
            commitment(HAND, 2, TIER_EASY, [0x23; 32])
        );
    }

    #[test]
    fn selector_values() {
        assert_ne!(
            selector(HAND, 2, TIER_EASY, NONCE, SECRET),
            selector(HAND, 2, TIER_EASY, [0x34; 32], SECRET)
        );
        assert_ne!(
            selector(HAND, 2, TIER_EASY, NONCE, SECRET),
            selector(HAND, 2, TIER_EASY, NONCE, [0x23; 32])
        );
        assert_ne!(
            selector(HAND, 2, TIER_EASY, NONCE, SECRET),
            selector(HAND, 2, TIER_HARD, NONCE, SECRET)
        );

        for nonce in 0..=u8::MAX {
            assert!(objective_index(HAND, 2, TIER_EASY, [nonce; 32], SECRET) < 4);
        }
    }

    #[test]
    fn fact_values() {
        assert_eq!(ALL.bytes(), [1, 1, 1, 1, 1, 1]);
        assert_eq!(NONE.bytes(), [0, 0, 0, 0, 0, 0]);
        assert_eq!(
            Facts {
                saw_flop: true,
                raised_preflop: false,
                called_preflop: true,
                checked_flop: false,
                reached_showdown: true,
                net_profit: false,
            }
            .bytes(),
            [1, 0, 1, 0, 1, 0]
        );
        assert_eq!(facts_hash(HAND, 2, ALL), facts_hash(HAND, 2, ALL));
        assert_ne!(facts_hash(HAND, 2, ALL), facts_hash([0x12; 32], 2, ALL));
        assert_ne!(facts_hash(HAND, 2, ALL), facts_hash(HAND, 3, ALL));
        assert_ne!(facts_hash(HAND, 2, ALL), facts_hash(HAND, 2, NONE));
    }

    #[test]
    fn nullifier_values() {
        let value = nullifier(HAND, 2, TIER_EASY, SECRET);

        assert_eq!(value, nullifier(HAND, 2, TIER_EASY, SECRET));
        assert_ne!(value, nullifier([0x12; 32], 2, TIER_EASY, SECRET));
        assert_ne!(value, nullifier(HAND, 3, TIER_EASY, SECRET));
        assert_ne!(value, nullifier(HAND, 2, TIER_HARD, SECRET));
    }

    #[test]
    fn catalog_values() {
        assert_eq!(CATALOG.len(), CATALOG_SIZE);
        assert_eq!(catalog_root(), catalog_root());

        for (index, objective) in CATALOG.into_iter().enumerate() {
            assert_eq!(objective.tier as usize * 4 + objective.slot as usize, index);
            assert_eq!(
                path_root(
                    objective_leaf(objective),
                    index,
                    objective_path(index).unwrap()
                ),
                Some(catalog_root())
            );
        }
    }

    #[test]
    fn invalid_paths() {
        let index = 2;
        let objective = CATALOG[index];
        let mut path = objective_path(index).unwrap();

        path.swap(0, 1);
        assert_ne!(
            path_root(objective_leaf(objective), index, path),
            Some(catalog_root())
        );

        let mut changed = objective;
        changed.must_true[0] = 1;
        assert_ne!(
            path_root(
                objective_leaf(changed),
                index,
                objective_path(index).unwrap()
            ),
            Some(catalog_root())
        );
        assert_eq!(objective_path(CATALOG_SIZE), None);
        assert_eq!(
            path_root([0; 32], CATALOG_SIZE, [[0; 32]; TREE_DEPTH]),
            None
        );
    }

    #[test]
    fn leaf_position() {
        let objective = CATALOG[0];
        let mut tier = objective;
        let mut slot = objective;

        tier.tier = 1;
        slot.slot = 1;
        assert_ne!(objective_leaf(objective), objective_leaf(tier));
        assert_ne!(objective_leaf(objective), objective_leaf(slot));
    }

    #[test]
    fn valid_objectives() {
        for objective in CATALOG {
            let mut literals = 0;

            for i in 0..FACT_COUNT {
                assert!(objective.must_true[i] < 2);
                assert!(objective.must_false[i] < 2);
                assert!(objective.must_true[i] + objective.must_false[i] <= 1);
                literals += objective.must_true[i] + objective.must_false[i];
            }

            assert!(literals > 0);
        }

        assert_eq!(objective(2, 0), None);
        assert_eq!(objective(TIER_EASY, 4), None);
    }

    #[test]
    fn objective_semantics() {
        for bits in 0u8..64 {
            let facts = facts_from(bits);

            for objective in CATALOG {
                assert_eq!(
                    objective_met(objective, facts),
                    prior_objective_met(objective.tier, objective.slot, facts)
                );
            }
        }

        let mut contradictory = CATALOG[0];
        contradictory.must_false[0] = 1;
        assert!(!objective_met(contradictory, ALL));
        assert!(!objective_met(
            Objective {
                must_true: [0; FACT_COUNT],
                ..CATALOG[0]
            },
            ALL
        ));
    }

    #[test]
    fn fixture_values() {
        let index = objective_index(HAND, 2, TIER_EASY, NONCE, SECRET);

        assert_eq!(
            commitment(HAND, 2, TIER_EASY, SECRET),
            decode("8db3780236f50489de3c16f2a7a06996f5239ffef4572abdf0234e89aefda674")
        );
        assert_eq!(
            selector(HAND, 2, TIER_EASY, NONCE, SECRET),
            decode("6a1c73af6b8a897beb9e2c1d338b94ce7a692f3f7d847a73201f5769148e1981")
        );
        assert_eq!(index, 2);
        assert_eq!(
            facts_hash(HAND, 2, ALL),
            decode("cdc4ad0d044f42a722aca8076bd3d8cdcacae3c49df34d84f45f481683592a23")
        );
        assert_eq!(
            nullifier(HAND, 2, TIER_EASY, SECRET),
            decode("4378956178b8af73c267002cd809d5ef2c42bd152a63f46ef48316be96c24411")
        );
        let objective = objective(TIER_EASY, index).unwrap();
        let path = objective_path(index as usize).unwrap();

        assert_eq!(
            objective_leaf(objective),
            decode("bd6fc38abc9f6b7f426a38ed28bcd8259429fe8817d37c2b173ded4477730436")
        );
        assert_eq!(
            path,
            [
                decode("0435da91a3d4c7e99c13b0bcf04b8171c35e62356b99b76d65fc4b111b7e9dc4"),
                decode("c8b3bb9a420a12a55d5d06f474bdb719d15643e41c89d403adf708d5812a53b5"),
                decode("43bf3aa41def544e83ccb9f02417f129a9580b4010466bb7157f9ae5f4735410"),
            ]
        );
        assert_eq!(
            catalog_root(),
            decode("b832b47c67eaa2f5b74be82cfad9fd77636f75d866cf1b8437358a7a8406e067")
        );
        assert!(objective_met(objective, ALL));
    }

    fn facts_from(bits: u8) -> Facts {
        Facts {
            saw_flop: bits & 1 != 0,
            raised_preflop: bits & 2 != 0,
            called_preflop: bits & 4 != 0,
            checked_flop: bits & 8 != 0,
            reached_showdown: bits & 16 != 0,
            net_profit: bits & 32 != 0,
        }
    }

    fn prior_objective_met(tier: u8, index: u8, facts: Facts) -> bool {
        match (tier, index) {
            (TIER_EASY, 0) => facts.saw_flop,
            (TIER_EASY, 1) => facts.raised_preflop,
            (TIER_EASY, 2) => facts.called_preflop,
            (TIER_EASY, 3) => facts.checked_flop,
            (TIER_HARD, 0) => facts.reached_showdown,
            (TIER_HARD, 1) => facts.net_profit,
            (TIER_HARD, 2) => facts.raised_preflop && facts.net_profit,
            (TIER_HARD, 3) => !facts.raised_preflop && facts.reached_showdown && facts.net_profit,
            _ => false,
        }
    }

    fn decode(value: &str) -> [u8; 32] {
        let mut bytes = [0u8; 32];

        for (i, byte) in bytes.iter_mut().enumerate() {
            *byte = u8::from_str_radix(&value[i * 2..i * 2 + 2], 16).unwrap();
        }

        bytes
    }
}
