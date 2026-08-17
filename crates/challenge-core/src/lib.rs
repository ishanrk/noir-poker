use blake2::{Blake2s256, Digest};

pub const PROTOCOL_VERSION: u8 = 1;
pub const TIER_EASY: u8 = 0;
pub const TIER_HARD: u8 = 1;
pub const EASY_POINTS: u8 = 10;
pub const HARD_POINTS: u8 = 25;
pub const FACT_COUNT: usize = 6;
pub const OBJECTIVES_PER_TIER: u8 = 4;

const COMMITMENT_DOMAIN: [u8; 8] = *b"NPCOMM01";
const SELECTOR_DOMAIN: [u8; 8] = *b"NPSELE01";
const FACTS_DOMAIN: [u8; 8] = *b"NPFACT01";
const NULLIFIER_DOMAIN: [u8; 8] = *b"NPNULL01";

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

pub const fn objective_met(tier: u8, index: u8, facts: Facts) -> bool {
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
    fn easy_objectives() {
        let mut facts = NONE;

        facts.saw_flop = true;
        assert!(objective_met(TIER_EASY, 0, facts));
        facts = NONE;
        facts.raised_preflop = true;
        assert!(objective_met(TIER_EASY, 1, facts));
        facts = NONE;
        facts.called_preflop = true;
        assert!(objective_met(TIER_EASY, 2, facts));
        facts = NONE;
        facts.checked_flop = true;
        assert!(objective_met(TIER_EASY, 3, facts));
    }

    #[test]
    fn hard_objectives() {
        let mut facts = NONE;

        facts.reached_showdown = true;
        assert!(objective_met(TIER_HARD, 0, facts));
        facts = NONE;
        facts.net_profit = true;
        assert!(objective_met(TIER_HARD, 1, facts));
        facts.raised_preflop = true;
        assert!(objective_met(TIER_HARD, 2, facts));
        facts.reached_showdown = true;
        facts.raised_preflop = false;
        assert!(objective_met(TIER_HARD, 3, facts));
    }

    #[test]
    fn invalid_objectives() {
        for index in 0..OBJECTIVES_PER_TIER {
            assert!(!objective_met(TIER_EASY, index, NONE));
            assert!(!objective_met(TIER_HARD, index, NONE));
        }

        assert!(!objective_met(2, 0, ALL));
        assert!(!objective_met(TIER_EASY, 4, ALL));
        assert!(!objective_met(TIER_HARD, 4, ALL));
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
        assert!(objective_met(TIER_EASY, index, ALL));
    }

    fn decode(value: &str) -> [u8; 32] {
        let mut bytes = [0u8; 32];

        for (i, byte) in bytes.iter_mut().enumerate() {
            *byte = u8::from_str_radix(&value[i * 2..i * 2 + 2], 16).unwrap();
        }

        bytes
    }
}
