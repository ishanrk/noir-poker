use blake2::{Blake2s256, Digest};

pub const PROTOCOL_VERSION: u8 = 2;
pub const POINTS: u8 = 20;
pub const MODE_DRAW: u8 = 0;
pub const MODE_COMPLETE: u8 = 1;
pub const FACT_COUNT: usize = 6;
pub const CATALOG_SIZE: usize = 8;
pub const TREE_DEPTH: usize = 3;

const HAND_DOMAIN: [u8; 8] = *b"NPHAND02";
const COMMITMENT_DOMAIN: [u8; 8] = *b"NPCOMM02";
const SELECTOR_DOMAIN: [u8; 8] = *b"NPSELE02";
const FACTS_DOMAIN: [u8; 8] = *b"NPFACT02";
const NULLIFIER_DOMAIN: [u8; 8] = *b"NPNULL02";
const LEAF_DOMAIN: [u8; 8] = *b"NPLEAF02";
const NODE_DOMAIN: [u8; 8] = *b"NPNODE02";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Objective {
    pub index: u8,
    pub must_true: [u8; FACT_COUNT],
    pub must_false: [u8; FACT_COUNT],
}

pub const CATALOG: [Objective; CATALOG_SIZE] = [
    Objective {
        index: 0,
        must_true: [1, 0, 0, 0, 0, 0],
        must_false: [0; FACT_COUNT],
    },
    Objective {
        index: 1,
        must_true: [0, 1, 0, 0, 0, 0],
        must_false: [0; FACT_COUNT],
    },
    Objective {
        index: 2,
        must_true: [0, 0, 1, 0, 0, 0],
        must_false: [0; FACT_COUNT],
    },
    Objective {
        index: 3,
        must_true: [0, 0, 0, 1, 0, 0],
        must_false: [0; FACT_COUNT],
    },
    Objective {
        index: 4,
        must_true: [0, 0, 0, 0, 1, 0],
        must_false: [0; FACT_COUNT],
    },
    Objective {
        index: 5,
        must_true: [0, 0, 0, 0, 0, 1],
        must_false: [0; FACT_COUNT],
    },
    Objective {
        index: 6,
        must_true: [0, 1, 0, 0, 0, 1],
        must_false: [0; FACT_COUNT],
    },
    Objective {
        index: 7,
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

pub fn commitment(hand_tag: [u8; 32], seat: u8, secret: [u8; 32]) -> [u8; 32] {
    let mut input = [0u8; 73];

    input[..8].copy_from_slice(&COMMITMENT_DOMAIN);
    input[8..40].copy_from_slice(&hand_tag);
    input[40] = seat;
    input[41..].copy_from_slice(&secret);

    Blake2s256::digest(input).into()
}

pub fn objective_index(hand_tag: [u8; 32], seat: u8, nonce: [u8; 32], secret: [u8; 32]) -> u8 {
    selector(hand_tag, seat, nonce, secret)[0] & 7
}

pub fn facts_hash(hand_tag: [u8; 32], seat: u8, salt: [u8; 32], facts: Facts) -> [u8; 32] {
    let mut input = [0u8; 79];

    input[..8].copy_from_slice(&FACTS_DOMAIN);
    input[8..40].copy_from_slice(&hand_tag);
    input[40] = seat;
    input[41..73].copy_from_slice(&salt);
    input[73..].copy_from_slice(&facts.bytes());

    Blake2s256::digest(input).into()
}

pub fn nullifier(hand_tag: [u8; 32], seat: u8, secret: [u8; 32]) -> [u8; 32] {
    let mut input = [0u8; 73];

    input[..8].copy_from_slice(&NULLIFIER_DOMAIN);
    input[8..40].copy_from_slice(&hand_tag);
    input[40] = seat;
    input[41..].copy_from_slice(&secret);

    Blake2s256::digest(input).into()
}

pub const fn objective(index: u8) -> Option<Objective> {
    if index < CATALOG_SIZE as u8 {
        Some(CATALOG[index as usize])
    } else {
        None
    }
}

pub fn objective_leaf(objective: Objective) -> [u8; 32] {
    let mut input = [0u8; 21];

    input[..8].copy_from_slice(&LEAF_DOMAIN);
    input[8] = objective.index;
    input[9..15].copy_from_slice(&objective.must_true);
    input[15..].copy_from_slice(&objective.must_false);

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

fn selector(hand_tag: [u8; 32], seat: u8, nonce: [u8; 32], secret: [u8; 32]) -> [u8; 32] {
    let mut input = [0u8; 105];

    input[..8].copy_from_slice(&SELECTOR_DOMAIN);
    input[8..40].copy_from_slice(&hand_tag);
    input[40] = seat;
    input[41..73].copy_from_slice(&nonce);
    input[73..].copy_from_slice(&secret);

    Blake2s256::digest(input).into()
}

#[cfg(test)]
mod tests {
    use super::*;

    const HAND: [u8; 32] = [0x11; 32];
    const SECRET: [u8; 32] = [0x22; 32];
    const NONCE: [u8; 32] = [0x33; 32];
    const SALT: [u8; 32] = [0x44; 32];

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
        assert_eq!(HAND_DOMAIN.len(), 8);
        assert_eq!(COMMITMENT_DOMAIN.len(), 8);
        assert_eq!(SELECTOR_DOMAIN.len(), 8);
        assert_eq!(FACTS_DOMAIN.len(), 8);
        assert_eq!(NULLIFIER_DOMAIN.len(), 8);
        assert_eq!(LEAF_DOMAIN.len(), 8);
        assert_eq!(NODE_DOMAIN.len(), 8);
    }

    #[test]
    fn commitments() {
        let value = commitment(HAND, 2, SECRET);

        assert_eq!(value, commitment(HAND, 2, SECRET));
        assert_ne!(value, commitment([0x12; 32], 2, SECRET));
        assert_ne!(value, commitment(HAND, 3, SECRET));
        assert_ne!(value, commitment(HAND, 2, [0x23; 32]));
    }

    #[test]
    fn selectors() {
        for nonce in 0..=u8::MAX {
            assert!(objective_index(HAND, 2, [nonce; 32], SECRET) < 8);
        }
    }

    #[test]
    fn fact_commitments() {
        let value = facts_hash(HAND, 2, SALT, ALL);

        assert_eq!(value, facts_hash(HAND, 2, SALT, ALL));
        assert_ne!(value, facts_hash([0x12; 32], 2, SALT, ALL));
        assert_ne!(value, facts_hash(HAND, 3, SALT, ALL));
        assert_ne!(value, facts_hash(HAND, 2, [0x45; 32], ALL));
        assert_ne!(value, facts_hash(HAND, 2, SALT, NONE));
    }

    #[test]
    fn nullifiers() {
        let value = nullifier(HAND, 2, SECRET);

        assert_eq!(value, nullifier(HAND, 2, SECRET));
        assert_ne!(value, nullifier([0x12; 32], 2, SECRET));
        assert_ne!(value, nullifier(HAND, 3, SECRET));
        assert_ne!(value, nullifier(HAND, 2, [0x23; 32]));
    }

    #[test]
    fn catalog() {
        assert_eq!(CATALOG.len(), CATALOG_SIZE);

        for (index, item) in CATALOG.into_iter().enumerate() {
            assert_eq!(item.index as usize, index);
            assert_eq!(
                path_root(objective_leaf(item), index, objective_path(index).unwrap()),
                Some(catalog_root())
            );
        }
    }

    #[test]
    fn objectives() {
        for item in &CATALOG[..7] {
            assert!(objective_met(*item, ALL));
        }

        assert!(!objective_met(CATALOG[0], NONE));
        assert!(!objective_met(CATALOG[7], ALL));
        assert!(objective_met(
            CATALOG[7],
            Facts {
                raised_preflop: false,
                reached_showdown: true,
                net_profit: true,
                ..NONE
            }
        ));
    }

    #[test]
    fn fixed_vector() {
        assert_eq!(
            hand_tag([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], 1),
            [
                20, 27, 125, 236, 107, 16, 89, 140, 84, 107, 223, 140, 206, 27, 227, 47, 102,
                94, 71, 17, 149, 157, 236, 202, 166, 127, 0, 242, 237, 144, 88, 52,
            ]
        );
        assert_eq!(
            commitment(HAND, 2, SECRET),
            [
                43, 198, 112, 233, 101, 135, 162, 148, 205, 132, 213, 22, 252, 91, 202, 18, 194,
                116, 117, 242, 74, 207, 189, 38, 92, 146, 252, 28, 222, 44, 152, 182,
            ]
        );
        assert_eq!(objective_index(HAND, 2, NONCE, SECRET), 6);
        assert_eq!(
            facts_hash(HAND, 2, SALT, ALL),
            [
                33, 159, 223, 40, 94, 162, 145, 238, 110, 44, 6, 95, 202, 132, 245, 142, 172, 11,
                190, 56, 198, 248, 118, 20, 223, 62, 93, 176, 29, 117, 49, 4,
            ]
        );
        assert_eq!(
            nullifier(HAND, 2, SECRET),
            [
                21, 151, 143, 95, 60, 73, 188, 53, 33, 238, 62, 29, 200, 212, 58, 176, 4, 40, 173,
                137, 154, 161, 5, 219, 58, 78, 200, 37, 204, 38, 215, 122,
            ]
        );
        assert_eq!(
            catalog_root(),
            [
                14, 88, 133, 241, 196, 42, 151, 153, 35, 122, 96, 111, 33, 79, 114, 86, 128, 109,
                119, 151, 113, 121, 229, 185, 255, 73, 234, 153, 180, 70, 196, 9,
            ]
        );
    }
}
