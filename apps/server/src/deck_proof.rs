use std::error::Error;
use std::io;
use std::io::Read;
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
use flate2::read::GzDecoder;
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
    0x89, 0x32, 0x7e, 0x37, 0x8e, 0xd1, 0x16, 0x18, 0x25, 0x26, 0x0e, 0xb6, 0xa5, 0xb3, 0xbc, 0xa7,
    0x88, 0xd1, 0x8d, 0x88, 0xfa, 0x8f, 0x09, 0xd4, 0xee, 0x15, 0xd0, 0x73, 0xa8, 0x61, 0xb8, 0xe5,
];
const VK_DIGEST: [u8; 32] = [
    0x4e, 0x82, 0x92, 0x5a, 0x6f, 0xf5, 0x6b, 0x94, 0xd6, 0x2d, 0x36, 0x65, 0x89, 0x9e, 0x44, 0xc8,
    0x7c, 0x97, 0x20, 0xf8, 0xbd, 0x47, 0xd2, 0x50, 0x27, 0x3a, 0x55, 0x3d, 0x6d, 0x68, 0xcc, 0xc1,
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

pub struct ShufflePublic<'a> {
    pub hand_no: u64,
    pub seat: usize,
    pub context: [u8; 32],
    pub input: &'a [Cipher; CARD_COUNT],
    pub output: &'a [Cipher; CARD_COUNT],
    pub key: deck_crypto::Affine,
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
        let compressed = STANDARD.decode(artifact.bytecode)?;
        let program = Program::deserialize_program(&compressed)?;
        let bytecode = decompress(&compressed)?;
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
        let permit = crate::proof_admission::admit().await?;
        let bytecode = Arc::clone(&self.bytecode);
        let api = Arc::clone(&self.api);
        let program = Arc::clone(&self.program);
        let (hand_no, seat, context, key) = (input.hand_no, input.seat, input.context, input.key);
        let (deck, output, permutation, masks) = (
            *input.input,
            *input.output,
            *input.permutation,
            *input.masks,
        );

        tokio::task::spawn_blocking(move || {
            // Admission stays charged until the actual blocking call ends, even if its caller leaves.
            let _permit = permit;
            let witness_at = std::time::Instant::now();
            let witness = witness(
                &program,
                ShuffleInput {
                    hand_no,
                    seat,
                    context,
                    key,
                    input: &deck,
                    output: &output,
                    permutation: &permutation,
                    masks: &masks,
                },
            )?;
            crate::proof_admission::record("witness", witness_at);
            let proof_at = std::time::Instant::now();
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
            crate::proof_admission::record("prove", proof_at);
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
        let permit = crate::proof_admission::admit().await?;
        let api = Arc::clone(&self.api);
        let proof_fields = proof.proof.clone();
        let public_inputs = proof.public_inputs.clone();

        tokio::task::spawn_blocking(move || {
            let _permit = permit;
            let mut api = api
                .lock()
                .map_err(|_| io::Error::other("deck verifier stopped"))?;
            let at = std::time::Instant::now();
            let result = api
                .circuit_verify(VK, public_inputs, proof_fields, settings())?
                .verified;
            crate::proof_admission::record("verify", at);
            Ok(result)
        })
        .await?
    }

    pub fn matches(&self, input: ShufflePublic<'_>, proof: &ShuffleProof) -> bool {
        let mut fields = Vec::with_capacity(PUBLIC_FIELDS);

        public_fields(&mut fields, input);
        fields
            .into_iter()
            .flat_map(|value| value.to_be_bytes())
            .eq(proof.public_input_bytes.iter().copied())
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

    public_fields(
        &mut public,
        ShufflePublic {
            hand_no: input.hand_no,
            seat: input.seat,
            context: input.context,
            input: input.input,
            output: input.output,
            key: input.key,
        },
    );
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
        ACVMStatus::Solved => {
            let compressed = WitnessStack::from(vm.finalize()).serialize()?;
            Ok(decompress(&compressed)?)
        }
        status => Err(io::Error::other(format!("deck witness {status}")).into()),
    }
}

fn decompress(input: &[u8]) -> io::Result<Vec<u8>> {
    let mut output = Vec::new();

    GzDecoder::new(input).read_to_end(&mut output)?;
    Ok(output)
}

fn public_fields(output: &mut Vec<FieldElement>, input: ShufflePublic<'_>) {
    output.push(field_u64(VERSION.into()));
    output.push(field_u64(input.hand_no));
    output.push(field_u64(
        u64::try_from(input.seat).expect("participant index"),
    ));
    output.extend(
        input
            .context
            .into_iter()
            .map(|value| field_u64(value.into())),
    );
    deck_fields(output, input.input);
    deck_fields(output, input.output);
    point_fields(output, input.key);
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

    #[tokio::test]
    #[ignore = "requires BB_PATH"]
    async fn real_shuffle() {
        let bb = std::env::var("BB_PATH").unwrap();
        let prover = DeckProofs::load(bb).unwrap();
        let secret = Fr::from(7u64);
        let key = aggregate(&[public_key(secret)]);
        let deck = canonical_deck();
        let permutation = core::array::from_fn(|i| CARD_COUNT - i - 1);
        let masks = core::array::from_fn(|i| Fr::from(i as u64 + 100));
        let output = shuffle(&deck, &permutation, &masks, key).unwrap();
        let proof = prover
            .prove(ShuffleInput {
                hand_no: 3,
                seat: 0,
                context: [9; 32],
                input: &deck,
                output: &output,
                key,
                permutation: &permutation,
                masks: &masks,
            })
            .await
            .unwrap();

        assert!(prover.matches(
            ShufflePublic {
                hand_no: 3,
                seat: 0,
                context: [9; 32],
                input: &deck,
                output: &output,
                key,
            },
            &proof,
        ));
        assert!(prover.verify(&proof).await.unwrap());
    }
}
