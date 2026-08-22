use ark_ec::{AffineRepr, CurveGroup, PrimeGroup};
use ark_ff::{BigInteger, PrimeField, Zero};
pub use ark_grumpkin::{Affine, Fr};
use ark_grumpkin::{Fq, Projective};
use sha2::{Digest, Sha256};

pub const CARD_COUNT: usize = 52;

const KEY_DOMAIN: &[u8] = b"NPKEY001";
const SHARE_DOMAIN: &[u8] = b"NPSHARE1";
const TRANSCRIPT_DOMAIN: &[u8] = b"NPDECK01";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Cipher {
    pub left: Affine,
    pub right: Affine,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Proof {
    pub a: Affine,
    pub b: Affine,
    pub z: Fr,
}

pub fn public_key(secret: Fr) -> Affine {
    (Projective::generator() * secret).into_affine()
}

pub fn aggregate(keys: &[Affine]) -> Affine {
    keys.iter()
        .fold(Projective::zero(), |sum, key| sum + key)
        .into_affine()
}

pub fn canonical_deck() -> [Cipher; CARD_COUNT] {
    core::array::from_fn(|i| Cipher {
        left: Affine::zero(),
        right: (Projective::generator() * Fr::from(i as u64 + 1)).into_affine(),
    })
}

pub fn remask(card: Cipher, mask: Fr, key: Affine) -> Cipher {
    Cipher {
        left: (Projective::from(card.left) + Projective::generator() * mask).into_affine(),
        right: (Projective::from(card.right) + key * mask).into_affine(),
    }
}

pub fn shuffle(
    deck: &[Cipher; CARD_COUNT],
    permutation: &[usize; CARD_COUNT],
    masks: &[Fr; CARD_COUNT],
    key: Affine,
) -> Option<[Cipher; CARD_COUNT]> {
    let mut seen = [false; CARD_COUNT];

    for &index in permutation {
        if index >= CARD_COUNT || seen[index] {
            return None;
        }
        seen[index] = true;
    }

    Some(core::array::from_fn(|i| {
        remask(deck[permutation[i]], masks[i], key)
    }))
}

pub fn share(card: Cipher, secret: Fr) -> Affine {
    (card.left * secret).into_affine()
}

pub fn open(card: Cipher, shares: &[Affine]) -> Option<u8> {
    let point = shares
        .iter()
        .fold(Projective::from(card.right), |value, share| value - share)
        .into_affine();

    (0..CARD_COUNT)
        .find(|&i| point == public_key(Fr::from(i as u64 + 1)))
        .map(|i| i as u8)
}

pub fn prove_key(secret: Fr, nonce: Fr, context: &[u8; 32]) -> Proof {
    let key = public_key(secret);
    let a = public_key(nonce);
    let c = challenge(KEY_DOMAIN, context, &[key, a]);

    Proof {
        a,
        b: Affine::zero(),
        z: nonce + c * secret,
    }
}

pub fn verify_key(key: Affine, proof: Proof, context: &[u8; 32]) -> bool {
    if key.is_zero() || proof.a.is_zero() || proof.z.is_zero() || !proof.b.is_zero() {
        return false;
    }
    let c = challenge(KEY_DOMAIN, context, &[key, proof.a]);

    public_key(proof.z) == (Projective::from(proof.a) + key * c).into_affine()
}

pub fn prove_share(card: Cipher, secret: Fr, nonce: Fr, context: &[u8; 32]) -> (Affine, Proof) {
    let key = public_key(secret);
    let value = share(card, secret);
    let a = public_key(nonce);
    let b = (card.left * nonce).into_affine();
    let c = challenge(SHARE_DOMAIN, context, &[key, card.left, value, a, b]);

    (
        value,
        Proof {
            a,
            b,
            z: nonce + c * secret,
        },
    )
}

pub fn verify_share(
    card: Cipher,
    key: Affine,
    value: Affine,
    proof: Proof,
    context: &[u8; 32],
) -> bool {
    if card.left.is_zero()
        || key.is_zero()
        || value.is_zero()
        || proof.a.is_zero()
        || proof.b.is_zero()
        || proof.z.is_zero()
    {
        return false;
    }
    let c = challenge(
        SHARE_DOMAIN,
        context,
        &[key, card.left, value, proof.a, proof.b],
    );

    public_key(proof.z) == (Projective::from(proof.a) + key * c).into_affine()
        && (card.left * proof.z).into_affine()
            == (Projective::from(proof.b) + value * c).into_affine()
}

pub fn transcript_start(room: [u8; 16], hand_no: u64) -> [u8; 32] {
    let mut hash = Sha256::new();

    hash.update(TRANSCRIPT_DOMAIN);
    hash.update(room);
    hash.update(hand_no.to_be_bytes());
    hash.finalize().into()
}

pub fn transcript_next(
    previous: [u8; 32],
    seq: u64,
    kind: &str,
    seat: Option<usize>,
    payload: &[u8],
) -> Option<[u8; 32]> {
    let kind = kind.as_bytes();
    let kind_len = u8::try_from(kind.len()).ok()?;
    let seat = match seat {
        Some(seat) => u8::try_from(seat).ok()?,
        None => u8::MAX,
    };
    let mut hash = Sha256::new();

    hash.update(TRANSCRIPT_DOMAIN);
    hash.update(previous);
    hash.update(seq.to_be_bytes());
    hash.update([kind_len]);
    hash.update(kind);
    hash.update([seat]);
    hash.update(Sha256::digest(payload));
    Some(hash.finalize().into())
}

pub fn point_bytes(point: Affine) -> [u8; 64] {
    if point.is_zero() {
        return [0; 64];
    }
    let mut bytes = [0; 64];
    let (x, y) = point.xy().expect("finite point");

    write_field(&mut bytes[..32], &x);
    write_field(&mut bytes[32..], &y);
    bytes
}

pub fn point_from_bytes(bytes: [u8; 64]) -> Option<Affine> {
    if bytes == [0; 64] {
        return Some(Affine::zero());
    }
    let x = field(&bytes[..32])?;
    let y = field(&bytes[32..])?;
    let point = Affine::new_unchecked(x, y);

    point.is_on_curve().then_some(point)
}

pub fn scalar_bytes(value: Fr) -> [u8; 32] {
    let mut bytes = [0; 32];
    let raw = value.into_bigint().to_bytes_be();

    bytes[32 - raw.len()..].copy_from_slice(&raw);
    bytes
}

pub fn scalar_from_bytes(bytes: [u8; 32]) -> Option<Fr> {
    let value = Fr::from_be_bytes_mod_order(&bytes);

    (scalar_bytes(value) == bytes).then_some(value)
}

fn challenge(domain: &[u8], context: &[u8; 32], points: &[Affine]) -> Fr {
    let mut hash = Sha256::new();

    hash.update(domain);
    hash.update(context);
    for &point in points {
        hash.update(point_bytes(point));
    }
    Fr::from_be_bytes_mod_order(&hash.finalize())
}

fn write_field(out: &mut [u8], value: &Fq) {
    let bytes = value.into_bigint().to_bytes_be();
    let start = out.len() - bytes.len();

    out[start..].copy_from_slice(&bytes);
}

fn field(bytes: &[u8]) -> Option<Fq> {
    let value = Fq::from_be_bytes_mod_order(bytes);
    let mut encoded = [0; 32];

    write_field(&mut encoded, &value);
    (encoded == bytes).then_some(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encrypted_shuffle_opens() {
        let a = Fr::from(7u64);
        let b = Fr::from(11u64);
        let key = aggregate(&[public_key(a), public_key(b)]);
        let deck = canonical_deck();
        let permutation = core::array::from_fn(|i| CARD_COUNT - i - 1);
        let masks = core::array::from_fn(|i| Fr::from(i as u64 + 100));
        let deck = shuffle(&deck, &permutation, &masks, key).unwrap();

        for (i, card) in deck.into_iter().enumerate() {
            assert_eq!(
                open(card, &[share(card, a), share(card, b)]),
                Some((51 - i) as u8)
            );
        }
    }

    #[test]
    fn proofs_bind_values() {
        let secret = Fr::from(7u64);
        let key = public_key(secret);
        let context = [9; 32];
        let proof = prove_key(secret, Fr::from(13u64), &context);

        assert!(verify_key(key, proof, &context));
        assert!(!verify_key(key, proof, &[8; 32]));

        let card = remask(canonical_deck()[3], Fr::from(17u64), key);
        let (value, proof) = prove_share(card, secret, Fr::from(19u64), &context);

        assert!(verify_share(card, key, value, proof, &context));
        assert!(!verify_share(card, key, value, proof, &[8; 32]));
    }

    #[test]
    fn transcript_binds_order() {
        let start = transcript_start([1; 16], 2);
        let a = transcript_next(start, 0, "key", Some(0), b"a").unwrap();
        let b = transcript_next(start, 0, "key", Some(0), b"b").unwrap();

        assert_ne!(a, b);
        assert_ne!(a, transcript_next(start, 1, "key", Some(0), b"a").unwrap());
    }

    #[test]
    fn encoding_round_trip() {
        let key = public_key(Fr::from(7u64));
        let secret = Fr::from(11u64);

        assert_eq!(point_from_bytes(point_bytes(key)), Some(key));
        assert_eq!(scalar_from_bytes(scalar_bytes(secret)), Some(secret));
        assert!(scalar_from_bytes([0xff; 32]).is_none());
    }
}
