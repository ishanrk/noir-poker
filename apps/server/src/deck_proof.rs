use std::error::Error;
use std::io;
use std::path::Path;
use std::sync::{Arc, Mutex};

use acir::circuit::Program;
use acir::native_types::{Witness, WitnessMap, WitnessStack};
use acir::{AcirField, FieldElement};
use acvm::pwg::{ACVM, ACVMStatus};
use barretenberg_rs::BarretenbergApi;
use barretenberg_rs::backends::PipeBackend;
use barretenberg_rs::generated_types::{CircuitInput, ProofSystemSettings};
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use bn254_blackbox_solver::Bn254BlackBoxSolver;
use deck_crypto::{CARD_COUNT, Cipher, Fr, point_bytes, scalar_bytes};
use serde::Deserialize;
use sha2::{Digest, Sha256};

const ARTIFACT: &[u8] = include_bytes!("../zk/deck_shuffle.json");
const VK: &[u8] = include_bytes!("../zk/deck_shuffle.vk");
const VERSION: u8 = 1;
const PUBLIC_FIELDS: usize = 453;
const PRIVATE_FIELDS: usize = 104;
const FIELD_BYTES: usize = 32;
const MAX_PROOF_BYTES: usize = 65_536;
const ARTIFACT_DIGEST: [u8; 32] = [
    0xfc, 0x13, 0x44, 0x12, 0x9d, 0xef, 0xfc, 0xf6, 0x7d, 0x47, 0x7b, 0x2d, 0x22, 0x20, 0x8a, 0x80,
    0x17, 0x37, 0x78, 0xa3, 0xdd, 0x8d, 0x29, 0x9e, 0xdb, 0x55, 0xb6, 0x7a, 0xfd, 0x90, 0xf7, 0x06,
];
const VK_DIGEST: [u8; 32] = [
    0x6f, 0x6b, 0x8d, 0x39, 0x7b, 0xee, 0xe8, 0x7b, 0x20, 0x50, 0x9f, 0xaa, 0x25, 0x30, 0x73, 0x3f,
    0x96, 0xa4, 0x3c, 0x58, 0xa3, 0x75, 0xa9, 0xc1, 0xa3, 0x1d, 0x6b, 0x18, 0x82, 0x58, 0x62, 0x7b,
];

type DeckResult<T> = Result<T, Box<dyn Error + Send + Sync>>;

#[derive(Deserialize)]
struct Artifact {
    bytecode: String,
}

#[derive(Clone)]
pub struct DeckProofs {
    api: Arc<Mutex<BarretenbergApi<PipeBackend>>>,
    bytecode: Arc<Vec<u8>>,
    program: Arc<Program<FieldElement>>,
}

pub struct ShuffleInput<'a> {
    pub hand_no: u64,
    pub seat: usize,
    pub context: [u8; 32],
    pub input: &'a [Cipher; CARD_COUNT],
    pub output: &'a [Cipher; CARD_COUNT],
    pub key: deck_crypto::Affine,
    pub permutation: &'a [usize; CARD_COUNT],
    pub masks: &'a [Fr; CARD_COUNT],
}

pub struct ShuffleProof {
    pub proof: Vec<Vec<u8>>,
    pub public_inputs: Vec<Vec<u8>>,
    pub proof_bytes: Vec<u8>,
    pub public_input_bytes: Vec<u8>,
}

impl DeckProofs {
    pub fn load(bb: impl AsRef<Path>) -> DeckResult<Self> {
        if Sha256::digest(ARTIFACT).as_slice() != ARTIFACT_DIGEST
            || Sha256::digest(VK).as_slice() != VK_DIGEST
        {
            return Err(io::Error::other("deck proof artifact mismatch").into());
        }
        let artifact: Artifact = serde_json::from_slice(ARTIFACT)?;
        let bytecode = STANDARD.decode(artifact.bytecode)?;
        let program = Program::deserialize_program(&bytecode)?;
        let circuit = program
            .functions
            .first()
            .ok_or_else(|| io::Error::other("deck proof circuit missing"))?;

        if circuit.public_parameters.indices().len() != PUBLIC_FIELDS
            || circuit.private_parameters.len() != PRIVATE_FIELDS
        {
            return Err(io::Error::other("deck proof input mismatch").into());
        }

        Ok(Self {
            api: Arc::new(Mutex::new(BarretenbergApi::new(PipeBackend::new(
                bb, None,
            )?))),
            bytecode: Arc::new(bytecode),
            program: Arc::new(program),
        })
    }

    pub async fn prove(&self, input: ShuffleInput<'_>) -> DeckResult<ShuffleProof> {
        let bytecode = Arc::clone(&self.bytecode);
        let api = Arc::clone(&self.api);
        let witness = witness(&self.program, input)?;

        tokio::task::spawn_blocking(move || {
            let mut api = api
                .lock()
                .map_err(|_| io::Error::other("deck prover stopped"))?;
            let result = api.circuit_prove(
                CircuitInput {
                    name: "deck_shuffle".to_owned(),
                    bytecode: bytecode.as_ref().clone(),
                    verification_key: VK.to_vec(),
                },
                &witness,
                settings(),
            )?;
            let proof_bytes = result.proof.concat();
            let public_input_bytes = result.public_inputs.concat();

            Ok(ShuffleProof {
                proof: result.proof,
                public_inputs: result.public_inputs,
                proof_bytes,
                public_input_bytes,
            })
        })
        .await?
    }

    pub async fn verify(&self, proof: &ShuffleProof) -> DeckResult<bool> {
        let api = Arc::clone(&self.api);
        let proof_fields = proof.proof.clone();
        let public_inputs = proof.public_inputs.clone();

        tokio::task::spawn_blocking(move || {
            let mut api = api
                .lock()
                .map_err(|_| io::Error::other("deck verifier stopped"))?;
            Ok(api
                .circuit_verify(VK, public_inputs, proof_fields, settings())?
                .verified)
        })
        .await?
    }
}

pub fn decode(proof: &str, public_inputs: &str) -> Result<ShuffleProof, &'static str> {
    let proof_bytes = STANDARD
        .decode(proof)
        .map_err(|_| "invalid shuffle proof")?;
    let public_input_bytes = STANDARD
        .decode(public_inputs)
        .map_err(|_| "invalid shuffle proof")?;

    if proof_bytes.is_empty()
        || proof_bytes.len() > MAX_PROOF_BYTES
        || !proof_bytes.len().is_multiple_of(FIELD_BYTES)
        || public_input_bytes.len() != PUBLIC_FIELDS * FIELD_BYTES
    {
        return Err("invalid shuffle proof");
    }

    Ok(ShuffleProof {
        proof: fields(&proof_bytes),
        public_inputs: fields(&public_input_bytes),
        proof_bytes,
        public_input_bytes,
    })
}

fn witness(program: &Program<FieldElement>, input: ShuffleInput<'_>) -> DeckResult<Vec<u8>> {
    let circuit = &program.functions[0];
    let mut public = Vec::with_capacity(PUBLIC_FIELDS);
    let mut private = Vec::with_capacity(PRIVATE_FIELDS);

    public.push(field_u64(VERSION.into()));
    public.push(field_u64(input.hand_no));
    public.push(field_u64(u64::try_from(input.seat)?));
    public.extend(
        input
            .context
            .into_iter()
            .map(|value| field_u64(value.into())),
    );
    deck_fields(&mut public, input.input);
    deck_fields(&mut public, input.output);
    point_fields(&mut public, input.key);
    private.extend(
        input
            .permutation
            .iter()
            .map(|&value| field_u64(u64::try_from(value).expect("deck index"))),
    );
    private.extend(input.masks.iter().map(|&value| field(scalar_bytes(value))));

    if public.len() != PUBLIC_FIELDS || private.len() != PRIVATE_FIELDS {
        return Err(io::Error::other("deck proof input mismatch").into());
    }

    let mut initial = WitnessMap::new();
    for (index, value) in circuit.public_parameters.indices().into_iter().zip(public) {
        initial.insert(Witness(index), value);
    }
    for (index, value) in circuit.private_parameters.iter().zip(private) {
        initial.insert(*index, value);
    }

    let backend = Bn254BlackBoxSolver;
    let mut vm = ACVM::new(
        &backend,
        &circuit.opcodes,
        initial,
        &program.unconstrained_functions,
        &[],
    );

    match vm.solve() {
        ACVMStatus::Solved => WitnessStack::from(vm.finalize())
            .serialize()
            .map_err(Into::into),
        status => Err(io::Error::other(format!("deck witness {status}")).into()),
    }
}

fn deck_fields(output: &mut Vec<FieldElement>, deck: &[Cipher; CARD_COUNT]) {
    for side in [false, true] {
        for axis in [false, true] {
            for card in deck {
                let point = if side { card.right } else { card.left };
                let bytes = point_bytes(point);
                output.push(field(if axis {
                    bytes[32..].try_into().expect("point y")
                } else {
                    bytes[..32].try_into().expect("point x")
                }));
            }
        }
    }
}

fn point_fields(output: &mut Vec<FieldElement>, point: deck_crypto::Affine) {
    let bytes = point_bytes(point);

    output.push(field(bytes[..32].try_into().expect("point x")));
    output.push(field(bytes[32..].try_into().expect("point y")));
}

fn field(bytes: [u8; 32]) -> FieldElement {
    FieldElement::from_be_bytes_reduce(&bytes)
}

fn field_u64(value: u64) -> FieldElement {
    FieldElement::from(value as u128)
}

fn fields(bytes: &[u8]) -> Vec<Vec<u8>> {
    bytes
        .chunks_exact(FIELD_BYTES)
        .map(<[u8]>::to_vec)
        .collect()
}

fn settings() -> ProofSystemSettings {
    ProofSystemSettings {
        ipa_accumulation: false,
        oracle_hash_type: "poseidon2".to_owned(),
        disable_zk: false,
        optimized_solidity_verifier: false,
    }
}

#[cfg(test)]
mod tests {
    use deck_crypto::{aggregate, canonical_deck, public_key, shuffle};

    use super::*;

    #[test]
    fn witness_executes() {
        let artifact: Artifact = serde_json::from_slice(ARTIFACT).unwrap();
        let bytecode = STANDARD.decode(artifact.bytecode).unwrap();
        let program = Program::deserialize_program(&bytecode).unwrap();
        let secret = Fr::from(7u64);
        let key = aggregate(&[public_key(secret)]);
        let deck = canonical_deck();
        let permutation = core::array::from_fn(|i| CARD_COUNT - i - 1);
        let masks = core::array::from_fn(|i| Fr::from(i as u64 + 100));
        let output = shuffle(&deck, &permutation, &masks, key).unwrap();
        let input = ShuffleInput {
            hand_no: 3,
            seat: 0,
            context: [9; 32],
            input: &deck,
            output: &output,
            key,
            permutation: &permutation,
            masks: &masks,
        };

        assert!(!witness(&program, input).unwrap().is_empty());
    }
}
