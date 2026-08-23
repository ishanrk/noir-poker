use std::collections::BTreeMap;

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use deck_crypto::{
    Affine, CARD_COUNT, Cipher, Fr, Proof, aggregate, canonical_deck, open, point_bytes,
    point_from_bytes, prove_key, prove_share, public_key, scalar_bytes, scalar_from_bytes, share,
    transcript_next, transcript_start, verify_key, verify_share,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::deck_proof::ShuffleProof;

pub const VERSION: u8 = 1;
const SERVER: usize = 0;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct PointWire {
    pub x: String,
    pub y: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct CipherWire {
    pub left: PointWire,
    pub right: PointWire,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ProofWire {
    pub a: PointWire,
    pub b: PointWire,
    pub z: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ShareWire {
    pub participant: usize,
    pub position: usize,
    pub context: String,
    pub value: PointWire,
    pub proof: ProofWire,
}

pub type PrivatePacket = Vec<(usize, CipherWire, Vec<ShareWire>)>;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct RecordWire {
    pub seq: u64,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub seat: Option<usize>,
    pub payload: String,
    pub hash: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ShuffleWire {
    pub participant: usize,
    pub input: Vec<CipherWire>,
    pub output: Vec<CipherWire>,
    pub proof: String,
    pub public_inputs: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct AuditWire {
    pub protocol_version: u8,
    pub room: Uuid,
    pub hand_no: u64,
    pub dealer: usize,
    pub human: Vec<bool>,
    pub transcript_hash: String,
    pub keys: Vec<PointWire>,
    pub key_proofs: Vec<ProofWire>,
    pub shuffles: Vec<ShuffleWire>,
    pub openings: Vec<String>,
    pub deck: Vec<u8>,
    pub records: Vec<RecordWire>,
}

#[derive(Clone)]
pub struct ShuffleRecord {
    pub participant: usize,
    pub input: [Cipher; CARD_COUNT],
    pub output: [Cipher; CARD_COUNT],
    pub proof: Vec<u8>,
    pub public_inputs: Vec<u8>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum OpenKind {
    Private,
    Board,
}

#[derive(Clone)]
pub struct Opening {
    pub kind: OpenKind,
    pub positions: Vec<usize>,
    pub shares: BTreeMap<(usize, usize), (Affine, Proof, [u8; 32])>,
}

#[derive(Clone)]
pub struct MentalDeck {
    pub room: Uuid,
    pub hand_no: u64,
    pub dealer: usize,
    pub human: Vec<bool>,
    pub seats: Vec<usize>,
    pub server_secret: Fr,
    pub keys: Vec<Option<(Affine, Proof)>>,
    pub deck: [Cipher; CARD_COUNT],
    pub shuffles: Vec<ShuffleRecord>,
    pub next_shuffle: usize,
    pub opening: Option<Opening>,
    pub private_ready: Vec<bool>,
    pub secrets: Vec<Option<Fr>>,
    pub opened: [Option<u8>; CARD_COUNT],
    pub records: Vec<RecordWire>,
    pub head: [u8; 32],
    pub complete: bool,
}

impl MentalDeck {
    pub fn new(
        room: Uuid,
        hand_no: u64,
        dealer: usize,
        human: Vec<bool>,
        server_secret: Fr,
        nonce: Fr,
    ) -> Self {
        let head = transcript_start(*room.as_bytes(), hand_no);
        let key = public_key(server_secret);
        let proof = prove_key(server_secret, nonce, &head);
        let seats = human
            .iter()
            .enumerate()
            .filter_map(|(seat, human)| human.then_some(seat))
            .collect::<Vec<_>>();
        let player_count = human.len();
        let mut state = Self {
            room,
            hand_no,
            dealer,
            keys: vec![None; seats.len() + 1],
            human,
            seats,
            server_secret,
            deck: canonical_deck(),
            shuffles: Vec::new(),
            next_shuffle: 0,
            opening: None,
            private_ready: vec![false; player_count],
            secrets: Vec::new(),
            opened: [None; CARD_COUNT],
            records: Vec::new(),
            head,
            complete: false,
        };
        state.secrets = vec![None; state.keys.len()];
        state.secrets[SERVER] = Some(server_secret);
        state.keys[SERVER] = Some((key, proof));
        state.record("key", None, &key_payload(key, proof));
        state
    }

    pub fn next_key(&self) -> Option<usize> {
        self.seats
            .iter()
            .enumerate()
            .find(|(index, _)| self.keys[*index + 1].is_none())
            .map(|(_, seat)| *seat)
    }

    pub fn add_key(&mut self, seat: usize, key: Affine, proof: Proof) -> Result<(), &'static str> {
        if self.next_key() != Some(seat) || !verify_key(key, proof, &self.head) {
            return Err("invalid deck key");
        }
        let participant = self.participant(seat).ok_or("invalid deck seat")?;
        self.keys[participant] = Some((key, proof));
        self.record("key", Some(seat), &key_payload(key, proof));
        Ok(())
    }

    pub fn aggregate_key(&self) -> Option<Affine> {
        self.keys
            .iter()
            .map(|entry| entry.map(|entry| entry.0))
            .collect::<Option<Vec<_>>>()
            .map(|keys| aggregate(&keys))
    }

    pub fn next_shuffler(&self) -> Option<usize> {
        (self.next_shuffle < self.keys.len()).then_some(self.next_shuffle)
    }

    pub fn participant_for(&self, seat: usize) -> Option<usize> {
        self.participant(seat)
    }

    pub fn owner_at(&self, position: usize) -> Option<usize> {
        self.owner(position)
    }

    pub fn add_shuffle(
        &mut self,
        participant: usize,
        output: [Cipher; CARD_COUNT],
        proof: ShuffleProof,
    ) -> Result<(), &'static str> {
        if self.next_shuffler() != Some(participant) {
            return Err("wrong deck shuffler");
        }
        let input = self.deck;
        let payload = shuffle_payload(participant, &input, &output, &proof);

        self.deck = output;
        self.shuffles.push(ShuffleRecord {
            participant,
            input,
            output,
            proof: proof.proof_bytes,
            public_inputs: proof.public_input_bytes,
        });
        self.next_shuffle += 1;
        self.record("shuffle", participant.checked_sub(1), &payload);
        Ok(())
    }

    pub fn shuffled(&self) -> bool {
        self.next_shuffle == self.keys.len()
    }

    pub fn begin_open(
        &mut self,
        kind: OpenKind,
        positions: Vec<usize>,
    ) -> Result<(), &'static str> {
        if !self.shuffled()
            || self.opening.is_some()
            || positions.is_empty()
            || positions.iter().any(|&position| position >= CARD_COUNT)
        {
            return Err("deck opening unavailable");
        }
        self.opening = Some(Opening {
            kind,
            positions,
            shares: BTreeMap::new(),
        });
        self.private_ready.fill(false);
        let context = self.head;
        let positions = self
            .opening
            .as_ref()
            .expect("deck opening")
            .positions
            .clone();
        let mut payload = Vec::new();
        for position in positions {
            let nonce = share_nonce(self.server_secret, context, position);
            let value = prove_share(self.deck[position], self.server_secret, nonce, &context);
            self.opening
                .as_mut()
                .expect("deck opening")
                .shares
                .insert((SERVER, position), (value.0, value.1, context));
            payload.extend(share_payload(position, value.0, value.1));
        }
        self.record("share", None, &payload);
        Ok(())
    }

    pub fn needed_shares(&self, seat: usize) -> Option<Vec<usize>> {
        let participant = self.participant(seat)?;
        let opening = self.opening.as_ref()?;

        if !self.human.get(seat).copied().unwrap_or(false) {
            return None;
        }
        let positions = opening
            .positions
            .iter()
            .copied()
            .filter(|&position| {
                let owner = self.owner(position);
                opening.kind == OpenKind::Board || owner != Some(seat) || self.complete
            })
            .filter(|&position| !opening.shares.contains_key(&(participant, position)))
            .collect::<Vec<_>>();

        (!positions.is_empty()).then_some(positions)
    }

    pub fn add_shares(&mut self, seat: usize, values: Vec<ShareWire>) -> Result<(), &'static str> {
        let participant = self.participant(seat).ok_or("invalid deck seat")?;
        let expected = self
            .needed_shares(seat)
            .ok_or("deck shares not requested")?;
        if values.len() != expected.len() {
            return Err("invalid deck shares");
        }
        let key = self.keys[participant].ok_or("deck key missing")?.0;
        let context = self.head;
        let mut parsed = Vec::with_capacity(values.len());
        let mut payload = Vec::new();

        for (wire, position) in values.into_iter().zip(expected) {
            if wire.participant != participant
                || wire.position != position
                || wire.context != hex(&context)
            {
                return Err("invalid deck shares");
            }
            let value = point_from_wire(wire.value)?;
            let proof = proof_from_wire(wire.proof)?;
            if !verify_share(self.deck[position], key, value, proof, &context) {
                return Err("invalid deck share proof");
            }
            payload.extend(share_payload(position, value, proof));
            parsed.push((position, value, proof));
        }
        let opening = self.opening.as_mut().expect("deck opening");
        for (position, value, proof) in parsed {
            opening
                .shares
                .insert((participant, position), (value, proof, context));
        }
        self.record("share", Some(seat), &payload);
        Ok(())
    }

    pub fn ready_to_open(&self) -> bool {
        self.opening.as_ref().is_some_and(|opening| {
            opening.positions.iter().all(|&position| {
                self.human.iter().enumerate().all(|(seat, human)| {
                    !*human
                        || self.owner(position) == Some(seat) && opening.kind == OpenKind::Private
                        || self.participant(seat).is_some_and(|participant| {
                            opening.shares.contains_key(&(participant, position))
                        })
                })
            })
        })
    }

    pub fn open_requested(&mut self) -> Result<Vec<(usize, u8)>, &'static str> {
        if !self.ready_to_open() {
            return Err("deck shares missing");
        }
        let opening = self.opening.take().expect("deck opening");
        let mut result = Vec::new();

        for position in opening.positions {
            let mut shares = vec![opening.shares[&(SERVER, position)].0];
            for (seat, human) in self.human.iter().enumerate() {
                if !*human
                    || self.owner(position) == Some(seat) && opening.kind == OpenKind::Private
                {
                    continue;
                }
                let participant = self.participant(seat).expect("human participant");
                shares.push(opening.shares[&(participant, position)].0);
            }
            if self.owner(position).is_some_and(|seat| self.human[seat])
                && opening.kind == OpenKind::Private
            {
                continue;
            }
            let card = open(self.deck[position], &shares).ok_or("invalid deck opening")?;
            self.opened[position] = Some(card);
            result.push((position, card));
        }
        let mut payload = Vec::new();
        for &(position, card) in &result {
            payload.extend_from_slice(&(position as u64).to_be_bytes());
            payload.push(card);
        }
        self.record("reveal", None, &payload);
        Ok(result)
    }

    pub fn private_packet(&self, seat: usize) -> Result<PrivatePacket, &'static str> {
        let opening = self.opening.as_ref().ok_or("private cards unavailable")?;
        if opening.kind != OpenKind::Private || !self.ready_to_open() {
            return Err("private cards unavailable");
        }
        opening
            .positions
            .iter()
            .copied()
            .filter(|&position| self.owner(position) == Some(seat))
            .map(|position| {
                let server = opening.shares[&(SERVER, position)];
                let mut shares = vec![ShareWire {
                    participant: SERVER,
                    position,
                    context: hex(&server.2),
                    value: point_wire(server.0),
                    proof: proof_wire(server.1),
                }];
                for (other, human) in self.human.iter().enumerate() {
                    if *human && other != seat {
                        let participant = self.participant(other).expect("human participant");
                        let value = opening.shares[&(participant, position)];
                        shares.push(ShareWire {
                            participant,
                            position,
                            context: hex(&value.2),
                            value: point_wire(value.0),
                            proof: proof_wire(value.1),
                        });
                    }
                }
                Ok((position, cipher_wire(self.deck[position]), shares))
            })
            .collect()
    }

    pub fn private_ack(&mut self, seat: usize) -> Result<(), &'static str> {
        if !self.human.get(seat).copied().unwrap_or(false)
            || self.opening.as_ref().map(|opening| opening.kind) != Some(OpenKind::Private)
            || !self.ready_to_open()
            || self.private_ready[seat]
        {
            return Err("private cards unavailable");
        }
        self.private_ready[seat] = true;
        Ok(())
    }

    pub fn private_done(&self) -> bool {
        self.human
            .iter()
            .enumerate()
            .all(|(seat, human)| !*human || self.private_ready[seat])
    }

    pub fn reveal_secret(&mut self, seat: usize, value: &str) -> Result<(), &'static str> {
        let participant = self.participant(seat).ok_or("invalid deck seat")?;
        if !self.human.get(seat).copied().unwrap_or(false) || self.secrets[participant].is_some() {
            return Err("deck opening unavailable");
        }
        let secret = scalar_from_wire(value)?;
        if public_key(secret) != self.keys[participant].ok_or("deck key missing")?.0 {
            return Err("invalid deck secret");
        }
        self.secrets[participant] = Some(secret);
        self.record("opening", Some(seat), &scalar_bytes(secret));
        Ok(())
    }

    pub fn all_secrets(&self) -> bool {
        self.secrets.iter().all(Option::is_some)
    }

    pub fn needs_secret(&self, seat: usize) -> bool {
        self.participant(seat)
            .is_some_and(|participant| self.secrets[participant].is_none())
    }

    pub fn finish(&mut self) -> Result<[u8; CARD_COUNT], &'static str> {
        if self.complete || !self.all_secrets() {
            return Err("deck openings missing");
        }
        let secrets = self.secrets.iter().flatten().copied().collect::<Vec<_>>();
        let deck = core::array::from_fn(|position| {
            let shares = secrets
                .iter()
                .map(|&secret| share(self.deck[position], secret))
                .collect::<Vec<_>>();
            open(self.deck[position], &shares).expect("verified deck opening")
        });
        self.record("opening", None, &scalar_bytes(self.server_secret));
        self.complete = true;
        self.record("complete", None, &deck);
        Ok(deck)
    }

    pub fn audit(&self) -> Result<AuditWire, &'static str> {
        if !self.complete {
            return Err("hand is still active");
        }
        let keys = self
            .keys
            .iter()
            .map(|entry| point_wire(entry.unwrap().0))
            .collect();
        let key_proofs = self
            .keys
            .iter()
            .map(|entry| proof_wire(entry.unwrap().1))
            .collect();
        let openings = self
            .secrets
            .iter()
            .flatten()
            .map(|&secret| hex(&scalar_bytes(secret)))
            .collect::<Vec<_>>();
        let secrets = self.secrets.iter().flatten().copied().collect::<Vec<_>>();
        let deck = self
            .deck
            .iter()
            .map(|&card| {
                let shares = secrets
                    .iter()
                    .map(|&secret| share(card, secret))
                    .collect::<Vec<_>>();
                open(card, &shares).ok_or("invalid final deck")
            })
            .collect::<Result<Vec<_>, _>>()?;

        Ok(AuditWire {
            protocol_version: VERSION,
            room: self.room,
            hand_no: self.hand_no,
            dealer: self.dealer,
            human: self.human.clone(),
            transcript_hash: hex(&self.head),
            keys,
            key_proofs,
            shuffles: self.shuffles.iter().map(shuffle_wire).collect(),
            openings,
            deck,
            records: self.records.clone(),
        })
    }

    fn owner(&self, position: usize) -> Option<usize> {
        let players = self.human.len();
        (position < players * 2).then(|| {
            let offset = position % players;
            let first = (self.dealer + 1) % players;
            (first + offset) % players
        })
    }

    fn participant(&self, seat: usize) -> Option<usize> {
        self.seats
            .iter()
            .position(|&value| value == seat)
            .map(|index| index + 1)
    }

    fn record(&mut self, kind: &str, seat: Option<usize>, payload: &[u8]) {
        let seq = self.records.len() as u64;
        self.head = transcript_next(self.head, seq, kind, seat, payload).expect("deck transcript");
        self.records.push(RecordWire {
            seq,
            kind: kind.to_owned(),
            seat,
            payload: STANDARD.encode(payload),
            hash: hex(&self.head),
        });
    }
}

pub fn point_wire(point: Affine) -> PointWire {
    let bytes = point_bytes(point);
    PointWire {
        x: format!("0x{}", hex(&bytes[..32])),
        y: format!("0x{}", hex(&bytes[32..])),
    }
}

pub fn point_from_wire(value: PointWire) -> Result<Affine, &'static str> {
    let x = decode_32(&value.x)?;
    let y = decode_32(&value.y)?;
    let mut bytes = [0; 64];
    bytes[..32].copy_from_slice(&x);
    bytes[32..].copy_from_slice(&y);
    point_from_bytes(bytes).ok_or("invalid curve point")
}

pub fn cipher_wire(value: Cipher) -> CipherWire {
    CipherWire {
        left: point_wire(value.left),
        right: point_wire(value.right),
    }
}

pub fn cipher_from_wire(value: CipherWire) -> Result<Cipher, &'static str> {
    Ok(Cipher {
        left: point_from_wire(value.left)?,
        right: point_from_wire(value.right)?,
    })
}

pub fn proof_wire(value: Proof) -> ProofWire {
    ProofWire {
        a: point_wire(value.a),
        b: point_wire(value.b),
        z: format!("0x{}", hex(&scalar_bytes(value.z))),
    }
}

pub fn proof_from_wire(value: ProofWire) -> Result<Proof, &'static str> {
    Ok(Proof {
        a: point_from_wire(value.a)?,
        b: point_from_wire(value.b)?,
        z: scalar_from_wire(&value.z)?,
    })
}

pub fn scalar_from_wire(value: &str) -> Result<Fr, &'static str> {
    scalar_from_bytes(decode_32(value)?)
        .filter(|value| *value != Fr::from(0u64))
        .ok_or("invalid scalar")
}

fn key_payload(key: Affine, proof: Proof) -> Vec<u8> {
    [point_bytes(key).as_slice(), proof_payload(proof).as_slice()].concat()
}

fn proof_payload(proof: Proof) -> Vec<u8> {
    [
        point_bytes(proof.a).as_slice(),
        point_bytes(proof.b).as_slice(),
        scalar_bytes(proof.z).as_slice(),
    ]
    .concat()
}

fn share_payload(position: usize, value: Affine, proof: Proof) -> Vec<u8> {
    [
        (position as u64).to_be_bytes().as_slice(),
        point_bytes(value).as_slice(),
        proof_payload(proof).as_slice(),
    ]
    .concat()
}

fn shuffle_payload(
    participant: usize,
    input: &[Cipher; CARD_COUNT],
    output: &[Cipher; CARD_COUNT],
    proof: &ShuffleProof,
) -> Vec<u8> {
    let mut payload = vec![u8::try_from(participant).expect("participant index")];
    payload.extend(deck_payload(input));
    payload.extend(deck_payload(output));
    payload.extend_from_slice(&proof.proof_bytes);
    payload.extend_from_slice(&proof.public_input_bytes);
    payload
}

fn deck_payload(deck: &[Cipher; CARD_COUNT]) -> Vec<u8> {
    deck.iter()
        .flat_map(|card| [point_bytes(card.left), point_bytes(card.right)])
        .flatten()
        .collect()
}

fn shuffle_wire(value: &ShuffleRecord) -> ShuffleWire {
    ShuffleWire {
        participant: value.participant,
        input: value.input.iter().copied().map(cipher_wire).collect(),
        output: value.output.iter().copied().map(cipher_wire).collect(),
        proof: STANDARD.encode(&value.proof),
        public_inputs: STANDARD.encode(&value.public_inputs),
    }
}

fn decode_32(value: &str) -> Result<[u8; 32], &'static str> {
    let value = value.strip_prefix("0x").unwrap_or(value);
    if value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("invalid field");
    }
    let mut bytes = [0; 32];
    for (index, byte) in bytes.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&value[index * 2..index * 2 + 2], 16)
            .map_err(|_| "invalid field")?;
    }
    Ok(bytes)
}

fn hex(value: &[u8]) -> String {
    value.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn share_nonce(secret: Fr, context: [u8; 32], position: usize) -> Fr {
    let mut hash = Sha256::new();
    hash.update(b"NPSNONCE");
    hash.update(scalar_bytes(secret));
    hash.update(context);
    hash.update((position as u64).to_be_bytes());
    let mut bytes: [u8; 32] = hash.finalize().into();
    bytes[0] = 0;
    scalar_from_bytes(bytes).expect("share nonce")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dummy() -> ShuffleProof {
        ShuffleProof {
            proof: vec![vec![1]],
            public_inputs: vec![vec![2]],
            proof_bytes: vec![1],
            public_input_bytes: vec![2],
        }
    }

    #[test]
    fn keys_bind_order() {
        let room = Uuid::from_bytes([1; 16]);
        let mut deck = MentalDeck::new(
            room,
            2,
            0,
            vec![true, true],
            Fr::from(7u64),
            Fr::from(11u64),
        );
        let secret = Fr::from(13u64);
        let proof = prove_key(secret, Fr::from(17u64), &deck.head);

        assert!(deck.add_key(1, public_key(secret), proof).is_err());
        assert!(deck.add_key(0, public_key(secret), proof).is_ok());
    }

    #[test]
    fn private_then_full_open() {
        let room = Uuid::from_bytes([2; 16]);
        let server = Fr::from(7u64);
        let client = Fr::from(13u64);
        let mut deck = MentalDeck::new(room, 0, 0, vec![true, false], server, Fr::from(11u64));
        let proof = prove_key(client, Fr::from(17u64), &deck.head);
        deck.add_key(0, public_key(client), proof).unwrap();
        let key = deck.aggregate_key().unwrap();
        let permutation = core::array::from_fn(|i| CARD_COUNT - i - 1);
        let masks = core::array::from_fn(|i| Fr::from(i as u64 + 30));
        let first = deck_crypto::shuffle(&deck.deck, &permutation, &masks, key).unwrap();
        deck.add_shuffle(0, first, dummy()).unwrap();
        let masks = core::array::from_fn(|i| Fr::from(i as u64 + 100));
        let second = deck_crypto::shuffle(&deck.deck, &permutation, &masks, key).unwrap();
        deck.add_shuffle(1, second, dummy()).unwrap();
        deck.begin_open(OpenKind::Private, (0..4).collect())
            .unwrap();
        let context = deck.head;
        let participant = deck.participant_for(0).unwrap();
        let shares = deck
            .needed_shares(0)
            .unwrap()
            .into_iter()
            .map(|position| {
                let value = prove_share(
                    deck.deck[position],
                    client,
                    Fr::from(position as u64 + 200),
                    &context,
                );
                ShareWire {
                    participant,
                    position,
                    context: hex(&context),
                    value: point_wire(value.0),
                    proof: proof_wire(value.1),
                }
            })
            .collect();
        deck.add_shares(0, shares).unwrap();

        assert_eq!(deck.private_packet(0).unwrap().len(), 2);
        deck.private_ack(0).unwrap();
        assert_eq!(deck.open_requested().unwrap().len(), 2);
        deck.reveal_secret(0, &format!("0x{}", hex(&scalar_bytes(client))))
            .unwrap();
        let cards = deck.finish().unwrap();

        assert_eq!(
            cards
                .iter()
                .copied()
                .collect::<std::collections::HashSet<_>>()
                .len(),
            52
        );
        let audit = deck.audit().unwrap();
        assert_eq!(audit.dealer, 0);
        assert_eq!(audit.human, vec![true, false]);
        assert_eq!(audit.transcript_hash, hex(&deck.head));
    }
}
