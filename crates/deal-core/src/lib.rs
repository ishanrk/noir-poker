use sha2::{Digest, Sha256};

pub const PROTOCOL_VERSION: u8 = 1;
pub const CARD_COUNT: usize = 52;

const COMMIT_DOMAIN: [u8; 8] = *b"NPDEAL01";
const SEED_DOMAIN: [u8; 8] = *b"NPSEED01";
const STREAM_DOMAIN: [u8; 8] = *b"NPSTRM01";

pub fn commitment(room: [u8; 16], hand_no: u64, server_secret: [u8; 32]) -> [u8; 32] {
    let mut input = [0u8; 64];

    input[..8].copy_from_slice(&COMMIT_DOMAIN);
    input[8..24].copy_from_slice(&room);
    input[24..32].copy_from_slice(&hand_no.to_be_bytes());
    input[32..].copy_from_slice(&server_secret);
    Sha256::digest(input).into()
}

pub fn seed(
    room: [u8; 16],
    hand_no: u64,
    server_secret: [u8; 32],
    shares: &[[u8; 32]],
) -> Option<[u8; 32]> {
    let count = u8::try_from(shares.len()).ok()?;
    let mut input = Vec::with_capacity(8 + 16 + 8 + 1 + shares.len() * 33 + 32);

    input.extend_from_slice(&SEED_DOMAIN);
    input.extend_from_slice(&room);
    input.extend_from_slice(&hand_no.to_be_bytes());
    input.push(count);

    for (seat, share) in shares.iter().enumerate() {
        input.push(u8::try_from(seat).ok()?);
        input.extend_from_slice(share);
    }

    input.extend_from_slice(&server_secret);
    Some(Sha256::digest(input).into())
}

pub fn shuffle(seed: [u8; 32]) -> [u8; CARD_COUNT] {
    let mut cards = core::array::from_fn(|index| index as u8);
    let mut stream = HashStream::new(seed);

    for index in (1..CARD_COUNT).rev() {
        let swap = stream.sample(index as u32 + 1) as usize;
        cards.swap(index, swap);
    }

    cards
}

struct HashStream {
    seed: [u8; 32],
    counter: u64,
    block: [u8; 32],
    offset: usize,
}

impl HashStream {
    const fn new(seed: [u8; 32]) -> Self {
        Self {
            seed,
            counter: 0,
            block: [0; 32],
            offset: 32,
        }
    }

    fn sample(&mut self, upper: u32) -> u32 {
        let limit = (1u64 << 32) / u64::from(upper) * u64::from(upper);

        loop {
            let value = u64::from(self.word());

            if value < limit {
                return (value % u64::from(upper)) as u32;
            }
        }
    }

    fn word(&mut self) -> u32 {
        if self.offset == self.block.len() {
            let mut input = [0u8; 48];

            input[..8].copy_from_slice(&STREAM_DOMAIN);
            input[8..40].copy_from_slice(&self.seed);
            input[40..].copy_from_slice(&self.counter.to_be_bytes());
            self.block = Sha256::digest(input).into();
            self.counter = self.counter.checked_add(1).expect("deal stream limit");
            self.offset = 0;
        }

        let bytes: [u8; 4] = self.block[self.offset..self.offset + 4]
            .try_into()
            .expect("deal stream word");
        self.offset += 4;
        u32::from_be_bytes(bytes)
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::*;

    const ROOM: [u8; 16] = [
        0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee,
        0xff,
    ];
    const SECRET: [u8; 32] = [0x11; 32];
    const SHARES: [[u8; 32]; 3] = [[0x22; 32], [0x33; 32], [0x44; 32]];
    const EXPECTED_DECK: [u8; 52] = [
        38, 18, 43, 22, 5, 11, 33, 35, 47, 24, 32, 25, 23, 2, 6, 46, 48, 27, 4, 3, 44, 42, 15, 13,
        39, 30, 49, 41, 7, 1, 12, 37, 9, 10, 20, 40, 17, 21, 0, 29, 36, 8, 26, 16, 14, 28, 19, 51,
        50, 31, 45, 34,
    ];

    #[test]
    fn vector() {
        let commitment = commitment(ROOM, 7, SECRET);
        let seed = seed(ROOM, 7, SECRET, &SHARES).unwrap();

        assert_eq!(
            commitment,
            hex("e11f12bea858c9319b49f596f39f61976f5085010dd16069661ee759f7cda74a")
        );
        assert_eq!(
            seed,
            hex("2804b581997cff7e45e6801f10130d4638188c6c19115f7741273282cbef08bd")
        );
        assert_eq!(shuffle(seed), EXPECTED_DECK);
    }

    #[test]
    fn complete_permutation() {
        let deck = shuffle([0x5a; 32]);
        let unique: HashSet<_> = deck.into_iter().collect();

        assert_eq!(unique.len(), CARD_COUNT);
        assert!(unique.into_iter().all(|card| card < CARD_COUNT as u8));
    }

    #[test]
    fn every_input_is_bound() {
        let base = seed(ROOM, 7, SECRET, &SHARES).unwrap();

        assert_ne!(base, seed([1; 16], 7, SECRET, &SHARES).unwrap());
        assert_ne!(base, seed(ROOM, 8, SECRET, &SHARES).unwrap());
        assert_ne!(base, seed(ROOM, 7, [2; 32], &SHARES).unwrap());
        assert_ne!(base, seed(ROOM, 7, SECRET, &SHARES[..2]).unwrap());
    }

    fn hex(value: &str) -> [u8; 32] {
        let mut bytes = [0; 32];

        for (index, byte) in bytes.iter_mut().enumerate() {
            *byte = u8::from_str_radix(&value[index * 2..index * 2 + 2], 16).unwrap();
        }

        bytes
    }
}
